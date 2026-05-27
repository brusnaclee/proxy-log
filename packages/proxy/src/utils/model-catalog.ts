import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { db } from "../db/index.js";
import { providers, modelMonitor } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { sanitizeProviderApiKey } from "./crypto.js";

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const CACHE_FILE_PATH = process.env.MODEL_CATALOG_CACHE_PATH || "./data/model_catalog_cache.json";

export interface ModelRecord {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  provider_id?: number;
}

interface CatalogCache {
  fetchedAt: string | null;
  models: ModelRecord[];
  lastError?: string;
  modelProviderMap: Record<string, number[]>;
}

const cache: CatalogCache = {
  fetchedAt: null,
  models: [],
  modelProviderMap: {},
};

let loadedFromDisk = false;
let refreshInFlight: Promise<void> | null = null;
let schedulerStarted = false;

function normalizeBaseUrl(url: string): string {
  return String(url || "").trim().replace(/\/$/, "");
}

function buildCandidateUrls(upstreamEndpoint: string): string[] {
  const base = normalizeBaseUrl(upstreamEndpoint);
  if (!base) return [];

  const candidates = new Set<string>();
  candidates.add(base + "/models");
  candidates.add(base + "/v1/models");

  if (base.endsWith("/v1")) {
    candidates.add(base + "/models");
  }

  return Array.from(candidates);
}

function normalizeModelItem(item: any, providerId: number): ModelRecord | null {
  const id = String(item?.id || item?.name || "").trim();
  if (!id) return null;

  return {
    id,
    object: "model",
    created: typeof item?.created === "number" ? item.created : Math.floor(Date.now() / 1000),
    owned_by: String(item?.owned_by || item?.owner || "system").trim(),
    provider_id: providerId,
  };
}

function extractModelList(payload: any, providerId: number): ModelRecord[] {
  const arr = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  return arr.map((i: any) => normalizeModelItem(i, providerId)).filter(Boolean) as ModelRecord[];
}

/** Normalize legacy single-provider map to array form. */
function normalizeProviderMap(raw: Record<string, number | number[]> | undefined): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!raw) return out;
  for (const [modelId, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      out[modelId] = [...value];
    } else if (typeof value === "number") {
      out[modelId] = [value];
    }
  }
  return out;
}

function appendProviderToMap(map: Record<string, number[]>, modelId: string, providerId: number) {
  if (!map[modelId]) {
    map[modelId] = [];
  }
  if (!map[modelId].includes(providerId)) {
    map[modelId].push(providerId);
  }
}

async function loadFromDisk() {
  if (loadedFromDisk) return;
  loadedFromDisk = true;
  try {
    const raw = await readFile(CACHE_FILE_PATH, "utf8");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.models)) {
        cache.models = parsed.models;
        cache.fetchedAt = typeof parsed?.fetchedAt === "string" ? parsed.fetchedAt : null;
        cache.modelProviderMap = normalizeProviderMap(parsed.modelProviderMap);
        cache.lastError = typeof parsed?.lastError === "string" ? parsed.lastError : undefined;
      }
    }
  } catch {
    // Ignore
  }
}

