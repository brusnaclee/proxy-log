import type { AdminConfig } from "../db/schema.js";
import { isGpyProviderOrModel, parseTrialModelWhitelist, parseTrialUpstreams } from "./trial-config.js";

export function isRetryableUpstreamStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504 || status === 0;
}

/** Full canonical gpy model list — always exposed to trial users regardless of cache. */
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

function modelMatchesUpstream(modelId: string, upstreams: string[]): boolean {
  if (upstreams.length === 0) return true;
  const lower = modelId.toLowerCase();
  const parts = lower.split("/");
  if (parts[0] === "gpy" && parts.length >= 2) {
    return upstreams.includes(parts[1]);
  }
  return upstreams.some((u) => parts[0] === u || lower.includes(`/${u}/`) || lower.startsWith(`${u}/`));
}

export function groupModelsByUpstream(modelIds: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const id of modelIds) {
    const parts = id.split("/");
    const upstream = parts[0] === "gpy" && parts.length >= 2 ? parts[1] : parts[0];
    if (!groups[upstream]) groups[upstream] = [];
    groups[upstream].push(id);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => a.localeCompare(b));
  }
  return groups;
}

export async function listGpyCatalogModels(config: AdminConfig): Promise<string[]> {
  const mode = config.trialModelSelectionMode || "all_gpy";
  const whitelist = parseTrialModelWhitelist(config.trialModelWhitelist);
  const upstreams = parseTrialUpstreams(config.trialUpstreams);

  let models = CANONICAL_GPY_MODELS.filter((m) => modelMatchesUpstream(m, upstreams));

  if (mode === "whitelist" && whitelist.length > 0) {
    const allowed = new Set(whitelist.map((m) => m.toLowerCase()));
    models = models.filter((id) => allowed.has(id.toLowerCase()));
  }

  return [...models];
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
