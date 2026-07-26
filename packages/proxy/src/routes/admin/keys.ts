import { Hono } from "hono";
import { db } from "../../db/index.js";
import { apiKeys, requestLogs, devices, allowedDevices, allowedIdes, chatSessions, adminConfig, modelLimits, keyDayOverrides } from "../../db/schema.js";
import { eq, sql, and, desc, inArray } from "drizzle-orm";
import { generateApiKey, getKeyPrefix, sha256, maskKey } from "../../utils/crypto.js";
import { normalizeIdeName } from "../../utils/detect-ide.js";
import { getModelRates } from "../../utils/cost-calculator.js";
import { COUNTED_LOG_SQL, BILLABLE_LOG_SQL, VALID_LOG_SQL, wibMonthStartSql, turnCountSql, turnPromptTokensSql, peakPromptTokensSql, turnCompletionTokensSql, turnTotalTokensSql, turnBillablePromptTokensSql, turnCachedTokensSql, hopCountSql, hopFullInputTokensSql, weightedHopInputTokensSql, weightedHopTotalTokensSql, sanitizeRows, groupedInputSumSql, modelLimitCreditBreakdownSql } from "../../utils/counting.js";
import { applyTokenMultiplierRows, getTokenMultipliers } from "../../utils/token-multiplier.js";
import { apiKeyCache, statsCache } from "../../utils/cache.js";
import { getModelCatalogResponse } from "../../utils/model-catalog.js";
import { enrichModelLimitsWithCatalog } from "../../utils/model-limits-enrich.js";
import { isAuthenticated } from "../../middleware/session.js";
import { isProtectedPrimaryApiKey, isAdminDeleteBlocked } from "../../utils/api-key-primary.js";
import { buildLiveUsageForKey } from "../../utils/live-usage.js";
import { resolveAccountKeyScope } from "../../utils/api-key-account.js";
import {
  dayOverrideHasAny,
  getKeyDayOverride,
  isValidDayWib,
  normalizeDayBonuses,
  wibDayStartUtc,
  wibTodayDateString,
} from "../../utils/day-override.js";
import {
  fetchDiscordMemberRoleIds,
  parseRoleLimitModes,
  resolveDiscordRoles,
} from "../../utils/discord-roles.js";
import { queueUserNotification, formatPhantomCredentialsMessage } from "../../utils/user-notify.js";

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

const keys = new Hono();

function calculateBreakdownCosts(modelBreakdown: Array<{ model: string | null, promptTokens: number, completionTokens: number }>) {
  let promptCost = 0;
  let completionCost = 0;
  for (const row of modelBreakdown) {
    const rates = getModelRates(row.model || "");
    promptCost += row.promptTokens * rates.prompt;
    completionCost += row.completionTokens * rates.completion;
  }
  return {
    promptCost: Math.round(promptCost),
    completionCost: Math.round(completionCost),
    totalCost: Math.round(promptCost + completionCost)
  };
}

