import { db } from "../db/index.js";
import { adminConfig, modelMonitor, modelTestState, providers } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";

/**
 * Data is valid until the next scheduled test replaces it.
 * No time-based stale cutoff — the smart retry system controls when models are tested.
 */
export const MONITOR_STALE_MINUTES = 60 * 24; // 24 hours (effectively "no stale cutoff")

export type MonitorAutoMode = "off" | "notif_only" | "auto";

export type MonitorSnapshotRow = {
  modelId: string;
  provider: string | null;
  isOnline: boolean;
  latencyMs: number;
  httpStatus: number;
  errorMessage: string | null;
  baseUrl: string | null;
  checkedAt: Date;
};

export type UpsertModelStatusSource = "sweep" | "admin";

export function isForceDeactivatedMessage(msg: string | null | undefined): boolean {
  return /force-deactivated/i.test(String(msg || ""));
}

export function normalizeMonitorAutoMode(raw: unknown): MonitorAutoMode {
  const mode = String(raw || "notif_only").toLowerCase();
  if (mode === "off" || mode === "auto" || mode === "notif_only") return mode;
  return "notif_only";
}

export async function getMonitorAutoMode(): Promise<MonitorAutoMode> {
  const [config] = await db.select().from(adminConfig).limit(1);
  return normalizeMonitorAutoMode(config?.monitorAutoMode);
}

/** Probe looks healthy (for admin indicator), independent of published is_online. */
export function isProbeOk(httpStatus: number | null | undefined): boolean {
  const s = Number(httpStatus) || 0;
  return s >= 200 && s < 300;
}

/**
 * Client catalog / Discord / chat access matrix:
 * - visible: show in /v1/models, portal, Discord when admin Published ON
 * - requestable: allow chat when Published ON (Probe is advisory — stale Fail must not 503)
 * - clientOnline: label "Online" only when Published AND Probe OK
 * Admin Model Monitor always lists all models regardless.
 */
export type ClientCatalogFlags = {
  published: boolean;
  probeOk: boolean;
  visible: boolean;
  clientOnline: boolean;
  requestable: boolean;
};

export function getClientCatalogFlags(params: {
  published: boolean | null | undefined;
  httpStatus?: number | null | undefined;
}): ClientCatalogFlags {
  const published = Boolean(params.published);
  const probeOk = isProbeOk(params.httpStatus);
  return {
    published,
    probeOk,
    visible: published,
    clientOnline: published && probeOk,
    requestable: published,
  };
}

export async function getActiveProviderNames(): Promise<Set<string>> {
  const rows = await db
    .select({ name: providers.name })
    .from(providers)
    .where(eq(providers.isActive, true));
  return new Set(rows.map((r) => r.name));
}

/** When an upstream is renamed in Settings, keep monitor rows in sync. */
export async function renameProviderInMonitor(oldName: string, newName: string): Promise<void> {
  if (!oldName || !newName || oldName === newName) return;
  await db.update(modelMonitor).set({ provider: newName }).where(eq(modelMonitor.provider, oldName));
  await db.update(modelTestState).set({ provider: newName }).where(eq(modelTestState.provider, oldName));
}

/**
 * Insert/refresh monitor rows from a /models list so new upstreams appear in
 * Model Monitor immediately (Published OFF until probed / manually enabled).
 */
export async function seedMonitorModelsFromList(
  providerName: string,
  baseUrl: string,
  modelIds: string[],
): Promise<number> {
  let count = 0;
  const now = new Date();
  for (const modelId of modelIds) {
    const id = String(modelId || "").trim();
    if (!id) continue;
    const existing = await db
      .select({ id: modelMonitor.id })
      .from(modelMonitor)
      .where(and(eq(modelMonitor.modelId, id), eq(modelMonitor.provider, providerName)))
      .limit(1)
      .then((r) => r[0]);
    if (existing) {
      await db
        .update(modelMonitor)
        .set({ baseUrl })
        .where(eq(modelMonitor.id, existing.id));
    } else {
      await db.insert(modelMonitor).values({
        modelId: id,
        provider: providerName,
        isOnline: false,
        latencyMs: 0,
        httpStatus: 0,
        errorMessage: "Listed from /models — pending probe",
        baseUrl,
        checkedAt: now,
      });
      count++;
    }
  }
  return count;
}

