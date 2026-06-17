import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiKeys, trialUsers } from "../db/schema.js";
import { queueTrialNotification } from "./trial-notify.js";

export function initializeTrialScheduler(): void {
  const run = async () => {
    try {
      const now = new Date();
      const expired = await db
        .select()
        .from(trialUsers)
        .where(and(isNull(trialUsers.endedAt), lt(trialUsers.expiresAt, now)));

      for (const row of expired) {
        await db
          .update(trialUsers)
          .set({ endedAt: now, endReason: "expired", updatedAt: now })
          .where(eq(trialUsers.id, row.id));

        await db
          .update(apiKeys)
          .set({ isActive: false, updatedAt: now })
          .where(eq(apiKeys.id, row.apiKeyId));

        await queueTrialNotification(row.apiKeyId, "expired");
      }

      // Auto-unsuspend check: none needed; admin handles suspend
    } catch (err: any) {
      console.error("[trial-scheduler] error:", err?.message || err);
    }
  };

  void run();
  setInterval(run, 5 * 60 * 1000);
}

export async function countUserTrials(discordUserId: string): Promise<number> {
	// Only count rows that still represent an active/expired trial, not ones that
	// were "unclaim" via admin grant_retry (endedAt set, endReason = admin_grant_retry).
	const rows = await db
		.select({ count: sql<number>`count(*)` })
		.from(trialUsers)
		.where(
			and(
				eq(trialUsers.discordUserId, discordUserId),
				or(isNull(trialUsers.endedAt), ne(trialUsers.endReason, "admin_grant_retry")),
			),
		);
	return Number(rows[0]?.count || 0);
}

export async function findActiveTrialByDiscordUser(discordUserId: string) {
  const now = new Date();
  const rows = await db
    .select()
    .from(trialUsers)
    .where(and(eq(trialUsers.discordUserId, discordUserId), isNull(trialUsers.endedAt)));
  return rows.find((r) => !r.suspended && r.expiresAt > now) || null;
}

export async function findTrialByApiKeyId(apiKeyId: number) {
  const [row] = await db.select().from(trialUsers).where(eq(trialUsers.apiKeyId, apiKeyId)).limit(1);
  return row || null;
}
