import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { db } from "../db/index.js";
import { providers, modelMonitor } from "../db/schema.js";
import { providers } from "../db/schema.js";
import { eq } from "drizzle-orm";

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
  modelProviderMap: Record<string, number>;
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
        cache.modelProviderMap = parsed.modelProviderMap || {};
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
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Accept": "application/json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error("HTTP " + res.status);
    }

    const payload = await res.json();
    const models = extractModelList(payload, providerId);
    if (models.length === 0) {
      throw new Error("No models returned by upstream");
    }

    return models;
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
    const modelProviderMap: Record<string, number> = {};
    let lastError = "";

    for (const provider of activeProviders) {
      const candidates = buildCandidateUrls(provider.endpoint);
      let success = false;
      for (const url of candidates) {
        try {
          const models = await fetchModelsFromUpstream(url, provider.apiKey, provider.id);
          for (const m of models) {
            if (!modelProviderMap[m.id]) {
              allModels.push(m);
              modelProviderMap[m.id] = provider.id;
            }
          }
          success = true;
          break; // move to next provider
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

  // Hide provider_id from public response
  const publicModels = cache.models.map(({ provider_id, ...rest }) => rest);

  return {
    object: "list",
    data: publicModels,
    cached_at: cache.fetchedAt,
    last_error: cache.lastError,
  };
}

export async function getProviderForModel(modelId: string): Promise<any | null> {
  await loadFromDisk();

  if (!cache.fetchedAt || cache.models.length === 0) {
    await refreshModelCatalog();
  }

  // Strip provider prefix if present: "ProviderName/ModelId" -> "ModelId"
  let cleanModelId = modelId;
  let specifiedProvider: any = null;

  const slashIdx = modelId.indexOf('/');
  if (slashIdx > 0) {
    const prefix = modelId.slice(0, slashIdx);
    cleanModelId = modelId.slice(slashIdx + 1);
    // Check if prefix matches any active provider name
    const allProvs = await db.select().from(providers).where(eq(providers.isActive, true)).all();
    const matched = allProvs.find(p => p.name === prefix);
    if (matched) {
      specifiedProvider = matched;
    }
  }

  // If provider was explicitly specified via prefix, return it
  if (specifiedProvider) {
    return specifiedProvider;
  }

  // No prefix or provider not found: use cached mapping or fallback to highest priority
  const providerId = cache.modelProviderMap[cleanModelId];
  if (!providerId) {
    // Fallback to highest priority active provider
    const fallback = await db.select().from(providers).where(eq(providers.isActive, true)).orderBy(providers.priority).all();
    if (fallback.length > 0) return fallback[fallback.length - 1];
    return null;
  }

  return await db.select().from(providers).where(eq(providers.id, providerId)).get();
}

// Helper: extract clean model ID without provider prefix
export function stripProviderPrefix(modelId: string): string {
  const slashIdx = modelId.indexOf('/');
  if (slashIdx > 0) {
    // Only strip if first part looks like a provider name (lowercase alphanumeric)
    const prefix = modelId.slice(0, slashIdx).toLowerCase();
    if (/^[a-z0-9]+$/.test(prefix)) {
      return modelId.slice(slashIdx + 1);
    }
  }
  return modelId;
}
