import { Hono } from "hono";
import { db } from "../../db/index.js";
import {
  apiKeys, requestLogs, devices, allowedDevices, allowedIdes,
  chatSessions, userPortalSettings, trialUsers, adminConfig, modelMonitor, modelLimits,
} from "../../db/schema.js";
import { eq, sql, and, desc } from "drizzle-orm";
import { generateApiKey, getKeyPrefix, sha256, maskKey } from "../../utils/crypto.js";
import { createPortalSession, destroyPortalSession, getPortalDiscordUserId, isPortalAuthenticated } from "../../middleware/portal-session.js";
import { resolvePeriodRange, chartDaysForPeriod, type PeriodKey, turnCountSql, turnPromptTokensSql, turnCompletionTokensSql, turnTotalTokensSql, turnBillablePromptTokensSql, turnCachedTokensSql, sanitizeRows, groupedInputSumSql } from "../../utils/counting.js";
import { getTokenMultipliers } from "../../utils/token-multiplier.js";
import { getModelRates } from "../../utils/cost-calculator.js";
import { getRecapWindow } from "../../utils/recap-window.js";
import { getModelCatalogResponse, getClientCatalogMonitorRows } from "../../utils/model-catalog.js";
import { parseTrialModelWhitelist, resolveKeyDailyTokenLimit, resolveKeyPromptLimit, resolveKeyApiCallLimit } from "../../utils/trial-config.js";
import { checkPromptLimit, checkModelPromptLimit, checkApiCallLimit, parseRateLimitWindow, getWindowResetMs, getApiCallWindowResetMs } from "../../utils/rate-limit.js";
import { logEmitter } from "../../utils/event-emitter.js";
import { randomBytes } from "crypto";
import { isProtectedPrimaryApiKey } from "../../utils/api-key-primary.js";

const portal = new Hono();

// Simple login rate limit: IP -> { count, resetAt }
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const row = loginAttempts.get(ip);
  if (!row || now > row.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (row.count >= LOGIN_MAX) return false;
  row.count += 1;
  return true;
}

async function fireUserWebhook(
  discordUserId: string,
  event: string,
  payload: Record<string, unknown>,
) {
  try {
    const settings = (await db.select().from(userPortalSettings)
      .where(eq(userPortalSettings.discordUserId, discordUserId)))[0];
    if (!settings?.webhookUrl) return;
    const body = JSON.stringify({
      event,
      discordUserId,
      at: new Date().toISOString(),
      ...payload,
    });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (settings.webhookSecret) {
      headers["X-Tokito-Signature"] = settings.webhookSecret;
    }
    void fetch(settings.webhookUrl, { method: "POST", headers, body }).catch(() => {});
  } catch {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wibTodayStartDate(): Date {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffset);
  wibNow.setUTCHours(0, 0, 0, 0);
  return new Date(wibNow.getTime() - wibOffset);
}

function userApiKeyIds(discordUserId: string) {
  return sql`SELECT id FROM api_keys WHERE discord_user_id = ${discordUserId}`;
}

function userWhere(discordUserId: string) {
  return sql`api_key_id IN (${userApiKeyIds(discordUserId)})`;
}

function periodWhere(discordUserId: string, period: PeriodKey) {
  const range = resolvePeriodRange(period);
  return and(
    userWhere(discordUserId),
    sql`created_at >= ${range.start}`,
    range.end ? sql`created_at <= ${range.end}` : sql`1=1`,
    sql`status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL`,
  );
}

function periodWhereNoTurn(discordUserId: string, period: PeriodKey) {
  const range = resolvePeriodRange(period);
  return and(
    userWhere(discordUserId),
    sql`created_at >= ${range.start}`,
    range.end ? sql`created_at <= ${range.end}` : sql`1=1`,
  );
}

/** Returns true when the user has NO active non-trial key (trial-only account). */
async function isTrialAccount(discordUserId: string): Promise<boolean> {
  const rows = await db.select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(
      eq(apiKeys.discordUserId, discordUserId),
      eq(apiKeys.isActive, true),
      eq(apiKeys.isTrial, false),
    ))
    .limit(1);
  return rows.length === 0;
}

function maskWebhookUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/***`;
  } catch {
    return `${url.substring(0, 20)}***`;
  }
}

function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

function sanitizeErrorMsg(msg: string | null | undefined): string {
  if (!msg) return "";
  return msg
    .replace(/sk-[A-Za-z0-9_\-]{6,}/g, "sk-***")
    .replace(/Bearer\s+\S{6,}/g, "Bearer ***");
}

function sanitizePreview(text: string | null | undefined, maxLen = 2500): string {
  if (!text) return "";
  const cleaned = sanitizeErrorMsg(text);
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + "…" : cleaned;
}

function minutesAgo(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

portal.post("/auth/login", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkLoginRateLimit(ip)) {
    return c.json({ error: "Too many login attempts. Try again later." }, 429);
  }

  const { apiKey } = await c.req.json<{ apiKey: string }>();
  if (!apiKey) return c.json({ error: "API key required" }, 400);

  let key = (await db.select().from(apiKeys).where(eq(apiKeys.key, apiKey)))[0];
  if (!key) {
    const keyHash = sha256(apiKey);
    key = (await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)))[0];
  }
  if (!key) return c.json({ error: "Invalid API key" }, 401);
  if (!key.isActive) return c.json({ error: "API key is not active" }, 403);
  if (!key.discordUserId) return c.json({ error: "API key not linked to a Discord user" }, 403);

  const discordUserId = key.discordUserId;
  const settings = (await db.select().from(userPortalSettings).where(eq(userPortalSettings.discordUserId, discordUserId)))[0];

  if (settings?.passwordHash) {
    return c.json({ requiresPassword: true, discordUserId });
  }

  createPortalSession(c, discordUserId);

  // Update lastLoginAt
  if (settings) {
    await db.update(userPortalSettings)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(userPortalSettings.discordUserId, discordUserId));
  } else {
    await db.insert(userPortalSettings).values({ discordUserId, lastLoginAt: new Date() });
  }

  return c.json({ success: true, autoLogin: true, discordUserId });
});

portal.post("/auth/verify-password", async (c) => {
  const { discordUserId, password } = await c.req.json<{ discordUserId: string; password: string }>();
  if (!discordUserId || !password) return c.json({ error: "Missing fields" }, 400);

  const settings = (await db.select().from(userPortalSettings).where(eq(userPortalSettings.discordUserId, discordUserId)))[0];
  if (!settings?.passwordHash) return c.json({ error: "No password set" }, 400);

  const { verify } = await import("@node-rs/argon2");
  const isValid = await verify(settings.passwordHash, password);
  if (!isValid) return c.json({ error: "Invalid password" }, 401);

  createPortalSession(c, discordUserId);
  await db.update(userPortalSettings)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(userPortalSettings.discordUserId, discordUserId));
  return c.json({ success: true });
});

portal.post("/auth/logout", (c) => {
  destroyPortalSession(c);
  return c.json({ success: true });
});

// ─── Auth middleware ───────────────────────────────────────────────────────────
portal.use("/*", async (c, next) => {
  const path = c.req.path;
  if (path === "/auth/login" || path === "/auth/verify-password") {
    return next();
  }
  if (!isPortalAuthenticated(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

// ─── Me ───────────────────────────────────────────────────────────────────────

portal.get("/me", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const [userKeys, settings] = await Promise.all([
    db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId)),
    db.select().from(userPortalSettings).where(eq(userPortalSettings.discordUserId, discordUserId)).then(r => r[0] ?? null),
  ]);

  const isTrial = await isTrialAccount(discordUserId);
  const primaryKey = userKeys.find(k => !k.isTrial && k.isActive) || userKeys.find(k => k.isActive) || userKeys[0];
  const config = (await db.select().from(adminConfig).limit(1))[0] ?? null;

  const { getActiveAddonsForUser, sumAddonDailyTokenBonus, parseModelDailyLimits, resolveAddonQuotaStack } = await import("../../utils/addons.js");
  const activeAddons = !isTrial && primaryKey
    ? await getActiveAddonsForUser({
        discordUserId,
        apiKeyId: primaryKey.id,
      })
    : [];
  const addonDailyBonus = sumAddonDailyTokenBonus(activeAddons);

  // Today's usage (WIB) — same token aggregation as Discord usage embed
  const todayStart = wibTodayStartDate();
  const todayPw = and(
    userWhere(discordUserId),
    sql`created_at >= ${todayStart}`,
    sql`status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL`,
  );
  const usageToday = (await db.select({
    requests: turnCountSql(todayPw!),
    promptTokens: turnPromptTokensSql(todayPw!, { isTrial }),
    billablePromptTokens: turnBillablePromptTokensSql(todayPw!, { isTrial }),
    cachedTokens: turnCachedTokensSql(todayPw!, { isTrial }),
    completionTokens: turnCompletionTokensSql(todayPw!, { isTrial }),
  }).from(requestLogs).where(todayPw))[0];

  // This month usage (for monthly limit bar)
  const monthRange = resolvePeriodRange("thisMonth");
  const monthPw = and(
    userWhere(discordUserId),
    sql`created_at >= ${monthRange.start}`,
    sql`status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL`,
  );
  const usageMonth = (await db.select({
    tokens: turnTotalTokensSql(monthPw!, { isTrial }),
  }).from(requestLogs).where(monthPw))[0];

  const { limit: promptLimit, window: promptLimitWindow } = primaryKey
    ? resolveKeyPromptLimit(primaryKey as any, config)
    : { limit: 0, window: "1d" };
  const baseDailyTokenLimit = primaryKey
    ? resolveKeyDailyTokenLimit(primaryKey as any, config)
    : 0;
  // Prompt used = shared across all Discord account keys
  let promptUsed = 0;
  let promptResetAt: string | null = null;
  let promptResetMins = 0;
  const accountKeyIds = userKeys.map((k) => k.id);
  const windowKeyId = primaryKey?.id ?? accountKeyIds[0];
  const promptScopeIds = windowKeyId
    ? [windowKeyId, ...accountKeyIds.filter((id) => id !== windowKeyId)]
    : accountKeyIds;
  if (primaryKey && promptLimit > 0 && promptScopeIds.length > 0) {
    const plCheck = await checkPromptLimit(promptScopeIds, promptLimit, promptLimitWindow);
    promptUsed = plCheck.used;
    const windowMs = parseRateLimitWindow(promptLimitWindow);
    const resetMs = await getWindowResetMs(promptScopeIds, windowMs);
    promptResetMins = Math.ceil(resetMs / 60000);
    promptResetAt = resetMs > 0 ? new Date(Date.now() + resetMs).toISOString() : null;
  }

  const { limit: apiCallLimit, window: apiCallLimitWindow } = primaryKey
    ? resolveKeyApiCallLimit(primaryKey as any, config)
    : { limit: 0, window: "5h" };
  let apiCallUsed = 0;
  let apiCallResetAt: string | null = null;
  let apiCallResetMins = 0;
  if (primaryKey && apiCallLimit > 0 && promptScopeIds.length > 0) {
    const acCheck = await checkApiCallLimit(promptScopeIds, apiCallLimit, apiCallLimitWindow);
    apiCallUsed = acCheck.used;
    const windowMs = parseRateLimitWindow(apiCallLimitWindow);
    const resetMs = await getApiCallWindowResetMs(promptScopeIds, windowMs);
    apiCallResetMins = Math.ceil(resetMs / 60000);
    apiCallResetAt = resetMs > 0 ? new Date(Date.now() + resetMs).toISOString() : null;
  }

  // Per-model prompt usage (same as Discord /usage) — account-scoped
  const modelUsageLimits: Array<{
    model: string; used: number; limit: number; window: string; resetAt: string | null;
  }> = [];
  if (primaryKey && !isTrial && promptScopeIds.length > 0 && activeAddons.length === 0) {
    const todayModels = sanitizeRows((await db.execute(sql`
      SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model,
        COUNT(DISTINCT turn_id)::int as requests
      FROM request_logs
      WHERE api_key_id IN (${sql.join(promptScopeIds.map((id) => sql`${id}`), sql`, `)})
        AND created_at >= ${todayStart}
        AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY 1
      ORDER BY requests DESC
      LIMIT 15
    `)).rows as any[], ["requests"]);

    const perKeyDefault = primaryKey.perModelPromptLimit || 0;
    const perKeyWindow = primaryKey.perModelPromptLimitWindow || null;
    const globalPerModel = config?.globalPerModelPromptLimit || 0;
    const globalPerModelWindow = config?.globalPerModelPromptLimitWindow || "30m";

    for (const tm of todayModels) {
      if (!tm.model) continue;
      const mlCheck = await checkModelPromptLimit(
        promptScopeIds,
        tm.model,
        perKeyDefault,
        perKeyWindow,
        globalPerModel,
        globalPerModelWindow,
      );
      const windowStr = perKeyWindow || globalPerModelWindow;
      const windowMs = parseRateLimitWindow(windowStr);
      const resetMs = await getWindowResetMs(promptScopeIds, windowMs, tm.model);
      if (mlCheck.used > 0 || mlCheck.effectiveLimit > 0) {
        modelUsageLimits.push({
          model: tm.model,
          used: mlCheck.used,
          limit: mlCheck.effectiveLimit,
          window: windowStr,
          resetAt: resetMs > 0 ? new Date(Date.now() + resetMs).toISOString() : null,
        });
      }
    }

    // Include configured global model limits even if unused today
    const activeModelLimits = await db.select().from(modelLimits).where(eq(modelLimits.scope, "global"));
    for (const am of activeModelLimits) {
      if (!modelUsageLimits.find((m) => m.model === am.model) && (am.promptLimit || 0) > 0) {
        modelUsageLimits.push({
          model: am.model,
          used: 0,
          limit: am.promptLimit || 0,
          window: perKeyWindow || globalPerModelWindow,
          resetAt: null,
        });
      }
    }
  }

  const pickLimit = (keyVal: number | null | undefined, globalVal: number | null | undefined) => {
    const k = Number(keyVal) || 0;
    const g = Number(globalVal) || 0;
    if (k > 0) return { value: k, source: "override" as const };
    if (g > 0) return { value: g, source: "global" as const };
    return { value: 0, source: "none" as const };
  };

  const rawDailyInput = pickLimit(primaryKey?.dailyInputTokenLimit, config?.globalDailyInputTokenLimit);
  const rawDailyOutput = pickLimit(primaryKey?.dailyOutputTokenLimit, config?.globalDailyOutputTokenLimit);
  const quotaStack = resolveAddonQuotaStack({
    hasActiveAddon: activeAddons.length > 0,
    keyOrGlobalDaily: baseDailyTokenLimit,
    dailyInput: rawDailyInput.value,
    dailyOutput: rawDailyOutput.value,
    addonDailyBonus,
  });
  const dailyInput = quotaStack.bypassIo
    ? {
        value: quotaStack.inputBase > 0 ? quotaStack.inputBase : rawDailyInput.value,
        source: (rawDailyInput.source === "none" && quotaStack.inputBase > 0
          ? "global"
          : rawDailyInput.source) as "override" | "global" | "none",
      }
    : rawDailyInput;
  const dailyOutput = quotaStack.bypassIo
    ? {
        value: quotaStack.outputBase > 0 ? quotaStack.outputBase : rawDailyOutput.value,
        source: (rawDailyOutput.source === "none" && quotaStack.outputBase > 0
          ? "global"
          : rawDailyOutput.source) as "override" | "global" | "none",
      }
    : rawDailyOutput;
  const dailyTokenLimit = quotaStack.effectiveDaily;
  // Match Discord: key override OR global monthly
  const monthly = pickLimit(primaryKey?.monthlyTokenLimit, config?.globalMonthlyTokenLimit);
  const rate = pickLimit(primaryKey?.rateLimit, config?.globalRateLimit);
  const dailyTok = dailyTokenLimit > 0
    ? {
        value: dailyTokenLimit,
        source: (quotaStack.addonBonus > 0
          ? "override"
          : Number(primaryKey?.dailyTokenLimit) > 0
            ? "override"
            : "global") as "override" | "global" | "none",
      }
    : { value: 0, source: "none" as const };
  const prompt = promptLimit > 0
    ? { value: promptLimit, source: (Number(primaryKey?.promptLimit) > 0 ? "override" : "global") as "override" | "global" | "none" }
    : { value: 0, source: "none" as const };

  // Daily / monthly reset timestamps (WIB midnight), same as Discord usage embed
  const wibOffset = 7 * 60 * 60 * 1000;
  const wibNow = new Date(Date.now() + wibOffset);
  const tomorrowWib = new Date(wibNow);
  tomorrowWib.setUTCDate(tomorrowWib.getUTCDate() + 1);
  tomorrowWib.setUTCHours(0, 0, 0, 0);
  const dailyResetAt = new Date(tomorrowWib.getTime() - wibOffset).toISOString();
  const nextMonthWib = new Date(wibNow);
  nextMonthWib.setUTCMonth(nextMonthWib.getUTCMonth() + 1);
  nextMonthWib.setUTCDate(1);
  nextMonthWib.setUTCHours(0, 0, 0, 0);
  const monthlyResetAt = new Date(nextMonthWib.getTime() - wibOffset).toISOString();

  // Trial expiry date
  let trialExpiresAt: string | null = null;
  if (isTrial && primaryKey) {
    const trialRow = (await db.select({ expiresAt: trialUsers.expiresAt })
      .from(trialUsers)
      .where(eq(trialUsers.apiKeyId, primaryKey.id))
      .limit(1))[0];
    if (trialRow) trialExpiresAt = trialRow.expiresAt?.toISOString() ?? null;
  }

  // Pending notifications from all keys
  const pendingNotifications: any[] = [];
  for (const k of userKeys) {
    if (k.pendingNotification) {
      try {
        const parsed = JSON.parse(k.pendingNotification);
        if (Array.isArray(parsed)) pendingNotifications.push(...parsed);
        else if (parsed && typeof parsed === "object") pendingNotifications.push(parsed);
      } catch { /* ignore */ }
    }
  }

  return c.json({
    discordUserId,
    discordUsername: primaryKey?.discordUsername ?? null,
    accountType: isTrial ? "trial" : "phantom",
    trialExpiresAt,
    hasPassword: !!settings?.passwordHash,
    webhookUrl: settings?.webhookUrl ? maskWebhookUrl(settings.webhookUrl) : null,
    hasWebhook: !!(settings?.webhookUrl),
    lastLoginAt: settings?.lastLoginAt ?? null,
    keyCount: userKeys.length,
    primaryKeyName: primaryKey?.name ?? null,
    keys: userKeys.map(k => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      isActive: k.isActive,
      isTrial: k.isTrial || false,
      createdAt: k.createdAt,
    })),
    limits: {
      dailyTokenLimit: dailyTok.value,
      dailyTokenLimitSource: dailyTok.source,
      monthlyTokenLimit: monthly.value,
      monthlyTokenLimitSource: monthly.source,
      dailyInputTokenLimit: dailyInput.value,
      dailyInputTokenLimitSource: dailyInput.source,
      dailyOutputTokenLimit: dailyOutput.value,
      dailyOutputTokenLimitSource: dailyOutput.source,
      rateLimit: rate.value,
      rateLimitWindow: primaryKey?.rateLimitWindow || config?.globalRateLimitWindow || apiCallLimitWindow || "5h",
      rateLimitSource: rate.source,
      promptLimit: prompt.value,
      promptLimitWindow,
      promptLimitSource: prompt.source,
      perModelPromptLimit: isTrial ? 0 : ((primaryKey?.perModelPromptLimit && primaryKey.perModelPromptLimit > 0)
        ? primaryKey.perModelPromptLimit
        : (config?.globalPerModelPromptLimit || 0)),
      perModelPromptLimitWindow: primaryKey?.perModelPromptLimitWindow || config?.globalPerModelPromptLimitWindow || "5h",
    },
    usageToday: {
      requests: usageToday?.requests || 0,
      promptTokens: usageToday?.promptTokens || 0,
      billablePromptTokens: usageToday?.billablePromptTokens || 0,
      cachedTokens: usageToday?.cachedTokens || 0,
      completionTokens: usageToday?.completionTokens || 0,
      // Rolling prompt window usage (matches Discord), NOT all-day requests
      promptCount: promptUsed,
      apiCallCount: apiCallUsed,
      totalTokens: (usageToday?.promptTokens || 0) + (usageToday?.completionTokens || 0),
    },
    usageMonth: {
      totalTokens: usageMonth?.tokens || 0,
    },
    promptResetAt,
    promptResetMins,
    apiCallResetAt,
    apiCallResetMins,
    dailyResetAt,
    monthlyResetAt,
    modelUsageLimits,
    dailyTokenBreakdown: {
      base: quotaStack.baseDaily,
      addonBonus: quotaStack.addonBonus,
      effective: quotaStack.effectiveDaily,
      bypassIo: quotaStack.bypassIo,
      inputBase: quotaStack.inputBase,
      outputBase: quotaStack.outputBase,
    },
    activeAddons: activeAddons.map((a) => ({
      name: a.name,
      expiresAt: a.expiresAt ? new Date(a.expiresAt).toISOString() : null,
      dailyTokenLimit: a.dailyTokenLimit || 0,
    })),
    addonModelTokenCaps: (() => {
      const out: Array<{ pattern: string; dailyLimit: number }> = [];
      const seen = new Set<string>();
      for (const a of activeAddons) {
        for (const [pattern, dailyLimit] of Object.entries(parseModelDailyLimits(a.modelDailyLimits))) {
          const key = `${pattern}:${dailyLimit}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ pattern, dailyLimit });
        }
      }
      return out;
    })(),
    perModelPromptsBypassedByAddon: quotaStack.bypassPerModelPrompts,
    pendingNotifications,
    tokenSaver: {
      global: {
        rtk: config?.tokenSaverRtkEnabled ?? true,
        rtkMaxChars: config?.tokenSaverRtkMaxChars ?? 2000,
        headroom: config?.tokenSaverHeadroomEnabled ?? false,
        caveman: config?.tokenSaverCavemanEnabled ?? false,
        cavemanLevel: config?.tokenSaverCavemanLevel ?? 2,
        ponytail: config?.tokenSaverPonytailEnabled ?? false,
        ponytailLevel: config?.tokenSaverPonytailLevel || "lite",
      },
      overrides: {
        rtk: settings?.tokenSaverRtkOverride ?? null,
        headroom: settings?.tokenSaverHeadroomOverride ?? null,
        caveman: settings?.tokenSaverCavemanOverride ?? null,
        ponytail: settings?.tokenSaverPonytailOverride ?? null,
      },
    },
  });
});

// ─── Stats ────────────────────────────────────────────────────────────────────

portal.get("/stats/overview", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const period = (c.req.query("period") || "today") as PeriodKey;
  const pw = periodWhere(discordUserId, period);
  const isTrial = await isTrialAccount(discordUserId);

  const stats = (await db.select({
    requests: turnCountSql(pw),
    tokens: turnTotalTokensSql(pw, { isTrial }),
    promptTokens: turnPromptTokensSql(pw, { isTrial }),
    billablePromptTokens: turnBillablePromptTokensSql(pw, { isTrial }),
    cachedTokens: turnCachedTokensSql(pw, { isTrial }),
    completionTokens: turnCompletionTokensSql(pw, { isTrial }),
  }).from(requestLogs).where(pw))[0];

  const sessionWhere = userWhere(discordUserId);
  const sessionCount = (await db.select({ count: sql<number>`count(*)` }).from(chatSessions).where(sessionWhere))[0];
  const toolCount = (await db.select({ count: sql<number>`COALESCE(SUM(tool_count), 0)` }).from(requestLogs).where(pw))[0];

  // Cost breakdown by model
  const range = resolvePeriodRange(period);
  const breakdownRows = sanitizeRows((await db.execute(sql`
    SELECT model,
      COALESCE(SUM(sum_delta), 0) as "promptTokens",
      COALESCE(SUM(sum_c), 0) as "completionTokens"
    FROM (
      SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model, turn_id,
        ${sql.raw(groupedInputSumSql())} as sum_delta,
        SUM(completion_tokens) as sum_c
      FROM request_logs
      WHERE api_key_id IN (${userApiKeyIds(discordUserId)})
        AND created_at >= ${range.start}
        ${range.end ? sql`AND created_at <= ${range.end}` : sql``}
        AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY model, turn_id
    ) sub
    GROUP BY model
  `)).rows as any[], ["promptTokens", "completionTokens"]);

  const { input, output } = getTokenMultipliers({ isTrial });
  let promptCost = 0;
  let completionCost = 0;
  for (const row of breakdownRows) {
    const rates = getModelRates(row.model || "");
    promptCost += Math.round(row.promptTokens * input * rates.prompt);
    completionCost += Math.round(row.completionTokens * output * rates.completion);
  }

  return c.json({
    requests: stats?.requests || 0,
    tokens: stats?.tokens || 0,
    promptTokens: stats?.promptTokens || 0,
    billablePromptTokens: stats?.billablePromptTokens || 0,
    cachedTokens: stats?.cachedTokens || 0,
    completionTokens: stats?.completionTokens || 0,
    sessions: Number(sessionCount?.count) || 0,
    toolCalls: Number(toolCount?.count) || 0,
    cost: { prompt: promptCost, completion: completionCost, total: promptCost + completionCost },
  });
});

portal.get("/stats/timeseries", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const period = (c.req.query("period") || "7d") as PeriodKey;
  const range = resolvePeriodRange(period);
  const days = chartDaysForPeriod(period);
  const isTrial = await isTrialAccount(discordUserId);
  const { input, output } = getTokenMultipliers({ isTrial });

  const groupExpr = days <= 1
    ? sql`to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:00')`
    : sql`to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`;

  const rows = sanitizeRows((await db.execute(sql`
    SELECT period_group as period,
      COUNT(*) as requests,
      COALESCE(SUM(sum_delta + sum_c), 0) as tokens,
      COALESCE(SUM(sum_delta), 0) as "promptTokens",
      COALESCE(SUM(sum_c), 0) as "completionTokens"
    FROM (
      SELECT ${groupExpr} as period_group, turn_id,
        ${sql.raw(groupedInputSumSql())} as sum_delta,
        SUM(completion_tokens) as sum_c
      FROM request_logs
      WHERE api_key_id IN (${userApiKeyIds(discordUserId)})
        AND created_at >= ${range.start}
        ${range.end ? sql`AND created_at <= ${range.end}` : sql``}
        AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY ${groupExpr}, turn_id
    ) sub
    GROUP BY period_group
    ORDER BY period_group
  `)).rows as any[], ["requests", "tokens", "promptTokens", "completionTokens"]);

  return c.json(rows.map((r: any) => ({
    ...r,
    promptTokens: Math.round(r.promptTokens * input),
    completionTokens: Math.round(r.completionTokens * output),
    tokens: Math.round(r.promptTokens * input + r.completionTokens * output),
  })));
});

portal.get("/stats/by-model", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const period = (c.req.query("period") || "today") as PeriodKey;
  const range = resolvePeriodRange(period);
  const isTrial = await isTrialAccount(discordUserId);

  const rows = sanitizeRows((await db.execute(sql`
    SELECT model, COUNT(*) as requests,
      COALESCE(SUM(sum_delta), 0) as "promptTokens",
      COALESCE(SUM(sum_bill), 0) as "billablePromptTokens",
      COALESCE(SUM(sum_cache), 0) as "cachedTokens",
      COALESCE(SUM(sum_c), 0) as "completionTokens"
    FROM (
      SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model, turn_id,
        ${sql.raw(groupedInputSumSql())} as sum_delta,
        SUM(COALESCE(prompt_tokens, 0)) as sum_bill,
        SUM(COALESCE(cached_tokens, 0)) as sum_cache,
        SUM(completion_tokens) as sum_c
      FROM request_logs
      WHERE api_key_id IN (${userApiKeyIds(discordUserId)})
        AND created_at >= ${range.start}
        ${range.end ? sql`AND created_at <= ${range.end}` : sql``}
        AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
      GROUP BY model, turn_id
    ) sub
    GROUP BY model
    ORDER BY requests DESC
    LIMIT 20
  `)).rows as any[], ["requests", "promptTokens", "billablePromptTokens", "cachedTokens", "completionTokens"]);

  const { input, output } = getTokenMultipliers({ isTrial });
  return c.json(rows.map((r: any) => ({
    ...r,
    promptTokens: Math.round(r.promptTokens * input),
    billablePromptTokens: Math.round(r.billablePromptTokens * input),
    cachedTokens: Math.round(r.cachedTokens * input),
    completionTokens: Math.round(r.completionTokens * output),
    tokens: Math.round(r.promptTokens * input + r.completionTokens * output),
  })));
});

portal.get("/stats/by-ide", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const period = (c.req.query("period") || "today") as PeriodKey;
  const range = resolvePeriodRange(period);

  const rows = sanitizeRows((await db.execute(sql`
    SELECT ide_detected as ide, COUNT(*) as requests, COUNT(DISTINCT device_fingerprint) as devices
    FROM request_logs
    WHERE api_key_id IN (${userApiKeyIds(discordUserId)})
      AND created_at >= ${range.start}
      ${range.end ? sql`AND created_at <= ${range.end}` : sql``}
      AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
    GROUP BY ide_detected
    ORDER BY requests DESC
  `)).rows as any[], ["requests", "devices"]);

  return c.json(rows);
});