async function persistToDisk() {
  await mkdir(dirname(CACHE_FILE_PATH), { recursive: true });
  await writeFile(CACHE_FILE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

async function fetchModelsFromUpstream(url: string, apiKey: string, providerId: number): Promise<ModelRecord[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const cleanKey = sanitizeProviderApiKey(apiKey);
  try {
    const authAttempts = cleanKey ? [cleanKey, ""] : [""];
    let lastError = "No models returned by upstream";

    for (const key of authAttempts) {
      try {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (key) headers.Authorization = "Bearer " + key;

        const res = await fetch(url, {
          method: "GET",
          headers,
          signal: controller.signal,
        });

        if (!res.ok) {
          lastError = "HTTP " + res.status;
          continue;
        }

        const payload = await res.json();
        const models = extractModelList(payload, providerId);
        if (models.length === 0) {
          lastError = "No models returned by upstream";
          continue;
        }

        return models;
      } catch (error: any) {
        lastError = error?.message || lastError;
      }
    }

    throw new Error(lastError);
  } finally {
    clearTimeout(timeout);
  }
}

export async function refreshModelCatalog(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    await loadFromDisk();

    const activeProviders = await db.select().from(providers).where(eq(providers.isActive, true)).orderBy(providers.priority).all();
    if (activeProviders.length === 0) {
      cache.lastError = "No active providers configured";
      return;
    }

    const allModels: ModelRecord[] = [];
    const modelProviderMap: Record<string, number[]> = {};
    let lastError = "";

    for (const provider of activeProviders) {
      const candidates = buildCandidateUrls(provider.endpoint);
      let success = false;
      for (const url of candidates) {
        try {
          const models = await fetchModelsFromUpstream(url, provider.apiKey, provider.id);
          for (const m of models) {
            const existing = allModels.find((x) => x.id === m.id && x.provider_id === provider.id);
            if (!existing) {
              allModels.push(m);
            }
            appendProviderToMap(modelProviderMap, m.id, provider.id);
          }
          success = true;
          break;
        } catch (error: any) {
          lastError = error?.message || "Unknown upstream fetch error";
        }
      }
      if (!success) {
        console.error("Failed to fetch models from provider " + provider.name + ": ", lastError);
      }
    }

    cache.models = allModels;
    cache.modelProviderMap = modelProviderMap;
    cache.fetchedAt = new Date().toISOString();
    cache.lastError = lastError || undefined;
    await persistToDisk();
  })();

  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function initializeModelCatalogScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  await loadFromDisk();
  void refreshModelCatalog();

  const timer = setInterval(() => {
    void refreshModelCatalog();
  }, REFRESH_INTERVAL_MS);

  timer.unref?.();
}

export async function getModelCatalogResponse() {
  await loadFromDisk();

  if (!cache.fetchedAt || cache.models.length === 0) {
    void refreshModelCatalog();
  } else {
    const ageMs = Date.now() - Date.parse(cache.fetchedAt);
    if (!Number.isNaN(ageMs) && ageMs > REFRESH_INTERVAL_MS) {
      void refreshModelCatalog();
    }
  }

  // Deduplicate by model id for public listing (first occurrence wins for display)
  const seen = new Set<string>();
  const publicModels: Omit<ModelRecord, "provider_id">[] = [];
  for (const m of cache.models) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const { provider_id: _pid, ...rest } = m;
    publicModels.push(rest);
  }

  return {
    object: "list",
    data: publicModels,
    cached_at: cache.fetchedAt,
    last_error: cache.lastError,
  };
}

async function getActiveProviders() {
  return db.select().from(providers).where(eq(providers.isActive, true)).orderBy(providers.priority).all();
}

async function resolveProviderById(providerId: number) {
  const p = await db.select().from(providers).where(eq(providers.id, providerId)).get();
  return p && p.isActive ? p : null;
}

/** Parse model id into optional forced provider name + upstream model id. */
export async function parseModelWithProvider(modelId: string): Promise<{ upstreamModel: string; forcedProviderName: string | null }> {
  const slashIdx = modelId.indexOf("/");
  if (slashIdx <= 0) {
    return { upstreamModel: modelId, forcedProviderName: null };
  }

  const prefix = modelId.slice(0, slashIdx);
  const allProvs = await getActiveProviders();
  const matched = allProvs.find((p) => p.name === prefix);
  if (matched) {
    return {
      upstreamModel: modelId.slice(slashIdx + 1),
      forcedProviderName: prefix,
    };
  }

  return { upstreamModel: modelId, forcedProviderName: null };
}

function collectProviderIdsForModel(modelId: string, upstreamModel: string): number[] {
  const ids = new Set<number>();

  for (const pid of cache.modelProviderMap[modelId] || []) ids.add(pid);
  for (const pid of cache.modelProviderMap[upstreamModel] || []) ids.add(pid);

  for (const [catalogModelId, pids] of Object.entries(cache.modelProviderMap)) {
    if (
      catalogModelId === modelId ||
      catalogModelId === upstreamModel ||
      catalogModelId.endsWith("/" + upstreamModel) ||
      catalogModelId.endsWith("/" + modelId)
    ) {
      for (const pid of pids) ids.add(pid);
    }
  }

  return Array.from(ids);
}

