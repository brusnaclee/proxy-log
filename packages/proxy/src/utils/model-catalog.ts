import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { db } from "../db/index.js";
import { providers, modelMonitor, providerApiKeys, modelMetadata, customModels } from "../db/schema.js";
import { eq, and, desc, sql, asc } from "drizzle-orm";
import { sanitizeProviderApiKey } from "./crypto.js";
import { getFallbackMetadata } from "./model-metadata-fallback.js";
import {
  buildModelListAuthHeaders,
  buildModelListCandidateUrls,
} from "./probe-validate.js";

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000; // Upstream combo is often slow on POST; give the GET enough headroom.
const CACHE_FILE_PATH = process.env.MODEL_CATALOG_CACHE_PATH || "./data/model_catalog_cache.json";

/** Synthetic model ids exposed for you.com (endpointType "youcom") providers. */
export const YOUCOM_MODEL_IDS = ["express", "advanced"];

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
  if (base.endsWith("/v1")) {
    candidates.add(base + "/models");
  } else {
    candidates.add(base + "/models");
    candidates.add(base + "/v1/models");
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

function buildUpstreamAuthHeaders(apiKey: string, endpointType: string): Record<string, string> {
  return buildModelListAuthHeaders(apiKey, endpointType);
}

async function getCatalogProbeKeys(providerId: number, legacyApiKey: string | null): Promise<string[]> {
  const rows = await db
    .select()
    .from(providerApiKeys)
    .where(
      and(
        eq(providerApiKeys.providerId, providerId),
        eq(providerApiKeys.isActive, true),
        eq(providerApiKeys.isLimited, false),
      ),
    )
    .orderBy(asc(providerApiKeys.id));
  const keys = rows.map((r) => sanitizeProviderApiKey(r.apiKey)).filter(Boolean);
  const legacy = sanitizeProviderApiKey(legacyApiKey || "");
  if (legacy && !keys.includes(legacy)) keys.push(legacy);
  return keys.length ? keys : legacy ? [legacy] : [""];
}

async function fetchModelsFromUpstream(
  url: string,
  apiKey: string,
  providerId: number,
  endpointType = "openai",
): Promise<ModelRecord[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const cleanKey = sanitizeProviderApiKey(apiKey);
  try {
    const authAttempts = cleanKey ? [cleanKey, ""] : [""];
    let lastError = "No models returned by upstream";

    for (const key of authAttempts) {
      try {
        const headers = buildUpstreamAuthHeaders(key, endpointType);

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

async function injectCustomModelsForProvider(
  provider: { id: number; name: string },
  allModels: ModelRecord[],
  modelProviderMap: Record<string, number[]>,
) {
  const rows = await db
    .select()
    .from(customModels)
    .where(and(eq(customModels.providerId, provider.id), eq(customModels.isActive, true)));

  for (const cm of rows) {
    const existing = allModels.find((x) => x.id === cm.modelId && x.provider_id === provider.id);
    if (!existing) {
      allModels.push({
        id: cm.modelId,
        object: "model",
        created: Math.floor(cm.createdAt.getTime() / 1000),
        owned_by: provider.name,
        provider_id: provider.id,
      });
    }
    appendProviderToMap(modelProviderMap, cm.modelId, provider.id);
  }
}

export async function refreshModelCatalog(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    await loadFromDisk();

    const activeProviders = await db.select().from(providers).where(eq(providers.isActive, true)).orderBy(providers.priority);
    if (activeProviders.length === 0) {
      cache.lastError = "No active providers configured";
      return;
    }

    const allModels: ModelRecord[] = [];
    const modelProviderMap: Record<string, number[]> = {};
    let lastError = "";

    for (const provider of activeProviders) {
      // you.com has no /models endpoint; inject synthetic agent models.
      if (provider.endpointType === "youcom") {
        for (const agentId of YOUCOM_MODEL_IDS) {
          const existing = allModels.find((x) => x.id === agentId && x.provider_id === provider.id);
          if (!existing) {
            allModels.push({
              id: agentId,
              object: "model",
              created: Math.floor(Date.now() / 1000),
              owned_by: "you.com",
              provider_id: provider.id,
            });
          }
          appendProviderToMap(modelProviderMap, agentId, provider.id);
        }
        continue;
      }

      const candidates = buildModelListCandidateUrls(provider.endpoint);
      const probeKeys = await getCatalogProbeKeys(provider.id, provider.apiKey);
      let success = false;
      // Retry the upstream fetch up to 2x to ride out transient Cloudflare
      // 524s / aborts. Try every active provider API key.
      for (const url of candidates) {
        for (const key of probeKeys) {
          for (let attempt = 0; attempt < 2 && !success; attempt++) {
            try {
              const models = await fetchModelsFromUpstream(
                url,
                key,
                provider.id,
                provider.endpointType || "openai",
              );
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
              if (attempt === 0) {
                console.warn(`[model-catalog] fetch from ${provider.name} attempt 1 failed: ${lastError}, retrying once...`);
                await new Promise((r) => setTimeout(r, 1500));
              }
            }
          }
          if (success) break;
        }
        if (success) break;
      }
      if (!success) {
        // Soft-retain: keep previous catalog rows for this provider so a transient
        // /models 401/5xx does not wipe routable models from /v1/models + sweeps.
        const retained = (cache.models || []).filter(
          (m) => m.provider_id === provider.id,
        );
        for (const m of retained) {
          const existing = allModels.find(
            (x) => x.id === m.id && x.provider_id === provider.id,
          );
          if (!existing) allModels.push({ ...m });
          appendProviderToMap(modelProviderMap, m.id, provider.id);
        }
        console.error(
          "Failed to fetch models from provider " +
            provider.name +
            ": ",
          lastError,
          retained.length
            ? `(retained ${retained.length} cached models)`
            : "(no cache to retain)",
        );
      }

      // Always merge custom models so they appear even when /v1/models fetch fails.
      await injectCustomModelsForProvider(provider, allModels, modelProviderMap);
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

  // Load metadata for enrichment
  const metadataMap = await getModelMetadataMap();

  // Build provider ID -> name map (all active providers, not just catalog hits)
  const providerIdToName = new Map<number, string>();
  const activeProviders = await getActiveProviders();
  for (const p of activeProviders) {
    providerIdToName.set(p.id, p.name);
  }
  for (const providerIds of Object.values(cache.modelProviderMap)) {
    for (const pid of providerIds) {
      if (!providerIdToName.has(pid)) {
        const p = await resolveProviderById(pid);
        if (p) providerIdToName.set(pid, p.name);
      }
    }
  }

  // Deduplicate per (provider, model) so the same upstream model id on different
  // providers (e.g. tokito vs claude both serving minimax/MiniMax-M3) each get
  // their own public entry: {provider}/{modelId}.
  const seen = new Set<string>();
  const publicModels: any[] = [];

  // Add virtual "auto" model (proxy-level auto-selection)
  publicModels.push({
    id: "auto",
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "proxy",
    description: "Auto-selects the fastest available online model",
    context_length: 262144,
    supported_features: ["tools", "reasoning", "structured_outputs"],
  });

  for (const m of cache.models) {
    const providerId = m.provider_id ?? null;
    const dedupeKey = providerId != null ? `${providerId}:${m.id}` : m.id;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const upstreamProviderName = providerId != null
      ? (providerIdToName.get(providerId) || null)
      : (() => {
          const providerIds = cache.modelProviderMap[m.id] || [];
          return providerIds.length > 0 ? (providerIdToName.get(providerIds[0]) || null) : null;
        })();

    // Build the public ID with upstream provider prefix
    const publicId = upstreamProviderName
      ? `${upstreamProviderName}/${m.id}`
      : m.id;

    const { provider_id: _pid, ...rest } = m;
    rest.id = publicId;

    // Start from hardcoded fallback metadata, then overlay DB-enriched metadata.
    const fb = getFallbackMetadata(m.id) || getFallbackMetadata(publicId);
    const meta = metadataMap.get(m.id) || metadataMap.get(publicId);

    if (meta || fb) {
      const enriched: any = { ...rest };
      enriched.provider = enriched.owned_by || null;
      enriched.upstream_provider = upstreamProviderName;

      // Apply fallback first
      if (fb) {
        if (fb.contextLength) enriched.context_length = fb.contextLength;
        if (fb.maxOutputTokens) enriched.max_output_tokens = fb.maxOutputTokens;
        if (fb.displayName) enriched.name = fb.displayName;
        if (fb.description) enriched.description = fb.description;
        if (fb.inputPricePerMtok || fb.outputPricePerMtok) {
          enriched.pricing = {
            prompt: (fb.inputPricePerMtok || 0) / 1_000_000,
            completion: (fb.outputPricePerMtok || 0) / 1_000_000,
          };
        }
        if (fb.inputModalities) enriched.input_modalities = fb.inputModalities;
        if (fb.outputModalities) enriched.output_modalities = fb.outputModalities;
        if (fb.supportedFeatures) enriched.supported_features = fb.supportedFeatures;
      }

      // Overlay DB metadata (higher priority when present)
      if (meta) {
        if (meta.contextLength) enriched.context_length = meta.contextLength;
        if (meta.maxOutputTokens) enriched.max_output_tokens = meta.maxOutputTokens;
        if (meta.displayName) enriched.name = meta.displayName;
        if (meta.description) enriched.description = meta.description;
        if (meta.inputPricePerMtok || meta.outputPricePerMtok) {
          enriched.pricing = {
            prompt: (meta.inputPricePerMtok || 0) / 1_000_000,
            completion: (meta.outputPricePerMtok || 0) / 1_000_000,
          };
        }
        if (meta.inputModalities) {
          try { enriched.input_modalities = JSON.parse(meta.inputModalities); } catch {}
        }
        if (meta.outputModalities) {
          try { enriched.output_modalities = JSON.parse(meta.outputModalities); } catch {}
        }
        if (meta.supportedFeatures) {
          try { enriched.supported_features = JSON.parse(meta.supportedFeatures); } catch {}
        }
      }
      publicModels.push(enriched);
    } else {
      rest.provider = rest.owned_by || null;
      rest.upstream_provider = upstreamProviderName;
      publicModels.push(rest);
    }
  }

  // Add custom models from database
  const activeCustomModels = await db.select().from(customModels).where(eq(customModels.isActive, true));
  for (const cm of activeCustomModels) {
    const providerName = providerIdToName.get(cm.providerId) || "unknown";
    const publicId = `${providerName}/${cm.modelId}`;

    if (seen.has(publicId)) continue;
    seen.add(publicId);

    // Pull fallback metadata for the raw model id to fill any gaps
    const fb = getFallbackMetadata(cm.modelId);

    const parseList = (raw: string | null, fallbackList: string[] | undefined, def: string[]) => {
      if (raw) { try { const v = JSON.parse(raw); if (Array.isArray(v) && v.length) return v; } catch {} }
      return fallbackList && fallbackList.length ? fallbackList : def;
    };

    const inputPrice = cm.inputPricePerMtok || fb?.inputPricePerMtok || 0;
    const outputPrice = cm.outputPricePerMtok || fb?.outputPricePerMtok || 0;

    const enriched: any = {
      id: publicId,
      object: "model",
      created: Math.floor(cm.createdAt.getTime() / 1000),
      owned_by: providerName,
      provider: providerName,
      upstream_provider: providerName,
      name: cm.displayName || fb?.displayName || cm.modelId,
      description: cm.description || fb?.description || null,
      context_length: cm.contextLength || fb?.contextLength || null,
      max_output_tokens: cm.maxOutputTokens || fb?.maxOutputTokens || null,
      pricing: (inputPrice || outputPrice) ? {
        prompt: inputPrice / 1_000_000,
        completion: outputPrice / 1_000_000,
      } : undefined,
      input_modalities: parseList(cm.inputModalities, fb?.inputModalities, ["text"]),
      output_modalities: parseList(cm.outputModalities, fb?.outputModalities, ["text"]),
      supported_features: parseList(cm.supportedFeatures, fb?.supportedFeatures, []),
      custom: true,
    };

    // Merge DB metadata (from OpenRouter enrichment) if available — highest priority
    const meta = metadataMap.get(cm.modelId);
    if (meta) {
      if (meta.contextLength) enriched.context_length = meta.contextLength;
      if (meta.maxOutputTokens) enriched.max_output_tokens = meta.maxOutputTokens;
      if (meta.description) enriched.description = meta.description;
    }

    publicModels.push(enriched);
  }

  return {
    object: "list",
    data: publicModels,
    cached_at: cache.fetchedAt,
    last_error: cache.lastError,
  };
}

export async function getFilteredModelCatalogResponse(opts?: { isTrial?: boolean }) {
  const base = await getModelCatalogResponse();
  if (!opts?.isTrial) return base;

  // Trial users see only `gpy/*` models + the virtual `auto`. No hardcoded
  // fallback — if cache is empty for gpy/*, we just expose `auto` so the
  // user can still try and hit the upstream auto-routing path.
  const filtered = (base?.data || []).filter((m) => {
    const id = String(m?.id || "").toLowerCase();
    return id.startsWith("gpy/") || id === "auto";
  });

  // Ensure `auto` virtual model is always present for trial users.
  if (!filtered.some((m) => String(m.id).toLowerCase() === "auto")) {
    filtered.unshift({
      id: "auto",
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "proxy",
      provider: "proxy",
      upstream_provider: "proxy",
      context_length: 262144,
      max_output_tokens: 64000,
      supported_features: ["tools", "reasoning", "structured_outputs"],
    } as any);
  }

  return { ...base, data: filtered };
}

async function getActiveProviders() {
  return db.select().from(providers).where(eq(providers.isActive, true)).orderBy(providers.priority);
}

async function resolveProviderById(providerId: number) {
  const p = (await db.select().from(providers).where(eq(providers.id, providerId)))[0];
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
	// Check exact match first
	const latest = (await db
		.select()
		.from(modelMonitor)
		.where(
			and(
				eq(modelMonitor.modelId, upstreamModel),
				eq(modelMonitor.provider, providerName),
			),
		)
		.orderBy(desc(modelMonitor.checkedAt))
		.limit(1))[0];

	if (latest) {
		return Boolean(latest.isOnline) && latest.httpStatus === 200;
	}

	// Also check with provider prefix (e.g., "mimo-v2.5-pro" -> "mimo/mimo-v2.5-pro")
	const withPrefix = (await db
		.select()
		.from(modelMonitor)
		.where(
			and(
				eq(modelMonitor.modelId, `${providerName}/${upstreamModel}`),
				eq(modelMonitor.provider, providerName),
			),
		)
		.orderBy(desc(modelMonitor.checkedAt))
		.limit(1))[0];

	if (withPrefix) {
		return Boolean(withPrefix.isOnline) && withPrefix.httpStatus === 200;
	}

	// Fallback: any monitor row for this model (legacy rows without provider)
	const legacy = (await db
		.select()
		.from(modelMonitor)
		.where(eq(modelMonitor.modelId, upstreamModel))
		.orderBy(desc(modelMonitor.checkedAt))
		.limit(1))[0];

	if (legacy) {
		return Boolean(legacy.isOnline) && legacy.httpStatus === 200;
	}

	// No monitor data — treat as eligible (don't block first request)
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
    const forced = (await db
      .select()
      .from(providers)
      .where(and(eq(providers.name, forcedProviderName), eq(providers.isActive, true))))[0];
    return forced || null;
  }

  const candidateIds = collectProviderIdsForModel(modelId, upstreamModel);
  const allActive = await getActiveProviders();

  let resolvedCandidates = candidateIds.length > 0
    ? (await Promise.all(candidateIds.map((id) => resolveProviderById(id)))).filter(Boolean) as typeof allActive
    : [];

  if (resolvedCandidates.length === 0 && candidateIds.length === 0) {
    // No catalog match — check custom models table (match bare id after prefix strip)
    const { customModels } = await import("../db/schema.js");
    let customModel = (await db.select().from(customModels)
      .where(and(eq(customModels.modelId, upstreamModel), eq(customModels.isActive, true))))[0];

    if (!customModel && modelId !== upstreamModel) {
      customModel = (await db.select().from(customModels)
        .where(and(eq(customModels.modelId, modelId), eq(customModels.isActive, true))))[0];
    }

    if (customModel) {
      const customProvider = await resolveProviderById(customModel.providerId);
      if (customProvider) {
        if (!forcedProviderName || customProvider.name === forcedProviderName) {
          return customProvider;
        }
      }
    }

    // Unknown model — do not route to a random active provider.
    return null;
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

/** Strip registered provider prefix only (e.g. tokito/glm/glm-5 ? glm/glm-5). */
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

const AUTO_MODEL_EXCLUDE_PATTERNS = [
  /\bimage\b/i,        // Image generation (qwen-image-*, z-image-*, wan2.7-image*)
  /\btts\b/i,          // Text-to-speech (qwen3-tts-*, mimo-*-tts*)
  /\basr\b/i,          // Speech recognition (qwen3-asr-*)
  /\bocr\b/i,          // OCR (qwen-vl-ocr-*)
  /\bembed/i,          // Embedding models (text-embedding-*)
  /\brerank/i,         // Reranking
  /\bmoderation\b/i,   // Content moderation
  /\bs2s\b/i,          // Speech-to-speech
  /\bcaptioner\b/i,    // Image captioning
  /^qwen-mt-/i,        // Machine translation
  /tingwu/i,           // Speech processing (tongyi-tingwu-slp)
  /ccai-/i,            // CCAI specialized
  /livetranslate/i,    // Live translation
  /-omni-/i,           // Omni multimodal (audio/video - unreliable for text chat)
  /^wan/i,             // Wanx image generation
  /^qvq-/i,           // Visual QA (not standard chat)
  /\bflux\b/i,         // Flux image generation
  /\bdall/i,           // DALL-E
  /stable[-_]?diff/i,  // Stable Diffusion
  /\bwhisper\b/i,      // Whisper speech
  /voicedesign/i,      // Voice design
  /voiceclone/i,       // Voice cloning
  /-realtime/i,        // Realtime streaming models (audio/video)
  /-character$/i,      // Character/roleplay models
  /^express$/i,        // you.com Express agent (route explicitly, not via auto)
  /^advanced$/i,       // you.com Advanced agent (route explicitly, not via auto)
  /^conduit\//i,       // Conduit transient upstream — never in auto pool
];

export function isAutoCompatible(modelId: string): boolean {
  return !AUTO_MODEL_EXCLUDE_PATTERNS.some(p => p.test(modelId));
}

/** Get all online models from model_monitor, sorted by latency ascending. */
export async function getOnlineModelsByLatency(): Promise<Array<{
  modelId: string;
  provider: string;
  latencyMs: number;
  baseUrl: string;
}>> {
  // Get latest check per model+provider, then filter to online only
  const latestSubquery = db
    .select({
      modelId: modelMonitor.modelId,
      provider: modelMonitor.provider,
      maxCheckedAt: sql<string>`MAX(checked_at)`.as("max_checked_at"),
    })
    .from(modelMonitor)
    .groupBy(modelMonitor.modelId, modelMonitor.provider)
    .as("latest");

  const rows = await db
    .select()
    .from(modelMonitor)
    .innerJoin(
      latestSubquery,
      sql`${modelMonitor.modelId} = ${latestSubquery.modelId} AND COALESCE(${modelMonitor.provider}, '') = COALESCE(${latestSubquery.provider}, '') AND ${modelMonitor.checkedAt} = ${latestSubquery.maxCheckedAt}`,
    );

  // Filter out monitor rows whose prefix doesn't match any active provider. This
  // skips "ghost" model ids left over from a removed upstream so the auto
  // resolver doesn't pick a model that has no provider DB row.
  const allActive = await db
    .select({ name: providers.name, endpointType: providers.endpointType })
    .from(providers)
    .where(eq(providers.isActive, true));
  const activeNames = new Set(allActive.map((p) => String(p.name || "").toLowerCase()));
  const isResolvable = (modelId: string, provider: string | null): boolean => {
    const id = String(modelId || "").toLowerCase();
    const slash = id.indexOf("/");
    if (slash > 0) {
      const prefix = id.slice(0, slash);
      if (activeNames.has(prefix)) return true;
    }
    if (provider && activeNames.has(String(provider).toLowerCase())) return true;
    return false;
  };

  return rows
    .map((r) => r.model_monitor)
    .filter((d) => d.isOnline && d.httpStatus === 200 && d.provider && isResolvable(d.modelId, d.provider))
    .sort((a, b) => (a.latencyMs ?? 999999) - (b.latencyMs ?? 999999))
    .map((d) => ({
      modelId: d.modelId,
      provider: d.provider!,
      latencyMs: d.latencyMs ?? 0,
      baseUrl: d.baseUrl ?? "",
    }));
}

// --- Provider API Key Rotation (multi-key load balancing) --------------------

export interface ProviderApiKeyRow {
  id: number;
  providerId: number;
  apiKey: string;
  isActive: boolean;
  isLimited: boolean;
  limitedAt: string | null;
  requestCount: number;
  lastUsedAt: string | null;
}

/**
 * Get the next available API key for a provider.
 * Uses least-used-first (by requestCount) for even load distribution.
 * Skips keys marked as limited or inactive.
 * Falls back to the provider's legacy api_key column if no keys in the new table.
 */
export async function getNextApiKey(providerId: number): Promise<{ keyId: number; apiKey: string } | null> {
  const keys = await db
    .select()
    .from(providerApiKeys)
    .where(
      and(
        eq(providerApiKeys.providerId, providerId),
        eq(providerApiKeys.isLimited, false),
        eq(providerApiKeys.isActive, true),
      ),
    )
    .orderBy(asc(providerApiKeys.requestCount));

  if (keys.length > 0) {
    const chosen = keys[0];
    // Increment requestCount and update lastUsedAt
    await db
      .update(providerApiKeys)
      .set({
        requestCount: (chosen.requestCount ?? 0) + 1,
        lastUsedAt: new Date().toISOString(),
      })
      .where(eq(providerApiKeys.id, chosen.id));

    return { keyId: chosen.id, apiKey: chosen.apiKey };
  }

  // Fallback: use the legacy api_key from the providers table
  const provider = (await db.select().from(providers).where(eq(providers.id, providerId)))[0];
  if (provider?.apiKey) {
    return { keyId: -1, apiKey: provider.apiKey }; // -1 = legacy key
  }

  return null;
}

/**
 * Mark a key as rate-limited so it won't be selected again until reset.
 */
export async function markKeyAsLimited(keyId: number): Promise<void> {
  if (keyId < 0) return; // legacy key, can't mark
  await db
    .update(providerApiKeys)
    .set({
      isLimited: true,
      limitedAt: new Date().toISOString(),
    })
    .where(eq(providerApiKeys.id, keyId));
}

/**
 * Reset a key's limited status (Retry button in dashboard).
 */
export async function resetKeyLimited(keyId: number): Promise<void> {
  await db
    .update(providerApiKeys)
    .set({
      isLimited: false,
      limitedAt: null,
    })
    .where(eq(providerApiKeys.id, keyId));
}

/**
 * Delete an API key (Delete button in dashboard).
 */
export async function deleteApiKey(keyId: number): Promise<void> {
  await db.delete(providerApiKeys).where(eq(providerApiKeys.id, keyId));
}

/**
 * Toggle a key's active status (Enable/Disable button in dashboard).
 */
export async function toggleKeyActive(keyId: number): Promise<boolean> {
  const key = (await db.select().from(providerApiKeys).where(eq(providerApiKeys.id, keyId)))[0];
  if (!key) return false;
  const newActive = !key.isActive;
  await db
    .update(providerApiKeys)
    .set({ isActive: newActive })
    .where(eq(providerApiKeys.id, keyId));
  return newActive;
}

/**
 * Update a key's value (Edit key in dashboard).
 */
export async function updateApiKey(keyId: number, newApiKey: string): Promise<void> {
  await db
    .update(providerApiKeys)
    .set({ apiKey: sanitizeProviderApiKey(newApiKey) })
    .where(eq(providerApiKeys.id, keyId));
}

/**
 * Get all API keys for a provider (for dashboard display).
 */
export async function getProviderApiKeys(providerId: number): Promise<ProviderApiKeyRow[]> {
  const rows = await db
    .select()
    .from(providerApiKeys)
    .where(eq(providerApiKeys.providerId, providerId))
    .orderBy(providerApiKeys.id);

  return rows.map((r) => ({
    id: r.id,
    providerId: r.providerId,
    apiKey: r.apiKey,
    isActive: Boolean(r.isActive),
    isLimited: Boolean(r.isLimited),
    limitedAt: r.limitedAt,
    requestCount: r.requestCount ?? 0,
    lastUsedAt: r.lastUsedAt,
  }));
}

/**
 * Add a new API key to a provider.
 */
export async function addProviderApiKey(providerId: number, apiKey: string): Promise<number> {
  const [result] = await db.insert(providerApiKeys).values({
    providerId,
    apiKey: sanitizeProviderApiKey(apiKey),
    requestCount: 0,
    isLimited: false,
  }).returning();

  return result.id;
}

// --- Model Metadata Enrichment (OpenRouter + Fallback) ------------------------

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/models";
const ENRICHMENT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
let lastEnrichmentAt = 0;
let enrichmentInFlight: Promise<void> | null = null;

/**
 * Known prefix mappings from our model IDs to OpenRouter vendor prefixes.
 * OpenRouter uses "vendor/model" format (e.g., "qwen/qwen3-max").
 */
const VENDOR_PREFIXES: Record<string, string[]> = {
  "qwen": ["qwen", "alibaba"],
  "ag": ["anthropic", "google", "openai"],
  "glm": ["zhipu", "thudm"],
  "minimax": ["minimax"],
  "ollama": ["ollama"],
  "deepseek": ["deepseek"],
  "mimo": ["xiaomi"],
};

function usd(dollars: number): number {
  return Math.round(dollars * 1_000_000);
}

/**
 * Try to find an OpenRouter model matching our local model ID.
 */
function findOpenRouterMatch(
  localModelId: string,
  openRouterModels: Map<string, any>,
): any | null {
  // Direct match: e.g., "qwen/qwen3-max" exists directly
  if (openRouterModels.has(localModelId)) return openRouterModels.get(localModelId);

  // Strip our provider prefix: "ag/claude-sonnet-4-6" -> "claude-sonnet-4-6"
  const slashIdx = localModelId.indexOf("/");
  const bareId = slashIdx > 0 ? localModelId.slice(slashIdx + 1) : localModelId;
  const localPrefix = slashIdx > 0 ? localModelId.slice(0, slashIdx) : "";

  // Determine which vendor prefixes to try
  const vendorPrefixes = localPrefix && VENDOR_PREFIXES[localPrefix]
    ? VENDOR_PREFIXES[localPrefix]
    : Object.values(VENDOR_PREFIXES).flat();

  // Also try all known vendors as a wider net
  const allVendors = [...new Set([...vendorPrefixes, ...Object.values(VENDOR_PREFIXES).flat()])];

  // Try "vendor/bareId" for each vendor prefix
  for (const vendor of allVendors) {
    const candidate = `${vendor}/${bareId}`;
    if (openRouterModels.has(candidate)) return openRouterModels.get(candidate);
  }

  // Fuzzy: try without version suffixes (e.g., "qwen3-max-2026-01-23" -> "qwen3-max")
  const versionless = bareId.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{4}$/, "");
  if (versionless !== bareId) {
    for (const vendor of allVendors) {
      const candidate = `${vendor}/${versionless}`;
      if (openRouterModels.has(candidate)) return openRouterModels.get(candidate);
    }
  }

  // Try common name transformations
  const candidates = new Set<string>();
  const bases = [bareId, versionless];
  for (const base of bases) {
    candidates.add(base.replace(/-/g, "_"));                       // claude-sonnet-4-6 -> claude_sonnet_4_6
    candidates.add(base.replace(/\./g, "-"));                      // qwen3.5-plus -> qwen3-5-plus
    candidates.add(base.replace(/-(\d+)-(\d+)$/, "-$1.$2"));      // claude-sonnet-4-6 -> claude-sonnet-4.6
    candidates.add(base.replace(/-thinking$/, ""));                // claude-opus-4-6-thinking -> claude-opus-4-6
    candidates.add(base.replace(/-agent$/, ""));                   // gemini-3-flash-agent -> gemini-3-flash
    candidates.add(base.replace(/-low$/, ""));                     // gemini-3.1-pro-low -> gemini-3.1-pro
    candidates.add(base.replace(/-extra-low$/, ""));               // gemini-3.5-flash-extra-low -> gemini-3.5-flash
    candidates.add(base.replace(/-medium$/, ""));                  // gpt-oss-120b-medium -> gpt-oss-120b
    candidates.add(base.replace(/-highspeed$/, ""));               // MiniMax-M2.7-highspeed -> MiniMax-M2.7
    candidates.add(base.replace(/^qwen(\d)/, "qwen-$1"));         // qwen3-max -> qwen-3-max
    candidates.add(base.replace(/^qwen-(\d)/, "qwen$1"));         // qwen-3-max -> qwen3-max
    // For models like "deepseek-v4-flash", try "deepseek-v4-flash" and "deepseek-chat"
    if (base.startsWith("deepseek-v")) {
      candidates.add("deepseek-chat");
      candidates.add("deepseek-reasoner");
    }
  }
  // Remove originals to avoid re-checking
  candidates.delete(bareId);
  candidates.delete(versionless);

  for (const tf of candidates) {
    if (!tf || tf === bareId) continue;
    for (const vendor of allVendors) {
      const candidate = `${vendor}/${tf}`;
      if (openRouterModels.has(candidate)) return openRouterModels.get(candidate);
    }
  }

  // Last resort: search all OpenRouter models for partial match in ID
  // e.g., our "glm-5.1" might match "thudm/glm-5.1" or "zhipu-ai/glm-5.1"
  for (const [orId, orModel] of openRouterModels) {
    const orBare = orId.includes("/") ? orId.split("/").pop()! : orId;
    if (orBare === bareId || orBare === versionless) {
      return orModel;
    }
  }

  return null;
}

/**
 * Extract metadata from an OpenRouter model object.
 */
function extractOpenRouterMetadata(orModel: any): {
  displayName: string;
  description: string;
  contextLength: number;
  maxOutputTokens: number;
  inputPricePerMtok: number;
  outputPricePerMtok: number;
  inputModalities: string[];
  outputModalities: string[];
  supportedFeatures: string[];
} {
  const pricing = orModel.pricing || {};
  // OpenRouter pricing is per-token in USD (string). Convert to per-1M-tokens microcents.
  const promptPerToken = parseFloat(pricing.prompt || "0");
  const completionPerToken = parseFloat(pricing.completion || "0");

  const arch = orModel.architecture || {};
  const topProvider = orModel.top_provider || {};

  // Build supported features list
  const features: string[] = [];
  const params = orModel.supported_parameters || [];
  if (params.includes("tools") || params.includes("tool_choice")) features.push("tools");
  if (params.includes("reasoning") || params.includes("reasoning_effort") || params.includes("include_reasoning")) features.push("reasoning");
  if (params.includes("response_format") || params.includes("structured_outputs")) features.push("structured_outputs");
  if (params.includes("stop")) features.push("stop");
  if (arch.modality?.includes("image")) features.push("vision");

  return {
    displayName: orModel.name || orModel.id || "",
    description: (orModel.description || "").substring(0, 500),
    contextLength: orModel.context_length || topProvider.context_length || 0,
    maxOutputTokens: topProvider.max_completion_tokens || 0,
    inputPricePerMtok: Math.round(promptPerToken * 1_000_000 * 1_000_000), // per-token -> per-1M-token -> microcents
    outputPricePerMtok: Math.round(completionPerToken * 1_000_000 * 1_000_000),
    inputModalities: arch.input_modalities || (arch.modality?.includes("image") ? ["text", "image"] : ["text"]),
    outputModalities: arch.output_modalities || ["text"],
    supportedFeatures: features,
  };
}

/**
 * Fetch all models from OpenRouter and enrich our catalog.
 */
export async function enrichModelMetadata(): Promise<void> {
  if (enrichmentInFlight) return enrichmentInFlight;

  enrichmentInFlight = (async () => {
    try {
      console.log("[model-metadata] Starting enrichment from OpenRouter...");

      // 1. Fetch OpenRouter catalog
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      let orModels: any[] = [];
      try {
        const res = await fetch(OPENROUTER_API_URL, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const json = await res.json() as any;
          orModels = Array.isArray(json?.data) ? json.data : [];
          console.log(`[model-metadata] Fetched ${orModels.length} models from OpenRouter`);
        } else {
          console.warn(`[model-metadata] OpenRouter returned ${res.status}`);
        }
      } catch (err: any) {
        clearTimeout(timeout);
        console.warn(`[model-metadata] OpenRouter fetch failed: ${err.message}`);
      }

      // Build lookup map
      const orMap = new Map<string, any>();
      for (const m of orModels) {
        if (m.id) orMap.set(m.id, m);
      }

      // 2. Get our current model catalog
      await loadFromDisk();
      const ourModels = cache.models.map(m => m.id);

      // 3. For each of our models, find metadata
      let matched = 0;
      let fallback = 0;
      let unknown = 0;

      for (const modelId of ourModels) {
        // Skip virtual models
        if (modelId === "auto") continue;

        // Try OpenRouter first
        const orMatch = findOpenRouterMatch(modelId, orMap);

        if (orMatch) {
          const meta = extractOpenRouterMetadata(orMatch);
          await db.insert(modelMetadata).values({
            modelId,
            displayName: meta.displayName,
            description: meta.description,
            contextLength: meta.contextLength,
            maxOutputTokens: meta.maxOutputTokens,
            inputPricePerMtok: meta.inputPricePerMtok,
            outputPricePerMtok: meta.outputPricePerMtok,
            inputModalities: JSON.stringify(meta.inputModalities),
            outputModalities: JSON.stringify(meta.outputModalities),
            supportedFeatures: JSON.stringify(meta.supportedFeatures),
            source: "openrouter",
          }).onConflictDoUpdate({
            target: modelMetadata.modelId,
            set: {
              displayName: meta.displayName,
              description: meta.description,
              contextLength: meta.contextLength,
              maxOutputTokens: meta.maxOutputTokens,
              inputPricePerMtok: meta.inputPricePerMtok,
              outputPricePerMtok: meta.outputPricePerMtok,
              inputModalities: JSON.stringify(meta.inputModalities),
              outputModalities: JSON.stringify(meta.outputModalities),
              supportedFeatures: JSON.stringify(meta.supportedFeatures),
              source: "openrouter",
              updatedAt: new Date(),
            },
          });
          matched++;
          continue;
        }

        // Try hardcode fallback
        const fb = getFallbackMetadata(modelId);
        if (fb) {
          await db.insert(modelMetadata).values({
            modelId,
            displayName: fb.displayName,
            description: fb.description || null,
            contextLength: fb.contextLength || null,
            maxOutputTokens: fb.maxOutputTokens || null,
            inputPricePerMtok: fb.inputPricePerMtok || 0,
            outputPricePerMtok: fb.outputPricePerMtok || 0,
            inputModalities: fb.inputModalities ? JSON.stringify(fb.inputModalities) : null,
            outputModalities: fb.outputModalities ? JSON.stringify(fb.outputModalities) : null,
            supportedFeatures: fb.supportedFeatures ? JSON.stringify(fb.supportedFeatures) : null,
            source: "hardcode",
          }).onConflictDoUpdate({
            target: modelMetadata.modelId,
            set: {
              displayName: fb.displayName,
              description: fb.description || null,
              contextLength: fb.contextLength || null,
              maxOutputTokens: fb.maxOutputTokens || null,
              inputPricePerMtok: fb.inputPricePerMtok || 0,
              outputPricePerMtok: fb.outputPricePerMtok || 0,
              inputModalities: fb.inputModalities ? JSON.stringify(fb.inputModalities) : null,
              outputModalities: fb.outputModalities ? JSON.stringify(fb.outputModalities) : null,
              supportedFeatures: fb.supportedFeatures ? JSON.stringify(fb.supportedFeatures) : null,
              source: "hardcode",
              updatedAt: new Date(),
            },
          });
          fallback++;
          continue;
        }

        // Unknown model ? check if already in DB (e.g., manually added), skip if so
        const existing = (await db.select().from(modelMetadata).where(eq(modelMetadata.modelId, modelId)))[0];
        if (!existing) {
          // Insert with safe defaults for unknown models
          await db.insert(modelMetadata).values({
            modelId,
            displayName: modelId,
            inputModalities: JSON.stringify(["text"]),
            outputModalities: JSON.stringify(["text"]),
            source: "unknown",
          }).onConflictDoNothing();
          unknown++;
        }
      }

      lastEnrichmentAt = Date.now();
      console.log(`[model-metadata] Enrichment complete: ${matched} OpenRouter, ${fallback} fallback, ${unknown} unknown`);

      // Fill identity prompts for any model still missing them (all providers)
      try {
        const { ensureIdentityProfilesForCatalog } = await import("./model-identity.js");
        const filled = await ensureIdentityProfilesForCatalog(ourModels);
        if (filled > 0) {
          console.log(`[model-metadata] Identity profiles filled: ${filled}`);
        }
      } catch (err: any) {
        console.warn(`[model-metadata] Identity fill warning: ${err?.message || err}`);
      }
    } catch (err: any) {
      console.error(`[model-metadata] Enrichment error: ${err.message}`);
    } finally {
      enrichmentInFlight = null;
    }
  })();

  return enrichmentInFlight;
}

/**
 * Get all model metadata from DB as a lookup map.
 */
export async function getModelMetadataMap(): Promise<Map<string, typeof modelMetadata.$inferSelect>> {
  const rows = await db.select().from(modelMetadata);
  const map = new Map<string, typeof modelMetadata.$inferSelect>();
  for (const row of rows) {
    map.set(row.modelId, row);
  }
  return map;
}

/**
 * Initialize the metadata enrichment scheduler.
 * Runs enrichment on startup (after a short delay) and every 6 hours.
 */
export function initializeMetadataEnrichmentScheduler() {
  // Run first enrichment after 30s (give catalog time to load)
  setTimeout(() => {
    void enrichModelMetadata();
  }, 30_000);

  // Then every 6 hours
  setInterval(() => {
    void enrichModelMetadata();
  }, ENRICHMENT_INTERVAL_MS);
}