portal.get("/stats/top-errors", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const period = (c.req.query("period") || "7d") as PeriodKey;
  const range = resolvePeriodRange(period);

  const rows = sanitizeRows((await db.execute(sql`
    WITH grouped AS (
      SELECT
        status_code as "statusCode",
        LEFT(COALESCE(error_message, ''), 200) as "errorSnippet",
        COUNT(*)::int as count,
        MAX(id) as "sampleId"
      FROM request_logs
      WHERE api_key_id IN (${userApiKeyIds(discordUserId)})
        AND created_at >= ${range.start}
        ${range.end ? sql`AND created_at <= ${range.end}` : sql``}
        AND (status_code < 200 OR status_code > 299)
      GROUP BY status_code, LEFT(COALESCE(error_message, ''), 200)
      ORDER BY count DESC
      LIMIT 20
    )
    SELECT
      g."statusCode",
      g."errorSnippet",
      g.count,
      r.model,
      r.ide_detected as "ideDetected",
      r.endpoint_path as "endpointPath",
      r.request_preview as "requestPreview",
      r.response_preview as "responsePreview",
      r.error_message as "errorMessage",
      r.created_at as "sampleAt"
    FROM grouped g
    LEFT JOIN request_logs r ON r.id = g."sampleId"
  `)).rows as any[], ["statusCode", "count"]);

  return c.json(rows.map(r => ({
    statusCode: r.statusCode,
    errorSnippet: sanitizeErrorMsg(r.errorSnippet),
    count: r.count,
    model: r.model || null,
    ideDetected: r.ideDetected || null,
    endpointPath: r.endpointPath || null,
    requestPreview: sanitizePreview(r.requestPreview),
    responsePreview: sanitizePreview(r.responsePreview),
    errorMessage: sanitizeErrorMsg(r.errorMessage),
    sampleAt: r.sampleAt || null,
  })));
});

