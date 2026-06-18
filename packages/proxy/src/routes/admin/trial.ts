import { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { adminConfig, apiKeys, trialUsers } from "../../db/schema.js";
import { configCache } from "../../utils/cache.js";
import {
  buildTrialSettingsResponse,
  formatTrialTemplate,
  parseTrialDmTemplates,
  parseTrialEmbedConfig,
  parseTrialModelWhitelist,
  parseTrialUpstreams,
} from "../../utils/trial-config.js";
import {
  groupModelsByUpstream,
  listGpyCatalogModels,
} from "../../utils/trial-routing.js";
import { getModelCatalogResponse } from "../../utils/model-catalog.js";
import { queueTrialNotification } from "../../utils/trial-notify.js";
import {
  countUserTrials,
  findActiveTrialByDiscordUser,
} from "../../utils/trial-scheduler.js";

const trial = new Hono();

async function buildCatalogModelsByUpstream(): Promise<Record<string, string[]>> {
  const catalog = await getModelCatalogResponse();
  const allIds = (catalog?.data || []).map((m) => String(m.id));
  return groupModelsByUpstream(allIds);
}

trial.get("/settings/trial", async (c) => {
  const [config] = await db.select().from(adminConfig);
  if (!config) return c.json({ error: "Admin not configured" }, 500);
  const gpyModels = await listGpyCatalogModels(config);
  const catalogModelsByUpstream = await buildCatalogModelsByUpstream();
  return c.json(buildTrialSettingsResponse(config, gpyModels, catalogModelsByUpstream));
});

trial.put("/settings/trial", async (c) => {
  const body = await c.req.json<any>();
  const [config] = await db.select().from(adminConfig);
  if (!config) return c.json({ error: "Admin not configured" }, 500);

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.trialEnabled !== undefined) updates.trialEnabled = Boolean(body.trialEnabled);
  if (body.trialAccessMode !== undefined) updates.trialAccessMode = body.trialAccessMode || "groupy_members";
  if (body.trialRequiredRoleId !== undefined) updates.trialRequiredRoleId = body.trialRequiredRoleId || "";
  if (body.trialDefaultDurationDays !== undefined) updates.trialDefaultDurationDays = Math.max(1, Number(body.trialDefaultDurationDays) || 30);
  if (body.trialMaxPerAccount !== undefined) updates.trialMaxPerAccount = Math.max(1, Number(body.trialMaxPerAccount) || 1);
  if (body.trialDailyTokenLimit !== undefined) updates.trialDailyTokenLimit = Math.max(0, Number(body.trialDailyTokenLimit) || 0);
  if (body.trialPromptLimit !== undefined) updates.trialPromptLimit = Math.max(0, Number(body.trialPromptLimit) || 0);
  if (body.trialPromptLimitWindow !== undefined) updates.trialPromptLimitWindow = body.trialPromptLimitWindow || "5h";
  if (body.trialModelSelectionMode !== undefined) updates.trialModelSelectionMode = body.trialModelSelectionMode || "all_gpy";
  if (body.trialModelWhitelist !== undefined) {
    updates.trialModelWhitelist = JSON.stringify(Array.isArray(body.trialModelWhitelist) ? body.trialModelWhitelist : []);
  }
  if (body.trialUpstreams !== undefined) {
    const upstreams = Array.isArray(body.trialUpstreams)
      ? body.trialUpstreams.map(String).filter(Boolean)
      : parseTrialUpstreams(String(body.trialUpstreams || ""));
    updates.trialUpstreams = upstreams.join(",");
  }
  if (body.trialEmbedConfig !== undefined) {
    updates.trialEmbedConfig = JSON.stringify(body.trialEmbedConfig || {});
  }
  if (body.trialDmTemplates !== undefined) {
    updates.trialDmTemplates = JSON.stringify(body.trialDmTemplates || {});
  }
  if (body.trialPanelMessageId !== undefined) {
    updates.trialPanelMessageId = body.trialPanelMessageId || null;
  }

  await db.update(adminConfig).set(updates).where(eq(adminConfig.id, config.id));
  configCache.invalidate("admin_config");

  const [updated] = await db.select().from(adminConfig);
  const gpyModels = await listGpyCatalogModels(updated!);
  const catalogModelsByUpstream = await buildCatalogModelsByUpstream();
  return c.json({ success: true, ...buildTrialSettingsResponse(updated!, gpyModels, catalogModelsByUpstream) });
});

