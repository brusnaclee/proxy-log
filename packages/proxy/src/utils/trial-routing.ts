import type { AdminConfig } from "../db/schema.js";
import { getModelCatalogResponse } from "./model-catalog.js";
import { isGpyProviderOrModel, parseTrialModelWhitelist } from "./trial-config.js";

export function isRetryableUpstreamStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504 || status === 0;
}

export async function listGpyCatalogModels(config: AdminConfig): Promise<string[]> {
  const catalog = await getModelCatalogResponse();
  const all: Array<{ id: string }> = (catalog as any)?.data || [];
  const gpyAll = all.map((m) => m.id).filter((id) => id.toLowerCase().startsWith("gpy/"));

  const mode = config.trialModelSelectionMode || "all_gpy";
  const whitelist = parseTrialModelWhitelist(config.trialModelWhitelist);
  if (mode === "whitelist" && whitelist.length > 0) {
    const allowed = new Set(whitelist.map((m) => m.toLowerCase()));
    return gpyAll.filter((id) => allowed.has(id.toLowerCase()));
  }
  return gpyAll;
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