async function isProviderOnlineForModel(providerName: string, upstreamModel: string): Promise<boolean> {
  const latest = await db
    .select()
    .from(modelMonitor)
    .where(
      and(
        eq(modelMonitor.modelId, upstreamModel),
        eq(modelMonitor.provider, providerName),
      ),
    )
    .orderBy(desc(modelMonitor.checkedAt))
    .limit(1)
    .get();

  if (latest) {
    return Boolean(latest.isOnline) && latest.httpStatus === 200;
  }

  // Fallback: any monitor row for this model (legacy rows without provider)
  const legacy = await db
    .select()
    .from(modelMonitor)
    .where(eq(modelMonitor.modelId, upstreamModel))
    .orderBy(desc(modelMonitor.checkedAt))
    .limit(1)
    .get();

  if (legacy) {
    return Boolean(legacy.isOnline) && legacy.httpStatus === 200;
  }

  // No monitor data — treat as eligible (don't block)
  return true;
}

function weightedRandomProvider(candidates: Array<{ provider: typeof providers.$inferSelect; priority: number }>) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].provider;

  const totalWeight = candidates.reduce((sum, c) => sum + Math.max(c.priority, 1), 0);
  let roll = Math.random() * totalWeight;

  for (const c of candidates) {
    roll -= Math.max(c.priority, 1);
    if (roll <= 0) return c.provider;
  }

  return candidates[candidates.length - 1].provider;
}

export async function getProviderForModel(modelId: string): Promise<any | null> {
  await loadFromDisk();

  if (!cache.fetchedAt || cache.models.length === 0) {
    await refreshModelCatalog();
  }

  const { upstreamModel, forcedProviderName } = await parseModelWithProvider(modelId);

  if (forcedProviderName) {
    const forced = await db
      .select()
      .from(providers)
      .where(and(eq(providers.name, forcedProviderName), eq(providers.isActive, true)))
      .get();
    return forced || null;
  }

  const candidateIds = collectProviderIdsForModel(modelId, upstreamModel);
  const allActive = await getActiveProviders();

  let resolvedCandidates = candidateIds.length > 0
    ? (await Promise.all(candidateIds.map((id) => resolveProviderById(id)))).filter(Boolean) as typeof allActive
    : [];

  if (resolvedCandidates.length === 0 && candidateIds.length === 0) {
    // No catalog match — don't blindly pick first provider; try any that lists the model via owned_by heuristic
    resolvedCandidates = allActive;
  }

  if (resolvedCandidates.length === 0) {
    return null;
  }

  const onlineCandidates: Array<{ provider: typeof allActive[0]; priority: number }> = [];
  for (const p of resolvedCandidates) {
    const online = await isProviderOnlineForModel(p.name, upstreamModel);
    if (online) {
      onlineCandidates.push({ provider: p, priority: p.priority });
    }
  }

  const pool = onlineCandidates.length > 0 ? onlineCandidates : resolvedCandidates.map((p) => ({ provider: p, priority: p.priority }));
  if (onlineCandidates.length === 0 && resolvedCandidates.length > 0) {
    console.warn(`[model-catalog] No online monitor entry for "${upstreamModel}", falling back to priority pool`);
  }

  return weightedRandomProvider(pool);
}

/** Strip registered provider prefix only (e.g. tokito/glm/glm-5 → glm/glm-5). */
export async function stripProviderPrefix(modelId: string): Promise<string> {
  const { upstreamModel } = await parseModelWithProvider(modelId);
  return upstreamModel;
}

/** Synchronous strip when provider names already known (for hot paths). */
export function stripProviderPrefixSync(modelId: string, providerNames: Set<string>): string {
  const slashIdx = modelId.indexOf("/");
  if (slashIdx <= 0) return modelId;
  const prefix = modelId.slice(0, slashIdx);
  if (providerNames.has(prefix)) {
    return modelId.slice(slashIdx + 1);
  }
  return modelId;
}
