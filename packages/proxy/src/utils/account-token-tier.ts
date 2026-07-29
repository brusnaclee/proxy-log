/**
 * Token *accounting* tier for a whole account (every api_key of one Discord user).
 *
 * This is deliberately different from the portal's feature gating (`isTrialAccount`,
 * which requires an ACTIVE non-trial key). Accounting must stay stable over time:
 * a lapsed/expired member key still keeps member multipliers so a month of history
 * reads the same in Discord, the admin dashboard, the client portal and the recap.
 * If accounting used "active" state, an expiring membership would silently rewrite
 * past numbers to 1x and the recap would diverge from both dashboards.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import type { TokenMultiplierOpts } from "./token-multiplier.js";

export type TierKeyRow = { isTrial?: boolean | null };

/** Trial-only = no non-trial key at all (active or not). Empty set = trial. */
export function isTrialOnlyKeySet(keys: TierKeyRow[]): boolean {
  if (!keys.length) return true;
  return keys.every((k) => !!k.isTrial);
}

export function accountTokenTierOpts(isTrial: boolean): TokenMultiplierOpts | undefined {
  return isTrial ? { isTrial: true } : undefined;
}

/** All key ids of the account + its accounting tier. Includes inactive keys. */
export async function resolveAccountTokenTier(
  discordUserId: string,
): Promise<{ isTrial: boolean; keyIds: number[] }> {
  const rows = await db
    .select({ id: apiKeys.id, isTrial: apiKeys.isTrial })
    .from(apiKeys)
    .where(eq(apiKeys.discordUserId, discordUserId));
  return {
    isTrial: isTrialOnlyKeySet(rows),
    keyIds: rows.map((r) => Number(r.id)).filter((id) => id > 0),
  };
}
