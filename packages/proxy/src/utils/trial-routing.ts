import type { AdminConfig } from "../db/schema.js";
import { parseTrialModelWhitelist, parseTrialUpstreams, normalizeTrialModelSelectionMode } from "./trial-config.js";
import { getModelCatalogResponse } from "./model-catalog.js";

export function isRetryableUpstreamStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504 || status === 0;
}

function extractUpstream(modelId: string): string | null {
  const lower = modelId.toLowerCase();
  const parts = lower.split("/");
  if (parts.length >= 2) return parts[1] || parts[0];
  return parts[0] || null;
}

function modelMatchesUpstream(modelId: string, upstreams: string[]): boolean {
  if (upstreams.length === 0) return true;
  const lower = modelId.toLowerCase();
  // Match provider prefix or nested upstream segment
  const provider = lower.split("/")[0];
  const nested = extractUpstream(modelId);
  return upstreams.includes(provider) || (nested != null && upstreams.includes(nested));
}

export function groupModelsByUpstream(modelIds: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const id of modelIds) {
    const upstream = extractUpstream(id) || id.split("/")[0] || "other";
    if (!groups[upstream]) groups[upstream] = [];
    groups[upstream].push(id);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => a.localeCompare(b));
  }
  return groups;
}

/** All non-auto catalog model ids from live cache. */
export async function getAllCatalogModelIds(): Promise<string[]> {
  const catalog = await getModelCatalogResponse();
  const ids = (catalog?.data || [])
    .map((m) => String(m.id))
    .filter((id) => id && id.toLowerCase() !== "auto");
  return Array.from(new Set(ids));
}

/** @deprecated Use getAllCatalogModelIds / listTrialCatalogModels */
export async function getAllGpyCatalogModels(): Promise<string[]> {
  const all = await getAllCatalogModelIds();
  return all.filter((id) => id.toLowerCase().startsWith("gpy/"));
}

/**
 * Models allowed for trial keys based on admin config.
 * Mode `all` (and legacy `all_gpy`): full catalog, optional upstream filter.
 * Mode `whitelist`: intersection with trialModelWhitelist.
 */
export async function listTrialCatalogModels(config: AdminConfig): Promise<string[]> {
  const mode = normalizeTrialModelSelectionMode(config.trialModelSelectionMode);
  const whitelist = parseTrialModelWhitelist(config.trialModelWhitelist);
  const upstreams = parseTrialUpstreams(config.trialUpstreams);
  const allIds = await getAllCatalogModelIds();
  let models = allIds.filter((id) => modelMatchesUpstream(id, upstreams));

  if (mode === "whitelist" && whitelist.length > 0) {
    const allowed = new Set(whitelist.map((m) => m.toLowerCase()));
    models = models.filter((id) => allowed.has(id.toLowerCase()));
  }

  return models;
}

/** @deprecated Alias for listTrialCatalogModels */
export async function listGpyCatalogModels(config: AdminConfig): Promise<string[]> {
  return listTrialCatalogModels(config);
}

export async function buildTrialModelCandidates(
  config: AdminConfig,
  requestedModel: string,
): Promise<string[]> {
  const allowed = await listTrialCatalogModels(config);
  const req = requestedModel.trim();
  const reqLower = req.toLowerCase();
  const ordered = [req, ...allowed.filter((m) => m.toLowerCase() !== reqLower)];
  return [...new Set(ordered.filter(Boolean))];
}

export type TrialModelsBuildResult =
  | { models: string[] }
  | { error: "trial_model_not_allowed" };

/** Build ordered trial model list including __auto__ fallback. */
export async function buildTrialModelsToTry(
  config: AdminConfig,
  requestedModel: string,
): Promise<TrialModelsBuildResult> {
  const mode = normalizeTrialModelSelectionMode(config.trialModelSelectionMode);
  const allowed = await listTrialCatalogModels(config);
  const requested = String(requestedModel).trim();
  const reqLower = requested.toLowerCase();

  if (!requested || requested === "auto" || requested.startsWith("__")) {
    return { models: [...allowed, "__auto__"] };
  }

  const inAllowed = allowed.find((m) => m.toLowerCase() === reqLower);
  if (inAllowed) {
    const candidates = [inAllowed, ...allowed.filter((m) => m.toLowerCase() !== reqLower)];
    return { models: [...candidates, "__auto__"] };
  }

  // Whitelist mode: reject models not on the list
  if (mode === "whitelist") {
    return { error: "trial_model_not_allowed" };
  }

  // Mode `all`: try requested model first, then allowed catalog, then auto
  return { models: [requested, ...allowed, "__auto__"] };
}