export async function purgeMonitorForProvider(providerName: string): Promise<void> {
  await db.delete(modelMonitor).where(eq(modelMonitor.provider, providerName));
  await db.delete(modelTestState).where(eq(modelTestState.provider, providerName));
}

/**
 * Upsert probe/snapshot rows without wiping manual published state.
 * Never deletes the table — preserves force-OFF and notif_only catalog.
 */
export async function replaceModelMonitorSnapshot(
  values: MonitorSnapshotRow[],
): Promise<number> {
  const activeNames = await getActiveProviderNames();
  const filtered = values.filter((v) => v.provider && activeNames.has(v.provider));

  for (const v of filtered) {
    await upsertModelStatus(
      {
        modelId: v.modelId,
        provider: v.provider,
        isOnline: v.isOnline,
        latencyMs: v.latencyMs,
        httpStatus: v.httpStatus,
        errorMessage: v.errorMessage,
        baseUrl: v.baseUrl,
      },
      { source: "sweep" },
    );
  }
  return filtered.length;
}

export function monitorStaleCutoffIso(): string {
  const d = new Date(Date.now() - MONITOR_STALE_MINUTES * 60 * 1000);
  return d.toISOString().replace("T", " ").substring(0, 19);
}

// ─── Smart Retry: Upsert single model status ──────────────────────────────────

const MAX_RETRIES = 3;

/**
 * Upsert a single model's status into model_monitor, and update model_test_state
 * for retry tracking.
 *
 * source=admin: always writes published is_online (manual catalog for Discord/client).
 * source=sweep:
 *   - force-deactivated rows: probe fields only (keep published OFF + force message)
 *   - notif_only / off: probe fields only (never flip published is_online)
 *   - auto: probe result writes published is_online
 */