keys.get("/keys", async (c) => {
  // Default is fast list. Opt-in heavy per-key liveUsage with ?full=1 (never used by Keys page).
  const wantFull =
    c.req.query("full") === "1" ||
    c.req.query("full") === "true" ||
    c.req.query("live") === "1";

  const listBase = await statsCache.getOrFetch("keys-list-fast-v4", async () => {
    const allKeys = await db.select().from(apiKeys).orderBy(desc(apiKeys.id));
    const config = (await db.select().from(adminConfig))[0];

    const _now = new Date();
    const _wibOffset = 7 * 60 * 60 * 1000;
    const _wibNow = new Date(_now.getTime() + _wibOffset);
    _wibNow.setUTCHours(0, 0, 0, 0);
    const todayUtcDate = new Date(_wibNow.getTime() - _wibOffset);

    const { getActiveAddonsForUser, sumAddonDailyTokenBonus, resolveAddonQuotaStack } =
      await import("../../utils/addons.js");

    // Batch aggregates — avoid N+1
    const [deviceRows, todayRows] = await Promise.all([
      db
        .select({
          apiKeyId: devices.apiKeyId,
          count: sql<number>`count(*)::int`,
        })
        .from(devices)
        .groupBy(devices.apiKeyId),
      db.execute(sql`
        SELECT
          api_key_id AS "apiKeyId",
          COUNT(DISTINCT turn_id) FILTER (
            WHERE status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
          )::int AS "requestsToday",
          COALESCE(SUM(
            CASE WHEN status_code BETWEEN 200 AND 299
              THEN COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0)
              ELSE 0 END
          ), 0)::bigint AS "tokensToday",
          COALESCE(SUM(
            CASE WHEN status_code BETWEEN 200 AND 299 THEN COALESCE(prompt_tokens, 0) ELSE 0 END
          ), 0)::bigint AS "inputToday",
          COALESCE(SUM(
            CASE WHEN status_code BETWEEN 200 AND 299 THEN COALESCE(completion_tokens, 0) ELSE 0 END
          ), 0)::bigint AS "outputToday",
          COALESCE(SUM(
            CASE WHEN status_code BETWEEN 200 AND 299 THEN COALESCE(estimated_cost, 0) ELSE 0 END
          ), 0)::float AS "estimatedCostToday"
        FROM request_logs
        WHERE created_at >= ${todayUtcDate}
        GROUP BY api_key_id
      `),
    ]);

    const deviceByKey = new Map<number, number>();
    for (const r of deviceRows) deviceByKey.set(r.apiKeyId, Number(r.count) || 0);

    const todayByKey = new Map<number, {
      requestsToday: number;
      tokensToday: number;
      inputToday: number;
      outputToday: number;
      estimatedCostToday: number;
    }>();
    for (const r of (todayRows.rows || []) as any[]) {
      todayByKey.set(Number(r.apiKeyId), {
        requestsToday: Number(r.requestsToday) || 0,
        tokensToday: Number(r.tokensToday) || 0,
        inputToday: Number(r.inputToday) || 0,
        outputToday: Number(r.outputToday) || 0,
        estimatedCostToday: Number(r.estimatedCostToday) || 0,
      });
    }

    // Active add-ons keyed by discord user (and by apiKeyId for unlinked)
    const addonByDiscord = new Map<string, Awaited<ReturnType<typeof getActiveAddonsForUser>>>();
    const discordIds = [...new Set(allKeys.map((k) => k.discordUserId).filter(Boolean))] as string[];
    await mapWithConcurrency(discordIds, 6, async (uid) => {
      try {
        addonByDiscord.set(uid, await getActiveAddonsForUser({ discordUserId: uid }));
      } catch {
        addonByDiscord.set(uid, []);
      }
    });

    const softRem = (limit: number, used: number): number | null => {
      if (!(limit > 0)) return null;
      return Math.max(0, limit - used);
    };

    return allKeys.map((key) => {
      const today = todayByKey.get(key.id);
      const tokensToday = today?.tokensToday || 0;
      const inputToday = today?.inputToday || 0;
      const outputToday = today?.outputToday || 0;
      const requestsToday = today?.requestsToday || 0;

      let accountBadges: string[] = [];
      try {
        accountBadges = JSON.parse((key as any).accountBadges || "[]");
        if (!Array.isArray(accountBadges)) accountBadges = [];
      } catch {
        accountBadges = [];
      }
      accountBadges = accountBadges
        .map((b) => String(b || "").trim())
        .filter((b) => {
          const n = b.toLowerCase().replace(/[\s-]+/g, "_");
          return n && n !== "admin_override" && n !== "none";
        });

      const accountTier = String((key as any).accountTier || "").trim();
      const activeAddons = key.discordUserId
        ? addonByDiscord.get(key.discordUserId) || []
        : [];
      const hasAddon = !key.isTrial && activeAddons.length > 0;
      if (hasAddon && !accountBadges.includes("addon")) accountBadges = [...accountBadges, "addon"];

      const addonBonus = sumAddonDailyTokenBonus(activeAddons);
      const stack = resolveAddonQuotaStack({
        hasActiveAddon: hasAddon,
        isTrial: !!key.isTrial,
        roleLimitMode: (key as any).roleLimitMode,
        keyDailyInput: key.dailyInputTokenLimit,
        keyDailyOutput: key.dailyOutputTokenLimit,
        keyDailyTotal: key.dailyTokenLimit,
        globalDailyInput: config?.globalDailyInputTokenLimit,
        globalDailyOutput: config?.globalDailyOutputTokenLimit,
        addonDailyBonus: addonBonus,
      });

      const promptCap = (key.promptLimit && key.promptLimit > 0)
        ? key.promptLimit
        : (key.isTrial ? 0 : (config?.globalPromptLimit || 0));

      // Hard remaining for list (quotaHint — liveUsage is null on fast path)
      const quotaHint = {
        bypassIo: false,
        dailyLeft: softRem(stack.effectiveDaily, tokensToday),
        inputLeft: softRem(stack.dailyInputLimit, inputToday),
        outputLeft: softRem(stack.dailyOutputLimit, outputToday),
        promptsLeftToday: softRem(promptCap, requestsToday),
        inputUsed: inputToday,
        outputUsed: outputToday,
        dailyUsed: tokensToday,
        inputLimit: stack.dailyInputLimit,
        outputLimit: stack.dailyOutputLimit,
        dailyLimit: stack.effectiveDaily,
      };

      return {
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        keyMasked: maskKey(key.key),
        discordUserId: key.discordUserId,
        discordUsername: key.discordUsername,
        provisionedBy: key.provisionedBy,
        isPrimary: isProtectedPrimaryApiKey(key),
        canDelete: true,
        isActive: key.isActive,
        isTrial: key.isTrial || false,
        maxDevices: key.maxDevices,
        devicePolicy: key.devicePolicy,
        ipPolicy: key.ipPolicy,
        idePolicy: key.idePolicy,
        dailyTokenLimit: key.dailyTokenLimit || 0,
        monthlyTokenLimit: key.monthlyTokenLimit,
        dailyInputTokenLimit: key.dailyInputTokenLimit || 0,
        dailyOutputTokenLimit: key.dailyOutputTokenLimit || 0,
        rateLimit: key.rateLimit || 0,
        rateLimitWindow: key.rateLimitWindow || config?.globalRateLimitWindow || "1h",
        promptLimit: key.promptLimit || 0,
        promptLimitWindow: key.promptLimitWindow || config?.globalPromptLimitWindow || "1d",
        deviceCount: deviceByKey.get(key.id) || 0,
        requestsToday,
        tokensToday,
        estimatedCostToday: today?.estimatedCostToday || 0,
        totalRequests: 0,
        totalTokens: 0,
        createdAt: key.createdAt,
        accountBadges,
        accountTier: accountTier && accountTier !== "admin_override" ? accountTier : null,
        roleLimitMode: (key as any).roleLimitMode || null,
        activeAddons: activeAddons.map((a) => ({
          name: a.name,
          expiresAt: a.expiresAt ? new Date(a.expiresAt).toISOString() : null,
          dailyTokenLimit: a.dailyTokenLimit || 0,
        })),
        quotaHint,
      };
    });
  }, 15_000);

  if (!wantFull) {
    return c.json((listBase as any[]).map((row) => ({ ...row, liveUsage: null })));
  }

  // Opt-in only: expensive per-key meters (kept for debugging / rare full export)
  const allKeysFresh = await db.select().from(apiKeys);
  const configFresh = (await db.select().from(adminConfig))[0];
  const liveByKeyId = new Map<number, Awaited<ReturnType<typeof buildLiveUsageForKey>>>();
  await mapWithConcurrency(allKeysFresh, 4, async (key) => {
    try {
      liveByKeyId.set(key.id, await buildLiveUsageForKey(key, configFresh));
    } catch (err) {
      console.warn(`[keys-list] liveUsage failed for key ${key.id}:`, (err as Error)?.message || err);
    }
  });

  return c.json(
    (listBase as any[]).map((row) => ({
      ...row,
      liveUsage: liveByKeyId.get(row.id) || null,
    })),
  );
});

keys.post("/keys", async (c) => {
  const { name, discordUserId, discordUsername, provisionedBy } = await c.req.json<{ name: string; discordUserId?: string; discordUsername?: string; provisionedBy?: string }>();
  if (!name || !name.trim()) return c.json({ error: "Name is required" }, 400);

  const key = generateApiKey();
  const [result] = await db.insert(apiKeys).values({
    name: name.trim(), key, keyPrefix: getKeyPrefix(key), keyHash: sha256(key),
    discordUserId: discordUserId || null,
    discordUsername: discordUsername || null,
    provisionedBy: provisionedBy || "dashboard",
  }).returning();

  return c.json({ id: result.id, name: result.name, key, keyPrefix: result.keyPrefix, isActive: result.isActive, createdAt: result.createdAt }, 201);
});

// Preview Discord roles for Admin Override (optional Discord ID).
keys.get("/keys/override-preview", async (c) => {
  if (!(await isAuthenticated(c))) return c.json({ error: "Unauthorized" }, 401);
  const discordUserId = String(c.req.query("discordUserId") || "").trim();
  if (!discordUserId) {
    return c.json({
      discordUserId: null,
      resolved: null,
      message: "No Discord ID — custom key, no DM / role detect",
    });
  }
  if (!/^\d{15,25}$/.test(discordUserId)) {
    return c.json({ error: "Valid discordUserId required (15-25 digits)" }, 400);
  }
  const [config] = await db.select().from(adminConfig).limit(1);
  const member = await fetchDiscordMemberRoleIds(config?.discordBotToken || "", discordUserId);
  if (!member) {
    return c.json({
      discordUserId,
      found: false,
      resolved: null,
      message: "Member not found in bot guilds (or bot token missing)",
    });
  }
  const resolved = resolveDiscordRoles(member.roleIds, {
    phantomRoleId: config?.requiredRoleId,
    premiumRoleId: config?.trialRequiredRoleId,
    proRoleId: (config as any)?.proRoleId,
    contributorRoleId: (config as any)?.contributorRoleId,
    troubleshooterRoleId: (config as any)?.troubleshooterRoleId,
    moderatorRoleId: (config as any)?.moderatorRoleId,
    roleLimitModes: parseRoleLimitModes((config as any)?.roleLimitModes),
  });
  return c.json({
    discordUserId,
    found: true,
    username: member.username,
    roleIds: member.roleIds,
    resolved,
  });
});