portal.get("/stats/compare", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const isTrial = await isTrialAccount(discordUserId);

  const todayRange = resolvePeriodRange("today");
  const wibTodayMidnight = todayRange.start;
  const wibYesterdayStart = new Date(wibTodayMidnight.getTime() - 24 * 60 * 60 * 1000);

  const buildOverview = async (start: Date, end: Date) => {
    const pw = and(
      userWhere(discordUserId),
      sql`created_at >= ${start}`,
      sql`created_at <= ${end}`,
      sql`status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL`,
    );
    const stats = (await db.select({
      requests: turnCountSql(pw),
      tokens: turnTotalTokensSql(pw, { isTrial }),
      promptTokens: turnPromptTokensSql(pw, { isTrial }),
      billablePromptTokens: turnBillablePromptTokensSql(pw, { isTrial }),
      cachedTokens: turnCachedTokensSql(pw, { isTrial }),
      completionTokens: turnCompletionTokensSql(pw, { isTrial }),
    }).from(requestLogs).where(pw))[0];

    const breakdownRows = sanitizeRows((await db.execute(sql`
      SELECT model,
        COALESCE(SUM(sum_delta), 0) as "promptTokens",
        COALESCE(SUM(sum_c), 0) as "completionTokens"
      FROM (
        SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model, turn_id,
          ${sql.raw(groupedInputSumSql())} as sum_delta,
          SUM(completion_tokens) as sum_c
        FROM request_logs
        WHERE api_key_id IN (${userApiKeyIds(discordUserId)})
          AND created_at >= ${start}
          AND created_at <= ${end}
          AND status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL
        GROUP BY model, turn_id
      ) sub
      GROUP BY model
    `)).rows as any[], ["promptTokens", "completionTokens"]);

    const { input, output } = getTokenMultipliers({ isTrial });
    let promptCost = 0, completionCost = 0;
    for (const row of breakdownRows) {
      const rates = getModelRates(row.model || "");
      promptCost += Math.round(row.promptTokens * input * rates.prompt);
      completionCost += Math.round(row.completionTokens * output * rates.completion);
    }

    return {
      requests: stats?.requests || 0,
      tokens: stats?.tokens || 0,
      promptTokens: stats?.promptTokens || 0,
      billablePromptTokens: stats?.billablePromptTokens || 0,
      cachedTokens: stats?.cachedTokens || 0,
      completionTokens: stats?.completionTokens || 0,
      cost: { prompt: promptCost, completion: completionCost, total: promptCost + completionCost },
    };
  };

  const [today, yesterday] = await Promise.all([
    buildOverview(wibTodayMidnight, new Date()),
    buildOverview(wibYesterdayStart, wibTodayMidnight),
  ]);

  return c.json({ today, yesterday });
});

