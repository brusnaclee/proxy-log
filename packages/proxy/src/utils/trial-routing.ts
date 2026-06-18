import type { AdminConfig } from "../db/schema.js";
import { isGpyProviderOrModel, parseTrialModelWhitelist, parseTrialUpstreams } from "./trial-config.js";
import { getModelCatalogResponse } from "./model-catalog.js";

export function isRetryableUpstreamStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504 || status === 0;
}

/** Full canonical gpy model list — used as safety fallback when upstream cache is empty. */
export const CANONICAL_GPY_MODELS = [
  "gpy/webnet/claude-opus-4.8",
  "gpy/webnet/claude-opus-4-turbo",
  "gpy/webnet/claude-opus-4-6-thinking",
  "gpy/webnet/claude-sonnet-4.5",
  "gpy/webnet/claude-sonnet-4.6",
  "gpy/webnet/claude-haiku-4.5",
  "gpy/webnet/deepseek-3.2",
  "gpy/webnet/minimax-m2.5",
  "gpy/webnet/minimax-m2.7",
  "gpy/webnet/minimax-m3",
  "gpy/webnet/glm-5",
  "gpy/webnet/glm-5.1",
  "gpy/webnet/qwen3-coder-next",
  "gpy/webnet/qwen3-max",
] as const;

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
 * Read all `gpy/*` models from the live model catalog cache. If cache is empty,
 * fall back to the canonical hardcoded list so trial users always have something
 * to pick from.
 */
export async function getAllGpyCatalogModels(): Promise<string[]> {
  const catalog = await getModelCatalogResponse();
  const cacheIds = (catalog?.data || []).map((m) => String(m.id));
  const gpyIds = cacheIds.filter((id) => id.toLowerCase().startsWith("gpy/"));
  if (gpyIds.length > 0) {
    return Array.from(new Set(gpyIds));
  }
  return [...CANONICAL_GPY_MODELS];
}

/** All gpy models (no upstream filter) — used for /v1/models multi-upstream display. */
export async function getAllTrialEligibleModels(): Promise<string[]> {
  return getAllGpyCatalogModels();
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
  const canonicalGpy = await listGpyCatalogModels(config);
  const requested = String(requestedModel).trim();
  const reqLower = requested.toLowerCase();

  if (!requested || requested === "auto" || requested.startsWith("__")) {
    return { models: [...canonicalGpy, "__auto__"] };
  }

  const inCanonical = canonicalGpy.find((m) => m.toLowerCase() === reqLower);
  if (inCanonical) {
    const candidates = [inCanonical, ...canonicalGpy.filter((m) => m.toLowerCase() !== reqLower)];
    return { models: [...candidates, "__auto__"] };
  }

  if (isGpyProviderOrModel("gpy", requested)) {
    return { models: [requested, ...canonicalGpy, "__auto__"] };
  }

  return { error: "trial_model_not_allowed" };
}