// Admin Override: optional Discord ID. provisionedBy=admin-override (cleanup-immune).
// With Discord ID: auto-detect roles → limit mode; queue DM. Without: silent custom key.
keys.post("/keys/override-discord", async (c) => {
  if (!(await isAuthenticated(c))) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{
    discordUserId?: string | null;
    discordUsername?: string;
    note?: string;
  }>();
  const rawId = String(body.discordUserId || "").trim();
  const hasDiscord = !!rawId;
  if (hasDiscord && !/^\d{15,25}$/.test(rawId)) {
    return c.json({ error: "Valid discordUserId required (15-25 digits), or leave empty for custom key" }, 400);
  }
  const discordUserId = hasDiscord ? rawId : null;
  const endpoint = `${process.env.PROXY_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || "3000"}`}/v1`;
  const [config] = await db.select().from(adminConfig).limit(1);

  let resolved = resolveDiscordRoles([], {
    roleLimitModes: parseRoleLimitModes((config as any)?.roleLimitModes),
  });
  let discordUsername = body.discordUsername?.trim() || (discordUserId ? `override-${discordUserId}` : "custom-override");

  if (discordUserId) {
    const member = await fetchDiscordMemberRoleIds(config?.discordBotToken || "", discordUserId);
    if (member) {
      if (!body.discordUsername?.trim() && member.username) discordUsername = member.username;
      resolved = resolveDiscordRoles(member.roleIds, {
        phantomRoleId: config?.requiredRoleId,
        premiumRoleId: config?.trialRequiredRoleId,
        proRoleId: (config as any)?.proRoleId,
        contributorRoleId: (config as any)?.contributorRoleId,
        troubleshooterRoleId: (config as any)?.troubleshooterRoleId,
        moderatorRoleId: (config as any)?.moderatorRoleId,
        roleLimitModes: parseRoleLimitModes((config as any)?.roleLimitModes),
      });
    }

    const [existing] = await db.select()
      .from(apiKeys)
      .where(and(
        eq(apiKeys.discordUserId, discordUserId),
        eq(apiKeys.provisionedBy, "admin-override"),
        eq(apiKeys.isActive, true),
      ))
      .limit(1);

    if (existing) {
      return c.json({
        success: true,
        alreadyExists: true,
        apiKey: existing.key,
        keyId: existing.id,
        keyName: existing.name,
        endpoint,
        discordUserId,
        discordUsername: existing.discordUsername || discordUsername,
        resolved,
        message: "User already has an active admin-override key",
      });
    }
  }

  // zero_unless_addon → hard 0 on I/O (and dedicated gated in proxy). follow_global → 0 = inherit global.
  const limitMode = resolved.limitMode;
  const accountTier =
    resolved.primary === "none"
      ? "phantom"
      : resolved.primary === "staff"
        ? "staff"
        : resolved.primary;
  // Store real Discord roles only — never expose "admin_override" as a badge
  const badges = resolved.badges.filter((b) => b && b !== "none" && b !== "admin_override");

  const key = generateApiKey();
  const safeUser = String(discordUsername || "user")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "user";
  const keyName = discordUserId
    ? `Override-${safeUser}-${discordUserId}`
    : `Override-custom-${Date.now().toString(36).slice(-6)}`;

  const [result] = await db.insert(apiKeys).values({
    name: keyName,
    key,
    keyPrefix: getKeyPrefix(key),
    keyHash: sha256(key),
    discordUserId,
    discordUsername,
    provisionedBy: "admin-override",
    isActive: true,
    isTrial: false,
    maxDevices: 99,
    devicePolicy: "none",
    ipPolicy: "none",
    idePolicy: "none",
    dailyTokenLimit: 0,
    monthlyTokenLimit: 0,
    dailyInputTokenLimit: 0,
    dailyOutputTokenLimit: 0,
    promptLimit: 0,
    promptLimitWindow: "5h",
    perModelPromptLimit: 0,
    roleLimitMode: limitMode,
    accountBadges: JSON.stringify(badges),
    accountTier,
  } as any).returning();

  if (discordUserId) {
    await queueUserNotification(result.id, {
      type: "admin_override_created",
      title: "🔑 API Key Proxy Anda",
      message: formatPhantomCredentialsMessage({
        endpoint,
        apiKey: key,
        intro:
          "Admin Override aktif. Verifikasi/klaim tidak diperlukan — berikut kredensial akses API proxy:",
      }),
      endpoint,
      apiKey: key,
      newKey: key,
    });
  }

  console.log(
    `[admin-override] key ${result.id} (${keyName}) discord=${discordUserId || "(none)"} tier=${accountTier} mode=${limitMode}` +
      (body.note ? ` note="${body.note}"` : ""),
  );

  return c.json({
    success: true,
    alreadyExists: false,
    apiKey: key,
    keyId: result.id,
    keyName,
    endpoint,
    discordUserId,
    discordUsername,
    resolved,
    roleLimitMode: limitMode,
    accountTier,
  });
});

keys.get("/keys/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  let key = (await db.select().from(apiKeys).where(eq(apiKeys.id, id)))[0];
  if (!key) return c.json({ error: "API key not found" }, 404);

  // Refresh Discord badges / tier into DB before responding (non-trial linked keys)
  if (key.discordUserId && !key.isTrial) {
    try {
      const { syncUserKeyAccess } = await import("../../utils/key-access-lifecycle.js");
      await syncUserKeyAccess(key.discordUserId, { reason: "admin key detail" });
      key = (await db.select().from(apiKeys).where(eq(apiKeys.id, id)))[0] || key;
    } catch (err) {
      console.warn("[keys/:id] role sync failed:", (err as Error)?.message || err);
    }
  }

  const config = (await db.select().from(adminConfig))[0];

  // Period start timestamps
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);
  wibNow.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(wibNow.getTime() - wibOffset);
  const weekStart  = new Date(now); weekStart.setDate(now.getDate() - 7);
  const monthStart = new Date(wibMonthStartSql().replace(" ", "T") + "Z");

  // Analytics period filter: days=1 (today), 7 (week), 30 (month), 0/absent (all time)
  const days = parseInt(c.req.query("days") || "0");
  const analyticsSince: Date | null = days === 1
    ? todayStart
    : days > 0
      ? new Date(Date.now() - days * 86400000)
      : null;
  const analyticsDateFilter = analyticsSince ? sql`AND created_at >= ${analyticsSince}` : sql``;

  const tmOpts = key.isTrial ? { isTrial: true as const } : undefined;

  const buildPeriodStats = async (since?: Date) => {
    const whereClause = since
      ? and(eq(requestLogs.apiKeyId, key.id), sql`created_at >= ${since}`, VALID_LOG_SQL)!
      : and(eq(requestLogs.apiKeyId, key.id), VALID_LOG_SQL)!;
    const whereHops = since
      ? and(eq(requestLogs.apiKeyId, key.id), sql`created_at >= ${since}`, BILLABLE_LOG_SQL)!
      : and(eq(requestLogs.apiKeyId, key.id), BILLABLE_LOG_SQL)!;

    const s = (await db.select({
      turns:            turnCountSql(whereClause),
      hops:             hopCountSql(whereClause),
      tokens:           weightedHopTotalTokensSql(whereHops, tmOpts),
      promptTokens:     weightedHopInputTokensSql(whereHops, tmOpts),
      peakPromptTokens: peakPromptTokensSql(whereClause, tmOpts),
      billablePromptTokens: turnBillablePromptTokensSql(whereClause, tmOpts),
      cachedTokens:     turnCachedTokensSql(whereClause, tmOpts),
      fullInputTokens:  hopFullInputTokensSql(whereHops, tmOpts),
      completionTokens: turnCompletionTokensSql(whereClause, tmOpts),
      contextTokens:    sql<number>`0`,
      estimatedCost:    sql<number>`COALESCE(SUM(estimated_cost), 0)`,
    }).from(requestLogs).where(whereClause))[0];

    const breakdown = applyTokenMultiplierRows(sanitizeRows((await db.execute(sql`
      SELECT model, COALESCE(SUM(sum_delta), 0) as "promptTokens", COALESCE(SUM(sum_c), 0) as "completionTokens"
      FROM (
        SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
          turn_id, ${sql.raw(groupedInputSumSql())} as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE api_key_id = ${key.id} ${since ? sql`AND created_at >= ${since}` : sql``} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
        GROUP BY CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END, turn_id
        UNION ALL
        SELECT TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)) as model,
          turn_id, ${sql.raw(groupedInputSumSql())} as sum_delta, SUM(completion_tokens) as sum_c
        FROM request_logs WHERE model LIKE 'auto (%)%' AND api_key_id = ${key.id} ${since ? sql`AND created_at >= ${since}` : sql``} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
        GROUP BY TRIM(SUBSTRING(model FROM 7 FOR POSITION(')' IN SUBSTRING(model FROM 7)) - 1)), turn_id
      )
      GROUP BY model
    `)).rows as any[], ['promptTokens', 'completionTokens']), tmOpts);
    const costs = calculateBreakdownCosts(breakdown as any);
    return {
      requests:         s?.turns           || 0,
      hopCount:         s?.hops            || 0,
      tokens:           s?.tokens          || 0,
      promptTokens:     s?.promptTokens    || 0,
      peakPromptTokens: s?.peakPromptTokens || 0,
      billablePromptTokens: s?.billablePromptTokens || 0,
      cachedTokens:     s?.cachedTokens    || 0,
      fullInputTokens:  s?.fullInputTokens || 0,
      completionTokens: s?.completionTokens|| 0,
      contextTokens:    s?.contextTokens   || 0,
      estimatedCost:    costs.totalCost,
      promptCost:       costs.promptCost,
      completionCost:   costs.completionCost,
    };
  };

  const [todayStats, weekStats, monthStats, allTimeStats] = await Promise.all([
    buildPeriodStats(todayStart),
    buildPeriodStats(weekStart),
    buildPeriodStats(monthStart),
    buildPeriodStats(),
  ]);

  const deviceCount = (await db.select({ count: sql<number>`count(*)` }).from(devices).where(eq(devices.apiKeyId, key.id)))[0];

  const { input: tmInput, output: tmOutput } = getTokenMultipliers(tmOpts);

  const modelCreditWhere = analyticsSince
    ? sql`api_key_id = ${key.id} AND created_at >= ${analyticsSince} AND status_code BETWEEN 200 AND 299`
    : sql`api_key_id = ${key.id} AND status_code BETWEEN 200 AND 299`;

  const topModelsByTokensRaw = sanitizeRows(
    (await db.execute(modelLimitCreditBreakdownSql(modelCreditWhere, { ...tmOpts, limit: 10 }))).rows as any[],
    ["requests", "promptTokens", "completionTokens", "tokens"],
  );
  const topModelsByTokens = topModelsByTokensRaw.map((r: any) => ({
    model: r.model,
    count: r.requests,
    tokens: r.tokens,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    estimatedCost: 0,
  }));
  const topModels = [...topModelsByTokens].sort((a, b) => (b.count || 0) - (a.count || 0));

  const topDevices = sanitizeRows((await db.execute(sql`
    SELECT device_fingerprint as "deviceFingerprint", ip_address as "ipAddress",
      ide_detected as "ideDetected", os_detected as "osDetected", client_name as "clientName",
      COUNT(*) as requests, COUNT(DISTINCT session_id) as sessions,
      COALESCE(SUM(sum_delta * ${tmInput} + sum_c * ${tmOutput}), 0) as tokens, 0 as "estimatedCost",
      MAX(last_seen) as "lastSeen"
    FROM (SELECT device_fingerprint, ip_address, ide_detected, os_detected, client_name, session_id, turn_id,
        ${sql.raw(groupedInputSumSql())} as sum_delta, SUM(completion_tokens) as sum_c, MAX(created_at) as last_seen
      FROM request_logs WHERE api_key_id = ${key.id} AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL ${analyticsDateFilter}
      GROUP BY device_fingerprint, ip_address, ide_detected, os_detected, client_name, session_id, turn_id)
    GROUP BY device_fingerprint, ip_address, ide_detected, os_detected, client_name ORDER BY tokens DESC LIMIT 20
  `)).rows as any[], ['requests', 'sessions', 'tokens']);

  const deviceSessionsWhere = analyticsSince
    ? and(eq(chatSessions.apiKeyId, key.id), sql`last_seen_at >= ${analyticsSince}`)
    : eq(chatSessions.apiKeyId, key.id);

  const deviceSessions = await db.select({
    sessionId: chatSessions.sessionId,
    sessionName: chatSessions.sessionName,
    deviceFingerprint: chatSessions.deviceFingerprint,
    ipAddress: chatSessions.ipAddress,
    ideDetected: chatSessions.ideDetected,
    provider: chatSessions.provider,
    model: chatSessions.model,
    requestCount: chatSessions.requestCount,
    totalTokens: chatSessions.totalTokens,
    estimatedCost: chatSessions.estimatedCost,
    lastContextTokens: chatSessions.lastContextTokens,
    contextFingerprint: chatSessions.contextFingerprint,
    firstSeenAt: chatSessions.firstSeenAt,
    lastSeenAt: chatSessions.lastSeenAt,
  }).from(chatSessions)
    .where(deviceSessionsWhere)
    .orderBy(sql`total_tokens DESC`)
    .limit(500);

  const devicePolicyCounts = (await db.select({
    deviceAllowCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'allow' AND fingerprint IS NOT NULL THEN 1 ELSE 0 END), 0)`,
    deviceBlockCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'block' AND fingerprint IS NOT NULL THEN 1 ELSE 0 END), 0)`,
    ipAllowCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'allow' AND ip_address IS NOT NULL THEN 1 ELSE 0 END), 0)`,
    ipBlockCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'block' AND ip_address IS NOT NULL THEN 1 ELSE 0 END), 0)`,
  }).from(allowedDevices).where(eq(allowedDevices.apiKeyId, key.id)))[0];

  const idePolicyCounts = (await db.select({
    ideAllowCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'allow' THEN 1 ELSE 0 END), 0)`,
    ideBlockCount: sql<number>`COALESCE(SUM(CASE WHEN list_type = 'block' THEN 1 ELSE 0 END), 0)`,
  }).from(allowedIdes).where(eq(allowedIdes.apiKeyId, key.id)))[0];

  const devicePolicies = await db
    .select()
    .from(allowedDevices)
    .where(eq(allowedDevices.apiKeyId, key.id))
    .orderBy(sql`created_at DESC`)
    .limit(200);

  const idePolicies = await db
    .select()
    .from(allowedIdes)
    .where(eq(allowedIdes.apiKeyId, key.id))
    .orderBy(sql`created_at DESC`)
    .limit(200);

  const liveUsage = await buildLiveUsageForKey(key, config);

  let accountBadges: string[] = [];
  try {
    accountBadges = JSON.parse((key as any).accountBadges || "[]");
    if (!Array.isArray(accountBadges)) accountBadges = [];
  } catch {
    accountBadges = [];
  }
  accountBadges = accountBadges
    .map((b) => String(b || "").trim())
    .filter((b) => {
      const n = b.toLowerCase().replace(/[\s-]+/g, "_");
      return n && n !== "admin_override" && n !== "none";
    });
  const activeAddons = liveUsage?.activeAddons || [];
  if (activeAddons.length > 0 && !accountBadges.includes("addon")) {
    accountBadges = [...accountBadges, "addon"];
  }
  const tierRaw = String((key as any).accountTier || "").trim();
  const accountTier =
    tierRaw && tierRaw !== "none" && tierRaw !== "admin_override" ? tierRaw : null;

  let addonHistory: Awaited<ReturnType<typeof import("../../utils/addons.js").listAddonHistoryForUser>> = [];
  try {
    const { listAddonHistoryForUser } = await import("../../utils/addons.js");
    addonHistory = await listAddonHistoryForUser(
      {
        discordUserId: key.discordUserId,
        apiKeyIds: [key.id],
      },
      40,
    );
  } catch (err) {
    console.warn("[keys/:id] addon history failed:", (err as Error)?.message || err);
  }

  return c.json({
    id: key.id, name: key.name, keyPrefix: key.keyPrefix, keyMasked: maskKey(key.key),
    discordUserId: key.discordUserId,
    discordUsername: key.discordUsername,
    provisionedBy: key.provisionedBy,
    isPrimary: isProtectedPrimaryApiKey(key),
    canDelete: !isAdminDeleteBlocked(key),
    isActive: key.isActive, isTrial: key.isTrial || false, maxDevices: key.maxDevices, devicePolicy: key.devicePolicy,
    ipPolicy: key.ipPolicy, idePolicy: key.idePolicy, 
    dailyTokenLimit: key.dailyTokenLimit || 0, monthlyTokenLimit: key.monthlyTokenLimit,
    dailyInputTokenLimit: key.dailyInputTokenLimit || 0, dailyOutputTokenLimit: key.dailyOutputTokenLimit || 0,
    rateLimit: key.rateLimit || 0, rateLimitWindow: key.rateLimitWindow || config?.globalRateLimitWindow || "1h",
    promptLimit: key.promptLimit || 0, promptLimitWindow: key.promptLimitWindow || config?.globalPromptLimitWindow || "1d",
    perModelPromptLimit: key.perModelPromptLimit || 0, perModelPromptLimitWindow: key.perModelPromptLimitWindow || config?.globalPerModelPromptLimitWindow || "1d",
    createdAt: key.createdAt, updatedAt: key.updatedAt,
    accountBadges,
    accountTier,
    roleLimitMode: (key as any).roleLimitMode || null,
    activeAddons,
    addonHistory,
    liveUsage,
    stats: {
      today:   { ...todayStats },
      week:    { ...weekStats },
      month:   { ...monthStats },
      allTime: { ...allTimeStats, contextTokens: allTimeStats.contextTokens },
      deviceCount: deviceCount?.count || 0,
      topModels,
    },
    policyStats: {
      deviceAllowCount: devicePolicyCounts?.deviceAllowCount || 0,
      deviceBlockCount: devicePolicyCounts?.deviceBlockCount || 0,
      ipAllowCount: devicePolicyCounts?.ipAllowCount || 0,
      ipBlockCount: devicePolicyCounts?.ipBlockCount || 0,
      ideAllowCount: idePolicyCounts?.ideAllowCount || 0,
      ideBlockCount: idePolicyCounts?.ideBlockCount || 0,
    },
    policyEntries: {
      devices: devicePolicies,
      ides: idePolicies,
    },
    analytics: {
      topModelsByTokens,
      topDevices,
      deviceSessions,
    },
  });
});

