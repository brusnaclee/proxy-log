import { Hono } from "hono";
import { db } from "../../db/index.js";
import {
  apiKeys, requestLogs, devices, allowedDevices, allowedIdes,
  chatSessions, userPortalSettings, trialUsers, adminConfig, modelMonitor,
} from "../../db/schema.js";
import { eq, sql, and, desc } from "drizzle-orm";
import { generateApiKey, getKeyPrefix, sha256, maskKey } from "../../utils/crypto.js";
import { createPortalSession, destroyPortalSession, getPortalDiscordUserId, isPortalAuthenticated } from "../../middleware/portal-session.js";
import { resolvePeriodRange, chartDaysForPeriod, type PeriodKey } from "../../utils/counting.js";
import { turnCountSql, turnPromptTokensSql, turnCompletionTokensSql, turnTotalTokensSql, sanitizeRows } from "../../utils/counting.js";
import { getTokenMultipliers } from "../../utils/token-multiplier.js";
import { getModelRates } from "../../utils/cost-calculator.js";
import { getRecapWindow } from "../../utils/recap-window.js";
import { getModelCatalogResponse } from "../../utils/model-catalog.js";
import { parseTrialModelWhitelist } from "../../utils/trial-config.js";
import { logEmitter } from "../../utils/event-emitter.js";
import { randomBytes } from "crypto";

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
  const multipliers = getTokenMultipliers({ isTrial });

  // Today's usage (WIB)
  const todayStart = wibTodayStartDate();
  const todayPw = and(
    userWhere(discordUserId),
    sql`created_at >= ${todayStart}`,
    sql`status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL`,
  );
  const usageToday = (await db.select({
    requests: turnCountSql(todayPw!),
    promptTokens: turnPromptTokensSql(todayPw!, { isTrial }),
    completionTokens: turnCompletionTokensSql(todayPw!, { isTrial }),
  }).from(requestLogs).where(todayPw))[0];

  // Distinct devices across all user keys
  const deviceUsageRow = (await db.execute(sql`
    SELECT COUNT(DISTINCT fingerprint) as used
    FROM devices
    WHERE api_key_id IN (${userApiKeyIds(discordUserId)})
  `)).rows[0] as any;

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
        const notifs = JSON.parse(k.pendingNotification);
        if (Array.isArray(notifs)) pendingNotifications.push(...notifs);
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
      maxDevices: primaryKey?.maxDevices || 0,
      dailyTokenLimit: primaryKey?.dailyTokenLimit || 0,
      monthlyTokenLimit: primaryKey?.monthlyTokenLimit || 0,
      dailyInputTokenLimit: primaryKey?.dailyInputTokenLimit || 0,
      dailyOutputTokenLimit: primaryKey?.dailyOutputTokenLimit || 0,
      rateLimit: primaryKey?.rateLimit || 0,
      rateLimitWindow: primaryKey?.rateLimitWindow || "1h",
      promptLimit: primaryKey?.promptLimit || 0,
      promptLimitWindow: primaryKey?.promptLimitWindow || "1d",
    },
    usageToday: {
      requests: usageToday?.requests || 0,
      promptTokens: usageToday?.promptTokens || 0,
      completionTokens: usageToday?.completionTokens || 0,
    },
    multipliers,
    deviceUsage: {
      used: Number((deviceUsageRow as any)?.used || 0),
      max: primaryKey?.maxDevices || 0,
    },
    pendingNotifications,
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
        SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta,
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
        SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta,
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
      COALESCE(SUM(sum_c), 0) as "completionTokens"
    FROM (
      SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model, turn_id,
        SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta,
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
  `)).rows as any[], ["requests", "promptTokens", "completionTokens"]);

  const { input, output } = getTokenMultipliers({ isTrial });
  return c.json(rows.map((r: any) => ({
    ...r,
    promptTokens: Math.round(r.promptTokens * input),
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
    SELECT
      status_code as "statusCode",
      LEFT(error_message, 200) as "errorSnippet",
      COUNT(*) as count
    FROM request_logs
    WHERE api_key_id IN (${userApiKeyIds(discordUserId)})
      AND created_at >= ${range.start}
      ${range.end ? sql`AND created_at <= ${range.end}` : sql``}
      AND (status_code < 200 OR status_code > 299)
      AND error_message IS NOT NULL
    GROUP BY status_code, LEFT(error_message, 200)
    ORDER BY count DESC
    LIMIT 20
  `)).rows as any[], ["statusCode", "count"]);

  return c.json(rows.map(r => ({
    ...r,
    errorSnippet: sanitizeErrorMsg(r.errorSnippet),
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
      completionTokens: turnCompletionTokensSql(pw, { isTrial }),
    }).from(requestLogs).where(pw))[0];

    const breakdownRows = sanitizeRows((await db.execute(sql`
      SELECT model,
        COALESCE(SUM(sum_delta), 0) as "promptTokens",
        COALESCE(SUM(sum_c), 0) as "completionTokens"
      FROM (
        SELECT CASE WHEN model LIKE 'auto (%)%' THEN 'auto' ELSE model END as model, turn_id,
          SUM(CASE WHEN context_delta_tokens > 0 THEN context_delta_tokens ELSE 0 END) as sum_delta,
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

  for (const key of userKeys) {
    const todayPw = and(
      eq(requestLogs.apiKeyId, key.id),
      sql`created_at >= ${todayStart}`,
      sql`status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL`,
    );
    const todayStats = (await db.select({
      requests: turnCountSql(todayPw!),
    }).from(requestLogs).where(and(eq(requestLogs.apiKeyId, key.id), sql`created_at >= ${todayStart}`)))[0];

    result.push({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      keyMasked: maskKey(key.key),
      isActive: key.isActive,
      isTrial: key.isTrial || false,
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
    ideDetected: requestLogs.ideDetected,
    provider: requestLogs.provider,
    endpointPath: requestLogs.endpointPath,
    errorMessage: requestLogs.errorMessage,
    latencyMs: requestLogs.latencyMs,
    statusCode: requestLogs.statusCode,
    createdAt: requestLogs.createdAt,
  }).from(requestLogs).where(where).orderBy(desc(requestLogs.createdAt)).limit(limit).offset(offset);

  const total = (await db.select({ count: sql<number>`count(*)` }).from(requestLogs).where(where))[0];

  return c.json({
    data: rows.map(r => ({
      ...r,
      errorMessage: sanitizeErrorMsg(r.errorMessage),
    })),
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
      const mode = config?.trialModelSelectionMode || "all_gpy";
      const whitelist = parseTrialModelWhitelist(config?.trialModelWhitelist);

      let allowedIds: string[];
      if (mode === "whitelist" && whitelist.length > 0) {
        allowedIds = whitelist;
      } else {
        // all_gpy: models that belong to the gpy upstream
        allowedIds = allModels
          .filter(m => (m.owned_by || "").toLowerCase() === "gpy" || m.id.startsWith("gpy/") || m.id.startsWith("gpy:"))
          .map(m => m.id);
        if (whitelist.length > 0) {
          const extra = whitelist.filter(w => !allowedIds.includes(w));
          allowedIds = [...allowedIds, ...extra];
        }
      }

      return c.json(allowedIds.map(id => ({ id, allowed: true, online: null })));
    }

    // Phantom: full catalog with online status from model_monitor
    const monitorRows = await db.select({
      modelId: modelMonitor.modelId,
      isOnline: modelMonitor.isOnline,
      checkedAt: modelMonitor.checkedAt,
    }).from(modelMonitor).orderBy(desc(modelMonitor.checkedAt));

    const monitorMap = new Map<string, boolean>();
    for (const row of monitorRows) {
      if (!monitorMap.has(row.modelId)) monitorMap.set(row.modelId, row.isOnline);
    }

    return c.json(allModels.map(m => ({
      id: m.id,
      allowed: true,
      online: monitorMap.has(m.id) ? monitorMap.get(m.id)! : null,
    })));
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
