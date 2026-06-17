import type { AdminConfig } from "../db/schema.js";
import { getModelCatalogResponse } from "./model-catalog.js";
import { isGpyProviderOrModel, parseTrialModelWhitelist } from "./trial-config.js";

export function isRetryableUpstreamStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504 || status === 0;
}

// Hardcoded fallback list gpy model — dipakai kalau catalog cache kosong
// (misalnya upstream /v1/models pernah gagal di-fetch). Trial user tetap
// harus bisa lihat minimal list ini di /v1/models dan bot panel.
const GPY_FALLBACK_MODELS = [
  'gpy/webnet/claude-sonnet-4.5',
  'gpy/webnet/claude-haiku-4.5',
  'gpy/webnet/claude-opus-4.6-thinking',
  'gpy/webnet/claude-opus-4-turbo',
  'gpy/webnet/deepseek-3.2',
  'gpy/webnet/minimax-m2.5',
  'gpy/webnet/glm-5',
  'gpy/webnet/glm-5.1',
  'gpy/webnet/qwen3-coder-next',
];

export async function listGpyCatalogModels(config: AdminConfig): Promise<string[]> {
  const catalog = await getModelCatalogResponse();
  const all: Array<{ id: string }> = (catalog as any)?.data || [];
  const gpyAll = all.map((m) => m.id).filter((id) => id.toLowerCase().startsWith("gpy/"));

  const mode = config.trialModelSelectionMode || "all_gpy";
  const whitelist = parseTrialModelWhitelist(config.trialModelWhitelist);
  if (mode === "whitelist" && whitelist.length > 0) {
    const allowed = new Set(whitelist.map((m) => m.toLowerCase()));
    // Gabung cache + fallback, intersect dengan whitelist
    const merged = Array.from(new Set([...gpyAll, ...GPY_FALLBACK_MODELS]));
    return merged.filter((id) => allowed.has(id.toLowerCase()));
  }
  // Mode all_gpy: gabung cache + fallback, dedupe
  return Array.from(new Set([...gpyAll, ...GPY_FALLBACK_MODELS]));
}

export async function buildTrialModelCandidates(
  config: AdminConfig,
  requestedModel: string,
): Promise<string[]> {
  const allowed = await listGpyCatalogModels(config);
  const req = requestedModel.trim();
  const reqLower = req.toLowerCase();

  if (!allowed.some((m) => m.toLowerCase() === reqLower) && isGpyProviderOrModel("gpy", req)) {
    // Requested model might be valid gpy but not in catalog — still try first
    const ordered = [req, ...allowed.filter((m) => m.toLowerCase() !== reqLower)];
    return [...new Set(ordered)];
  }

  const ordered = [req, ...allowed.filter((m) => m.toLowerCase() !== reqLower)];
  return [...new Set(ordered.filter(Boolean))];
}