trial.get("/trial/users", async (c) => {
  const rows = await db
    .select({
      trial: trialUsers,
      key: apiKeys,
    })
    .from(trialUsers)
    .innerJoin(apiKeys, eq(trialUsers.apiKeyId, apiKeys.id))
    .orderBy(desc(trialUsers.claimedAt));

  const data = rows.map(({ trial: t, key }) => mapTrialUserRow(t, key));

  return c.json({ data });
});

function mapTrialUserRow(t: typeof trialUsers.$inferSelect, key: typeof apiKeys.$inferSelect) {
  const now = new Date();
  let status = "ended";
  if (!t.endedAt && !t.suspended && t.expiresAt > now && key.isActive) status = "active";
  else if (t.suspended) status = "suspended";
  else if (!t.endedAt && t.expiresAt <= now) status = "expired";
    else if (t.endReason === "admin_terminated") status = "terminated";
    else if (t.endReason === "admin_grant_retry") status = "unclaimed";

  return {
    id: t.id,
    discordUserId: t.discordUserId,
    discordUsername: t.discordUsername,
    apiKeyId: t.apiKeyId,
    keyPrefix: key.keyPrefix,
    keyName: key.name,
    isActive: key.isActive,
    claimedAt: t.claimedAt,
    expiresAt: t.expiresAt,
    endedAt: t.endedAt,
    endReason: t.endReason,
    suspended: t.suspended,
    status,
    overrideDays: t.overrideDays,
    overrideMaxTrials: t.overrideMaxTrials,
    overrideDailyTokenLimit: t.overrideDailyTokenLimit,
    overridePromptLimit: t.overridePromptLimit,
    overridePromptLimitWindow: t.overridePromptLimitWindow,
  };
}

trial.get("/trial/users/key/:apiKeyId", async (c) => {
  const apiKeyId = parseInt(c.req.param("apiKeyId"));
  if (!Number.isFinite(apiKeyId)) return c.json({ error: "Invalid api key id" }, 400);

  const rows = await db
    .select({ trial: trialUsers, key: apiKeys })
    .from(trialUsers)
    .innerJoin(apiKeys, eq(trialUsers.apiKeyId, apiKeys.id))
    .where(eq(trialUsers.apiKeyId, apiKeyId))
    .limit(1);

  const row = rows[0];
  if (!row) return c.json({ error: "Trial user not found" }, 404);
  return c.json(mapTrialUserRow(row.trial, row.key));
});