portal.get("/stats/forecast", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const isTrial = await isTrialAccount(discordUserId);

  const userKeys = await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId));
  const primaryKey = userKeys.find(k => !k.isTrial && k.isActive) || userKeys.find(k => k.isActive) || userKeys[0];

  if (!primaryKey) return c.json({ forecast: null, reason: "No keys found" });

  const dailyTokenLimit = primaryKey.dailyTokenLimit || 0;
  const monthlyTokenLimit = primaryKey.monthlyTokenLimit || 0;

  if (!dailyTokenLimit && !monthlyTokenLimit) {
    return c.json({ forecast: null, reason: "No token limits configured" });
  }

  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const todayStart = wibTodayStartDate();
  const wibNow = new Date(now.getTime() + wibOffset);
  const wibMidnight = new Date(todayStart.getTime() + wibOffset);
  const elapsedHoursToday = (wibNow.getTime() - wibMidnight.getTime()) / (1000 * 60 * 60);

  const result: Record<string, any> = { daily: null, monthly: null };

  if (dailyTokenLimit > 0 && elapsedHoursToday > 0.1) {
    const todayPw = and(
      userWhere(discordUserId),
      sql`created_at >= ${todayStart}`,
      sql`status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL`,
    );
    const todayStats = (await db.select({
      tokens: turnTotalTokensSql(todayPw!, { isTrial }),
    }).from(requestLogs).where(todayPw))[0];
    const tokensToday = todayStats?.tokens || 0;

    if (tokensToday > 0) {
      const ratePerHour = tokensToday / elapsedHoursToday;
      const remaining = dailyTokenLimit - tokensToday;
      if (remaining <= 0) {
        result.daily = { status: "exceeded", tokensUsed: tokensToday, limit: dailyTokenLimit };
      } else {
        const hoursUntilLimit = remaining / ratePerHour;
        const etaMs = now.getTime() + hoursUntilLimit * 60 * 60 * 1000;
        result.daily = {
          status: "ok",
          tokensUsed: tokensToday,
          limit: dailyTokenLimit,
          ratePerHour: Math.round(ratePerHour),
          etaUtc: new Date(etaMs).toISOString(),
          hoursRemaining: Math.round(hoursUntilLimit * 10) / 10,
        };
      }
    } else {
      result.daily = { status: "no_usage", limit: dailyTokenLimit };
    }
  }

  if (monthlyTokenLimit > 0) {
    const wibNowObj = new Date(now.getTime() + wibOffset);
    const wibMonthStart = new Date(Date.UTC(wibNowObj.getUTCFullYear(), wibNowObj.getUTCMonth(), 1));
    const monthStartUtc = new Date(wibMonthStart.getTime() - wibOffset);
    const elapsedDaysMonth = (now.getTime() - monthStartUtc.getTime()) / (1000 * 60 * 60 * 24);

    if (elapsedDaysMonth > 0.1) {
      const monthPw = and(
        userWhere(discordUserId),
        sql`created_at >= ${monthStartUtc}`,
        sql`status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL`,
      );
      const monthStats = (await db.select({
        tokens: turnTotalTokensSql(monthPw!, { isTrial }),
      }).from(requestLogs).where(monthPw))[0];
      const tokensMonth = monthStats?.tokens || 0;

      if (tokensMonth > 0) {
        const ratePerDay = tokensMonth / elapsedDaysMonth;
        const remaining = monthlyTokenLimit - tokensMonth;
        if (remaining <= 0) {
          result.monthly = { status: "exceeded", tokensUsed: tokensMonth, limit: monthlyTokenLimit };
        } else {
          const daysUntilLimit = remaining / ratePerDay;
          const etaMs = now.getTime() + daysUntilLimit * 24 * 60 * 60 * 1000;
          result.monthly = {
            status: "ok",
            tokensUsed: tokensMonth,
            limit: monthlyTokenLimit,
            ratePerDay: Math.round(ratePerDay),
            etaUtc: new Date(etaMs).toISOString(),
            daysRemaining: Math.round(daysUntilLimit * 10) / 10,
          };
        }
      } else {
        result.monthly = { status: "no_usage", limit: monthlyTokenLimit };
      }
    }
  }

  return c.json({ forecast: result });
});

