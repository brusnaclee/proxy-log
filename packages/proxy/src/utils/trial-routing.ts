import type { AdminConfig } from "../db/schema.js";
import { isGpyProviderOrModel, parseTrialModelWhitelist, parseTrialUpstreams } from "./trial-config.js";
import { getModelCatalogResponse } from "./model-catalog.js";

export function isRetryableUpstreamStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504 || status === 0;
}

function extractUpstream(modelId: string): string | null {
  const lower = modelId.toLowerCase();
  if (!lower.startsWith("gpy/")) return null;
  const parts = lower.split("/");
  return parts.length >= 2 ? parts[1] : null;
}

function modelMatchesUpstream(modelId: string, upstreams: string[]): boolean {
  if (upstreams.length === 0) return true;
  const upstream = extractUpstream(modelId);
  if (!upstream) return false;
  return upstreams.includes(upstream);
}

export function groupModelsByUpstream(modelIds: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const id of modelIds) {
    const upstream = extractUpstream(id) || id.split("/")[0];
    if (!groups[upstream]) groups[upstream] = [];
    groups[upstream].push(id);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => a.localeCompare(b));
  }
  return groups;
}

/**
 * Read all `gpy/*` models from the live model catalog cache. NEVER falls back
 * to a hardcoded list — we only return models that the upstream actually exposes.
 * If the cache is empty, this returns [].
 */
export async function getAllGpyCatalogModels(): Promise<string[]> {
  const catalog = await getModelCatalogResponse();
  const cacheIds = (catalog?.data || []).map((m) => String(m.id));
  const gpyIds = cacheIds.filter((id) => id.toLowerCase().startsWith("gpy/"));
  return Array.from(new Set(gpyIds));
}

export async function listGpyCatalogModels(config: AdminConfig): Promise<string[]> {
  const mode = config.trialModelSelectionMode || "all_gpy";
  const whitelist = parseTrialModelWhitelist(config.trialModelWhitelist);
  const upstreams = parseTrialUpstreams(config.trialUpstreams);

  const gpyIds = await getAllGpyCatalogModels();
  let models = gpyIds.filter((id) => modelMatchesUpstream(id, upstreams));

  if (mode === "whitelist" && whitelist.length > 0) {
    const allowed = new Set(whitelist.map((m) => m.toLowerCase()));
    models = models.filter((id) => allowed.has(id.toLowerCase()));
  }

  return models;
}

export async function buildTrialModelCandidates(
  config: AdminConfig,
  requestedModel: string,
): Promise<string[]> {
  const allowed = await listGpyCatalogModels(config);
  const req = requestedModel.trim();
  const reqLower = req.toLowerCase();

  if (!allowed.some((m) => m.toLowerCase() === reqLower) && isGpyProviderOrModel("gpy", req)) {
    const ordered = [req, ...allowed.filter((m) => m.toLowerCase() !== reqLower)];
    return [...new Set(ordered)];
  }

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
  const allowed = await listGpyCatalogModels(config);
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

  // Requested model is gpy/* but not in the configured allowed set — still try it
  // (admin may have toggled upstreams to allow it), then fall back to allowed set,
  // then __auto__.
  if (isGpyProviderOrModel("gpy", requested)) {
    return { models: [requested, ...allowed, "__auto__"] };
  }

  return { error: "trial_model_not_allowed" };
}
