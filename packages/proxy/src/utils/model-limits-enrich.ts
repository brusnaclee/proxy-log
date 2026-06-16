import { modelLimits } from "../db/schema.js";
import { getModelCatalogResponse } from "./model-catalog.js";

type ModelLimitRow = typeof modelLimits.$inferSelect;

const MAX_MATCHED_IDS = 50;

/**
 * Enrich an array of model_limits rows with catalog match info:
 *  - exact rows get matchCount 0/1 and matchedIds [model] | []
 *  - pattern rows get matchCount (substring count) and matchedIds (capped)
 * Fails gracefully — if the catalog can't be loaded, matchCount/matchedIds
 * are returned as 0/[] so callers can still render the row.
 */
export async function enrichModelLimitsWithCatalog(rows: ModelLimitRow[]): Promise<Array<ModelLimitRow & {
  matchCount: number;
  matchedIds: string[];
}>> {
  let catalogIds: string[] = [];
  try {
    const catalog = await getModelCatalogResponse();
    catalogIds = ((catalog as any)?.data || []).map((m: { id: string }) => m.id).filter(Boolean);
  } catch { /* catalog optional */ }

  return rows.map((r) => {
    if (r.isPattern) {
      const pat = (r.model || "").toLowerCase();
      const matched = catalogIds.filter((id) => id.toLowerCase().includes(pat));
      return {
        ...r,
        matchCount: matched.length,
        matchedIds: matched.slice(0, MAX_MATCHED_IDS),
      };
    }
    const exists = catalogIds.includes(r.model);
    return {
      ...r,
      matchCount: exists ? 1 : 0,
      matchedIds: exists ? [r.model] : [],
    };
  });
}