// ─── Keys ─────────────────────────────────────────────────────────────────────

portal.get("/keys", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const userKeys = await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId));
  const result = [];
  const todayStart = wibTodayStartDate();

  // Primary = Discord/trial-issued key; else oldest non-trial
  const primary =
    userKeys.find((k) => !k.isTrial && isProtectedPrimaryApiKey(k)) ||
    userKeys.find((k) => isProtectedPrimaryApiKey(k)) ||
    [...userKeys].filter((k) => !k.isTrial).sort((a, b) => Number(a.id) - Number(b.id))[0] ||
    userKeys[0];
  const primaryId = primary?.id ?? null;

  for (const key of userKeys) {
    const todayPw = and(
      eq(requestLogs.apiKeyId, key.id),
      sql`created_at >= ${todayStart}`,
      sql`status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL`,
    );
    const todayStats = (await db.select({
      requests: turnCountSql(todayPw!),
    }).from(requestLogs).where(and(eq(requestLogs.apiKeyId, key.id), sql`created_at >= ${todayStart}`)))[0];

    const isPrimary = key.id === primaryId;
    result.push({
      id: key.id,
      name: key.name,
      key: key.key,
      keyPrefix: key.keyPrefix,
      keyMasked: maskKey(key.key),
      isActive: key.isActive,
      isTrial: key.isTrial || false,
      isPrimary,
      canDelete: !isProtectedPrimaryApiKey(key) && !isPrimary,
      provisionedBy: key.provisionedBy,
      createdAt: key.createdAt,
      requestsToday: todayStats?.requests || 0,
    });
  }
  return c.json(result);
});

portal.post("/keys", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const { name } = await c.req.json<{ name: string }>();
  if (!name?.trim()) return c.json({ error: "Name required" }, 400);

  // Block trial-only accounts from creating extra keys
  const isTrial = await isTrialAccount(discordUserId);
  if (isTrial) {
    return c.json({ error: "Upgrade to Phantom membership to create additional API keys." }, 403);
  }

  const existing = await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId));
  if (existing.length >= 5) {
    return c.json({ error: "Maximum of 5 API keys allowed. Delete an existing key to create a new one." }, 400);
  }

  // Copy limits from primary phantom key
  const primaryKey = existing.find(k => !k.isTrial && k.isActive) || existing[0];
  const newKey = generateApiKey();

  const [result] = await db.insert(apiKeys).values({
    name: name.trim(),
    key: newKey,
    keyPrefix: getKeyPrefix(newKey),
    keyHash: sha256(newKey),
    discordUserId,
    discordUsername: primaryKey?.discordUsername ?? null,
    provisionedBy: "portal",
    isActive: true,
    isTrial: false,
    maxDevices: primaryKey?.maxDevices || 0,
    devicePolicy: primaryKey?.devicePolicy || "none",
    ipPolicy: primaryKey?.ipPolicy || "none",
    idePolicy: primaryKey?.idePolicy || "none",
    monthlyTokenLimit: primaryKey?.monthlyTokenLimit ?? null,
    rateLimit: primaryKey?.rateLimit ?? null,
    rateLimitWindow: primaryKey?.rateLimitWindow ?? null,
    promptLimit: primaryKey?.promptLimit ?? null,
    promptLimitWindow: primaryKey?.promptLimitWindow ?? null,
    dailyTokenLimit: primaryKey?.dailyTokenLimit ?? null,
    dailyInputTokenLimit: primaryKey?.dailyInputTokenLimit ?? null,
    dailyOutputTokenLimit: primaryKey?.dailyOutputTokenLimit ?? null,
  }).returning();

  return c.json({ ...result, key: newKey });
});

portal.delete("/keys/:id", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const keyId = parseInt(c.req.param("id"));

  const key = (await db.select().from(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.discordUserId, discordUserId)))).find(Boolean);
  if (!key) return c.json({ error: "Key not found" }, 404);

  if (isProtectedPrimaryApiKey(key)) {
    return c.json({ error: "Cannot delete your primary Discord API key. You can delete additional keys you created." }, 403);
  }

  // Also block deleting the sole remaining key for this Discord account
  const siblings = await db.select({ id: apiKeys.id, provisionedBy: apiKeys.provisionedBy, isTrial: apiKeys.isTrial })
    .from(apiKeys)
    .where(eq(apiKeys.discordUserId, discordUserId));
  const hasProtectedPrimary = siblings.some((k) => isProtectedPrimaryApiKey(k));
  if (!hasProtectedPrimary && siblings.length <= 1) {
    return c.json({ error: "Cannot delete your only API key." }, 403);
  }

  await db.delete(devices).where(eq(devices.apiKeyId, keyId));
  await db.delete(apiKeys).where(eq(apiKeys.id, keyId));

  void fireUserWebhook(discordUserId, "key_deleted", {
    keyId: key.id,
    keyName: key.name,
  });

  return c.json({ success: true });
});

portal.post("/keys/:id/rotate", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const keyId = parseInt(c.req.param("id"));

  const key = (await db.select().from(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.discordUserId, discordUserId)))).find(Boolean);
  if (!key) return c.json({ error: "Key not found" }, 404);

  const newKey = generateApiKey();
  const proxyEndpoint = `${process.env.PROXY_PUBLIC_BASE_URL || "https://api.tokito.xyz"}/v1`;
  const notification = {
    type: "portal_key_rotated",
    discordUserId,
    newKey,
    endpoint: proxyEndpoint,
    keyName: key.name,
    keyId: key.id,
    rotatedAt: new Date().toISOString(),
  };

  await db.update(apiKeys).set({
    key: newKey,
    keyPrefix: getKeyPrefix(newKey),
    keyHash: sha256(newKey),
    pendingNotification: JSON.stringify(notification),
    updatedAt: new Date(),
  }).where(eq(apiKeys.id, keyId));

  void fireUserWebhook(discordUserId, "key_rotated", {
    keyId: key.id,
    keyName: key.name,
    keyPrefix: getKeyPrefix(newKey),
  });

  return c.json({ success: true, key: newKey, keyPrefix: getKeyPrefix(newKey) });
});

// ─── Devices ──────────────────────────────────────────────────────────────────

portal.get("/keys/:id/devices", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const keyId = parseInt(c.req.param("id"));

  const key = (await db.select().from(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.discordUserId, discordUserId)))).find(Boolean);
  if (!key) return c.json({ error: "Key not found" }, 404);

  const devs = await db.select().from(devices).where(eq(devices.apiKeyId, keyId)).orderBy(desc(devices.lastSeen)).limit(50);
  return c.json(devs.map(d => ({
    fingerprint: d.fingerprint,
    fingerprintShort: d.fingerprint.substring(0, 12),
    deviceName: d.deviceName,
    ideDetected: d.ideDetected,
    osDetected: d.osDetected,
    ipAddress: d.ipAddress,
    userAgentRaw: d.userAgentRaw ? d.userAgentRaw.substring(0, 80) : null,
    requestCount: d.requestCount,
    lastSeen: d.lastSeen,
    firstSeen: d.firstSeen,
    isBlocked: d.isBlocked,
  })));
});

