import { db } from "../db/index.js";
import { modelMonitor, modelTestState, providers } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";

/**
 * Data is valid until the next scheduled test replaces it.
 * No time-based stale cutoff — the smart retry system controls when models are tested.
 */
export const MONITOR_STALE_MINUTES = 60 * 24; // 24 hours (effectively "no stale cutoff")

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

export async function getActiveProviderNames(): Promise<Set<string>> {
  const rows = await db
    .select({ name: providers.name })
    .from(providers)
    .where(eq(providers.isActive, true));
  return new Set(rows.map((r) => r.name));
}

export async function purgeMonitorForProvider(providerName: string): Promise<void> {
  await db.delete(modelMonitor).where(eq(modelMonitor.provider, providerName));
  await db.delete(modelTestState).where(eq(modelTestState.provider, providerName));
}

/** Replace entire monitor table with the latest bot snapshot (active providers only). */
export async function replaceModelMonitorSnapshot(
  values: MonitorSnapshotRow[],
): Promise<number> {
  const activeNames = await getActiveProviderNames();
  const filtered = values.filter((v) => v.provider && activeNames.has(v.provider));

  await db.delete(modelMonitor);
  if (filtered.length > 0) {
    await db.insert(modelMonitor).values(filtered);
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
 * for retry tracking. Called by the bot after each individual model test.
 *
 * - If online: upsert into model_monitor, clear retry state (retryCount=0, suspendedUntil=null)
 * - If offline: upsert into model_monitor, increment retryCount
 * - If retryCount >= MAX_RETRIES: set suspendedUntil to next midnight (Asia/Jakarta)
 */
export async function upsertModelStatus(params: {
  modelId: string;
  provider: string | null;
  isOnline: boolean;
  latencyMs: number;
  httpStatus: number;
  errorMessage: string | null;
  baseUrl: string | null;
}): Promise<void> {
  const now = new Date();
  const nowStr = now.toISOString().replace("T", " ").substring(0, 19);

  // Upsert into model_monitor: find existing row by modelId+provider
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
    .then(rows => rows[0]);

  if (existing) {
    await db
      .update(modelMonitor)
      .set({
        isOnline: params.isOnline,
        latencyMs: params.latencyMs,
        httpStatus: params.httpStatus,
        errorMessage: params.errorMessage,
        baseUrl: params.baseUrl,
        checkedAt: now,
      })
      .where(eq(modelMonitor.id, existing.id));
  } else {
    await db.insert(modelMonitor).values({
      modelId: params.modelId,
      provider: params.provider,
      isOnline: params.isOnline,
      latencyMs: params.latencyMs,
      httpStatus: params.httpStatus,
      errorMessage: params.errorMessage,
      baseUrl: params.baseUrl,
      checkedAt: now,
    });
  }

  // Update model_test_state for retry tracking
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
    .then(rows => rows[0]);

  if (params.isOnline) {
    // Online: clear retry state
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
    // Rate limited: DON'T increment retry count - model is working, just busy
    // Just update the lastTestAt timestamp
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
    // Offline (5xx, timeout, connection error): increment retry count
    const newRetryCount = (stateRow?.retryCount ?? 0) + 1;
    // After 3 failures, suspend for 24 hours instead of until midnight
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

/** Get 24 hours from now as ISO string (for suspension). */
function get24HoursFromNowIso(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return d.toISOString().replace("T", " ").substring(0, 19);
}