keys.put("/keys/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json<any>();
  const key = (await db.select().from(apiKeys).where(eq(apiKeys.id, id)))[0];
  if (!key) return c.json({ error: "API key not found" }, 404);

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.isActive !== undefined) updates.isActive = body.isActive;
  if (body.maxDevices !== undefined) updates.maxDevices = body.maxDevices;
  if (body.devicePolicy !== undefined) updates.devicePolicy = body.devicePolicy;
  if (body.ipPolicy !== undefined) updates.ipPolicy = body.ipPolicy;
  if (body.idePolicy !== undefined) updates.idePolicy = body.idePolicy;
  if (body.dailyTokenLimit !== undefined) updates.dailyTokenLimit = body.dailyTokenLimit;
  if (body.monthlyTokenLimit !== undefined) updates.monthlyTokenLimit = body.monthlyTokenLimit;
  if (body.dailyInputTokenLimit !== undefined) updates.dailyInputTokenLimit = body.dailyInputTokenLimit;
  if (body.dailyOutputTokenLimit !== undefined) updates.dailyOutputTokenLimit = body.dailyOutputTokenLimit;
  if (body.rateLimit !== undefined) updates.rateLimit = body.rateLimit;
  if (body.rateLimitWindow !== undefined) updates.rateLimitWindow = body.rateLimitWindow || null;
  if (body.promptLimit !== undefined) updates.promptLimit = body.promptLimit;
  if (body.promptLimitWindow !== undefined) updates.promptLimitWindow = body.promptLimitWindow || null;
  if (body.perModelPromptLimit !== undefined) updates.perModelPromptLimit = body.perModelPromptLimit;
  if (body.perModelPromptLimitWindow !== undefined) updates.perModelPromptLimitWindow = body.perModelPromptLimitWindow || null;

  await db.update(apiKeys).set(updates).where(eq(apiKeys.id, id));
  apiKeyCache.clear();
  statsCache.invalidate("keys-list");
  statsCache.invalidate("keys-list-fast");
  statsCache.invalidate("keys-list-fast-v4");

  if (key.discordUserId) {
    if (body.isActive !== undefined && body.isActive !== key.isActive) {
      await queueUserNotification(id, {
        type: body.isActive ? "key_enabled" : "key_disabled",
        title: body.isActive ? "✅ API Key Diaktifkan" : "🚫 API Key Dinonaktifkan",
        message: body.isActive
          ? `API key **${key.name}** telah diaktifkan kembali oleh admin.`
          : `API key **${key.name}** telah dinonaktifkan oleh admin. Hubungi admin jika ini tidak diharapkan.`,
      });
    }
    const limitFields = [
      "dailyTokenLimit", "monthlyTokenLimit", "dailyInputTokenLimit", "dailyOutputTokenLimit",
      "promptLimit", "rateLimit", "maxDevices", "perModelPromptLimit",
    ];
    const changedLimits = limitFields.filter((f) => body[f] !== undefined && body[f] !== (key as any)[f]);
    if (changedLimits.length > 0) {
      await queueUserNotification(id, {
        type: "limits_changed",
        title: "⚙️ Limit API Key Diubah",
        message:
          `Admin mengubah konfigurasi limit untuk key **${key.name}**.\n` +
          `Field: ${changedLimits.join(", ")}.\n` +
          `Cek portal / Discord Usage untuk sisa kuota terbaru.`,
      });
    }
  }

  return c.json({ success: true, message: "API key updated" });
});

