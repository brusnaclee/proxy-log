/**
 * Shared payload builder for "model details".
 *
 * Why this exists: the admin dashboard read `/admin/monitor/models/details`
 * while the Discord bot and portal read `/admin/internal/models/details`, and
 * those were two independent implementations. Any field added to one was
 * silently missing from the other — the dashboard rendered `0 / 0` requests for
 * a model with thousands of hits because only the internal handler computed
 * `requests_by_range`. Both routes now call this function.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { resolveAmanaiMultipliers } from "./amanai-credits.js";
import {
  getProviderModelStatus,
  lookupProviderStatus,
  type ProviderModelStatus,
} from "./provider-status.js";

export async function buildModelDetailsPayload(): Promise<{
  object: string;
  data: any[];
}> {
  const {
    getModelCatalogResponse,
    getAllClientCatalogMonitorRows,
    buildProviderStrictStatusLookup,
  } = await import("./model-catalog.js");

  const [catalog, monitorRows] = await Promise.all([
    getModelCatalogResponse(),
    getAllClientCatalogMonitorRows(),
  ]);
  const { lookup } = buildProviderStrictStatusLookup(
    monitorRows,
    await (await import("./vendor-aliases.js")).loadVendorAliasIndex(),
  );

  // Real observed latency per model from actual user requests. The monitor's
  // own `latency_ms` is a synthetic probe that reads 0 on every row, so it
  // cannot be shown as a speed figure.
  const latencyStats = new Map<string, { p50: number; p95: number; n: number }>();
  // Observed reliability/throughput per model. Only the amanai-compat provider
  // publishes a status feed, so providers like gcli/antigravity would render
  // `—` for success rate and tps forever. Derive them from our own traffic
  // instead: same source as latency, so every model gets a real number.
  const obsStats = new Map<
    string,
    { ok: number; total: number; outTok: number; ms: number }
  >();
  try {
    const latRows = (await db.execute(sql`
      SELECT model,
             COUNT(*)::int AS n,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms)::int AS p50,
             PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95
      FROM request_logs
      WHERE status_code = 200 AND latency_ms > 0 AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY model HAVING COUNT(*) >= 3
    `)).rows as any[];
    for (const r of latRows) {
      latencyStats.set(String(r.model || ""), {
        p50: Number(r.p50) || 0,
        p95: Number(r.p95) || 0,
        n: Number(r.n) || 0,
      });
    }

    const obsRows = (await db.execute(sql`
      SELECT model,
             COUNT(*)::int AS total,
             COUNT(CASE WHEN status_code = 200 THEN 1 END)::int AS ok,
             SUM(CASE WHEN status_code = 200 THEN completion_tokens ELSE 0 END)::int AS out_tok,
             SUM(CASE WHEN status_code = 200 THEN latency_ms ELSE 0 END)::int AS ms
      FROM request_logs
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY model HAVING COUNT(*) >= 3
    `)).rows as any[];
    for (const r of obsRows) {
      obsStats.set(String(r.model || ""), {
        ok: Number(r.ok) || 0,
        total: Number(r.total) || 0,
        outTok: Number(r.out_tok) || 0,
        ms: Number(r.ms) || 0,
      });
    }
  } catch {
    // Latency is a nice-to-have; never fail the catalog over it.
  }

  // Provider-published health is the primary speed signal (covers every model,
  // measures upstream time only). request_logs is the fallback.
  let providerStatus = new Map<string, ProviderModelStatus>();
  try {
    providerStatus = await getProviderModelStatus();
  } catch {
    // fall back to request_logs only
  }

  // Request counts per range, so a list row can show "N req / 7d" without the
  // client having to issue one query per model.
  let reqCounts = new Map<string, Map<string, { req: number; ok: number; fail: number }>>();
  try {
    const { getRequestCountsByModel, RANGES } = await import("./model-history.js");
    reqCounts = new Map();
    for (const r of RANGES) {
      reqCounts.set(r.key, await getRequestCountsByModel(r.key));
    }
  } catch {
    // Traffic counts are a nice-to-have; never fail the catalog over them.
  }

  const enriched = catalog.data
    .map((model: any) => {
      const id = String(model.id || "");
      const monitor = lookup(id);
      if (!monitor?.visible) return null;
      // Billing rates come from the meter's own table, not the upstream
      // catalog: the catalog reports a different scale.
      const rates = resolveAmanaiMultipliers(id);
      const ph = lookupProviderStatus(providerStatus, id, monitor.provider);
      const own = latencyStats.get(id);
      const obs = obsStats.get(id);
      const obsSuccess =
        obs && obs.total > 0 ? Math.round((obs.ok / obs.total) * 10000) / 100 : null;
      const obsTps =
        obs && obs.ms > 0 && obs.outTok > 0
          ? Math.round((obs.outTok / (obs.ms / 1000)) * 10) / 10
          : null;
      return {
        ...model,
        is_online: monitor.clientOnline,
        latency_ms: monitor.latencyMs ?? null,
        active_provider: monitor.provider ?? null,
        pricing: rates
          ? { prompt: rates.mIn, input_cache_read: rates.mCache, completion: rates.mOut }
          : null,
        usage_multiplier: rates ? rates.mIn : null,
        latency_p50: ph?.p50_1h ?? ph?.p50_24h ?? own?.p50 ?? null,
        latency_p95: ph?.p95_1h ?? ph?.p95_24h ?? own?.p95 ?? null,
        latency_samples: ph?.requests24h ?? own?.n ?? null,
        success_rate: ph?.successRate24h ?? obsSuccess,
        tps: ph?.tps24h ?? obsTps,
        provider_status: ph?.status ?? (obs && obs.total > 0 ? "operational" : null),
        requests_by_range: Object.fromEntries(
          [...reqCounts.entries()].map(([k, m]) => {
            const v = m.get(id);
            return [k, v ? { req: v.req, ok: v.ok, fail: v.fail } : { req: 0, ok: 0, fail: 0 }];
          }),
        ),
      };
    })
    .filter(Boolean) as any[];

  // Scale the multiplier against the cheapest model in this catalog so the
  // caller can render "3x" without recomputing the baseline.
  const cheapest = enriched.reduce((min: number | null, m: any) => {
    const val = Number(m?.pricing?.prompt);
    if (!Number.isFinite(val) || val <= 0) return min;
    return min === null || val < min ? val : min;
  }, null as number | null);
  if (cheapest && cheapest > 0) {
    for (const m of enriched) {
      const v = Number(m?.pricing?.prompt);
      m.usage_multiplier =
        Number.isFinite(v) && v > 0 ? Math.round((v / cheapest) * 10) / 10 : null;
    }
  }

  return { object: "list", data: enriched };
}
