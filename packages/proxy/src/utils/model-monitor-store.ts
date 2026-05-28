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
  checkedAt: string;
};

export async function getActiveProviderNames(): Promise<Set<string>> {
  const rows = await db
    .select({ name: providers.name })
    .from(providers)
    .where(eq(providers.isActive, true))
    .all();
  return new Set(rows.map((r) => r.name));
}

export async function purgeMonitorForProvider(providerName: string): Promise<void> {
  await db.delete(modelMonitor).where(eq(modelMonitor.provider, providerName)).run();
  await db.delete(modelTestState).where(eq(modelTestState.provider, providerName)).run();
}

/** Replace entire monitor table with the latest bot snapshot (active providers only). */
export async function replaceModelMonitorSnapshot(
  values: MonitorSnapshotRow[],
): Promise<number> {
  const activeNames = await getActiveProviderNames();
  const filtered = values.filter((v) => v.provider && activeNames.has(v.provider));

  await db.delete(modelMonitor).run();
  if (filtered.length > 0) {
    await db.insert(modelMonitor).values(filtered).run();
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
  const now = new Date().toISOString().replace("T", " ").substring(0, 19);

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
    .get();

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
      .where(eq(modelMonitor.id, existing.id))
      .run();
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
    }).run();
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
    .get();

  if (params.isOnline) {
    // Online: clear retry state
    if (stateRow) {
      await db
        .update(modelTestState)
        .set({ retryCount: 0, lastTestAt: now, suspendedUntil: null })
        .where(eq(modelTestState.id, stateRow.id))
        .run();
    } else {
      await db.insert(modelTestState).values({
        modelId: params.modelId,
        provider: params.provider,
        retryCount: 0,
        lastTestAt: now,
        suspendedUntil: null,
      }).run();
    }
  } else {
    // Offline: increment retry count
    const newRetryCount = (stateRow?.retryCount ?? 0) + 1;
    const suspendedUntil = newRetryCount >= MAX_RETRIES ? getNextMidnightIso() : null;

    if (stateRow) {
      await db
        .update(modelTestState)
        .set({ retryCount: newRetryCount, lastTestAt: now, suspendedUntil })
        .where(eq(modelTestState.id, stateRow.id))
        .run();
    } else {
      await db.insert(modelTestState).values({
        modelId: params.modelId,
        provider: params.provider,
        retryCount: newRetryCount,
        lastTestAt: now,
        suspendedUntil,
      }).run();
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
    .from(modelTestState)
    .all();
}

/** Reset all retry states (midnight reset). */
export async function resetAllTestStates(): Promise<void> {
  await db
    .update(modelTestState)
    .set({ retryCount: 0, suspendedUntil: null })
    .run();
}

/** Get next midnight in Asia/Jakarta (UTC+7) as ISO string. */
function getNextMidnightIso(): string {
  const now = new Date();
  // Convert to Asia/Jakarta (UTC+7)
  const jakartaOffset = 7 * 60; // minutes
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const jakartaMs = utcMs + jakartaOffset * 60000;
  const jakartaDate = new Date(jakartaMs);

  // Set to next midnight
  jakartaDate.setHours(24, 0, 0, 0);

  // Convert back to UTC ISO
  const midnightUtcMs = jakartaDate.getTime() - jakartaOffset * 60000;
  return new Date(midnightUtcMs).toISOString().replace("T", " ").substring(0, 19);
}