keys.delete("/keys/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const key = (await db.select().from(apiKeys).where(eq(apiKeys.id, id)))[0];
  if (!key) return c.json({ error: "API key not found" }, 404);
  if (isAdminDeleteBlocked(key)) {
    return c.json({
      error: "Cannot delete the primary Discord/trial API key. Delete secondary portal keys or override keys as needed.",
    }, 403);
  }

  // Notify before delete (queue on a sibling key if possible — sole-key delete cannot DM after row gone)
  if (key.discordUserId) {
    const siblings = await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, key.discordUserId));
    const other = siblings.find((k) => k.id !== id);
    if (other) {
      await queueUserNotification(other.id, {
        type: "key_deleted",
        title: "🗑️ API Key Dihapus",
        message: `API key **${key.name}** telah dihapus oleh admin.`,
      });
    }
  }

  try {
    // Orphan rows (no FK): per-key model limit overrides
    await db
      .delete(modelLimits)
      .where(and(eq(modelLimits.scope, "key"), eq(modelLimits.scopeId, id)));
    await db.delete(apiKeys).where(eq(apiKeys.id, id));
  } catch (err: any) {
    console.error(`[keys] delete ${id} failed:`, err?.message || err);
    return c.json({
      error: err?.message || "Failed to delete API key (database constraint).",
    }, 500);
  }
  apiKeyCache.clear();
  statsCache.invalidate("keys-list");
  statsCache.invalidate("keys-list-fast");
  statsCache.invalidate("keys-list-fast-v4");
  return c.json({ success: true, message: "API key deleted" });
});

