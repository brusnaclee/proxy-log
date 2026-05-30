import { db } from "../db/index.js";
import { modelMonitor, modelTestState, providers } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";

/**
 * Model Monitoring Store
 *
 * Supports passive monitoring (from real user requests) and escalating shutdown.
 *
 * Escalating shutdown cycles:
 * 1. First offline: test 3x every 10 min until online or 30 min
 * 2. Still offline: shutdown 1 day
 * 3. After 1 day: test 3x every 10 min until online or 30 min
 * 4. Still offline: shutdown 3 days
 * 5. After 3 days: test 3x every 10 min until online or 30 min
 * 6. Still offline: shutdown 7 days
 * 7. After 7 days: test 3x every 10 min until online or 30 min
 * 8. Still offline: shutdown 30 days
 * 9. After 30 days: reset to online
 */

export const MONITOR_STALE_MINUTES = 60 * 24;

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

// Shutdown durations in milliseconds (escalating)
const SHUTDOWN_DURATIONS = [
  24 * 60 * 60 * 1000,   // 1 day
  3 * 24 * 60 * 60 * 1000,  // 3 days
  7 * 24 * 60 * 60 * 1000,  // 7 days
  30 * 24 * 60 * 60 * 1000, // 30 days
];

// Passive detection: 5 failures within 1 minute = truly offline
const PASSIVE_FAILURE_THRESHOLD = 5;
const PASSIVE_FAILURE_WINDOW_MS = 60000;

// In-memory failure tracking for passive detection
const failureCounters = new Map<string, { count: number; firstFailureAt: number }>();

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

/**
 * Report a passive failure from a real user request.
 * Returns true if the model should now be considered offline.
 */
export function reportPassiveFailure(modelId: string, provider: string | null): boolean {
  const key = `${modelId}:${provider || 'null'}`;
  const now = Date.now();
  const counter = failureCounters.get(key);

  if (!counter || (now - counter.firstFailureAt) > PASSIVE_FAILURE_WINDOW_MS) {
    // New window
    failureCounters.set(key, { count: 1, firstFailureAt: now });
    return false;
  }

  counter.count++;
  if (counter.count >= PASSIVE_FAILURE_THRESHOLD) {
    // Reset counter
    failureCounters.delete(key);
    return true; // Should mark as offline
  }

  return false;
}

/**
 * Report a passive success from a real user request.
 * Updates latency and clears failure counter.
 */
export function reportPassiveSuccess(modelId: string, provider: string | null): void {
  const key = `${modelId}:${provider || 'null'}`;
  failureCounters.delete(key);
}

/**
 * Update model latency from a real user request.
 */
export async function updateModelLatency(
  modelId: string,
  provider: string | null,
  latencyMs: number,
  isOnline: boolean,
): Promise<void> {
  const now = new Date().toISOString().replace("T", " ").substring(0, 19);

  const existing = await db
    .select()
    .from(modelMonitor)
    .where(
      and(
        eq(modelMonitor.modelId, modelId),
        provider
          ? eq(modelMonitor.provider, provider)
          : sql`${modelMonitor.provider} IS NULL`,
      ),
    )
    .limit(1)
    .get();

  if (existing) {
    await db
      .update(modelMonitor)
      .set({
        isOnline,
        latencyMs,
        checkedAt: now,
        httpStatus: isOnline ? 200 : 500,
      })
      .where(eq(modelMonitor.id, existing.id))
      .run();
  } else {
    await db.insert(modelMonitor).values({
      modelId,
      provider,
      isOnline,
      latencyMs,
      httpStatus: isOnline ? 200 : 500,
      checkedAt: now,
    }).run();
  }
}

/**
 * Mark a model as offline (from passive detection).
 */
export async function markModelOffline(
  modelId: string,
  provider: string | null,
  httpStatus: number,
  errorMessage: string | null,
): Promise<void> {
  const now = new Date().toISOString().replace("T", " ").substring(0, 19);

  const existing = await db
    .select()
    .from(modelMonitor)
    .where(
      and(
        eq(modelMonitor.modelId, modelId),
        provider
          ? eq(modelMonitor.provider, provider)
          : sql`${modelMonitor.provider} IS NULL`,
      ),
    )
    .limit(1)
    .get();

  if (existing) {
    await db
      .update(modelMonitor)
      .set({
        isOnline: false,
        httpStatus,
        errorMessage,
        checkedAt: now,
      })
      .where(eq(modelMonitor.id, existing.id))
      .run();
  } else {
    await db.insert(modelMonitor).values({
      modelId,
      provider,
      isOnline: false,
      httpStatus,
      errorMessage,
      checkedAt: now,
    }).run();
  }

  // Update test state for escalating shutdown
  await updateTestStateForShutdown(modelId, provider);
}

/**
 * Update test state with escalating shutdown logic.
 */