export async function upsertModelStatus(
  params: {
    modelId: string;
    provider: string | null;
    isOnline: boolean;
    latencyMs: number;
    httpStatus: number;
    errorMessage: string | null;
    baseUrl: string | null;
  },
  opts: { source?: UpsertModelStatusSource } = {},
): Promise<void> {
  const source: UpsertModelStatusSource = opts.source || "sweep";
  const now = new Date();
  const nowStr = now.toISOString().replace("T", " ").substring(0, 19);
  const mode = source === "admin" ? "auto" : await getMonitorAutoMode();

  const existing = await db
    .select()
    .from(modelMonitor)
    .where(
      and(
        eq(modelMonitor.modelId, params.modelId),
        params.provider
          ? eq(modelMonitor.provider, params.provider)
          : sql`${modelMonitor.provider} IS NULL`,
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);

  const existingForced = existing
    ? isForceDeactivatedMessage(existing.errorMessage)
    : false;
  const adminForced = source === "admin" && isForceDeactivatedMessage(params.errorMessage);

  let nextOnline = params.isOnline;
  let nextError = params.errorMessage;

  if (source === "sweep") {
    if (existingForced) {
      // Sticky manual OFF: update probe indicators only.
      nextOnline = false;
      nextError = existing!.errorMessage;
    } else if (mode === "notif_only" || mode === "off") {
      // Probe notifies admin only — keep published catalog as-is.
      nextOnline = existing ? Boolean(existing.isOnline) : false;
      // Keep prior force message if any; otherwise store probe error for indicator.
      nextError = existingForced
        ? existing!.errorMessage
        : params.errorMessage;
    }
    // mode === "auto": use params.isOnline / params.errorMessage as published
  } else {
    // admin: params win (activate clears error; deactivate sets force message)
    nextOnline = params.isOnline;
    nextError = adminForced
      ? params.errorMessage
      : params.isOnline
        ? null
        : params.errorMessage;
  }

  if (existing) {
    await db
      .update(modelMonitor)
      .set({
        isOnline: nextOnline,
        latencyMs: params.latencyMs,
        httpStatus: params.httpStatus,
        errorMessage: nextError,
        baseUrl: params.baseUrl ?? existing.baseUrl,
        checkedAt: now,
      })
      .where(eq(modelMonitor.id, existing.id));
  } else {
    await db.insert(modelMonitor).values({
      modelId: params.modelId,
      provider: params.provider,
      // New rows from sweep in notif_only start published OFF until admin ON.
      isOnline: source === "admin" ? nextOnline : mode === "auto" ? params.isOnline : false,
      latencyMs: params.latencyMs,
      httpStatus: params.httpStatus,
      errorMessage:
        source === "admin"
          ? nextError
          : mode === "auto"
            ? params.errorMessage
            : params.errorMessage,
      baseUrl: params.baseUrl,
      checkedAt: now,
    });
  }

  // Retry state tracks probe health (sweep), not admin toggles.
  if (source === "admin") return;

  const stateRow = await db
    .select()
    .from(modelTestState)
    .where(
      and(
        eq(modelTestState.modelId, params.modelId),
        params.provider
          ? eq(modelTestState.provider, params.provider)
          : sql`${modelTestState.provider} IS NULL`,
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);

  const probeOnline = params.isOnline;

  if (probeOnline) {
    if (stateRow) {
      await db
        .update(modelTestState)
        .set({ retryCount: 0, lastTestAt: nowStr, suspendedUntil: null })
        .where(eq(modelTestState.id, stateRow.id));
    } else {
      await db.insert(modelTestState).values({
        modelId: params.modelId,
        provider: params.provider,
        retryCount: 0,
        lastTestAt: nowStr,
        suspendedUntil: null,
      });
    }
  } else if (params.httpStatus === 429) {
    if (stateRow) {
      await db
        .update(modelTestState)
        .set({ lastTestAt: nowStr })
        .where(eq(modelTestState.id, stateRow.id));
    } else {
      await db.insert(modelTestState).values({
        modelId: params.modelId,
        provider: params.provider,
        retryCount: 0,
        lastTestAt: nowStr,
        suspendedUntil: null,
      });
    }
  } else {
    const newRetryCount = (stateRow?.retryCount ?? 0) + 1;
    const suspendedUntil = newRetryCount >= MAX_RETRIES ? get24HoursFromNowIso() : null;

    if (stateRow) {
      await db
        .update(modelTestState)
        .set({ retryCount: newRetryCount, lastTestAt: nowStr, suspendedUntil })
        .where(eq(modelTestState.id, stateRow.id));
    } else {
      await db.insert(modelTestState).values({
        modelId: params.modelId,
        provider: params.provider,
        retryCount: newRetryCount,
        lastTestAt: nowStr,
        suspendedUntil,
      });
    }
  }
}

/** Get all model test states (for bot to recover retry state on startup). */
export async function getModelTestStates(): Promise<
  Array<{
    modelId: string;
    provider: string | null;
    retryCount: number;
    lastTestAt: string | null;
    suspendedUntil: string | null;
  }>
> {
  return db
    .select({
      modelId: modelTestState.modelId,
      provider: modelTestState.provider,
      retryCount: modelTestState.retryCount,
      lastTestAt: modelTestState.lastTestAt,
      suspendedUntil: modelTestState.suspendedUntil,
    })
    .from(modelTestState);
}

/** Reset all retry states (midnight reset). */
export async function resetAllTestStates(): Promise<void> {
  await db
    .update(modelTestState)
    .set({ retryCount: 0, suspendedUntil: null });
}

/**
 * Flip published offline for a provider when no usable keys (auto mode / access honesty).
 * In notif_only this still flips published — call only from live traffic key exhaustion.
 */
export async function markProviderModelsOffline(
  providerName: string,
  errorMessage: string,
): Promise<void> {
  const mode = await getMonitorAutoMode();
  if (mode === "notif_only" || mode === "off") {
    // Don't clobber manual catalog; only annotate non-forced rows' probe fields.
    const rows = await db
      .select()
      .from(modelMonitor)
      .where(eq(modelMonitor.provider, providerName));
    for (const row of rows) {
      if (isForceDeactivatedMessage(row.errorMessage)) continue;
      await db
        .update(modelMonitor)
        .set({
          httpStatus: 0,
          errorMessage,
          checkedAt: new Date(),
        })
        .where(eq(modelMonitor.id, row.id));
    }
    return;
  }

  await db
    .update(modelMonitor)
    .set({
      isOnline: false,
      httpStatus: 0,
      errorMessage,
      checkedAt: new Date(),
    })
    .where(eq(modelMonitor.provider, providerName));
}

/** Get 24 hours from now as ISO string (for suspension). */
function get24HoursFromNowIso(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return d.toISOString().replace("T", " ").substring(0, 19);
}
