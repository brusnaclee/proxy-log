/**
 * 9Router Quota Guard Scheduler
 *
 * Monitors 9Router provider quotas and auto-disables models/connections
 * when quota drops below a configurable threshold.
 *
 * Features:
 * - Persists state to data/quota_guard_state.json (survives restarts)
 * - Tracks resetAt per entity (detects quota period changes)
 * - Checks ALL connections per provider (per-session)
 * - Tracks which entities guard disabled vs manually disabled
 * - Race condition mutex (prevents overlapping cycles)
 * - Provider exclusion (e.g. GLM excluded per owner request)
 * - Exports state for dashboard API
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname, resolve } from "path";

// ─── Configuration ────────────────────────────────────────────────────────────

// NOTE: These are initialized as empty and re-read in initializeQuotaGuardScheduler()
// because dotenv loads AFTER module imports in index.ts.
let BASE_URL = (process.env.NINEROUTER_BASE_URL || "https://api3.tokito.xyz").replace(/\/$/, "");
let PASSWORD = process.env.NINEROUTER_PASSWORD || "";
let QUOTA_THRESHOLD = parseInt(process.env.NINEROUTER_QUOTA_THRESHOLD || "20", 10);
let POLL_INTERVAL_MS = parseInt(process.env.NINEROUTER_POLL_INTERVAL_MS || "60000", 10);
const COOLDOWN_MS = 10 * 60 * 1000;
const RECHECK_MS = 5 * 60 * 1000;
const LOCKOUT_MS = 60 * 60 * 1000;
const MAX_RETRIES = 3;
const EXCLUDED_PROVIDERS_DEFAULT = (process.env.NINEROUTER_EXCLUDED_PROVIDERS || "glm").split(",").map(s => s.trim().toLowerCase());
const excludedProviders: Set<string> = new Set(EXCLUDED_PROVIDERS_DEFAULT);
const STATE_FILE = process.env.QUOTA_GUARD_STATE_PATH || resolve(process.cwd(), "data", "quota_guard_state.json");

// ─── Provider Alias Mapping ─────────────────────────────────────────────────
// 9Router API uses short aliases (e.g. "ag") but /api/providers returns full names (e.g. "antigravity")
const PROVIDER_ALIAS_MAP: Record<string, string> = {
  antigravity: "ag",
  glm: "glm",
  minimax: "minimax",
  xai: "xai",
  ollama: "ollama",
  nvidia: "nvidia",
};
function toAlias(name: string): string {
  return PROVIDER_ALIAS_MAP[name.toLowerCase()] || name;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuotaType = "per-model" | "per-session" | "per-category" | "no-quota";
type GuardPhase = "idle" | "cooldown" | "waiting-recheck";

export interface Connection {
  id: string;
  provider: string;
  name: string;
  isActive: boolean;
}

interface ProvidersResponse {
  connections: Connection[];
}

export interface UsageQuotaValue {
  used: number;
  total: number;
  remaining?: number;
  remainingPercentage: number;
  resetAt?: string;
  unlimited?: boolean;
  displayName?: string;
}

export interface UsageResponse {
  plan?: string;
  quotas?: Record<string, UsageQuotaValue>;
  message?: string;
}

interface GuardState {
  phase: GuardPhase;
  disabledAt: number;
  phaseStartedAt: number;
  retryCount: number;
  lockoutCount: number;
  lastResetAt?: string;
}

export interface QuotaGuardSnapshot {
  scheduler: {
    enabled: boolean;
    pollIntervalMs: number;
    threshold: number;
    isRunning: boolean;
    lastCycleAt: string | null;
    excludedProviders: string[];
  };
  providers: ProviderSnapshot[];
}

export interface ProviderSnapshot {
  name: string;
  alias: string;
  connections: ConnectionSnapshot[];
}

export interface ConnectionSnapshot {
  id: string;
  name: string;
  isActive: boolean;
  quotaType: QuotaType;
  quotas: Record<string, UsageQuotaValue>;
  guardState: {
    phase: GuardPhase;
    retryCount: number;
    lockoutCount: number;
    disabledByGuard: boolean;
    excluded: boolean;
    lastResetAt?: string;
  };
}

// ─── State ────────────────────────────────────────────────────────────────────

const guardStates: Map<string, GuardState> = new Map();
const disabledByGuard: Set<string> = new Set();
let isRunning = false;
let lastCycleAt: string | null = null;
let schedulerEnabled = true;

// Latest snapshot for dashboard API
let latestSnapshot: QuotaGuardSnapshot | null = null;

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

// ─── Persistence ──────────────────────────────────────────────────────────────

interface PersistedState {
  guardStates: Record<string, GuardState>;
  disabledByGuard: string[];
}

async function saveState(): Promise<void> {
  try {
    const dir = dirname(STATE_FILE);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const data: PersistedState = {
      guardStates: Object.fromEntries(guardStates),
      disabledByGuard: Array.from(disabledByGuard),
    };
    await writeFile(STATE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("[QuotaGuard] Failed to save state:", err);
  }
}

async function loadState(): Promise<void> {
  try {
    const dir = dirname(STATE_FILE);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    if (!existsSync(STATE_FILE)) {
      console.log(`[QuotaGuard] No state file found, starting fresh`);
      return;
    }
    const raw = await readFile(STATE_FILE, "utf-8");
    const data: PersistedState = JSON.parse(raw);
    if (data.guardStates) {
      for (const [key, state] of Object.entries(data.guardStates)) {
        guardStates.set(key, state);
      }
    }
    if (data.disabledByGuard) {
      for (const key of data.disabledByGuard) {
        disabledByGuard.add(key);
      }
    }
    console.log(`[QuotaGuard] Loaded state: ${guardStates.size} entities, ${disabledByGuard.size} disabled by guard`);
  } catch (err) {
    console.error("[QuotaGuard] Failed to load state:", err);
  }
}

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

let sessionCookie: string | null = null;
let tokenObtainedAt: number = 0;
const TOKEN_MAX_AGE_MS = 23 * 60 * 60 * 1000;
let loginLockedUntil: number = 0;

function isTokenValid(): boolean {
  return !!sessionCookie && (Date.now() - tokenObtainedAt) < TOKEN_MAX_AGE_MS;
}

function isLoginLocked(): boolean {
  return Date.now() < loginLockedUntil;
}

function invalidateToken() {
  sessionCookie = null;
  tokenObtainedAt = 0;
}

async function ensureAuthenticated(): Promise<boolean> {
  if (isTokenValid()) return true;
  if (isLoginLocked()) {
    const waitSec = Math.ceil((loginLockedUntil - Date.now()) / 1000);
    console.log(`[QuotaGuard] Login locked, retry in ${waitSec}s`);
    return false;
  }
  return await login();
}

async function login(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });

    if (!res.ok) {
      const body: any = await res.json().catch(() => ({}));
      const retryAfter = body.retryAfter || 300;
      loginLockedUntil = Date.now() + retryAfter * 1000;
      console.error(`[QuotaGuard] Login failed: ${res.status} — locked ${retryAfter}s`);
      return false;
    }

    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const match = setCookie.match(/auth_token=([^;]+)/) || setCookie.match(/jwt=([^;]+)/);
      if (match) {
        const cookieName = setCookie.includes("auth_token=") ? "auth_token" : "jwt";
        sessionCookie = `${cookieName}=${match[1]}`;
        tokenObtainedAt = Date.now();
        loginLockedUntil = 0;
        console.log("[QuotaGuard] Logged in (token cached)");
        return true;
      }
    }

    const body2: any = await res.json().catch(() => ({}));
    if (body2.token) {
      sessionCookie = `auth_token=${body2.token}`;
      tokenObtainedAt = Date.now();
      loginLockedUntil = 0;
      console.log("[QuotaGuard] Logged in (token cached)");
      return true;
    }

    console.error("[QuotaGuard] Login OK but no token found");
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
    if (res.status === 401) {
      console.log(`[QuotaGuard] GET ${path} got 401, invalidating token`);
      invalidateToken();
      return null;
    }
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
  if (gs.phase !== "idle") return;

  console.log(`[QuotaGuard] DISABLE -> ${label}`);
  await disableAction();
  gs.phase = "cooldown";
  gs.disabledAt = Date.now();
  gs.phaseStartedAt = Date.now();
  disabledByGuard.add(key);
  await saveState();
}

async function handleGuardPhases(
  key: string,
  label: string,
  quotaNowLow: boolean,
  currentResetAt: string | undefined,
  disableAction: () => Promise<void>,
  enableAction: () => Promise<void>
) {
  const gs = getGuardState(key);
  const now = Date.now();

  // Detect quota reset by comparing resetAt (compare date only, not exact time)
  if (currentResetAt && gs.lastResetAt) {
    const oldDate = gs.lastResetAt.split("T")[0];
    const newDate = currentResetAt.split("T")[0];
    if (oldDate !== newDate) {
      console.log(`[QuotaGuard] RESET DETECTED -> ${label} (old: ${gs.lastResetAt}, new: ${currentResetAt})`);
      if (gs.phase === "cooldown" || gs.phase === "waiting-recheck") {
        console.log(`[QuotaGuard] Quota reset during ${gs.phase} -> enabling immediately -> ${label}`);
        await enableAction();
        gs.phase = "idle";
        gs.retryCount = 0;
        gs.lockoutCount = 0;
        disabledByGuard.delete(key);
        await saveState();
        return;
      }
    }
  }
  if (currentResetAt) {
    gs.lastResetAt = currentResetAt;
  }

  switch (gs.phase) {
    case "idle": {
      if (quotaNowLow) {
        await disableEntity(key, label, disableAction);
      }
      break;
    }

    case "cooldown": {
      const waitMs = gs.lockoutCount > 0 ? LOCKOUT_MS : COOLDOWN_MS;
      if (now - gs.phaseStartedAt >= waitMs) {
        console.log(`[QuotaGuard] ENABLE (cooldown done) -> ${label}`);
        await enableAction();
        gs.phase = "waiting-recheck";
        gs.phaseStartedAt = now;
        await saveState();
      }
      break;
    }

    case "waiting-recheck": {
      if (now - gs.phaseStartedAt >= RECHECK_MS) {
        if (quotaNowLow) {
          gs.retryCount++;
          if (gs.retryCount > MAX_RETRIES) {
            console.log(`[QuotaGuard] LOCKOUT (retry ${gs.retryCount - 1}/${MAX_RETRIES} failed) -> ${label} -- disabling for 1 hour`);
            gs.lockoutCount++;
            gs.phase = "cooldown";
            gs.phaseStartedAt = now;
            await disableAction();
          } else {
            console.log(`[QuotaGuard] RETRY ${gs.retryCount}/${MAX_RETRIES} (still low) -> ${label} -- disabling again`);
            gs.phase = "cooldown";
            gs.phaseStartedAt = now;
            await disableAction();
          }
        } else {
          console.log(`[QuotaGuard] RECHECK OK -> ${label} -- quota recovered`);
          gs.phase = "idle";
          gs.retryCount = 0;
          gs.lockoutCount = 0;
          disabledByGuard.delete(key);
          await saveState();
        }
      }
      break;
    }
  }
}

// ─── Per-Model Handler ────────────────────────────────────────────────────────

async function handlePerModelQuota(
  providerAlias: string,
  providerId: string,
  quotas: Record<string, UsageQuotaValue>
) {
  for (const [modelId, quota] of Object.entries(quotas)) {
    if (modelId === "session") continue;
    const pct = quota.remainingPercentage ?? 0;
    const isLow = pct <= QUOTA_THRESHOLD;
    const key = `${providerId}:model:${modelId}`;
    const label = `model:${providerAlias}/${modelId} (${pct}%)`;

    await handleGuardPhases(
      key, label, isLow, quota.resetAt,
      async () => {
        await apiPost("/api/models/disabled", { providerAlias, ids: [modelId] });
      },
      async () => {
        await apiDelete(`/api/models/disabled?providerAlias=${providerAlias}&id=${modelId}`);
      }
    );
  }
}

// ─── Per-Session Handler ──────────────────────────────────────────────────────

async function handlePerSessionQuota(
  providerAlias: string,
  connections: Connection[],
  quotas: Record<string, UsageQuotaValue>
) {
  const sessionQuota = quotas["session"];
  if (!sessionQuota) return;

  const pct = sessionQuota.remainingPercentage ?? 0;
  const isLow = pct <= QUOTA_THRESHOLD;

  // Check each connection independently
  for (const conn of connections) {
    const key = `${conn.id}:session`;
    const label = `session:${providerAlias}/${conn.name} (${pct}%)`;

    await handleGuardPhases(
      key, label, isLow, sessionQuota.resetAt,
      async () => {
        await apiPut(`/api/providers/${conn.id}`, { isActive: false });
      },
      async () => {
        await apiPut(`/api/providers/${conn.id}`, { isActive: true });
      }
    );
  }
}

// ─── Per-Category Handler ─────────────────────────────────────────────────────

async function handlePerCategoryQuota(
  providerAlias: string,
  providerId: string,
  quotas: Record<string, UsageQuotaValue>
) {
  const categories: Map<string, Array<{ key: string; quota: UsageQuotaValue }>> = new Map();

  for (const [catKey, quota] of Object.entries(quotas)) {
    const catMatch = catKey.match(/^(.+?)\s*\(/);
    const catName = catMatch ? catMatch[1].trim() : catKey;
    if (!categories.has(catName)) categories.set(catName, []);
    categories.get(catName)!.push({ key: catKey, quota });
  }

  for (const [catName, entries] of categories) {
    const anyLow = entries.some((e) => (e.quota.remainingPercentage ?? 0) <= QUOTA_THRESHOLD);
    // Use the earliest resetAt among the entries
    const earliestReset = entries
      .map(e => e.quota.resetAt)
      .filter(Boolean)
      .sort()[0];
    const key = `${providerId}:cat:${catName}`;
    const label = `category:${providerAlias}/${catName}`;

    await handleGuardPhases(
      key, label, anyLow, earliestReset,
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
  if (isRunning) {
    console.log("[QuotaGuard] Previous cycle still running, skipping");
    return;
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    console.log("[QuotaGuard] Cycle starting...");

    const loggedIn = await ensureAuthenticated();
    if (!loggedIn) {
      console.error("[QuotaGuard] Login failed, skipping cycle");
      return;
    }

    const providersData = await apiGet<ProvidersResponse>("/api/providers");
    if (!providersData?.connections) {
      console.error("[QuotaGuard] Failed to fetch providers, skipping cycle");
      return;
    }

    // Group connections by provider name
    const byProvider = new Map<string, Connection[]>();
    for (const conn of providersData.connections) {
      const name = conn.provider;
      if (!byProvider.has(name)) byProvider.set(name, []);
      byProvider.get(name)!.push(conn);
    }

    const providerSnapshots: ProviderSnapshot[] = [];

    for (const [providerName, conns] of byProvider) {
      if (conns.length === 0) continue;

      const providerAlias = toAlias(providerName);
      const isExcluded = excludedProviders.has(providerName.toLowerCase());
      if (isExcluded) {
        console.log(`[QuotaGuard] Skipping excluded provider: ${providerName}`);
      }

      // Build connection snapshots
      const connSnapshots: ConnectionSnapshot[] = [];

      for (const conn of conns) {
        const usageData = await apiGet<UsageResponse>(`/api/usage/${conn.id}`);
        const quotas = usageData?.quotas || {};
        const quotaType = detectQuotaType(quotas);

        const gsKey = quotaType === "per-session"
          ? `${conn.id}:session`
          : `${conn.id}:${quotaType}`;
        const gs = guardStates.get(gsKey);

        connSnapshots.push({
          id: conn.id,
          name: conn.name,
          isActive: conn.isActive,
          quotaType,
          quotas,
          guardState: {
            phase: gs?.phase || "idle",
            retryCount: gs?.retryCount || 0,
            lockoutCount: gs?.lockoutCount || 0,
            disabledByGuard: disabledByGuard.has(gsKey),
            excluded: isExcluded,
            lastResetAt: gs?.lastResetAt,
          },
        });

        // Skip guard actions for excluded providers
        if (isExcluded) continue;

        // Skip if no quota data
        if (!usageData?.quotas || Object.keys(quotas).length === 0) continue;

        switch (quotaType) {
          case "per-session":
            await handlePerSessionQuota(providerAlias, conns, quotas);
            break;
          case "per-category":
            await handlePerCategoryQuota(providerAlias, conn.id, quotas);
            break;
          case "per-model":
            await handlePerModelQuota(providerAlias, conn.id, quotas);
            break;
          case "no-quota":
          default:
            break;
        }
      }

      providerSnapshots.push({
        name: providerName,
        alias: providerAlias,
        connections: connSnapshots,
      });
    }

    lastCycleAt = new Date().toISOString();

    // Save state after each cycle
    await saveState();

    // Build snapshot for dashboard
    latestSnapshot = {
      scheduler: {
        enabled: schedulerEnabled,
        pollIntervalMs: POLL_INTERVAL_MS,
        threshold: QUOTA_THRESHOLD,
        isRunning: false,
        lastCycleAt,
        excludedProviders: Array.from(excludedProviders),
      },
      providers: providerSnapshots,
    };

    console.log(`[QuotaGuard] Cycle complete (${Date.now() - startTime}ms)`);
  } catch (err) {
    console.error("[QuotaGuard] Cycle error:", err);
  } finally {
    isRunning = false;
  }
}

// ─── Public API for Dashboard ─────────────────────────────────────────────────

export function getQuotaGuardSnapshot(): QuotaGuardSnapshot {
  return latestSnapshot || {
    scheduler: {
      enabled: schedulerEnabled,
      pollIntervalMs: POLL_INTERVAL_MS,
      threshold: QUOTA_THRESHOLD,
      isRunning,
      lastCycleAt,
      excludedProviders: Array.from(excludedProviders),
    },
    providers: [],
  };
}

export function setSchedulerEnabled(enabled: boolean) {
  schedulerEnabled = enabled;
  if (latestSnapshot) latestSnapshot.scheduler.enabled = enabled;
  console.log(`[QuotaGuard] Scheduler ${enabled ? "enabled" : "disabled"}`);
}

export function getExcludedProviders(): string[] {
  return Array.from(excludedProviders);
}

export function setProviderExcluded(provider: string, excluded: boolean) {
  const name = provider.toLowerCase();
  if (excluded) {
    excludedProviders.add(name);
  } else {
    excludedProviders.delete(name);
  }
  if (latestSnapshot) {
    latestSnapshot.scheduler.excludedProviders = Array.from(excludedProviders);
  }
  console.log(`[QuotaGuard] Provider ${name} ${excluded ? "excluded" : "included"}`);
}

export function isSchedulerRunning() {
  return isRunning;
}

// Manual disable/enable for dashboard
export async function manualDisable(providerAlias: string, type: "model" | "connection" | "category", id: string): Promise<boolean> {
  const alias = toAlias(providerAlias);
  switch (type) {
    case "model":
      return !!(await apiPost("/api/models/disabled", { providerAlias: alias, ids: [id] }));
    case "connection":
      return !!(await apiPut(`/api/providers/${id}`, { isActive: false }));
    case "category":
      return !!(await apiPost("/api/models/disabled", { providerAlias: alias, ids: [`${id}/*`] }));
  }
}

export async function manualEnable(providerAlias: string, type: "model" | "connection" | "category", id: string): Promise<boolean> {
  const alias = toAlias(providerAlias);
  switch (type) {
    case "model":
      return !!(await apiDelete(`/api/models/disabled?providerAlias=${alias}&id=${id}`));
    case "connection":
      return !!(await apiPut(`/api/providers/${id}`, { isActive: true }));
    case "category":
      return !!(await apiDelete(`/api/models/disabled?providerAlias=${alias}&id=${id}/*`));
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let schedulerStarted = false;

export async function initializeQuotaGuardScheduler() {
  // Re-read env vars now that dotenv has loaded (module-level constants were
  // captured before dotenv ran in index.ts, so they would be empty).
  BASE_URL = (process.env.NINEROUTER_BASE_URL || BASE_URL).replace(/\/$/, "");
  PASSWORD = process.env.NINEROUTER_PASSWORD || PASSWORD;
  QUOTA_THRESHOLD = parseInt(process.env.NINEROUTER_QUOTA_THRESHOLD || String(QUOTA_THRESHOLD), 10);
  POLL_INTERVAL_MS = parseInt(process.env.NINEROUTER_POLL_INTERVAL_MS || String(POLL_INTERVAL_MS), 10);

  if (!BASE_URL || !PASSWORD) {
    console.log("[QuotaGuard] NINEROUTER_BASE_URL or NINEROUTER_PASSWORD not set, scheduler disabled");
    return;
  }

  if (schedulerStarted) {
    console.log("[QuotaGuard] Scheduler already started");
    return;
  }

  schedulerStarted = true;

  // Load persisted state
  await loadState();

  console.log(`[QuotaGuard] Initialized — poll: ${POLL_INTERVAL_MS / 1000}s, threshold: ${QUOTA_THRESHOLD}%, cooldown: ${COOLDOWN_MS / 60000}min, recheck: ${RECHECK_MS / 60000}min, lockout: ${LOCKOUT_MS / 60000}min, maxRetries: ${MAX_RETRIES}, excluded: [${Array.from(excludedProviders).join(", ")}]`);

  setTimeout(async () => {
    await runQuotaGuardCycle();
  }, 30_000);

  setInterval(async () => {
    if (schedulerEnabled) {
      await runQuotaGuardCycle();
    }
  }, POLL_INTERVAL_MS);
}