keys.post("/keys/:id/rotate", async (c) => {
  const id = parseInt(c.req.param("id"));
  const key = (await db.select().from(apiKeys).where(eq(apiKeys.id, id)))[0];
  if (!key) return c.json({ error: "API key not found" }, 404);

  const newKey = generateApiKey();
  const endpoint = `${process.env.PROXY_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || "3000"}`}/v1`;
  await db.update(apiKeys).set({
    key: newKey, keyPrefix: getKeyPrefix(newKey), keyHash: sha256(newKey),
    updatedAt: new Date(),
  }).where(eq(apiKeys.id, id));

  if (key.discordUserId) {
    const isTrialKey = !!key.isTrial;
    await queueUserNotification(id, {
      type: isTrialKey ? "trial_key_rotated" : "key_rotated",
      title: isTrialKey ? "🔄 Trial Key Di-rotate" : "🔑 API Key Proxy Anda",
      message: isTrialKey
        ? `Admin merotasi key trial **${key.name}**.\n\n**Endpoint:** \`${endpoint}\`\n**Key baru:** \`${newKey}\``
        : formatPhantomCredentialsMessage({
            endpoint,
            apiKey: newKey,
            intro: `Admin merotasi API key **${key.name}**. Key lama sudah tidak valid. Kredensial baru:`,
          }),
      endpoint,
      newKey,
      apiKey: newKey,
    });
  }

  apiKeyCache.clear();
  statsCache.invalidate("keys-list");
  statsCache.invalidate("keys-list-fast");
  statsCache.invalidate("keys-list-fast-v4");
  return c.json({ success: true, key: newKey, keyPrefix: getKeyPrefix(newKey), message: "API key rotated." });
});

/** Reveal plaintext key for admin audit/debug (key already stored in DB). */
keys.post("/keys/:id/reveal", async (c) => {
  const id = parseInt(c.req.param("id"));
  const key = (await db.select().from(apiKeys).where(eq(apiKeys.id, id)))[0];
  if (!key) return c.json({ error: "API key not found" }, 404);
  console.log(`[admin] reveal key id=${id} name=${key.name} by admin`);
  return c.json({
    id: key.id,
    name: key.name,
    key: key.key,
    keyPrefix: key.keyPrefix,
    keyMasked: maskKey(key.key),
  });
});

/** Refresh Discord badges/tier for a user (Keys list expand / manual). */
keys.post("/keys/sync-roles", async (c) => {
  const body = await c.req.json<{ discordUserId?: string }>().catch(() => ({} as any));
  const discordUserId = String(body?.discordUserId || "").trim();
  if (!/^\d{15,25}$/.test(discordUserId)) {
    return c.json({ error: "Valid discordUserId required" }, 400);
  }
  const { syncUserKeyAccess } = await import("../../utils/key-access-lifecycle.js");
  const result = await syncUserKeyAccess(discordUserId, { reason: "admin sync-roles" });
  statsCache.invalidate("keys-list");
  statsCache.invalidate("keys-list-fast");
  statsCache.invalidate("keys-list-fast-v4");
  return c.json({ success: true, ...result });
});

/** Backfill / refresh Discord badges for all Discord-linked non-trial keys. */
keys.post("/keys/sync-all-roles", async (c) => {
  const { syncAllDiscordLinkedKeyRoles } = await import("../../utils/key-access-lifecycle.js");
  const result = await syncAllDiscordLinkedKeyRoles({
    concurrency: 2,
    reason: "admin sync-all-roles",
  });
  statsCache.invalidate("keys-list");
  statsCache.invalidate("keys-list-fast");
  statsCache.invalidate("keys-list-fast-v4");
  console.log("[admin] sync-all-roles:", result);
  return c.json({ success: true, ...result });
});

keys.get("/keys/:id/devices", async (c) => {
  const id = parseInt(c.req.param("id"));
  const allDevices = await db.select().from(devices).where(eq(devices.apiKeyId, id)).orderBy(desc(devices.lastSeen));
  return c.json(allDevices);
});

keys.post("/keys/:id/devices/:fingerprint/block", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const fingerprint = c.req.param("fingerprint");

  await db.update(devices).set({ isBlocked: true }).where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, fingerprint)));

  const existing = await db.select().from(allowedDevices)
    .where(and(eq(allowedDevices.apiKeyId, keyId), eq(allowedDevices.fingerprint, fingerprint), eq(allowedDevices.listType, "block")));
  const blockExisting = existing[0];
  if (!blockExisting) {
    await db.insert(allowedDevices).values({ apiKeyId: keyId, fingerprint, listType: "block", label: "Blocked via dashboard" });
  }
  return c.json({ success: true, message: "Device blocked" });
});

keys.post("/keys/:id/devices/:fingerprint/allow", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const fingerprint = c.req.param("fingerprint");

  await db.update(devices).set({ isBlocked: false }).where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, fingerprint)));
  await db.delete(allowedDevices).where(and(eq(allowedDevices.apiKeyId, keyId), eq(allowedDevices.fingerprint, fingerprint), eq(allowedDevices.listType, "block")));

  const existing = await db.select().from(allowedDevices)
    .where(and(eq(allowedDevices.apiKeyId, keyId), eq(allowedDevices.fingerprint, fingerprint), eq(allowedDevices.listType, "allow")));
  const allowExisting = existing[0];
  if (!allowExisting) {
    await db.insert(allowedDevices).values({ apiKeyId: keyId, fingerprint, listType: "allow", label: "Allowed via dashboard" });
  }
  return c.json({ success: true, message: "Device allowed" });
});

keys.delete("/keys/:id/devices/:fingerprint", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const fingerprint = c.req.param("fingerprint");
  await db.delete(allowedDevices).where(and(eq(allowedDevices.apiKeyId, keyId), eq(allowedDevices.fingerprint, fingerprint)));
  await db.delete(devices).where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, fingerprint)));
  return c.json({ success: true, message: "Device deleted" });
});

