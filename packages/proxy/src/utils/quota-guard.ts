/**
 * 9Router Quota Guard Scheduler
 *
 * Monitors 9Router provider quotas and auto-disables models/connections
 * when quota drops below a threshold.
 *
 * Retry flow:
 *   1. Quota low → DISABLE
 *   2. Quota resets → wait 10 min COOLDOWN → ENABLE
 *   3. 5 min after ENABLE → RECHECK
 *   4. If still exhausted → DISABLE again → repeat steps 2-3
 *   5. Max 3 retries → if still exhausted → LOCKOUT 1 hour → ENABLE → RECHECK 5 min
 *   6. If still exhausted after lockout → LOCKOUT 1 hour again (repeat forever)
 *
 * Three quota types:
 * - Per-Model (antigravity): disable individual models
 * - Per-Session (glm): disable entire connections
 * - Per-Category (minimax): disable model groups by category
 */

// ─── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = (process.env.NINEROUTER_BASE_URL || "https://api3.tokito.xyz").replace(/\/$/, "");
const PASSWORD = process.env.NINEROUTER_PASSWORD || "rendang123!";
const QUOTA_THRESHOLD = parseInt(process.env.NINEROUTER_QUOTA_THRESHOLD || "20", 10);
const POLL_INTERVAL_MS = parseInt(process.env.NINEROUTER_POLL_INTERVAL_MS || "60000", 10); // 1 min default
const COOLDOWN_MS = 10 * 60 * 1000;   // 10 min wait before re-enable after quota reset
const RECHECK_MS = 5 * 60 * 1000;     // 5 min after enable before rechecking
const LOCKOUT_MS = 60 * 60 * 1000;    // 1 hour lockout after 3 failed retries
const MAX_RETRIES = 3;                 // max normal retries before lockout

// ─── Types ────────────────────────────────────────────────────────────────────

type QuotaType = "per-model" | "per-session" | "per-category" | "no-quota";
type GuardPhase = "idle" | "cooldown" | "waiting-recheck" | "locked-out";

interface Connection {
  id: number;
  isActive: boolean;
}

interface ProviderEntry {
  id: number;
  name: string;
  alias: string;
  connections: Connection[];
}

interface ProvidersResponse {
  providers: ProviderEntry[];
}

interface UsageQuotaValue {
  total: number;
  used: number;
  remaining: number;
}

interface UsageResponse {
  quotas: Record<string, UsageQuotaValue>;
  message?: string;
}

// ─── Guard State Machine ──────────────────────────────────────────────────────

/**
 * Per-entity state machine:
 *
 *  IDLE ──[quota low]──► DISABLED + COOLDOWN
 *    ▲                        │
 *    │                   [10 min elapsed]
 *    │                        ▼
 *    │                    ENABLE + WAITING-RECHECK
 *    │                        │
 *    │                   [5 min elapsed]
 *    │                        ▼
 *    ◄──[quota OK]──── RECHECK (success)
 *    │
 *    │──[quota low]──► DISABLED + COOLDOWN (retry++, up to MAX_RETRIES)
 *    │
 *    │──[retry > MAX_RETRIES]──► DISABLED + LOCKED-OUT (1 hour)
 *                                    │
 *                               [1 hour elapsed]
 *                                    ▼
 *                                ENABLE + WAITING-RECHECK
 *                                    │
 *                               [5 min elapsed]
 *                                    ▼
 *                          RECHECK (if low → LOCKED-OUT again, repeat)
 */

interface GuardState {
  phase: GuardPhase;
  disabledAt: number;          // timestamp when we disabled
  phaseStartedAt: number;      // timestamp when current phase started
  retryCount: number;          // retries in current lockout cycle (0-3)
  lockoutCount: number;        // total lockout rounds (for logging)
}

// key: "providerId:modelId" or "providerId:conn:connId" or "providerId:cat:catName"
const guardStates: Map<string, GuardState> = new Map();

function getGuardState(key: string): GuardState {
  if (!guardStates.has(key)) {
    guardStates.set(key, {
      phase: "idle",
      disabledAt: 0,
      phaseStartedAt: 0,
      retryCount: 0,
      lockoutCount: 0,
    });
  }
  return guardStates.get(key)!;
}

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

let sessionCookie: string | null = null;

async function login(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });

    if (!res.ok) {
      console.error(`[QuotaGuard] Login failed: ${res.status} ${res.statusText}`);
      return false;
    }

    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const match = setCookie.match(/jwt=([^;]+)/);
      if (match) {
        sessionCookie = `jwt=${match[1]}`;
        return true;
      }
    }

    const body: any = await res.json().catch(() => ({}));
    if (body.token) {
      sessionCookie = `jwt=${body.token}`;
      return true;
    }

    console.error("[QuotaGuard] Login succeeded but no JWT found");
    return false;
  } catch (err) {
    console.error("[QuotaGuard] Login error:", err);
    return false;
  }
}

