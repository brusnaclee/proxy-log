import { and, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { adminConfig, apiKeys, trialUsers } from "../db/schema.js";
import { queueTrialNotification } from "./trial-notify.js";
import { parseTrialDmTemplates, formatTrialTemplate } from "./trial-config.js";

/**
 * Run trial-related background jobs:
 * - autoExpireAndNotify: marks expired trials ended, disables key, queues DM
 *   (expired + upgrade_phantom).
 */
function buildUpgradePrompt(): { text: string; agverifChannelId: string; tokitoChannelId: string } {
  // Run synchronously by deferring caller to use the runtime values.
  return { text: "", agverifChannelId: "", tokitoChannelId: "" };
}

async function getUpgradePrompt(reason: string): Promise<string> {
  const [config] = await db.select().from(adminConfig);
  if (!config) return "";
  const templates = parseTrialDmTemplates(config.trialDmTemplates);
  const upgrade = templates.upgradePhantom || "";
  return formatTrialTemplate(upgrade, {
    reason,
    agverifChannelId: config.agverifChannelId || "",
    channelId: config.tokitoChannelId || "",
  });
}

async function runAutoExpireAndNotify(): Promise<void> {
  const now = new Date();
  const expired = await db
    .select({ tu: trialUsers, k: apiKeys })
    .from(trialUsers)
    .innerJoin(apiKeys, eq(trialUsers.apiKeyId, apiKeys.id))
    .where(
      and(
        isNull(trialUsers.endedAt),
        lte(trialUsers.expiresAt, now),
        eq(apiKeys.isActive, true),
      ),
    );

  if (expired.length === 0) return;

  for (const { tu, k } of expired) {
    try {
      await db
        .update(trialUsers)
        .set({
          endedAt: now,
          endReason: "auto_expired",
          updatedAt: now,
        })
        .where(eq(trialUsers.id, tu.id));

      await db
        .update(apiKeys)
        .set({ isActive: false, updatedAt: now })
        .where(eq(apiKeys.id, k.id));

      const [config] = await db.select().from(adminConfig);
      const templates = parseTrialDmTemplates(config?.trialDmTemplates);
      const reason = "berakhir";
      const upgradeText = await getUpgradePrompt(reason);

      // Build expired DM with {upgradePhantom} substituted
      const expiredText = formatTrialTemplate(
        templates.expired || "Trial Anda sudah berakhir.",
        { reason, expiresAt: tu.expiresAt.toISOString(), upgradePhantom: upgradeText },
      );

      // Queue expired (rendered with upgrade text appended in bot)
      await queueTrialNotification(k.id, "expired", {
        reason,
        upgradePhantom: upgradeText,
        expiresAt: tu.expiresAt.toISOString(),
        prebuiltText: expiredText,
      });

      // Queue separate upgrade_phantom notification
      await queueTrialNotification(k.id, "upgrade_phantom", {
        reason,
        upgradePhantom: upgradeText,
        agverifChannelId: config?.agverifChannelId || "",
      });

      console.log(`[trial-scheduler] auto-expired key ${k.id} (user ${tu.discordUserId})`);
    } catch (err: any) {
      console.error(
        `[trial-scheduler] auto-expire error for key ${k.id}:`,
        err?.message || err,
      );
    }
  }
}

export function initializeTrialScheduler(): void {
  const run = async () => {
    try {
      await runAutoExpireAndNotify();
    } catch (err: any) {
      console.error("[trial-scheduler] error:", err?.message || err);
    }
  };

  void run();
  setInterval(run, 60 * 1000); // every 60s
}

export async function autoExpireAndNotify(): Promise<{ processed: number }> {
  const before = Date.now();
  const now = new Date();
  const expired = await db
    .select({ tu: trialUsers, k: apiKeys })
    .from(trialUsers)
    .innerJoin(apiKeys, eq(trialUsers.apiKeyId, apiKeys.id))
    .where(
      and(
        isNull(trialUsers.endedAt),
        lte(trialUsers.expiresAt, now),
        eq(apiKeys.isActive, true),
      ),
    );

  for (const { tu, k } of expired) {
    await db
      .update(trialUsers)
      .set({ endedAt: now, endReason: "auto_expired", updatedAt: now })
      .where(eq(trialUsers.id, tu.id));
    await db
      .update(apiKeys)
      .set({ isActive: false, updatedAt: now })
      .where(eq(apiKeys.id, k.id));
    const [config] = await db.select().from(adminConfig);
    const templates = parseTrialDmTemplates(config?.trialDmTemplates);
    const reason = "berakhir";
    const upgradeText = await getUpgradePrompt(reason);
    const expiredText = formatTrialTemplate(
      templates.expired || "Trial Anda sudah berakhir.",
      { reason, expiresAt: tu.expiresAt.toISOString(), upgradePhantom: upgradeText },
    );
    await queueTrialNotification(k.id, "expired", {
      reason,
      upgradePhantom: upgradeText,
      expiresAt: tu.expiresAt.toISOString(),
      prebuiltText: expiredText,
    });
    await queueTrialNotification(k.id, "upgrade_phantom", {
      reason,
      upgradePhantom: upgradeText,
      agverifChannelId: config?.agverifChannelId || "",
    });
  }

  console.log(`[trial-scheduler] autoExpireAndNotify processed ${expired.length} in ${Date.now() - before}ms`);
  return { processed: expired.length };
}

export async function countUserTrials(discordUserId: string): Promise<number> {
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

// Suppress unused-var warning
void buildUpgradePrompt;