trial.get("/trial/users/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);

  const rows = await db
    .select({ trial: trialUsers, key: apiKeys })
    .from(trialUsers)
    .innerJoin(apiKeys, eq(trialUsers.apiKeyId, apiKeys.id))
    .where(eq(trialUsers.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return c.json({ error: "Trial user not found" }, 404);
  return c.json(mapTrialUserRow(row.trial, row.key));
});

trial.post("/trial/users/action", async (c) => {
  const body = await c.req.json<any>();
  const result = await adminTrialAction(body);
  if ("error" in result && "status" in result) {
    return c.json({ error: result.error }, result.status as any);
  }
  return c.json(result);
});

export default trial;

export async function getTrialPanelConfigForBot() {
  const [config] = await db.select().from(adminConfig);
  if (!config) return null;
  const gpyModels = await listGpyCatalogModels(config);
  return buildTrialSettingsResponse(config, gpyModels);
}

export async function claimTrialForUser(body: {
  discordUserId: string;
  discordUsername?: string;
  hasRequiredRole?: boolean;
}) {
  const [config] = await db.select().from(adminConfig);
  if (!config) return { error: "Admin config missing", status: 500 as const };
  if (!config.trialEnabled) return { error: "Trial mode is currently disabled", status: 403 as const };

  const accessMode = config.trialAccessMode || "groupy_members";
  if (accessMode === "groupy_members" && !body.hasRequiredRole) {
    return {
      error: "role_required",
      requiredRoleId: config.trialRequiredRoleId || "1354682641961582632",
      status: 403 as const,
    };
  }

  const active = await findActiveTrialByDiscordUser(body.discordUserId);
  if (active) {
    return { error: "trial_already_active", status: 409 as const };
  }

  // Compute effective maxPerAccount: pick the highest overrideMaxTrials across
  // existing rows (grant_retry bumps it) so retries still work even when the
  // user already used their default trial allotment.
  const overrideRows = await db
    .select({ overrideMaxTrials: trialUsers.overrideMaxTrials })
    .from(trialUsers)
    .where(eq(trialUsers.discordUserId, body.discordUserId));
  const maxOverride = overrideRows.reduce(
    (m, r) => Math.max(m, r.overrideMaxTrials || 0),
    0,
  );
  const effectiveMax = (config.trialMaxPerAccount ?? 1) + maxOverride;
  const trialCount = await countUserTrials(body.discordUserId);
  if (trialCount >= effectiveMax) {
    return { error: "trial_already_used", maxPerAccount: effectiveMax, status: 409 as const };
  }

  const [phantomKey] = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.discordUserId, body.discordUserId),
        eq(apiKeys.isTrial, false),
        eq(apiKeys.isActive, true),
      ),
    )
    .limit(1);
  if (phantomKey) {
    return {
      error: "phantom_member",
      message:
        "You already have an active API key. Trial is only available if you have not verified AG yet, or your existing key is disabled.",
      status: 403 as const,
      agverifChannelId: config.agverifChannelId || null,
    };
  }

  const durationDays = config.trialDefaultDurationDays ?? 30;
  const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
  const dailyLimit = config.trialDailyTokenLimit ?? 1_000_000;
  const promptLimit = config.trialPromptLimit ?? 50;
  const promptWindow = config.trialPromptLimitWindow || "5h";

  const { generateTrialApiKey, getKeyPrefix, sha256 } = await import("../../utils/crypto.js");
  const username = String(body.discordUsername || body.discordUserId).trim();
  const keyPlain = generateTrialApiKey();
  const keyName = `trial-${username}-${body.discordUserId.slice(-6)}`;

  const [insertedKey] = await db
    .insert(apiKeys)
    .values({
      name: keyName,
      key: keyPlain,
      keyPrefix: getKeyPrefix(keyPlain),
      keyHash: sha256(keyPlain),
      discordUserId: body.discordUserId,
      discordUsername: body.discordUsername || null,
      provisionedBy: "trial-bot",
      isActive: true,
      isTrial: true,
      maxDevices: config.globalMaxDevices ?? 1,
      dailyTokenLimit: dailyLimit,
      promptLimit,
      promptLimitWindow: promptWindow,
      dailyInputTokenLimit: 0,
      dailyOutputTokenLimit: 0,
      monthlyTokenLimit: 0,
      perModelPromptLimit: 0,
    })
    .returning();

  await db.insert(trialUsers).values({
    discordUserId: body.discordUserId,
    discordUsername: body.discordUsername || null,
    apiKeyId: insertedKey.id,
    expiresAt,
  });

  const endpoint = `${process.env.PROXY_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || "3000"}`}/v1`;
  const gpyModels = await listGpyCatalogModels(config);
  const dmTemplates = parseTrialDmTemplates(config.trialDmTemplates);

  const { queueTrialNotification } = await import("../../utils/trial-notify.js");
  await queueTrialNotification(insertedKey.id, "claimed", {
    apiKey: keyPlain,
    endpoint,
    expiresAt: expiresAt.toISOString(),
    expiresAtFormatted: `<t:${Math.floor(expiresAt.getTime() / 1000)}:F>`,
    durationDays: String(durationDays),
    dailyTokenLimit: String(dailyLimit),
    promptLimit: String(promptLimit),
    promptWindow,
    modelList: gpyModels.slice(0, 30).map((m) => `• \`${m}\``).join("\n") || "• (lihat /v1/models)",
    dmTemplate: dmTemplates.claimed || "",
  });

  return {
    success: true,
    apiKey: keyPlain,
    endpoint,
    expiresAt: expiresAt.toISOString(),
    durationDays,
    rules: {
      dailyTokenLimit: dailyLimit,
      promptLimit,
      promptLimitWindow: promptWindow,
      models: gpyModels,
      provider: "gpy",
    },
  };
}

