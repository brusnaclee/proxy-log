import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { db } from "../db/index.js";
import { adminConfig } from "../db/schema.js";

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const CACHE_FILE_PATH = process.env.MODEL_CATALOG_CACHE_PATH || "./data/model_catalog_cache.json";

interface ModelRecord {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

interface CatalogCache {
  fetchedAt: string | null;
  upstreamEndpoint: string;
  models: ModelRecord[];
  lastError?: string;
}

const cache: CatalogCache = {
  fetchedAt: null,
  upstreamEndpoint: "",
  models: [],
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
  candidates.add(`${base}/models`);
  candidates.add(`${base}/v1/models`);

  if (base.endsWith("/v1")) {
    candidates.add(`${base}/models`);
  }

  return Array.from(candidates);
}

function normalizeModelItem(item: any): ModelRecord | null {
  const id = String(item?.id || item?.name || "").trim();
  if (!id) return null;

  return {
    id,
    object: "model",
    created: typeof item?.created === "number" ? item.created : Math.floor(Date.now() / 1000),
    owned_by: String(item?.owned_by || item?.provider || "upstream"),
  };
}

function extractModelList(payload: any): ModelRecord[] {
  let rawList: any[] = [];

  if (Array.isArray(payload?.data)) {
    rawList = payload.data;
  } else if (Array.isArray(payload?.models)) {
    rawList = payload.models;
  } else if (Array.isArray(payload)) {
    rawList = payload;
  }

  const normalized = rawList
    .map((item) => normalizeModelItem(item))
    .filter((item): item is ModelRecord => !!item);

  const dedup = new Map<string, ModelRecord>();
  for (const model of normalized) {
    dedup.set(model.id, model);
  }

  return Array.from(dedup.values()).sort((a, b) => a.id.localeCompare(b.id));
}

async function loadFromDisk() {
  if (loadedFromDisk) return;
  loadedFromDisk = true;

  try {
    const raw = await readFile(CACHE_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.models)) {
      cache.models = extractModelList(parsed.models);
      cache.fetchedAt = typeof parsed?.fetchedAt === "string" ? parsed.fetchedAt : null;
      cache.upstreamEndpoint = typeof parsed?.upstreamEndpoint === "string" ? parsed.upstreamEndpoint : "";
      cache.lastError = typeof parsed?.lastError === "string" ? parsed.lastError : undefined;
    }
  } catch {
    // Ignore missing or invalid cache file.
  }
}

async function persistToDisk() {
  await mkdir(dirname(CACHE_FILE_PATH), { recursive: true });
  await writeFile(CACHE_FILE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

async function fetchModelsFromUpstream(url: string, apiKey: string): Promise<ModelRecord[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const payload = await res.json();
    const models = extractModelList(payload);
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

    const config = await db.select().from(adminConfig).get();
    if (!config?.upstreamApiKey) {
      cache.lastError = "Upstream API key not configured";
      await persistToDisk();
      return;
    }

    const candidates = buildCandidateUrls(config.upstreamEndpoint);
    let lastError = "Unable to fetch model catalog";

    for (const url of candidates) {
      try {
        const models = await fetchModelsFromUpstream(url, config.upstreamApiKey);
        cache.models = models;
        cache.fetchedAt = new Date().toISOString();
        cache.upstreamEndpoint = normalizeBaseUrl(config.upstreamEndpoint);
        cache.lastError = undefined;
        await persistToDisk();
        return;
      } catch (error: any) {
        lastError = error?.message || "Unknown upstream fetch error";
      }
    }

    cache.lastError = lastError;
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

  return {
    object: "list",
    data: cache.models,
    cached_at: cache.fetchedAt,
    upstream_endpoint: cache.upstreamEndpoint,
    last_error: cache.lastError,
  };
}
