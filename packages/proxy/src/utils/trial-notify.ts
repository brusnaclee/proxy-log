import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";

export type TrialNotificationType =
  | "limit_reached"
  | "expired"
  | "terminated"
  | "key_rotated"
  | "claimed";

export async function queueTrialNotification(
  apiKeyId: number,
  type: TrialNotificationType,
  extra: Record<string, string> = {},
): Promise<void> {
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).limit(1);
  if (!key?.discordUserId) return;

  const payload = {
    type: `trial_${type}`,
    discordUserId: key.discordUserId,
    keyId: apiKeyId,
    ...extra,
  };

  await db
    .update(apiKeys)
    .set({
      pendingNotification: JSON.stringify(payload),
      updatedAt: new Date(),
    })
    .where(eq(apiKeys.id, apiKeyId));
}
