/**
 * Upstream provider health feed.
 *
 * The provider publishes a read-only status snapshot with per-model p50/p95
 * latency, success rate and throughput. That is a far better speed signal than
 * our own `request_logs` aggregate (which mixes in client network time and is
 * empty for models nobody has called yet), so it is the primary source for the
 * "Latency" column everywhere we render model info.
 *
 * Two rules this module enforces:
 *
 *  1. **Never leak the provider name.** Public surfaces (user portal, Discord)
 *     show this as "provider latency" — nothing in the payload names the
 *     upstream. The admin dashboard may label it "Provider" because that view
 *     is internal.
 *  2. **Best-effort.** A failed fetch must never break a page. Callers get
 *     whatever was cached last, or an empty map.
 *
 * Fallback order used by callers: provider status → our own request_logs p50.
 */

import { db } from "../db/index.js";
import { providers } from "../db/schema.js";
import { eq } from "drizzle-orm";

export type ProviderModelStatus = {
  status: string;
  /** p50 latency in ms over the last hour, when available. */
  p50_1h: number | null;
  p95_1h: number | null;
  /** p50 latency in ms over the last 24 hours. */
  p50_24h: number | null;
  p95_24h: number | null;
  successRate24h: number | null;
  requests24h: number | null;
  /** Mean output tokens/second over 24h. */
  tps24h: number | null;
};

const CACHE_TTL_MS = Number(process.env.PROVIDER_STATUS_TTL_MS || 5 * 60 * 1000); // 5m
const FETCH_TIMEOUT_MS = 8_000;

type Cache = {
  fetchedAt: number;
  byModel: Map<string, ProviderModelStatus>;
  overall: { status: string; successRate24h: number | null; p50_24h: number | null } | null;
};

let cache: Cache = { fetchedAt: 0, byModel: new Map(), overall: null };
let inFlight: Promise<void> | null = null;
/** Provider name that owns the status feed (e.g. `phantom`). */
let feedProviderName: string | null = null;

/**
 * Derive the public status URL from the configured provider endpoint.
 * `https://api.amanai.sh/v1` → `https://api.amanai.sh/public/status`.
 * Returns null when no amanai-compat provider is configured.
 */
async function resolveStatusUrl(): Promise<string | null> {
  try {
    const rows = await db
      .select({ endpoint: providers.endpoint, name: providers.name })
      .from(providers)
      .where(eq(providers.isActive, true));
    for (const row of rows) {
      const ep = String(row?.endpoint || "").trim();
      if (!ep) continue;
      // Only the provider that ships a public status feed.
      if (!/amanai/i.test(ep) && !/amanai/i.test(String(row?.name || ""))) continue;
      try {
        const u = new URL(ep);
        feedProviderName = String(row?.name || "").trim() || null;
        return `${u.protocol}//${u.host}/public/status`;
      } catch {
        continue;
      }
    }
  } catch {
    // fall through
  }
  return null;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchOnce(): Promise<void> {
  const url = await resolveStatusUrl();
  if (!url) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return;
    const payload: any = await res.json();
    const byModel = new Map<string, ProviderModelStatus>();
    for (const m of payload?.models || []) {
      const id = String(m?.id || "");
      if (!id) continue;
      const w1 = m?.metrics?.["1h"] || {};
      const w24 = m?.metrics?.["24h"] || {};
      byModel.set(id, {
        status: String(m?.status || "unknown"),
        p50_1h: num(w1.p50_latency_ms),
        p95_1h: num(w1.p95_latency_ms),
        p50_24h: num(w24.p50_latency_ms),
        p95_24h: num(w24.p95_latency_ms),
        successRate24h: num(w24.success_rate),
        requests24h: num(w24.total_requests),
        tps24h: num(w24.avg_effective_tps),
      });
    }
    const ov = payload?.overall;
    const w24o = payload?.windows?.["24h"] || {};
    cache = {
      fetchedAt: Date.now(),
      byModel,
      overall: ov
        ? {
            status: String(ov),
            successRate24h: num(w24o.success_rate),
            p50_24h: num(w24o.p50_latency_ms),
          }
        : null,
    };
  } catch {
    // keep the previous cache
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Per-model provider status, keyed by the upstream model id (e.g.
 * `amanai/glm-5.3`). Empty when the feed has never been reachable.
 */
export async function getProviderModelStatus(): Promise<Map<string, ProviderModelStatus>> {
  const stale = Date.now() - cache.fetchedAt > CACHE_TTL_MS;
  if (stale) {
    if (!inFlight) {
      inFlight = fetchOnce().finally(() => {
        inFlight = null;
      });
    }
    // First call ever: wait for it. Later calls serve stale data immediately.
    if (cache.fetchedAt === 0) await inFlight;
  }
  return cache.byModel;
}

/** Account-level provider health, for admin headers. */
export function getProviderOverall() {
  return cache.overall;
}

/**
 * Look up status for a public model id such as `phantom/vibecode/glm-5.3` or
 * `grok/gcli/grok-4.5`. The feed keys on `<vendor>/<model>`, so try the tail
 * and a few common prefixes.
 *
 * `providerName` matters: the feed belongs to ONE upstream. A model served by a
 * different provider (e.g. `gcli/grok-4.5` on the `grok` upstream) must NOT
 * borrow the numbers from the feed's own same-named model
 * (`amanai/grok-4.5`) — they are different deployments with different
 * latency. Pass the provider and the lookup returns null on a mismatch.
 */
export function lookupProviderStatus(
  map: Map<string, ProviderModelStatus>,
  publicId: string,
  providerName?: string | null,
): ProviderModelStatus | null {
  if (!map.size) return null;

  // Reject cross-provider matches outright.
  if (providerName && feedProviderName && providerName !== feedProviderName) {
    return null;
  }

  const direct = map.get(publicId);
  if (direct) return direct;

  const parts = String(publicId).split("/").filter(Boolean);
  const tail = parts[parts.length - 1];
  if (!tail) return null;

  const candidates = [
    `amanai/${tail}`,
    `gcli/${tail}`,
    tail,
    `amanai/${parts.slice(-2).join("/")}`,
  ];
  for (const c of candidates) {
    const hit = map.get(c);
    if (hit) return hit;
  }
  return null;
}

/** Warm the cache at boot so the first page render already has data. */
export function initializeProviderStatusScheduler(): void {
  const tick = () => {
    void fetchOnce();
  };
  setTimeout(tick, 20_000).unref?.();
  setInterval(tick, CACHE_TTL_MS).unref?.();
}