portal.delete("/keys/:id/devices/:fingerprint", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const keyId = parseInt(c.req.param("id"));
  const fingerprint = c.req.param("fingerprint");

  const key = (await db.select().from(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.discordUserId, discordUserId)))).find(Boolean);
  if (!key) return c.json({ error: "Key not found" }, 404);

  await db.delete(devices).where(and(eq(devices.apiKeyId, keyId), eq(devices.fingerprint, fingerprint)));
  return c.json({ success: true });
});

portal.put("/keys/:id/policies", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const keyId = parseInt(c.req.param("id"));
  const { devicePolicy, idePolicy } = await c.req.json<{ devicePolicy?: string; idePolicy?: string }>();

  const key = (await db.select().from(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.discordUserId, discordUserId)))).find(Boolean);
  if (!key) return c.json({ error: "Key not found" }, 404);

  await db.update(apiKeys).set({
    devicePolicy: devicePolicy || key.devicePolicy,
    idePolicy: idePolicy || key.idePolicy,
    updatedAt: new Date(),
  }).where(eq(apiKeys.id, keyId));
  return c.json({ success: true });
});

// ─── Logs ─────────────────────────────────────────────────────────────────────

portal.get("/logs", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const period = (c.req.query("period") || "7d") as PeriodKey;
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
  const page = parseInt(c.req.query("page") || "1");
  const offset = (page - 1) * limit;

  const range = resolvePeriodRange(period);
  const where = and(
    userWhere(discordUserId),
    sql`created_at >= ${range.start}`,
    range.end ? sql`created_at <= ${range.end}` : sql`1=1`,
  );

  const rows = await db.select({
    id: requestLogs.id,
    model: requestLogs.model,
    promptTokens: requestLogs.promptTokens,
    completionTokens: requestLogs.completionTokens,
    totalTokens: requestLogs.totalTokens,
    cachedTokens: requestLogs.cachedTokens,
    ideDetected: requestLogs.ideDetected,
    provider: requestLogs.provider,
    endpointPath: requestLogs.endpointPath,
    errorMessage: requestLogs.errorMessage,
    requestPreview: requestLogs.requestPreview,
    responsePreview: requestLogs.responsePreview,
    latencyMs: requestLogs.latencyMs,
    statusCode: requestLogs.statusCode,
    createdAt: requestLogs.createdAt,
  }).from(requestLogs).where(where).orderBy(desc(requestLogs.createdAt)).limit(limit).offset(offset);

  const total = (await db.select({ count: sql<number>`count(*)` }).from(requestLogs).where(where))[0];

  return c.json({
    data: rows.map(r => {
      const billable = Number(r.promptTokens) || 0;
      const cached = Number(r.cachedTokens) || 0;
      const completion = Number(r.completionTokens) || 0;
      const inputTokens = billable + cached;
      return {
        ...r,
        billablePromptTokens: billable,
        cachedTokens: cached,
        inputTokens,
        promptTokens: inputTokens,
        completionTokens: completion,
        totalTokens: inputTokens + completion,
        errorMessage: sanitizeErrorMsg(r.errorMessage),
        requestPreview: sanitizePreview(r.requestPreview),
        responsePreview: sanitizePreview(r.responsePreview),
      };
    }),
    pagination: {
      page,
      limit,
      total: Number(total?.count) || 0,
      totalPages: Math.ceil((Number(total?.count) || 0) / limit),
    },
  });
});

// ─── Models ───────────────────────────────────────────────────────────────────

portal.get("/models", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const isTrial = await isTrialAccount(discordUserId);

  try {
    const catalog = await getModelCatalogResponse();
    const allModels: Array<{ id: string; owned_by?: string }> = (catalog as any)?.data || [];

    if (isTrial) {
      const config = (await db.select().from(adminConfig).limit(1))[0];
      const mode = String(config?.trialModelSelectionMode || "all").toLowerCase();
      const whitelist = parseTrialModelWhitelist(config?.trialModelWhitelist);

      let allowedIds: string[];
      if (mode === "whitelist" && whitelist.length > 0) {
        allowedIds = whitelist;
      } else {
        // Full catalog for trial (mode all / legacy all_gpy)
        allowedIds = allModels.map((m) => m.id).filter((id) => id && id.toLowerCase() !== "auto");
      }
      if (!allowedIds.some((id) => id.toLowerCase() === "auto")) {
        allowedIds = ["auto", ...allowedIds];
      }

      return c.json(allowedIds.map(id => ({
        id,
        allowed: true,
        online: null as boolean | null,
        checkedAt: null as string | null,
        lastCheckedMinutes: null as number | null,
        latencyMs: null as number | null,
      })));
    }

    // Same matrix as Discord /v1/models: visible = Published ON; online label = both
    const monitorRows = await getClientCatalogMonitorRows();

    const statusMap = new Map<
      string,
      { clientOnline: boolean; latencyMs: number; checkedAt: Date | null }
    >();
    for (const m of monitorRows) {
      const bare = m.modelId.includes("/")
        ? m.modelId.slice(m.modelId.indexOf("/") + 1)
        : m.modelId;
      const payload = {
        clientOnline: m.clientOnline,
        latencyMs: m.latencyMs,
        checkedAt: null as Date | null,
      };
      statusMap.set(m.modelId, payload);
      statusMap.set(bare, payload);
      statusMap.set(`${m.provider}/${bare}`, payload);
    }

    // Attach checkedAt from raw table for display
    const checkedRows = await db
      .select({
        modelId: modelMonitor.modelId,
        checkedAt: modelMonitor.checkedAt,
      })
      .from(modelMonitor)
      .orderBy(desc(modelMonitor.checkedAt));
    for (const row of checkedRows) {
      const existing = statusMap.get(row.modelId);
      if (existing && !existing.checkedAt) {
        existing.checkedAt = row.checkedAt;
      }
    }

    const lookup = (id: string) => {
      if (statusMap.has(id)) return statusMap.get(id)!;
      const parts = id.split("/");
      for (let i = 1; i < parts.length; i++) {
        const suffix = parts.slice(i).join("/");
        if (statusMap.has(suffix)) return statusMap.get(suffix)!;
      }
      for (const [mid, val] of statusMap) {
        if (mid.endsWith("/" + id) || id.endsWith("/" + mid)) return val;
      }
      return null;
    };

    return c.json(
      allModels
        .map((m) => {
          const st = lookup(m.id);
          if (!st) return null;
          return {
            id: m.id,
            allowed: true,
            online: st.clientOnline,
            checkedAt: st.checkedAt?.toISOString() ?? null,
            lastCheckedMinutes: st.checkedAt ? minutesAgo(st.checkedAt) : null,
            latencyMs: st.latencyMs ?? null,
          };
        })
        .filter(Boolean),
    );
  } catch (err: any) {
    return c.json({ error: err?.message || "Failed to load models" }, 500);
  }
});

// ─── Recap ────────────────────────────────────────────────────────────────────

portal.get("/recap/status", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const window = getRecapWindow();

  const userKeys = await db.select({ name: apiKeys.name, isTrial: apiKeys.isTrial, isActive: apiKeys.isActive })
    .from(apiKeys)
    .where(eq(apiKeys.discordUserId, discordUserId));
  const primaryKey = userKeys.find(k => !k.isTrial && k.isActive) || userKeys.find(k => k.isActive) || userKeys[0];
  const primaryKeyName = primaryKey?.name ?? null;

  return c.json({
    ...window,
    recapUrl: primaryKeyName ? `/recap/${encodeURIComponent(primaryKeyName)}` : null,
  });
});

// ─── Notifications ────────────────────────────────────────────────────────────