keys.post("/keys/:id/policies/device", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const body = await c.req.json<{
    targetType?: "fingerprint" | "ip";
    value?: string;
    listType?: "allow" | "block";
    label?: string;
  }>();

  const key = (await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)))[0];
  if (!key) return c.json({ error: "API key not found" }, 404);

  const targetType = body.targetType === "ip" ? "ip" : "fingerprint";
  const listType = body.listType === "block" ? "block" : "allow";
  const value = String(body.value || "").trim();
  const label = String(body.label || "").trim();

  if (!value) {
    return c.json({ error: "Rule value is required" }, 400);
  }

  const where = targetType === "ip"
    ? and(eq(allowedDevices.apiKeyId, keyId), eq(allowedDevices.ipAddress, value), eq(allowedDevices.listType, listType))
    : and(eq(allowedDevices.apiKeyId, keyId), eq(allowedDevices.fingerprint, value), eq(allowedDevices.listType, listType));

  const existing = (await db.select().from(allowedDevices).where(where))[0];
  if (existing) {
    return c.json({ success: true, message: "Rule already exists", id: existing.id });
  }

  const [inserted] = await db.insert(allowedDevices).values({
    apiKeyId: keyId,
    fingerprint: targetType === "fingerprint" ? value : null,
    ipAddress: targetType === "ip" ? value : null,
    listType,
    label: label || `${listType === "block" ? "Blocked" : "Allowed"} via dashboard`,
  }).returning();

  if (targetType === "fingerprint") {
    if (listType === "block") {
      await db.update(devices)
        .set({ isBlocked: true })
        .where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, value)));
    } else {
      await db.update(devices)
        .set({ isBlocked: false })
        .where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, value)));
    }
  }

  return c.json({ success: true, id: inserted.id, message: "Rule added" }, 201);
});

keys.delete("/keys/:id/policies/device/:ruleId", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const ruleId = parseInt(c.req.param("ruleId"));

  const existing = (await db.select().from(allowedDevices)
    .where(and(eq(allowedDevices.id, ruleId), eq(allowedDevices.apiKeyId, keyId))))[0];

  if (!existing) return c.json({ error: "Rule not found" }, 404);

  await db.delete(allowedDevices)
    .where(and(eq(allowedDevices.id, ruleId), eq(allowedDevices.apiKeyId, keyId)));

  if (existing.fingerprint && existing.listType === "block") {
    await db.update(devices)
      .set({ isBlocked: false })
      .where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, existing.fingerprint)));
  }

  return c.json({ success: true, message: "Rule removed" });
});

keys.post("/keys/:id/policies/ide", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const body = await c.req.json<{ ideName?: string; listType?: "allow" | "block" }>();
  const key = (await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)))[0];
  if (!key) return c.json({ error: "API key not found" }, 404);

  const ideName = normalizeIdeName(body.ideName || "");
  const listType = body.listType === "block" ? "block" : "allow";

  if (!ideName || ideName === "unknown") {
    return c.json({ error: "Valid IDE name is required" }, 400);
  }

  const existing = (await db.select().from(allowedIdes)
    .where(and(eq(allowedIdes.apiKeyId, keyId), eq(allowedIdes.ideName, ideName), eq(allowedIdes.listType, listType))))[0];

  if (existing) {
    return c.json({ success: true, message: "IDE rule already exists", id: existing.id });
  }

  const [inserted] = await db.insert(allowedIdes).values({ apiKeyId: keyId, ideName, listType }).returning();
  return c.json({ success: true, id: inserted.id, message: "IDE rule added" }, 201);
});

keys.delete("/keys/:id/policies/ide/:ruleId", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const ruleId = parseInt(c.req.param("ruleId"));

  const existing = (await db.select().from(allowedIdes)
    .where(and(eq(allowedIdes.id, ruleId), eq(allowedIdes.apiKeyId, keyId))))[0];

  if (!existing) return c.json({ error: "IDE rule not found" }, 404);

  await db.delete(allowedIdes)
    .where(and(eq(allowedIdes.id, ruleId), eq(allowedIdes.apiKeyId, keyId)));

  return c.json({ success: true, message: "IDE rule removed" });
});

// ─── Per-Key Model Limits CRUD ─────────────────────────────────────────────────

keys.get("/keys/:id/model-limits", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const rows = await db.select().from(modelLimits)
    .where(and(eq(modelLimits.scope, "key"), eq(modelLimits.scopeId, keyId)));
  const data = await enrichModelLimitsWithCatalog(rows);
  return c.json({ data });
});

keys.put("/keys/:id/model-limits", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const body = await c.req.json<{
    model: string;
    promptLimit?: number;
    dailyTokenLimit?: number;
    monthlyTokenLimit?: number;
    dailyInputTokenLimit?: number;
    dailyOutputTokenLimit?: number;
    isPattern?: boolean;
    dedicatedQuota?: boolean;
  }>();
  if (!body.model || body.model.trim() === "") return c.json({ error: "model is required" }, 400);
  const modelName = body.model.trim();
  const isPattern = !!body.isPattern;
  const dedicatedQuota = !!body.dedicatedQuota;
  const limit = Math.max(0, body.promptLimit || 0);
  const dailyTokenLimit = Math.max(0, body.dailyTokenLimit || 0);
  const monthlyTokenLimit = Math.max(0, body.monthlyTokenLimit || 0);
  const dailyInputTokenLimit = Math.max(0, body.dailyInputTokenLimit || 0);
  const dailyOutputTokenLimit = Math.max(0, body.dailyOutputTokenLimit || 0);

  if (dedicatedQuota && dailyTokenLimit <= 0) {
    return c.json({ error: "dedicatedQuota requires dailyTokenLimit > 0" }, 400);
  }

  // Upsert (key + model + isPattern). UPDATE preserves prompt_window_start.
  const { pool } = await import("../../db/index.js");
  const existing = await pool.query(
    `SELECT id FROM model_limits
     WHERE scope = $1 AND scope_id = $2 AND model = $3 AND is_pattern = $4 LIMIT 1`,
    ["key", keyId, modelName, isPattern],
  );

  if (limit > 0 || dailyTokenLimit > 0 || monthlyTokenLimit > 0 || dailyInputTokenLimit > 0 || dailyOutputTokenLimit > 0) {
    if (existing.rows[0]?.id) {
      await pool.query(
        `UPDATE model_limits SET
           prompt_limit = $1,
           daily_token_limit = $2,
           monthly_token_limit = $3,
           daily_input_token_limit = $4,
           daily_output_token_limit = $5,
           dedicated_quota = $6
         WHERE id = $7`,
        [limit, dailyTokenLimit, monthlyTokenLimit, dailyInputTokenLimit, dailyOutputTokenLimit, dedicatedQuota, existing.rows[0].id],
      );
    } else {
      await db.insert(modelLimits).values({
        scope: "key", scopeId: keyId, model: modelName, isPattern,
        promptLimit: limit,
        dailyTokenLimit,
        monthlyTokenLimit,
        dailyInputTokenLimit,
        dailyOutputTokenLimit,
        dedicatedQuota,
      });
    }
  } else if (existing.rows[0]?.id) {
    await pool.query(`DELETE FROM model_limits WHERE id = $1`, [existing.rows[0].id]);
  }

  return c.json({
    success: true, model: modelName, isPattern, dedicatedQuota,
    promptLimit: limit, dailyTokenLimit, monthlyTokenLimit, dailyInputTokenLimit, dailyOutputTokenLimit,
  });
});

