import { db } from "../db/index.js";
import { apiKeys, requestLogs } from "../db/schema.js";
import { eq, inArray, type SQL } from "drizzle-orm";
import { isProtectedPrimaryApiKey } from "./api-key-primary.js";

/**
 * All API keys belonging to the same Discord account share one limit pool.
 * Extra portal keys do NOT get separate quotas.
 */
export async function resolveAccountKeyScope(key: {
  id: number;
  discordUserId?: string | null;
  provisionedBy?: string | null;
  isTrial?: boolean | null;
}): Promise<{ keyIds: number[]; windowKeyId: number }> {
  if (!key.discordUserId) {
    return { keyIds: [key.id], windowKeyId: key.id };
  }

  const rows = await db
    .select({
      id: apiKeys.id,
      provisionedBy: apiKeys.provisionedBy,
      isTrial: apiKeys.isTrial,
    })
    .from(apiKeys)
    .where(eq(apiKeys.discordUserId, key.discordUserId));

  if (rows.length === 0) {
    return { keyIds: [key.id], windowKeyId: key.id };
  }

  const primary =
    rows.find((k) => !k.isTrial && isProtectedPrimaryApiKey(k)) ||
    rows.find((k) => isProtectedPrimaryApiKey(k)) ||
    rows.find((k) => !k.isTrial) ||
    rows[0];

  const keyIds = rows.map((r) => r.id);
  // Put window owner first so callers that only pass keyIds[0] stay correct
  const ordered = [primary.id, ...keyIds.filter((id) => id !== primary.id)];
  return { keyIds: ordered, windowKeyId: primary.id };
}

/** SQL condition: request_logs.api_key_id IN (account keys). */
export function accountApiKeyCondition(keyIds: number[]): SQL {
  if (keyIds.length === 1) {
    return eq(requestLogs.apiKeyId, keyIds[0]);
  }
  return inArray(requestLogs.apiKeyId, keyIds);
}

/** Sync quota/limit columns across all Discord account keys. */
export const ACCOUNT_QUOTA_SYNC_FIELDS = [
  "dailyTokenLimit",
  "monthlyTokenLimit",
  "dailyInputTokenLimit",
  "dailyOutputTokenLimit",
  "rateLimit",
  "rateLimitWindow",
  "promptLimit",
  "promptLimitWindow",
  "perModelPromptLimit",
  "perModelPromptLimitWindow",
  "maxDevices",
] as const;

export type AccountQuotaSyncField = (typeof ACCOUNT_QUOTA_SYNC_FIELDS)[number];

export async function syncAccountQuotaFields(
  discordUserId: string,
  updates: Partial<Record<AccountQuotaSyncField, unknown>> & { updatedAt?: Date },
): Promise<number> {
  const patch: Record<string, unknown> = { updatedAt: updates.updatedAt || new Date() };
  for (const f of ACCOUNT_QUOTA_SYNC_FIELDS) {
    if (updates[f] !== undefined) patch[f] = updates[f];
  }
  if (Object.keys(patch).length <= 1) return 0;
  await db
    .update(apiKeys)
    .set(patch as any)
    .where(eq(apiKeys.discordUserId, discordUserId));
  return 1;
}

/** Sync prompt window start across all account keys so shared limits stay aligned. */
export async function syncAccountPromptWindowStart(
  keyIds: number[],
  windowStart: string,
  tx?: { update: typeof db.update },
): Promise<void> {
  if (keyIds.length === 0) return;
  const runner = tx || db;
  await runner
    .update(apiKeys)
    .set({ promptWindowStart: windowStart })
    .where(inArray(apiKeys.id, keyIds));
}