async function updateTestStateForShutdown(
  modelId: string,
  provider: string | null,
): Promise<void> {
  const now = new Date().toISOString().replace("T", " ").substring(0, 19);

  const stateRow = await db
    .select()
    .from(modelTestState)
    .where(
      and(
        eq(modelTestState.modelId, modelId),
        provider
          ? eq(modelTestState.provider, provider)
          : sql`${modelTestState.provider} IS NULL`,
      ),
    )
    .limit(1)
    .get();

  if (!stateRow) {
    // First time offline - start cycle 1
    await db.insert(modelTestState).values({
      modelId,
      provider,
      retryCount: 1,
      lastTestAt: now,
      suspendedUntil: null,
      shutdownCycle: 0,
    }).run();
    return;
  }

  const currentCycle = (stateRow as any).shutdownCycle || 0;
  const newRetryCount = stateRow.retryCount + 1;

  // After 3 failures in current cycle, escalate to next shutdown
  if (newRetryCount >= 3) {
    const shutdownDuration = SHUTDOWN_DURATIONS[Math.min(currentCycle, SHUTDOWN_DURATIONS.length - 1)];
    const suspendedUntil = new Date(Date.now() + shutdownDuration).toISOString().replace("T", " ").substring(0, 19);

    await db
      .update(modelTestState)
      .set({
        retryCount: 0,
        lastTestAt: now,
        suspendedUntil,
        shutdownCycle: currentCycle + 1,
      })
      .where(eq(modelTestState.id, stateRow.id))
      .run();
  } else {
    await db
      .update(modelTestState)
      .set({
        retryCount: newRetryCount,
        lastTestAt: now,
      })
      .where(eq(modelTestState.id, stateRow.id))
      .run();
  }
}

/**
 * Mark a model as online (from passive detection or test).
 */
export async function markModelOnline(
  modelId: string,
  provider: string | null,
  latencyMs: number,
): Promise<void> {
  const now = new Date().toISOString().replace("T", " ").substring(0, 19);

  // Update monitor
  await updateModelLatency(modelId, provider, latencyMs, true);

  // Clear test state
  const stateRow = await db
    .select()
    .from(modelTestState)
    .where(
      and(
        eq(modelTestState.modelId, modelId),
        provider
          ? eq(modelTestState.provider, provider)
          : sql`${modelTestState.provider} IS NULL`,
      ),
    )
    .limit(1)
    .get();

  if (stateRow) {
    await db
      .update(modelTestState)
      .set({ retryCount: 0, lastTestAt: now, suspendedUntil: null, shutdownCycle: 0 })
      .where(eq(modelTestState.id, stateRow.id))
      .run();
  }
}

/**
 * Get all model test states (for bot to recover retry state on startup).
 */
export async function getModelTestStates(): Promise<
  Array<{
    modelId: string;
    provider: string | null;
    retryCount: number;
    lastTestAt: string | null;
    suspendedUntil: string | null;
    shutdownCycle: number;
  }>
> {
  return db
    .select({
      modelId: modelTestState.modelId,
      provider: modelTestState.provider,
      retryCount: modelTestState.retryCount,
      lastTestAt: modelTestState.lastTestAt,
      suspendedUntil: modelTestState.suspendedUntil,
      shutdownCycle: sql<number>`COALESCE(${modelTestState.shutdownCycle}, 0)`,
    })
    .from(modelTestState)
    .all();
}

/**
 * Reset all retry states (midnight reset).
 */
export async function resetAllTestStates(): Promise<void> {
  await db
    .update(modelTestState)
    .set({ retryCount: 0, suspendedUntil: null, shutdownCycle: 0 })
    .run();
}

/**
 * Get models that are currently suspended (for testing).
 */
export async function getSuspendedModels(): Promise<
  Array<{
    modelId: string;
    provider: string | null;
    suspendedUntil: string | null;
    shutdownCycle: number;
  }>
> {
  const now = new Date().toISOString().replace("T", " ").substring(0, 19);
  return db
    .select({
      modelId: modelTestState.modelId,
      provider: modelTestState.provider,
      suspendedUntil: modelTestState.suspendedUntil,
      shutdownCycle: sql<number>`COALESCE(${modelTestState.shutdownCycle}, 0)`,
    })
    .from(modelTestState)
    .where(
      and(
        sql`${modelTestState.suspendedUntil} IS NOT NULL`,
        sql`${modelTestState.suspendedUntil} > ${now}`,
      ),
    )
    .all();
}

/**
 * Get models that are offline and not suspended (eligible for testing).
 */
export async function getOfflineModelsForTesting(): Promise<
  Array<{
    modelId: string;
    provider: string | null;
    retryCount: number;
    shutdownCycle: number;
  }>
> {
  const now = new Date().toISOString().replace("T", " ").substring(0, 19);
  return db
    .select({
      modelId: modelTestState.modelId,
      provider: modelTestState.provider,
      retryCount: modelTestState.retryCount,
      shutdownCycle: sql<number>`COALESCE(${modelTestState.shutdownCycle}, 0)`,
    })
    .from(modelTestState)
    .where(
      and(
        sql`${modelTestState.retryCount} > 0`,
        sql`(${modelTestState.suspendedUntil} IS NULL OR ${modelTestState.suspendedUntil} <= ${now})`,
      ),
    )
    .all();
}