portal.get("/notifications", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const userKeys = await db.select({
    id: apiKeys.id,
    name: apiKeys.name,
    pendingNotification: apiKeys.pendingNotification,
  }).from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId));

  const notifications: any[] = [];
  for (const k of userKeys) {
    if (k.pendingNotification) {
      try {
        const notifs = JSON.parse(k.pendingNotification);
        if (Array.isArray(notifs)) {
          notifications.push(...notifs.map((n: any) => ({ ...n, keyId: k.id, keyName: k.name })));
        }
      } catch { /* ignore */ }
    }
  }

  return c.json({ notifications, count: notifications.length });
});

// ─── Settings ─────────────────────────────────────────────────────────────────

portal.put("/settings/password", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const { currentPassword, newPassword } = await c.req.json<{ currentPassword?: string; newPassword: string }>();

  if (!newPassword || newPassword.length < 6) return c.json({ error: "Password must be at least 6 characters" }, 400);

  const settings = (await db.select().from(userPortalSettings).where(eq(userPortalSettings.discordUserId, discordUserId)))[0];

  if (settings?.passwordHash) {
    if (!currentPassword) return c.json({ error: "Current password required" }, 400);
    const { verify } = await import("@node-rs/argon2");
    const isValid = await verify(settings.passwordHash, currentPassword);
    if (!isValid) return c.json({ error: "Invalid current password" }, 401);
  }

  const { hash } = await import("@node-rs/argon2");
  const newHash = await hash(newPassword);

  if (settings) {
    await db.update(userPortalSettings)
      .set({ passwordHash: newHash, passwordSetAt: new Date(), updatedAt: new Date() })
      .where(eq(userPortalSettings.discordUserId, discordUserId));
  } else {
    await db.insert(userPortalSettings).values({ discordUserId, passwordHash: newHash, passwordSetAt: new Date() });
  }

  return c.json({ success: true });
});

portal.delete("/settings/password", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  await db.update(userPortalSettings)
    .set({ passwordHash: null, passwordSetAt: null, updatedAt: new Date() })
    .where(eq(userPortalSettings.discordUserId, discordUserId));
  return c.json({ success: true });
});

portal.put("/settings/webhook", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const { url } = await c.req.json<{ url?: string }>();

  const settings = (await db.select().from(userPortalSettings).where(eq(userPortalSettings.discordUserId, discordUserId)))[0];

  if (!url || !url.trim()) {
    // Clear webhook
    if (settings) {
      await db.update(userPortalSettings)
        .set({ webhookUrl: null, webhookSecret: null, updatedAt: new Date() })
        .where(eq(userPortalSettings.discordUserId, discordUserId));
    }
    return c.json({ success: true, removed: true, hasWebhook: false });
  }

  try { new URL(url.trim()); } catch {
    return c.json({ error: "Invalid URL format" }, 400);
  }

  const webhookUrl = url.trim();
  // Preserve existing secret; generate new one only on first save
  const webhookSecret = settings?.webhookSecret || generateWebhookSecret();

  if (settings) {
    await db.update(userPortalSettings)
      .set({ webhookUrl, webhookSecret, updatedAt: new Date() })
      .where(eq(userPortalSettings.discordUserId, discordUserId));
  } else {
    await db.insert(userPortalSettings).values({ discordUserId, webhookUrl, webhookSecret });
  }

  return c.json({
    success: true,
    webhookUrl: maskWebhookUrl(webhookUrl),
    webhookSecret,
    hasWebhook: true,
  });
});

// Token Saver per-user overrides (tri-state: null=default, true=on, false=off)
portal.get("/settings/token-saver", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const [settings, config] = await Promise.all([
    db.select().from(userPortalSettings).where(eq(userPortalSettings.discordUserId, discordUserId)).then(r => r[0] ?? null),
    db.select().from(adminConfig).limit(1).then(r => r[0] ?? null),
  ]);
  return c.json({
    global: {
      rtk: config?.tokenSaverRtkEnabled ?? true,
      rtkMaxChars: config?.tokenSaverRtkMaxChars ?? 2000,
      headroom: config?.tokenSaverHeadroomEnabled ?? false,
      caveman: config?.tokenSaverCavemanEnabled ?? false,
      cavemanLevel: config?.tokenSaverCavemanLevel ?? 2,
      ponytail: config?.tokenSaverPonytailEnabled ?? false,
      ponytailLevel: config?.tokenSaverPonytailLevel || "lite",
    },
    overrides: {
      rtk: settings?.tokenSaverRtkOverride ?? null,
      headroom: settings?.tokenSaverHeadroomOverride ?? null,
      caveman: settings?.tokenSaverCavemanOverride ?? null,
      ponytail: settings?.tokenSaverPonytailOverride ?? null,
    },
  });
});

portal.put("/settings/token-saver", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const body = await c.req.json<{
    rtk?: boolean | null;
    headroom?: boolean | null;
    caveman?: boolean | null;
    ponytail?: boolean | null;
  }>();

  const normalize = (v: unknown): boolean | null => {
    if (v === null || v === undefined || v === "default") return null;
    if (v === true || v === "on" || v === "true") return true;
    if (v === false || v === "off" || v === "false") return false;
    return null;
  };

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.rtk !== undefined) updates.tokenSaverRtkOverride = normalize(body.rtk);
  if (body.headroom !== undefined) updates.tokenSaverHeadroomOverride = normalize(body.headroom);
  if (body.caveman !== undefined) updates.tokenSaverCavemanOverride = normalize(body.caveman);
  if (body.ponytail !== undefined) updates.tokenSaverPonytailOverride = normalize(body.ponytail);

  const settings = (await db.select().from(userPortalSettings).where(eq(userPortalSettings.discordUserId, discordUserId)))[0];
  if (settings) {
    await db.update(userPortalSettings).set(updates).where(eq(userPortalSettings.discordUserId, discordUserId));
  } else {
    await db.insert(userPortalSettings).values({
      discordUserId,
      tokenSaverRtkOverride: updates.tokenSaverRtkOverride ?? null,
      tokenSaverHeadroomOverride: updates.tokenSaverHeadroomOverride ?? null,
      tokenSaverCavemanOverride: updates.tokenSaverCavemanOverride ?? null,
      tokenSaverPonytailOverride: updates.tokenSaverPonytailOverride ?? null,
    });
  }

  const refreshed = (await db.select().from(userPortalSettings).where(eq(userPortalSettings.discordUserId, discordUserId)))[0];
  return c.json({
    success: true,
    overrides: {
      rtk: refreshed?.tokenSaverRtkOverride ?? null,
      headroom: refreshed?.tokenSaverHeadroomOverride ?? null,
      caveman: refreshed?.tokenSaverCavemanOverride ?? null,
      ponytail: refreshed?.tokenSaverPonytailOverride ?? null,
    },
  });
});

// ─── Live SSE (filtered to this user's keys) ──────────────────────────────────

portal.get("/logs/stream", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const userKeys = await db.select({ id: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.discordUserId, discordUserId));
  const keyIdSet = new Set(userKeys.map((k) => k.id));

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { clearInterval(keepalive); }
      }, 30000);

      const unsubscribe = logEmitter.on((logEntry: any) => {
        try {
          if (logEntry?.apiKeyId && keyIdSet.has(logEntry.apiKeyId)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              id: logEntry.id,
              model: logEntry.model,
              statusCode: logEntry.statusCode,
              createdAt: logEntry.createdAt,
            })}\n\n`));
          }
        } catch {
          unsubscribe();
          clearInterval(keepalive);
        }
      });

      c.req.raw.signal?.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(keepalive);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

export default portal;