export async function adminTrialAction(body: {
  action: string;
  discordUserId: string;
  days?: number;
  reason?: string;
  overrideDays?: number;
  overrideMaxTrials?: number;
  overrideDailyTokenLimit?: number;
  overridePromptLimit?: number;
  overridePromptLimitWindow?: string;
}) {
  const [trialRow] = await db
    .select()
    .from(trialUsers)
    .where(eq(trialUsers.discordUserId, body.discordUserId))
    .orderBy(desc(trialUsers.claimedAt))
    .limit(1);

  if (!trialRow) return { error: "Trial user not found", status: 404 as const };
  const now = new Date();

  if (body.action === "terminate") {
    await db.update(trialUsers).set({
      endedAt: now,
      endReason: "admin_terminated",
      suspended: true,
      updatedAt: now,
    }).where(eq(trialUsers.id, trialRow.id));
    await db.update(apiKeys).set({ isActive: false, updatedAt: now }).where(eq(apiKeys.id, trialRow.apiKeyId));
    const { queueTrialNotification } = await import("../../utils/trial-notify.js");
    await queueTrialNotification(trialRow.apiKeyId, "terminated", { reason: body.reason || "Admin action" });
    return { success: true };
  }

  if (body.action === "suspend") {
    await db.update(trialUsers).set({ suspended: true, updatedAt: now }).where(eq(trialUsers.id, trialRow.id));
    await db.update(apiKeys).set({ isActive: false, updatedAt: now }).where(eq(apiKeys.id, trialRow.apiKeyId));
    await queueTrialNotification(trialRow.apiKeyId, "terminated", { reason: "Trial suspended by admin" });
    return { success: true };
  }

  if (body.action === "unsuspend") {
    await db.update(trialUsers).set({ suspended: false, updatedAt: now }).where(eq(trialUsers.id, trialRow.id));
    await db.update(apiKeys).set({ isActive: true, updatedAt: now }).where(eq(apiKeys.id, trialRow.apiKeyId));
    return { success: true };
  }

  if (body.action === "extend") {
    const addDays = Math.max(1, Number(body.days) || 7);
    const base = trialRow.expiresAt > now ? trialRow.expiresAt : now;
    const newExpiry = new Date(base.getTime() + addDays * 24 * 60 * 60 * 1000);
    await db.update(trialUsers).set({
      expiresAt: newExpiry,
      endedAt: null,
      endReason: null,
      suspended: false,
      updatedAt: now,
    }).where(eq(trialUsers.id, trialRow.id));
    await db.update(apiKeys).set({ isActive: true, updatedAt: now }).where(eq(apiKeys.id, trialRow.apiKeyId));

    const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, trialRow.apiKeyId));
    const [config] = await db.select().from(adminConfig);
    const templates = parseTrialDmTemplates(config?.trialDmTemplates);
    const upgradeText = formatTrialTemplate(templates.upgradePhantom || "", {
      reason: "berakhir",
      agverifChannelId: config?.agverifChannelId || "",
    });
    await queueTrialNotification(trialRow.apiKeyId, "extended", {
      days: String(addDays),
      expiresAt: newExpiry.toISOString(),
      expiresAtFormatted: `<t:${Math.floor(newExpiry.getTime() / 1000)}:F>`,
      apiKey: key?.key || "",
      endpoint: `${process.env.PROXY_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || "3000"}`}/v1`,
      upgradePhantom: upgradeText,
    });
    return { success: true, expiresAt: newExpiry.toISOString() };
  }

  if (body.action === "reset_usage") {
    // Wipe all request_logs rows for this key (trial usage reset).
    const { requestLogs } = await import("../../db/schema.js");
    await db.delete(requestLogs).where(eq(requestLogs.apiKeyId, trialRow.apiKeyId));
    return { success: true, message: "Usage reset" };
  }

  if (body.action === "override") {
    const updates: Record<string, any> = { updatedAt: now };
    if (body.overrideDays !== undefined) updates.overrideDays = body.overrideDays;
    if (body.overrideMaxTrials !== undefined) updates.overrideMaxTrials = body.overrideMaxTrials;
    if (body.overrideDailyTokenLimit !== undefined) updates.overrideDailyTokenLimit = body.overrideDailyTokenLimit;
    if (body.overridePromptLimit !== undefined) updates.overridePromptLimit = body.overridePromptLimit;
    if (body.overridePromptLimitWindow !== undefined) updates.overridePromptLimitWindow = body.overridePromptLimitWindow;
    await db.update(trialUsers).set(updates).where(eq(trialUsers.id, trialRow.id));

    const keyUpdates: Record<string, any> = { updatedAt: now };
    if (body.overrideDailyTokenLimit !== undefined) keyUpdates.dailyTokenLimit = body.overrideDailyTokenLimit;
    if (body.overridePromptLimit !== undefined) keyUpdates.promptLimit = body.overridePromptLimit;
    if (body.overridePromptLimitWindow !== undefined) keyUpdates.promptLimitWindow = body.overridePromptLimitWindow;
    if (Object.keys(keyUpdates).length > 1) {
      await db.update(apiKeys).set(keyUpdates).where(eq(apiKeys.id, trialRow.apiKeyId));
    }
    return { success: true };
  }

  if (body.action === "grant_retry") {
    // Full reset: mark previous row as unclaim so user can re-claim from scratch.
    await db.update(trialUsers).set({
      endedAt: now,
      endReason: "admin_grant_retry",
      suspended: false,
      overrideMaxTrials: (trialRow.overrideMaxTrials || 0) + 1,
      updatedAt: now,
    }).where(eq(trialUsers.id, trialRow.id));
    // Disable the previous key so quota resets cleanly on next claim.
    await db.update(apiKeys).set({ isActive: false, updatedAt: now }).where(eq(apiKeys.id, trialRow.apiKeyId));

    const [config] = await db.select().from(adminConfig);
    const templates = parseTrialDmTemplates(config?.trialDmTemplates);
    const upgradeText = formatTrialTemplate(templates.upgradePhantom || "", {
      reason: "berakhir",
      agverifChannelId: config?.agverifChannelId || "",
    });
    await queueTrialNotification(trialRow.apiKeyId, "reclaim_available", {
      channelId: config?.tokitoChannelId || "",
      durationDays: String(config?.trialDefaultDurationDays ?? 1),
      upgradePhantom: upgradeText,
    });
    return { success: true, message: "User may claim trial again" };
  }

  if (body.action === "add_max_trials") {
    const n = Math.max(1, Number((body as any).count) || 1);
    await db.update(trialUsers).set({
      overrideMaxTrials: (trialRow.overrideMaxTrials || 0) + n,
      updatedAt: now,
    }).where(eq(trialUsers.id, trialRow.id));
    return { success: true, overrideMaxTrials: (trialRow.overrideMaxTrials || 0) + n };
  }

  return { error: "Unknown action", status: 400 as const };
}

export async function getTrialStatusForUser(discordUserId: string) {
  const trialRow = await findActiveTrialByDiscordUser(discordUserId);
  if (!trialRow) {
    const ended = await db.select().from(trialUsers)
      .where(eq(trialUsers.discordUserId, discordUserId))
      .orderBy(desc(trialUsers.claimedAt))
      .limit(1);
    if (!ended[0]) return { status: "not_started" as const };
    return {
      status: ended[0].endedAt ? (ended[0].endReason || "ended") : "expired",
      expiresAt: ended[0].expiresAt,
      endedAt: ended[0].endedAt,
    };
  }

  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, trialRow.apiKeyId)).limit(1);
  return {
    status: trialRow.suspended ? "suspended" : "active",
    expiresAt: trialRow.expiresAt,
    apiKeyId: trialRow.apiKeyId,
    isActive: key?.isActive,
    dailyTokenLimit: key?.dailyTokenLimit,
    promptLimit: key?.promptLimit,
    promptLimitWindow: key?.promptLimitWindow,
  };
}

export async function isUserTrialMember(discordUserId: string): Promise<boolean> {
  const active = await findActiveTrialByDiscordUser(discordUserId);
  return !!active;
}

export async function isUserPhantomMember(discordUserId: string, requiredRoleId: string): Promise<boolean> {
  // Bot-side role check is authoritative; proxy uses key type as proxy
  const [key] = await db.select().from(apiKeys).where(and(eq(apiKeys.discordUserId, discordUserId), eq(apiKeys.isTrial, false))).limit(1);
  return !!key && key.isActive;
}
