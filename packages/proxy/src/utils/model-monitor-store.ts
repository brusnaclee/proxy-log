import { db } from "../db/index.js";
import { modelMonitor, providers } from "../db/schema.js";
import { eq } from "drizzle-orm";

/** Bot pushes latency results every 10 min — data older than this is stale. */
export const MONITOR_STALE_MINUTES = 10;

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