async function apiGet<T = any>(path: string): Promise<T | null> {
  if (!sessionCookie) return null;
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Cookie: sessionCookie },
    });
    if (!res.ok) {
      console.error(`[QuotaGuard] GET ${path} failed: ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[QuotaGuard] GET ${path} error:`, err);
    return null;
  }
}

async function apiPost<T = any>(path: string, body: any): Promise<T | null> {
  if (!sessionCookie) return null;
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[QuotaGuard] POST ${path} failed: ${res.status} ${text}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[QuotaGuard] POST ${path} error:`, err);
    return null;
  }
}

async function apiDelete<T = any>(path: string): Promise<T | null> {
  if (!sessionCookie) return null;
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "DELETE",
      headers: { Cookie: sessionCookie },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[QuotaGuard] DELETE ${path} failed: ${res.status} ${text}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[QuotaGuard] DELETE ${path} error:`, err);
    return null;
  }
}

async function apiPut<T = any>(path: string, body: any): Promise<T | null> {
  if (!sessionCookie) return null;
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[QuotaGuard] PUT ${path} failed: ${res.status} ${text}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[QuotaGuard] PUT ${path} error:`, err);
    return null;
  }
}

// ─── Quota Type Detection ─────────────────────────────────────────────────────

function detectQuotaType(quotas: Record<string, any>): QuotaType {
  const keys = Object.keys(quotas);
  if (keys.length === 0) return "no-quota";
  if ("session" in quotas) return "per-session";
  if (keys.some((k) => /\(\s*\d+\s*[hdwm]\s*\)/i.test(k))) return "per-category";
  return "per-model";
}

// ─── Unified Guard Logic ──────────────────────────────────────────────────────

async function disableEntity(
  key: string,
  label: string,
  disableAction: () => Promise<void>
) {
  const gs = getGuardState(key);
  if (gs.phase !== "idle") return; // already in some phase

  console.log(`[QuotaGuard] DISABLE → ${label}`);
  await disableAction();
  gs.phase = "cooldown";
  gs.disabledAt = Date.now();
  gs.phaseStartedAt = Date.now();
}

async function handleGuardPhases(
  key: string,
  label: string,
  quotaNowLow: boolean,
  disableAction: () => Promise<void>,
  enableAction: () => Promise<void>
) {
  const gs = getGuardState(key);
  const now = Date.now();

  switch (gs.phase) {
    case "idle": {
      if (quotaNowLow) {
        await disableEntity(key, label, disableAction);
      }
      break;
    }

    case "cooldown": {
      // Waiting 10 min (or 1h lockout) before enabling
      const waitMs = gs.lockoutCount > 0 ? LOCKOUT_MS : COOLDOWN_MS;
      if (now - gs.phaseStartedAt >= waitMs) {
        console.log(`[QuotaGuard] ENABLE (cooldown done) → ${label}`);
        await enableAction();
        gs.phase = "waiting-recheck";
        gs.phaseStartedAt = now;
      }
      break;
    }

    case "waiting-recheck": {
      // Waiting 5 min after enable before rechecking
      if (now - gs.phaseStartedAt >= RECHECK_MS) {
        if (quotaNowLow) {
          // Still exhausted after recheck
          gs.retryCount++;
          if (gs.retryCount > MAX_RETRIES) {
            // Enter lockout
            console.log(`[QuotaGuard] LOCKOUT (retry ${gs.retryCount-1}/${MAX_RETRIES} failed) → ${label} — disabling for 1 hour`);
            gs.lockoutCount++;
            gs.phase = "cooldown";
            gs.phaseStartedAt = now;
            await disableAction();
          } else {
            console.log(`[QuotaGuard] RETRY ${gs.retryCount}/${MAX_RETRIES} (still low) → ${label} — disabling again`);
            gs.phase = "cooldown";
            gs.phaseStartedAt = now;
            await disableAction();
          }
        } else {
          // Quota is OK — back to idle, reset retry counts
          console.log(`[QuotaGuard] RECHECK OK → ${label} — quota recovered, resuming normal monitoring`);
          gs.phase = "idle";
          gs.retryCount = 0;
          gs.lockoutCount = 0;
        }
      }
      break;
    }

    case "locked-out": {
      // Shouldn't reach here (lockout uses cooldown phase), but handle gracefully
      gs.phase = "cooldown";
      gs.phaseStartedAt = now;
      break;
    }
  }
}

// ─── Per-Model Handler (antigravity-style) ────────────────────────────────────

async function handlePerModelQuota(
  providerAlias: string,
  providerId: number,
  quotas: Record<string, UsageQuotaValue>
) {
  for (const [modelId, quota] of Object.entries(quotas)) {
    if (modelId === "session") continue;
    const pct = quota.total > 0 ? (quota.remaining / quota.total) * 100 : 0;
    const isLow = pct <= QUOTA_THRESHOLD;
    const key = `${providerId}:${modelId}`;
    const label = `model:${providerAlias}/${modelId} (${pct.toFixed(1)}%)`;

    await handleGuardPhases(
      key, label, isLow,
      async () => {
        await apiPost("/api/models/disabled", { providerAlias, ids: [modelId] });
      },
      async () => {
        await apiDelete(`/api/models/disabled?providerAlias=${providerAlias}&id=${modelId}`);
      }
    );
  }
}

// ─── Per-Session Handler (glm-style) ──────────────────────────────────────────

async function handlePerSessionQuota(
  providerAlias: string,
  providerId: number,
  connections: Connection[],
  sessionQuota: UsageQuotaValue
) {
  const pct = sessionQuota.total > 0 ? (sessionQuota.remaining / sessionQuota.total) * 100 : 0;
  const isLow = pct <= QUOTA_THRESHOLD;
  const key = `${providerId}:session`;
  const label = `session:${providerAlias} (${pct.toFixed(1)}%)`;

  await handleGuardPhases(
    key, label, isLow,
    async () => {
      for (const conn of connections) {
        await apiPut(`/api/providers/${conn.id}`, { isActive: false });
      }
    },
    async () => {
      for (const conn of connections) {
        await apiPut(`/api/providers/${conn.id}`, { isActive: true });
      }
    }
  );
}

// ─── Per-Category Handler (minimax-style) ─────────────────────────────────────

async function handlePerCategoryQuota(
  providerAlias: string,
  providerId: number,
  quotas: Record<string, UsageQuotaValue>
) {
  const categories: Map<string, Array<{ quota: UsageQuotaValue }>> = new Map();

  for (const [key, quota] of Object.entries(quotas)) {
    const catMatch = key.match(/^(.+?)\s*\(/);
    const catName = catMatch ? catMatch[1].trim() : key;
    if (!categories.has(catName)) categories.set(catName, []);
    categories.get(catName)!.push({ quota });
  }

  for (const [catName, entries] of categories) {
    const anyLow = entries.some((e) => {
      const pct = e.quota.total > 0 ? (e.quota.remaining / e.quota.total) * 100 : 0;
      return pct <= QUOTA_THRESHOLD;
    });

    const key = `${providerId}:cat:${catName}`;
    const label = `category:${providerAlias}/${catName}`;

    await handleGuardPhases(
      key, label, anyLow,
      async () => {
        await apiPost("/api/models/disabled", { providerAlias, ids: [`${catName}/*`] });
      },
      async () => {
        await apiDelete(`/api/models/disabled?providerAlias=${providerAlias}&id=${catName}/*`);
      }
    );
  }
}

// ─── Main Cycle ───────────────────────────────────────────────────────────────

async function runQuotaGuardCycle() {
  console.log("[QuotaGuard] Cycle starting...");

  const loggedIn = await login();
  if (!loggedIn) {
    console.error("[QuotaGuard] Login failed, skipping cycle");
    return;
  }

  const providersData = await apiGet<ProvidersResponse>("/api/providers");
  if (!providersData?.providers) {
    console.error("[QuotaGuard] Failed to fetch providers, skipping cycle");
    return;
  }

  for (const provider of providersData.providers) {
    const connections = provider.connections || [];
    if (connections.length === 0) continue;

    const firstConnId = connections[0].id;
    const usageData = await apiGet<UsageResponse>(`/api/usage/${firstConnId}`);
    if (!usageData?.quotas) continue;

    const quotas = usageData.quotas;
    const quotaType = detectQuotaType(quotas);

    switch (quotaType) {
      case "per-session": {
        const sessionQuota = quotas["session"];
        if (sessionQuota) {
          await handlePerSessionQuota(provider.alias, provider.id, connections, sessionQuota);
        }
        break;
      }
      case "per-category":
        await handlePerCategoryQuota(provider.alias, provider.id, quotas);
        break;
      case "per-model":
        await handlePerModelQuota(provider.alias, provider.id, quotas);
        break;
      case "no-quota":
      default:
        break;
    }
  }

  console.log("[QuotaGuard] Cycle complete");
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let schedulerStarted = false;

export function initializeQuotaGuardScheduler() {
  const baseUrl = process.env.NINEROUTER_BASE_URL;
  const password = process.env.NINEROUTER_PASSWORD;

  if (!baseUrl || !password) {
    console.log("[QuotaGuard] NINEROUTER_BASE_URL or NINEROUTER_PASSWORD not set, scheduler disabled");
    return;
  }

  if (schedulerStarted) {
    console.log("[QuotaGuard] Scheduler already started");
    return;
  }

  schedulerStarted = true;
  console.log(`[QuotaGuard] Initialized — poll: ${POLL_INTERVAL_MS / 1000}s, threshold: ${QUOTA_THRESHOLD}%, cooldown: ${COOLDOWN_MS / 60000}min, recheck: ${RECHECK_MS / 60000}min, lockout: ${LOCKOUT_MS / 60000}min, maxRetries: ${MAX_RETRIES}`);

  setTimeout(async () => {
    await runQuotaGuardCycle();
  }, 30_000);

  setInterval(async () => {
    await runQuotaGuardCycle();
  }, POLL_INTERVAL_MS);
}