// GET /keys/:id/model-catalog/match?pattern=X
keys.get("/keys/:id/model-catalog/match", async (c) => {
  const pattern = (c.req.query("pattern") || "").toLowerCase().trim();
  try {
    const catalog = await getModelCatalogResponse();
    const all: Array<{ id: string }> = (catalog as any)?.data || [];
    const matched = pattern
      ? all.filter(m => (m.id || "").toLowerCase().includes(pattern))
      : all;
    return c.json({ data: matched.map(m => m.id), total: matched.length, totalAll: all.length });
  } catch (err: any) {
    return c.json({ data: [], total: 0, totalAll: 0, error: err?.message || "catalog error" }, 200);
  }
});

keys.delete("/keys/:id/model-limits/:model", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  const model = decodeURIComponent(c.req.param("model"));
  const isPatternRaw = c.req.query("isPattern");
  const { pool } = await import("../../db/index.js");
  if (isPatternRaw === "true" || isPatternRaw === "false") {
    await pool.query(
      `DELETE FROM model_limits WHERE scope = $1 AND scope_id = $2 AND model = $3 AND is_pattern = $4`,
      ["key", keyId, model, isPatternRaw === "true"],
    );
  } else {
    await db.delete(modelLimits).where(and(
      eq(modelLimits.scope, "key"),
      eq(modelLimits.scopeId, keyId),
      eq(modelLimits.model, model),
    ));
  }
  return c.json({ success: true, message: `Model limit for "${model}" removed` });
});

// ─── Calendar-day override (WIB) + reset today's usage ─────────────────────────

keys.get("/keys/:id/day-override", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  if (!Number.isFinite(keyId)) return c.json({ error: "Invalid key id" }, 400);
  const [key] = await db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.id, keyId));
  if (!key) return c.json({ error: "Key not found" }, 404);

  const dayParam = c.req.query("day") || wibTodayDateString();
  if (!isValidDayWib(dayParam)) return c.json({ error: "Invalid day (use YYYY-MM-DD)" }, 400);

  const row = await getKeyDayOverride(keyId, dayParam);
  return c.json({
    dayWib: dayParam,
    todayWib: wibTodayDateString(),
    override: row
      ? {
          extraDailyInput: row.extraDailyInput || 0,
          extraDailyOutput: row.extraDailyOutput || 0,
          extraDailyTotal: row.extraDailyTotal || 0,
          extraPromptLimit: row.extraPromptLimit || 0,
          extraRateLimit: row.extraRateLimit || 0,
          note: row.note || "",
          updatedAt: row.updatedAt,
        }
      : null,
  });
});

keys.put("/keys/:id/day-override", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  if (!Number.isFinite(keyId)) return c.json({ error: "Invalid key id" }, 400);
  const [key] = await db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.id, keyId));
  if (!key) return c.json({ error: "Key not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const dayWib = typeof body.dayWib === "string" && body.dayWib ? body.dayWib : wibTodayDateString();
  if (!isValidDayWib(dayWib)) return c.json({ error: "Invalid dayWib (use YYYY-MM-DD)" }, 400);

  const bonuses = normalizeDayBonuses(body);
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
  const now = new Date();

  if (!dayOverrideHasAny(bonuses) && !note) {
    await db
      .delete(keyDayOverrides)
      .where(and(eq(keyDayOverrides.apiKeyId, keyId), eq(keyDayOverrides.dayWib, dayWib)));
    statsCache.invalidate("keys-list");
    statsCache.invalidate("keys-list-fast");
    statsCache.invalidate("keys-list-fast-v4");
    return c.json({ success: true, cleared: true, dayWib, override: null });
  }

  const existing = await getKeyDayOverride(keyId, dayWib);
  if (existing) {
    await db
      .update(keyDayOverrides)
      .set({ ...bonuses, note, updatedAt: now })
      .where(eq(keyDayOverrides.id, existing.id));
  } else {
    await db.insert(keyDayOverrides).values({
      apiKeyId: keyId,
      dayWib,
      ...bonuses,
      note,
      createdAt: now,
      updatedAt: now,
    });
  }

  const saved = await getKeyDayOverride(keyId, dayWib);
  statsCache.invalidate("keys-list");
  statsCache.invalidate("keys-list-fast");
  statsCache.invalidate("keys-list-fast-v4");

  const [fullKey] = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1);
  if (fullKey?.discordUserId && dayOverrideHasAny(bonuses)) {
    await queueUserNotification(keyId, {
      type: "limits_changed",
      title: "⚙️ Day Override Ditetapkan",
      message:
        `Admin menambah kuota harian untuk **${fullKey.name}** (hari ${dayWib} WIB).\n` +
        `Cek portal / Discord Usage untuk sisa kuota terbaru.`,
    });
  }

  return c.json({
    success: true,
    dayWib,
    override: saved
      ? {
          extraDailyInput: saved.extraDailyInput || 0,
          extraDailyOutput: saved.extraDailyOutput || 0,
          extraDailyTotal: saved.extraDailyTotal || 0,
          extraPromptLimit: saved.extraPromptLimit || 0,
          extraRateLimit: saved.extraRateLimit || 0,
          note: saved.note || "",
          updatedAt: saved.updatedAt,
        }
      : null,
  });
});

keys.delete("/keys/:id/day-override", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  if (!Number.isFinite(keyId)) return c.json({ error: "Invalid key id" }, 400);
  const dayParam = c.req.query("day") || wibTodayDateString();
  if (!isValidDayWib(dayParam)) return c.json({ error: "Invalid day" }, 400);

  await db
    .delete(keyDayOverrides)
    .where(and(eq(keyDayOverrides.apiKeyId, keyId), eq(keyDayOverrides.dayWib, dayParam)));
  statsCache.invalidate("keys-list");
  statsCache.invalidate("keys-list-fast");
  statsCache.invalidate("keys-list-fast-v4");
  return c.json({ success: true, dayWib: dayParam });
});

keys.post("/keys/:id/reset-today-usage", async (c) => {
  const keyId = parseInt(c.req.param("id"));
  if (!Number.isFinite(keyId)) return c.json({ error: "Invalid key id" }, 400);
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId));
  if (!key) return c.json({ error: "Key not found" }, 404);

  const dayWib = wibTodayDateString();
  const dayStart = wibDayStartUtc(dayWib);
  const { keyIds } = await resolveAccountKeyScope(key);

  const deleted = await db
    .delete(requestLogs)
    .where(and(inArray(requestLogs.apiKeyId, keyIds), sql`created_at >= ${dayStart}`))
    .returning({ id: requestLogs.id });

  if (key.discordUserId) {
    await queueUserNotification(keyId, {
      type: "usage_reset",
      title: "🔄 Usage Hari Ini Di-reset",
      message:
        `Admin mereset usage hari ini (${dayWib} WIB) untuk akun Anda.\n` +
        `${deleted.length} log dihapus. Kuota harian dihitung ulang dari nol.`,
    });
  }

  statsCache.invalidate("keys-list");
  statsCache.invalidate("keys-list-fast");
  statsCache.invalidate("keys-list-fast-v4");
  return c.json({
    success: true,
    dayWib,
    dayStart: dayStart.toISOString(),
    keyIds,
    deletedRows: deleted.length,
    message: `Reset ${deleted.length} log row(s) for ${dayWib} WIB across ${keyIds.length} key(s)`,
  });
});

export default keys;