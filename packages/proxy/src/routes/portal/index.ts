import { Hono } from "hono";
import { db } from "../../db/index.js";
import {
  apiKeys, requestLogs, devices, allowedDevices, allowedIdes,
  chatSessions, userPortalSettings, trialUsers, adminConfig, modelMonitor, modelLimits,
} from "../../db/schema.js";
import { eq, sql, and, desc } from "drizzle-orm";
import { generateApiKey, getKeyPrefix, sha256, maskKey } from "../../utils/crypto.js";
import { createPortalSession, destroyPortalSession, getPortalDiscordUserId, resolvePortalDiscordUserId, getPortalSessionRawId } from "../../middleware/portal-session.js";
import { destroyAllAuthSessions, destroyAuthSessionById, destroyOtherAuthSessions, listAuthSessions } from "../../utils/auth-sessions.js";
import { resolvePeriodRange, chartDaysForPeriod, type PeriodKey, turnCountSql, hopCountSql, peakPromptTokensSql, turnCompletionTokensSql, turnDisplayCompletionTokensSql, turnBillablePromptTokensSql, turnCachedTokensSql, sanitizeRows, hopFullInputTokensSql, weightedHopInputTokensSql, weightedHopTotalTokensSql, modelLimitCreditBreakdownSql, hopWeightedTimeseriesSql, BILLABLE_LOG_SQL } from "../../utils/counting.js";
import { resolveTokenMultipliers } from "../../utils/token-multiplier.js";
import { getModelRates } from "../../utils/cost-calculator.js";
import { getRecapWindow } from "../../utils/recap-window.js";
import { getModelCatalogResponse } from "../../utils/model-catalog.js";
import { scrubUpstreamLeakText } from "../../utils/upstream-leak-scrub.js";
import { parseTrialModelWhitelist, resolveKeyPromptLimit, resolveKeyApiCallLimit } from "../../utils/trial-config.js";
import {
  checkPromptLimit,
  checkModelPromptLimit,
  checkApiCallLimit,
  parseRateLimitWindow,
  getWindowResetMs,
  getApiCallWindowResetMs,
  listDedicatedQuotaRules,
  sqlExcludeDedicatedModels,
  sqlMatchDedicatedRule,
} from "../../utils/rate-limit.js";
import { buildModelPromptUsage } from "../../utils/model-prompt-usage.js";
import { logEmitter } from "../../utils/event-emitter.js";
import { randomBytes } from "crypto";
import {
  isProtectedPrimaryApiKey,
  canUserDeleteApiKey,
  getPortalPrimaryKeyIds,
  pickPrimaryNonTrialKey,
  sortKeysPrimaryFirst,
} from "../../utils/api-key-primary.js";
import { listAccountDevices } from "../../utils/account-devices.js";
import { getAccountUsageBreakdown, parseUsageBreakdownPeriod } from "../../utils/usage-aggregates.js";

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

/** Successful hops (no turn_id filter) — same scope as Discord limit-credit meters. */
function periodWhereHops(discordUserId: string, period: PeriodKey) {
  const range = resolvePeriodRange(period);
  return and(
    userWhere(discordUserId),
    sql`created_at >= ${range.start}`,
    range.end ? sql`created_at <= ${range.end}` : sql`1=1`,
    sql`status_code BETWEEN 200 AND 299`,
  );
}

/**
 * Token accounting tier for stats/usage math. Unlike `isTrialAccount` below it
 * ignores active state, so an expired membership keeps member multipliers and
 * the portal numbers stay identical to Discord, admin dashboard and recap.
 */
async function statsIsTrial(discordUserId: string): Promise<boolean> {
  const { resolveAccountTokenTier } = await import("../../utils/account-token-tier.js");
  return (await resolveAccountTokenTier(discordUserId)).isTrial;
}

/** Feature gating only: true when the user has NO ACTIVE non-trial key. */
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
  return scrubUpstreamLeakText(msg);
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

  const { apiKey, clientHint } = await c.req.json<{
    apiKey: string;
    clientHint?: { platform?: string; mobile?: boolean; label?: string };
  }>();
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

  await createPortalSession(c, discordUserId, clientHint ?? null);

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
  const { discordUserId, password, clientHint } = await c.req.json<{
    discordUserId: string;
    password: string;
    clientHint?: { platform?: string; mobile?: boolean; label?: string };
  }>();
  if (!discordUserId || !password) return c.json({ error: "Missing fields" }, 400);

  const settings = (await db.select().from(userPortalSettings).where(eq(userPortalSettings.discordUserId, discordUserId)))[0];
  if (!settings?.passwordHash) return c.json({ error: "No password set" }, 400);

  const { verify } = await import("@node-rs/argon2");
  const isValid = await verify(settings.passwordHash, password);
  if (!isValid) return c.json({ error: "Invalid password" }, 401);

  await createPortalSession(c, discordUserId, clientHint ?? null);
  await db.update(userPortalSettings)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(userPortalSettings.discordUserId, discordUserId));
  return c.json({ success: true });
});

portal.post("/auth/logout", async (c) => {
  await destroyPortalSession(c);
  return c.json({ success: true });
});

// ─── Auth middleware ───────────────────────────────────────────────────────────
portal.use("/*", async (c, next) => {
  const path = c.req.path;
  if (
    path === "/auth/login" ||
    path === "/auth/verify-password" ||
    path === "/auth/logout" ||
    path.endsWith("/auth/login") ||
    path.endsWith("/auth/verify-password") ||
    path.endsWith("/auth/logout")
  ) {
    return next();
  }
  const userId = await resolvePortalDiscordUserId(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

// ─── Active sessions ───────────────────────────────────────────────────────────

portal.get("/sessions", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const rawId = getPortalSessionRawId(c);
  const rows = await listAuthSessions({
    kind: "portal",
    discordUserId,
    currentRawId: rawId,
    limit: 50,
  });
  return c.json({ sessions: rows });
});

portal.delete("/sessions/:id", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
  const ok = await destroyAuthSessionById(id, "portal", discordUserId);
  if (!ok) return c.json({ error: "Session not found" }, 404);
  return c.json({ success: true });
});

portal.post("/sessions/revoke-others", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const rawId = getPortalSessionRawId(c);
  if (!rawId) return c.json({ error: "No current session" }, 400);
  const n = await destroyOtherAuthSessions("portal", rawId, discordUserId);
  return c.json({ success: true, revoked: n });
});

/** Revoke every portal session for this user (including current) and clear cookie. */
portal.post("/sessions/revoke-all", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const n = await destroyAllAuthSessions("portal", discordUserId);
  await destroyPortalSession(c);
  return c.json({ success: true, revoked: n });
});

// ─── Me ───────────────────────────────────────────────────────────────────────

portal.get("/me", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const [userKeys, settings] = await Promise.all([
    db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId)),
    db.select().from(userPortalSettings).where(eq(userPortalSettings.discordUserId, discordUserId)).then(r => r[0] ?? null),
  ]);

  const isTrial = await isTrialAccount(discordUserId);
  // Usage numbers must not flip to 1x when a membership lapses.
  const usageIsTrial = await statsIsTrial(discordUserId);
  const primaryKey =
    pickPrimaryNonTrialKey(userKeys) ||
    userKeys.find((k) => k.isActive) ||
    userKeys[0];
  const config = (await db.select().from(adminConfig).limit(1))[0] ?? null;

  const { getActiveAddonsForUser, sumAddonDailyTokenBonus, parseModelDailyLimits, resolveAddonQuotaStack } = await import("../../utils/addons.js");
  const activeAddons = !isTrial && primaryKey
    ? await getActiveAddonsForUser({
        discordUserId,
        apiKeyId: primaryKey.id,
      })
    : [];
  const addonDailyBonus = sumAddonDailyTokenBonus(activeAddons);
  const { isBlockedWithoutAddon } = await import("../../utils/role-limit-gate.js");
  const blockedWithoutAddon =
    !!primaryKey &&
    !isTrial &&
    isBlockedWithoutAddon(primaryKey as any, activeAddons.length);

  // Today's usage (WIB) — same token aggregation as Discord usage embed
  const todayStart = wibTodayStartDate();
  const dedicatedRules = primaryKey
    ? await listDedicatedQuotaRules(primaryKey.id)
    : [];
  const excludeDedicated = sqlExcludeDedicatedModels(dedicatedRules);
  const todayPw = and(
    userWhere(discordUserId),
    sql`created_at >= ${todayStart}`,
    sql`status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL`,
    excludeDedicated,
  );
  const todayHops = and(
    userWhere(discordUserId),
    sql`created_at >= ${todayStart}`,
    sql`status_code BETWEEN 200 AND 299`,
    excludeDedicated,
  );
  const usageToday = (await db.select({
    requests: turnCountSql(todayPw!),
    promptTokens: weightedHopInputTokensSql(todayHops!, { isTrial: usageIsTrial }),
    peakPromptTokens: peakPromptTokensSql(todayPw!, { isTrial: usageIsTrial }),
    billablePromptTokens: turnBillablePromptTokensSql(todayPw!, { isTrial: usageIsTrial }),
    cachedTokens: turnCachedTokensSql(todayPw!, { isTrial: usageIsTrial }),
    fullInputTokens: hopFullInputTokensSql(todayHops!, { isTrial: usageIsTrial }),
    rawProcessedInput: sql<number>`COALESCE(SUM(COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0)), 0)`,
    rawCompletionTokens: sql<number>`COALESCE(SUM(COALESCE(completion_tokens, 0)), 0)`,
    completionTokens: turnDisplayCompletionTokensSql(todayHops!, { isTrial: usageIsTrial }),
    totalTokens: weightedHopTotalTokensSql(todayHops!, { isTrial: usageIsTrial }),
  }).from(requestLogs).where(todayPw))[0];

  // This month usage (for monthly limit bar)
  const monthRange = resolvePeriodRange("thisMonth");
  const monthPw = and(
    userWhere(discordUserId),
    sql`created_at >= ${monthRange.start}`,
    sql`status_code BETWEEN 200 AND 299 AND turn_id IS NOT NULL`,
  );
  const monthHops = and(
    userWhere(discordUserId),
    sql`created_at >= ${monthRange.start}`,
    sql`status_code BETWEEN 200 AND 299`,
  );
  const usageMonth = (await db.select({
    tokens: weightedHopTotalTokensSql(monthHops!, { isTrial: usageIsTrial }),
  }).from(requestLogs).where(monthPw))[0];

  const { limit: promptLimit, window: promptLimitWindow } = primaryKey
    ? resolveKeyPromptLimit(primaryKey as any, config)
    : { limit: 0, window: "1d" };
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
    const plCheck = await checkPromptLimit(
      promptScopeIds,
      promptLimit,
      promptLimitWindow,
      primaryKey.promptWindowStart,
    );
    promptUsed = plCheck.used;
    promptResetMins = Math.ceil(plCheck.resetMs / 60000);
    promptResetAt = plCheck.resetMs > 0 ? new Date(Date.now() + plCheck.resetMs).toISOString() : null;
  }

  const { limit: apiCallLimit, window: apiCallLimitWindow } = primaryKey
    ? resolveKeyApiCallLimit(primaryKey as any, config)
    : { limit: 0, window: "5h" };
  let apiCallUsed = 0;
  let apiCallResetAt: string | null = null;
  let apiCallResetMins = 0;
  if (primaryKey && apiCallLimit > 0 && promptScopeIds.length > 0) {
    const acCheck = await checkApiCallLimit(
      promptScopeIds,
      apiCallLimit,
      apiCallLimitWindow,
      primaryKey.rateWindowStart,
    );
    apiCallUsed = acCheck.used;
    apiCallResetMins = Math.ceil(acCheck.resetMs / 60000);
    apiCallResetAt = acCheck.resetMs > 0 ? new Date(Date.now() + acCheck.resetMs).toISOString() : null;
  }

  // Per-model prompt usage (same as Discord /usage) — account-scoped
  const modelUsageLimits: Array<{
    model: string; used: number; limit: number; window: string; resetAt: string | null;
  }> = primaryKey
    ? (await buildModelPromptUsage({
        scopeIds: promptScopeIds,
        isTrial: !!isTrial,
        hasActiveAddons: activeAddons.length > 0,
        perKeyDefaultLimit: primaryKey.perModelPromptLimit || 0,
        perKeyDefaultWindow: primaryKey.perModelPromptLimitWindow || null,
        globalDefaultLimit: config?.globalPerModelPromptLimit || 0,
        globalDefaultWindow: config?.globalPerModelPromptLimitWindow || "1d",
      })).map((r) => ({
        model: r.model,
        used: r.used,
        limit: r.limit,
        window: r.window,
        resetAt: r.resetAt,
      }))
    : [];

  const pickLimit = (keyVal: number | null | undefined, globalVal: number | null | undefined) => {
    const k = Number(keyVal) || 0;
    const g = Number(globalVal) || 0;
    if (k > 0) return { value: k, source: "override" as const };
    if (g > 0) return { value: g, source: "global" as const };
    return { value: 0, source: "none" as const };
  };

  const quotaStack = resolveAddonQuotaStack({
    hasActiveAddon: activeAddons.length > 0,
    isTrial: !!isTrial || !!primaryKey?.isTrial,
    roleLimitMode: (primaryKey as any)?.roleLimitMode,
    keyDailyInput: primaryKey?.dailyInputTokenLimit,
    keyDailyOutput: primaryKey?.dailyOutputTokenLimit,
    keyDailyTotal: primaryKey?.dailyTokenLimit,
    globalDailyInput: config?.globalDailyInputTokenLimit,
    globalDailyOutput: config?.globalDailyOutputTokenLimit,
    addonDailyBonus,
  });
  const dailyInput = {
    value: quotaStack.dailyInputLimit,
    source: (Number(primaryKey?.dailyInputTokenLimit) > 0
      ? "override"
      : quotaStack.dailyInputLimit > 0
        ? quotaStack.addonBonus > 0 && quotaStack.inputBase <= 0
          ? "addon"
          : "global"
        : "none") as "override" | "global" | "none" | "addon",
  };
  const dailyOutput = {
    value: quotaStack.dailyOutputLimit,
    source: (Number(primaryKey?.dailyOutputTokenLimit) > 0
      ? "override"
      : quotaStack.dailyOutputLimit > 0
        ? "global"
        : "none") as "override" | "global" | "none",
  };
  const dailyTokenLimit = quotaStack.effectiveDaily;
  // Match Discord: key override OR global monthly
  const monthly = pickLimit(primaryKey?.monthlyTokenLimit, config?.globalMonthlyTokenLimit);
  const rate = pickLimit(primaryKey?.rateLimit, config?.globalRateLimit);
  const dailyTok = dailyTokenLimit > 0
    ? {
        value: dailyTokenLimit,
        source: (Number(primaryKey?.dailyTokenLimit) > 0
          ? "override"
          : primaryKey?.isTrial || isTrial
            ? "global"
            : "none") as "override" | "global" | "none" | "addon",
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
  const dedicatedPools: Array<{
    model: string;
    isPattern: boolean;
    scope: string;
    limit: number;
    used: number;
    remaining: number;
    resetAt: string;
    inputLimit?: number;
    outputLimit?: number;
    inputUsed?: number;
    outputUsed?: number;
  }> = [];
  if (!blockedWithoutAddon && dedicatedRules.length > 0 && accountKeyIds.length > 0) {
    for (const rule of dedicatedRules) {
      const wherePool = and(
        sql`api_key_id IN (${sql.join(accountKeyIds.map((id) => sql`${id}`), sql`, `)})`,
        sql`created_at >= ${todayStart}`,
        BILLABLE_LOG_SQL,
        sqlMatchDedicatedRule(rule),
      )!;
      const usedRow = await db
        .select({
          total: weightedHopTotalTokensSql(wherePool, { isTrial: usageIsTrial }),
          input: weightedHopInputTokensSql(wherePool, { isTrial: usageIsTrial }),
          output: turnCompletionTokensSql(wherePool, { isTrial: usageIsTrial }),
        })
        .from(requestLogs)
        .where(wherePool)
        .then((r) => r[0]);
      const used = Number(usedRow?.total) || 0;
      const limit = rule.dailyTokenLimit || 0;
      dedicatedPools.push({
        model: rule.model,
        isPattern: !!rule.isPattern,
        scope: rule.scope,
        limit,
        used,
        remaining: Math.max(0, limit - used),
        resetAt: dailyResetAt,
        inputLimit: rule.dailyInputTokenLimit || 0,
        outputLimit: rule.dailyOutputTokenLimit || 0,
        inputUsed: Number(usedRow?.input) || 0,
        outputUsed: Number(usedRow?.output) || 0,
      });
    }
  }
  const nextMonthWib = new Date(wibNow);
  nextMonthWib.setUTCMonth(nextMonthWib.getUTCMonth() + 1);
  nextMonthWib.setUTCDate(1);
  nextMonthWib.setUTCHours(0, 0, 0, 0);
  const monthlyResetAt = new Date(nextMonthWib.getTime() - wibOffset).toISOString();

  const { emptyInputLimitBreakdown, fetchInputLimitBreakdown } = await import("../../utils/usage-input-breakdown.js");
  let inputBreakdown = emptyInputLimitBreakdown();
  if (todayHops) {
    try {
      inputBreakdown = await fetchInputLimitBreakdown(todayHops);
    } catch (err) {
      console.warn("[portal/me] input breakdown failed:", (err as Error)?.message || err);
    }
  }

  const preferredLang =
    String((settings as any)?.preferredLang || "").toLowerCase() === "id" ? "id" : "en";

  // Trial expiry date
  let trialExpiresAt: string | null = null;
  if (isTrial && primaryKey) {
    const trialRow = (await db.select({ expiresAt: trialUsers.expiresAt })
      .from(trialUsers)
      .where(eq(trialUsers.apiKeyId, primaryKey.id))
      .limit(1))[0];
    if (trialRow) trialExpiresAt = trialRow.expiresAt?.toISOString() ?? null;
  }

  // Pending notifications: durable user_notifications + legacy key queue
  const pendingNotifications: any[] = [];
  try {
    const { listPortalNotifications, listPendingChallengesForUser } = await import(
      "../../utils/device-challenge.js"
    );
    const durable = await listPortalNotifications(discordUserId, 20);
    const now = Date.now();
    for (const n of durable) {
      let payload: any = {};
      try {
        payload = JSON.parse(n.payload || "{}");
      } catch {
        /* ignore */
      }
      const actionableUntil = n.actionableUntil ? new Date(n.actionableUntil).getTime() : 0;
      const expired = actionableUntil > 0 && actionableUntil <= now;
      pendingNotifications.push({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        actionable: n.type === "device_confirm" && !expired && payload.challengeId && payload.token,
        expired,
        challengeId: payload.challengeId,
        token: payload.token,
        expiresAt: payload.expiresAt,
      });
    }
    (c as any)._pendingChallenges = await listPendingChallengesForUser(discordUserId);
  } catch {
    /* ignore */
  }
  for (const k of userKeys) {
    if (k.pendingNotification) {
      try {
        const parsed = JSON.parse(k.pendingNotification);
        if (Array.isArray(parsed)) pendingNotifications.push(...parsed);
        else if (parsed && typeof parsed === "object") pendingNotifications.push(parsed);
      } catch { /* ignore */ }
    }
  }

  let accountBadges: string[] = [];
  try {
    accountBadges = JSON.parse((primaryKey as any)?.accountBadges || "[]");
    if (!Array.isArray(accountBadges)) accountBadges = [];
  } catch {
    accountBadges = [];
  }
  // Never expose Admin Override as a portal badge (any casing / spacing)
  accountBadges = accountBadges
    .map((b) => String(b || "").trim())
    .filter((b) => {
      const n = b.toLowerCase().replace(/[\s-]+/g, "_");
      return n && n !== "admin_override" && n !== "none" && n !== "adminoverride";
    });
  if (!isTrial) {
    accountBadges = accountBadges.filter((b) => b.toLowerCase() !== "trial");
  }
  if (isTrial) {
    accountBadges = ["trial", ...accountBadges.filter((b) => b !== "trial")];
  } else if (accountBadges.length === 0) {
    const tierHint = String((primaryKey as any)?.accountTier || "").trim();
    if (tierHint && tierHint !== "none" && tierHint !== "admin_override") {
      accountBadges = [tierHint];
    } else {
      accountBadges = ["phantom"];
    }
  }
  if (!isTrial && activeAddons.length > 0 && !accountBadges.includes("addon")) {
    accountBadges = [...accountBadges, "addon"];
  }

  const tierRaw = String((primaryKey as any)?.accountTier || "").trim();
  // Prefer real membership / staff tiers — never "admin_override"
  let accountType = isTrial
    ? "trial"
    : tierRaw && tierRaw !== "none" && tierRaw !== "admin_override"
      ? tierRaw
      : accountBadges.includes("moderator") ||
          accountBadges.includes("troubleshooter") ||
          accountBadges.includes("contributor") ||
          accountBadges.includes("staff")
        ? "staff"
        : accountBadges.includes("phantom")
          ? "phantom"
          : accountBadges.includes("pro")
            ? "pro"
            : accountBadges.includes("premium")
              ? "premium"
              : "phantom";

  return c.json(await (await import("../../utils/vendor-aliases.js")).withPublicizedModels({
    discordUserId,
    discordUsername: primaryKey?.discordUsername ?? null,
    accountType,
    accountBadges,
    trialExpiresAt,
    hasPassword: !!settings?.passwordHash,
    preferredLang,
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
      peakPromptTokens: (usageToday as any)?.peakPromptTokens || 0,
      billablePromptTokens: usageToday?.billablePromptTokens || 0,
      cachedTokens: usageToday?.cachedTokens || 0,
      fullInputTokens: (usageToday as any)?.fullInputTokens || 0,
      rawProcessedInput: (usageToday as any)?.rawProcessedInput || 0,
      rawCompletionTokens: (usageToday as any)?.rawCompletionTokens || 0,
      completionTokens: usageToday?.completionTokens || 0,
      // Rolling prompt window usage (matches Discord), NOT all-day requests
      promptCount: promptUsed,
      apiCallCount: apiCallUsed,
      totalTokens: (usageToday as any)?.totalTokens
        ?? ((usageToday?.promptTokens || 0) + (usageToday?.completionTokens || 0)),
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
    inputBreakdown,
    dedicatedPools,
    blockedWithoutAddon,
    roleLimitMode: (primaryKey as any)?.roleLimitMode || null,
    modelUsageLimits,
    dailyTokenBreakdown: {
      base: quotaStack.inputBase,
      addonBonus: quotaStack.addonBonus,
      effective: quotaStack.dailyInputLimit,
      bypassIo: false,
      inputBase: quotaStack.inputBase,
      outputBase: quotaStack.outputBase,
      dailyTotal: quotaStack.effectiveDaily,
    },
    activeAddons: activeAddons.map((a) => ({
      name: a.name,
      expiresAt: a.expiresAt ? new Date(a.expiresAt).toISOString() : null,
      dailyTokenLimit: a.dailyTokenLimit || 0,
    })),
    addonHistory: await (async () => {
      if (isTrial) return [];
      try {
        const { listAddonHistoryForUser } = await import("../../utils/addons.js");
        return await listAddonHistoryForUser(
          {
            discordUserId,
            apiKeyIds: userKeys.map((k) => k.id),
          },
          30,
        );
      } catch {
        return [];
      }
    })(),
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
    pendingDeviceChallenges: Array.isArray((c as any)._pendingChallenges)
      ? (c as any)._pendingChallenges.map((ch: any) => ({
          id: ch.id,
          token: ch.token,
          fingerprint: ch.fingerprint,
          ideDetected: ch.ideDetected,
          expiresAt: ch.expiresAt,
        }))
      : [],
    tokenSaver: await (async () => {
      const { packGlobalTokenSaver, packUserTokenSaverOverrides } = await import("../../utils/token-saver-api.js");
      return {
        global: packGlobalTokenSaver(config),
        overrides: packUserTokenSaverOverrides(settings),
      };
    })(),
  }));
});

// ─── Stats ────────────────────────────────────────────────────────────────────

portal.get("/stats/usage-breakdown", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  try {
    const period = parseUsageBreakdownPeriod(c.req.query("period"));
    return c.json(await getAccountUsageBreakdown(discordUserId, period));
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

portal.get("/stats/overview", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const period = (c.req.query("period") || "today") as PeriodKey;
  const pw = periodWhere(discordUserId, period);
  const hops = periodWhereHops(discordUserId, period);
  const isTrial = await statsIsTrial(discordUserId);

  const stats = (await db.select({
    requests: turnCountSql(pw),
    apiCalls: hopCountSql(hops),
    tokens: weightedHopTotalTokensSql(hops, { isTrial }),
    promptTokens: weightedHopInputTokensSql(hops, { isTrial }),
    billablePromptTokens: turnBillablePromptTokensSql(pw, { isTrial }),
    cachedTokens: turnCachedTokensSql(pw, { isTrial }),
    peakPromptTokens: peakPromptTokensSql(pw, { isTrial }),
    completionTokens: turnDisplayCompletionTokensSql(hops, { isTrial }),
  }).from(requestLogs).where(pw))[0];

  const sessionWhere = userWhere(discordUserId);
  const sessionCount = (await db.select({ count: sql<number>`count(*)` }).from(chatSessions).where(sessionWhere))[0];
  // Hops where the model actually invoked tools (not SUM(tool_count) — that
  // counted request tool *definitions* on every hop and inflated vs Hermes).
  const toolCount = (await db.select({
    count: sql<number>`COALESCE(SUM(CASE WHEN actual_tool_calls_in_response = true THEN 1 ELSE 0 END), 0)`,
  }).from(requestLogs).where(pw))[0];

  // Cost breakdown by model — same limit-credit rows as by-model / gates
  const range = resolvePeriodRange(period);
  const costWhere = sql`
    api_key_id IN (${userApiKeyIds(discordUserId)})
    AND created_at >= ${range.start}
    ${range.end ? sql`AND created_at <= ${range.end}` : sql``}
    AND status_code BETWEEN 200 AND 299
  `;
  const breakdownRows = sanitizeRows(
    (await db.execute(modelLimitCreditBreakdownSql(costWhere, { isTrial, limit: 50 }))).rows as any[],
    ["promptTokens", "completionTokens", "tokens"],
  );

  let promptCost = 0;
  let completionCost = 0;
  for (const row of breakdownRows) {
    const rates = getModelRates(row.model || "");
    promptCost += Math.round(row.promptTokens * rates.prompt);
    completionCost += Math.round(row.completionTokens * rates.completion);
  }

  return c.json({
    requests: stats?.requests || 0,
    apiCalls: stats?.apiCalls || 0,
    tokens: stats?.tokens || 0,
    promptTokens: stats?.promptTokens || 0,
    billablePromptTokens: stats?.billablePromptTokens || 0,
    cachedTokens: stats?.cachedTokens || 0,
    peakPromptTokens: stats?.peakPromptTokens || 0,
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
  const isTrial = await statsIsTrial(discordUserId);

  const groupExpr = days <= 1
    ? sql`to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:00')`
    : sql`to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`;

  const whereExtra = sql`
    api_key_id IN (${userApiKeyIds(discordUserId)})
    AND created_at >= ${range.start}
    ${range.end ? sql`AND created_at <= ${range.end}` : sql``}
    AND status_code BETWEEN 200 AND 299
  `;

  const rows = sanitizeRows(
    (await db.execute(hopWeightedTimeseriesSql(groupExpr, whereExtra, { isTrial }))).rows as any[],
    ["requests", "apiCalls", "tokens", "promptTokens", "completionTokens"],
  );

  return c.json(rows);
});

portal.get("/stats/by-model", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const period = (c.req.query("period") || "today") as PeriodKey;
  const range = resolvePeriodRange(period);
  const isTrial = await statsIsTrial(discordUserId);

  const extraWhere = sql`
    api_key_id IN (${userApiKeyIds(discordUserId)})
    AND created_at >= ${range.start}
    ${range.end ? sql`AND created_at <= ${range.end}` : sql``}
    AND status_code BETWEEN 200 AND 299
  `;

  const rows = sanitizeRows(
    (await db.execute(modelLimitCreditBreakdownSql(extraWhere, { isTrial, limit: 20 }))).rows as any[],
    ["requests", "promptTokens", "completionTokens", "displayCompletionTokens", "tokens"],
  );

  return c.json(
    await (await import("../../utils/vendor-aliases.js")).withPublicizedModels(
      rows.map((r: any) => ({
        ...r,
        completionTokens: Number(r.displayCompletionTokens) || Number(r.completionTokens) || 0,
        billablePromptTokens: r.promptTokens,
        cachedTokens: 0,
      })),
    ),
  );
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

  return c.json(await (await import("../../utils/vendor-aliases.js")).withPublicizedModels(rows.map(r => ({
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
  }))));
});

portal.get("/stats/compare", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const isTrial = await statsIsTrial(discordUserId);

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
    const hops = and(
      userWhere(discordUserId),
      sql`created_at >= ${start}`,
      sql`created_at <= ${end}`,
      sql`status_code BETWEEN 200 AND 299`,
    );
    const stats = (await db.select({
      requests: turnCountSql(pw),
      apiCalls: hopCountSql(hops),
      tokens: weightedHopTotalTokensSql(hops, { isTrial }),
      promptTokens: weightedHopInputTokensSql(hops, { isTrial }),
      billablePromptTokens: turnBillablePromptTokensSql(pw, { isTrial }),
      cachedTokens: turnCachedTokensSql(pw, { isTrial }),
      completionTokens: turnDisplayCompletionTokensSql(hops, { isTrial }),
    }).from(requestLogs).where(pw))[0];

    const breakdownRows = sanitizeRows(
      (
        await db.execute(
          modelLimitCreditBreakdownSql(
            sql`api_key_id IN (${userApiKeyIds(discordUserId)})
              AND created_at >= ${start}
              AND created_at <= ${end}
              AND status_code BETWEEN 200 AND 299`,
            { isTrial },
          ),
        )
      ).rows as any[],
      ["promptTokens", "completionTokens"],
    );

    let promptCost = 0, completionCost = 0;
    for (const row of breakdownRows) {
      const rates = getModelRates(row.model || "");
      promptCost += Math.round(row.promptTokens * rates.prompt);
      completionCost += Math.round(row.completionTokens * rates.completion);
    }

    return {
      requests: stats?.requests || 0,
      apiCalls: stats?.apiCalls || 0,
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
  const isTrial = await statsIsTrial(discordUserId);

  const userKeys = await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId));
  const primaryKey =
    pickPrimaryNonTrialKey(userKeys) ||
    userKeys.find((k) => k.isActive) ||
    userKeys[0];

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
    const todayHops = and(
      userWhere(discordUserId),
      sql`created_at >= ${todayStart}`,
      sql`status_code BETWEEN 200 AND 299`,
    );
    const todayStats = (await db.select({
      tokens: weightedHopTotalTokensSql(todayHops!, { isTrial }),
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
      const monthHopsFc = and(
        userWhere(discordUserId),
        sql`created_at >= ${monthStartUtc}`,
        sql`status_code BETWEEN 200 AND 299`,
      );
      const monthStats = (await db.select({
        tokens: weightedHopTotalTokensSql(monthHopsFc!, { isTrial }),
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
  const userKeys = sortKeysPrimaryFirst(
    await db.select().from(apiKeys).where(eq(apiKeys.discordUserId, discordUserId)),
  );
  const result = [];
  const todayStart = wibTodayStartDate();

  // Primary badges: trial (if any) + override/phantom/oldest non-trial
  const primaryIds = new Set(getPortalPrimaryKeyIds(userKeys));
  // Account-level tier so per-key rows sum to the account total shown elsewhere.
  const keyTier = await statsIsTrial(discordUserId);

  for (const key of userKeys) {
    const todayHops = and(
      eq(requestLogs.apiKeyId, key.id),
      sql`created_at >= ${todayStart}`,
      sql`status_code BETWEEN 200 AND 299`,
    );
    const todayPw = and(
      todayHops,
      sql`turn_id IS NOT NULL`,
    );
    const todayStats = (await db.select({
      requests: turnCountSql(todayPw!),
      hops: hopCountSql(todayHops!),
      tokens: weightedHopTotalTokensSql(todayHops!, { isTrial: keyTier }),
      input: weightedHopInputTokensSql(todayHops!, { isTrial: keyTier }),
      output: turnCompletionTokensSql(todayPw!, { isTrial: keyTier }),
    }).from(requestLogs).where(todayHops))[0];

    const isPrimary = primaryIds.has(key.id);
    result.push({
      id: key.id,
      name: key.name,
      key: key.key,
      keyPrefix: key.keyPrefix,
      keyMasked: maskKey(key.key),
      isActive: key.isActive,
      isTrial: key.isTrial || false,
      isPrimary,
      canDelete: canUserDeleteApiKey(key),
      provisionedBy: key.provisionedBy,
      createdAt: key.createdAt,
      requestsToday: todayStats?.requests || 0,
      apiCallsToday: todayStats?.hops || 0,
      tokensToday: todayStats?.tokens || 0,
      inputToday: todayStats?.input || 0,
      outputToday: todayStats?.output || 0,
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

  // Copy limits from portal Primary (same as Discord resend)
  const primaryKey = pickPrimaryNonTrialKey(existing) || existing[0];
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

  const proxyEndpoint = `${process.env.PROXY_PUBLIC_BASE_URL || "https://api.tokito.xyz"}/v1`;
  const notification = {
    type: "portal_key_created",
    discordUserId,
    newKey,
    endpoint: proxyEndpoint,
    keyName: name.trim(),
    keyId: result.id,
    createdAt: new Date().toISOString(),
  };
  await db
    .update(apiKeys)
    .set({ pendingNotification: JSON.stringify(notification) })
    .where(eq(apiKeys.id, result.id));

  return c.json({ ...result, key: newKey });
});

portal.delete("/keys/:id", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const keyId = parseInt(c.req.param("id"));

  const key = (await db.select().from(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.discordUserId, discordUserId)))).find(Boolean);
  if (!key) return c.json({ error: "Key not found" }, 404);

  if (isProtectedPrimaryApiKey(key) || !canUserDeleteApiKey(key)) {
    return c.json({ error: "Cannot delete this API key. Only keys you created yourself can be deleted." }, 403);
  }

  // Also block deleting the sole remaining key for this Discord account
  const siblings = await db.select({ id: apiKeys.id, provisionedBy: apiKeys.provisionedBy, isTrial: apiKeys.isTrial })
    .from(apiKeys)
    .where(eq(apiKeys.discordUserId, discordUserId));
  const hasProtectedPrimary = siblings.some((k) => isProtectedPrimaryApiKey(k));
  if (!hasProtectedPrimary && siblings.length <= 1) {
    return c.json({ error: "Cannot delete your only API key." }, 403);
  }

  // Queue DM on a remaining sibling before delete
  const other = siblings.find((k) => k.id !== keyId);
  if (other) {
    const notification = {
      type: "portal_key_deleted",
      discordUserId,
      keyName: key.name,
      keyId: other.id,
      deletedKeyId: key.id,
      deletedAt: new Date().toISOString(),
    };
    await db
      .update(apiKeys)
      .set({ pendingNotification: JSON.stringify(notification) })
      .where(eq(apiKeys.id, other.id));
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

  try {
    // Account-scoped: device slots are shared across the account's keys, so a
    // device held by a sibling key still has to be visible here.
    const devs = (await listAccountDevices(keyId)).slice(0, 50);
    return c.json(devs.map(d => ({
      fingerprint: d.fingerprint,
      fingerprintShort: String(d.fingerprint || "").substring(0, 12),
      deviceName: d.deviceName,
      ideDetected: d.ideDetected,
      osDetected: d.osDetected,
      ipAddress: d.ipAddress,
      userAgentRaw: d.userAgentRaw ? d.userAgentRaw.substring(0, 80) : null,
      requestCount: d.requestCount,
      lastSeen: d.lastSeen,
      firstSeen: d.firstSeen,
      isBlocked: d.isBlocked,
      ownerKeyId: d.ownerKeyId,
      ownerKeyName: d.ownerKeyName,
      isCurrentKey: d.isCurrentKey,
    })));
  } catch (err: any) {
    console.error("[portal] listAccountDevices failed:", keyId, err?.message || err);
    return c.json({ error: err?.message || "Failed to load devices" }, 500);
  }
});

portal.delete("/keys/:id/devices/:fingerprint", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const keyId = parseInt(c.req.param("id"));
  const fingerprint = c.req.param("fingerprint");

  const key = (await db.select().from(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.discordUserId, discordUserId)))).find(Boolean);
  if (!key) return c.json({ error: "Key not found" }, 404);

  // The row may live under a sibling key; freeing the slot means deleting it
  // wherever it sits inside this Discord account.
  await db.delete(devices).where(and(
    eq(devices.fingerprint, fingerprint),
    sql`${devices.apiKeyId} IN (SELECT id FROM api_keys WHERE discord_user_id = ${discordUserId})`,
  ));
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

  const isTrial = await statsIsTrial(discordUserId);

  const rows = await db.select({
    id: requestLogs.id,
    model: requestLogs.model,
    promptTokens: requestLogs.promptTokens,
    completionTokens: requestLogs.completionTokens,
    totalTokens: requestLogs.totalTokens,
    cachedTokens: requestLogs.cachedTokens,
    upstreamCredits: requestLogs.upstreamCredits,
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

  return c.json(await (await import("../../utils/vendor-aliases.js")).withPublicizedModels({
    data: rows.map(r => {
      const uc = Math.max(0, Number(r.upstreamCredits) || 0);
      // Compat meter hops: limits use upstream meter; activity shows raw prompt/cache/out (no brand wording).
      const { upstreamCredits: _dropCredits, ...rest } = r as typeof r & { upstreamCredits?: number };
      if (uc > 0) {
        const billable = Number(r.promptTokens) || 0;
        const cached = Number(r.cachedTokens) || 0;
        const completion = Number(r.completionTokens) || 0;
        return {
          ...rest,
          billablePromptTokens: billable,
          cachedTokens: cached,
          inputTokens: billable + cached,
          promptTokens: billable + cached,
          completionTokens: completion,
          totalTokens: billable + cached + completion,
          errorMessage: sanitizeErrorMsg(r.errorMessage),
          requestPreview: sanitizePreview(r.requestPreview),
          responsePreview: sanitizePreview(r.responsePreview),
        };
      }
      // Same scaled numbers as Overview / gates (never expose raw upstream counts).
      const { input, output } = resolveTokenMultipliers(r.model, { isTrial });
      const billable = Math.round((Number(r.promptTokens) || 0) * input);
      const cached = Math.round((Number(r.cachedTokens) || 0) * input);
      const completion = Math.round((Number(r.completionTokens) || 0) * output);
      const inputTokens = billable + cached;
      return {
        ...rest,
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
  }));
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

    // Same matrix as Discord /v1/models — provider-strict (no bare-ID Online borrow)
    const { getAllClientCatalogMonitorRows, buildProviderStrictStatusLookup } = await import(
      "../../utils/model-catalog.js"
    );
    const monitorRows = await getAllClientCatalogMonitorRows();
    const { loadVendorAliasIndex } = await import("../../utils/vendor-aliases.js");
    const aliasIndex = await loadVendorAliasIndex();
    const { lookup } = buildProviderStrictStatusLookup(monitorRows, aliasIndex);

    // checkedAt by provider/model for display
    const checkedAtByKey = new Map<string, Date>();
    const checkedRows = await db
      .select({
        modelId: modelMonitor.modelId,
        provider: modelMonitor.provider,
        checkedAt: modelMonitor.checkedAt,
      })
      .from(modelMonitor)
      .orderBy(desc(modelMonitor.checkedAt));
    for (const row of checkedRows) {
      if (!row.checkedAt || !row.provider) continue;
      const k = `${row.provider}/${row.modelId}`;
      if (!checkedAtByKey.has(k)) checkedAtByKey.set(k, row.checkedAt);
      if (row.modelId.includes("/") && !checkedAtByKey.has(row.modelId)) {
        checkedAtByKey.set(row.modelId, row.checkedAt);
      }
    }

    return c.json(
      allModels
        .map((m) => {
          const st = lookup(m.id);
          if (!st) return null;
          // Align with Discord + /v1/models: Unpublished = hidden (not Offline row)
          if (!st.visible) return null;
          const checkedAt =
            checkedAtByKey.get(m.id) ||
            checkedAtByKey.get(`${st.provider}/${m.id}`) ||
            null;
          return {
            id: m.id,
            allowed: true,
            online: Boolean(st.clientOnline),
            checkedAt: checkedAt?.toISOString() ?? null,
            lastCheckedMinutes: checkedAt ? minutesAgo(checkedAt) : null,
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

  const userKeys = await db.select({
    id: apiKeys.id,
    name: apiKeys.name,
    isTrial: apiKeys.isTrial,
    isActive: apiKeys.isActive,
    provisionedBy: apiKeys.provisionedBy,
  })
    .from(apiKeys)
    .where(eq(apiKeys.discordUserId, discordUserId));
  const primaryKey =
    pickPrimaryNonTrialKey(userKeys) ||
    userKeys.find((k) => k.isActive) ||
    userKeys[0];
  const primaryKeyName = primaryKey?.name ?? null;

  // Days until open (countdown phase) or days left open (inclusive-ish).
  let daysUntilOpen: number | null = null;
  let daysUntilClose: number | null = null;
  const day = window.todayDay;
  if (!window.isOpen) {
    daysUntilOpen = Math.max(0, window.openDay - day);
  } else if (day <= 5) {
    daysUntilClose = Math.max(0, 5 - day);
  } else {
    // Open in end-of-month segment: remaining days in month + 5 of next month.
    const [y, m] = window.yearMonth.split("-").map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    daysUntilClose = Math.max(0, (dim - day) + 5);
  }

  // phase: hidden | countdown (panel visible, not open) | open
  let phase: "hidden" | "countdown" | "open" = "hidden";
  if (window.isOpen) phase = "open";
  else if (window.panelVisible) phase = "countdown";

  return c.json({
    ...window,
    phase,
    daysUntilOpen,
    daysUntilClose,
    recapUrl: primaryKeyName ? `/recap/${encodeURIComponent(primaryKeyName)}` : null,
    openDate: !window.isOpen
      ? `${window.yearMonth}-${String(window.openDay).padStart(2, "0")}`
      : null,
    closeHint: `5 ${window.closeMonthLabel}`,
  });
});

/** Prepare (generate/cache) current user's recap and return URL + day token. */
portal.post("/recap/open", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const window = getRecapWindow();
  if (!window.isOpen) {
    return c.json({ error: "Recap window is closed", message: window.message, ...window }, 403);
  }

  const port = process.env.PORT || "3000";
  const secret = process.env.INTERNAL_API_SECRET || "";
  let data: any = null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/admin/internal/recap/${discordUserId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({ interactive: true, yearMonth: window.yearMonth }),
      signal: AbortSignal.timeout(120_000),
    });
    data = await res.json().catch(() => null);
    if (!res.ok) {
      return c.json(
        { error: data?.error || `Generate failed (${res.status})`, details: data },
        res.status as 400,
      );
    }
  } catch (err: any) {
    return c.json({ error: err?.message || "Generate failed" }, 502);
  }

  const name = data?.apiKeyName;
  if (!name) {
    return c.json({ error: "No API key / recap for this account" }, 404);
  }
  const token = data?.shareToken ? String(data.shareToken) : "";
  const qs = token ? `?t=${encodeURIComponent(token)}&from=portal` : "?from=portal";
  return c.json({
    success: true,
    yearMonth: window.yearMonth,
    monthLabel: window.monthLabel,
    degraded: !!data?.degraded,
    recapUrl: `/recap/${encodeURIComponent(name)}${qs}`,
  });
});

// ─── Notifications ────────────────────────────────────────────────────────────

portal.get("/notifications", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const {
    listPortalNotifications,
    listPendingChallengesForUser,
  } = await import("../../utils/device-challenge.js");
  const durable = await listPortalNotifications(discordUserId, 50);
  const pendingChallenges = await listPendingChallengesForUser(discordUserId);
  const now = Date.now();
  const notifications = durable.map((n) => {
    let payload: any = {};
    try {
      payload = JSON.parse(n.payload || "{}");
    } catch {
      /* ignore */
    }
    const actionableUntil = n.actionableUntil
      ? new Date(n.actionableUntil).getTime()
      : 0;
    const expired = actionableUntil > 0 && actionableUntil <= now;
    const actionable =
      n.type === "device_confirm" &&
      !expired &&
      !!payload.challengeId &&
      !!payload.token;
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      createdAt: n.createdAt,
      readAt: n.readAt,
      actionableUntil: n.actionableUntil,
      expired,
      actionable,
      challengeId: payload.challengeId || null,
      token: payload.token || null,
      fingerprint: payload.fingerprint || null,
      ideDetected: payload.ideDetected || null,
    };
  });

  return c.json({
    notifications,
    count: notifications.length,
    pendingChallenges: pendingChallenges.map((ch) => ({
      id: ch.id,
      token: ch.token,
      fingerprint: ch.fingerprint,
      ideDetected: ch.ideDetected,
      expiresAt: ch.expiresAt,
      status: ch.status,
    })),
  });
});

portal.post("/notifications/dismiss", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const { userNotifications } = await import("../../db/schema.js");
  const { eq: eqq } = await import("drizzle-orm");
  await db
    .update(userNotifications)
    .set({ readAt: new Date() })
    .where(eqq(userNotifications.discordUserId, discordUserId));

  const userKeys = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.discordUserId, discordUserId));
  for (const k of userKeys) {
    await db
      .update(apiKeys)
      .set({ pendingNotification: null, updatedAt: new Date() })
      .where(eq(apiKeys.id, k.id));
  }

  return c.json({ success: true });
});

portal.post("/device-challenge/:id/approve", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json<{ token?: string }>();
  if (!body.token) return c.json({ error: "token required" }, 400);
  const { approveChallenge } = await import("../../utils/device-challenge.js");
  const result = await approveChallenge(id, body.token, discordUserId);
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json({ success: true });
});

portal.post("/device-challenge/:id/deny", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json<{ token?: string }>();
  if (!body.token) return c.json({ error: "token required" }, 400);
  const { denyChallenge } = await import("../../utils/device-challenge.js");
  const result = await denyChallenge(id, body.token, discordUserId);
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json({ success: true, blacklisted: !!result.blacklisted });
});

portal.get("/keys/:id/device-policy-rules", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const keyId = parseInt(c.req.param("id"));
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1);
  if (!key || key.discordUserId !== discordUserId) return c.json({ error: "Not found" }, 404);
  const { allowedDevices } = await import("../../db/schema.js");
  const { accountKeyIdsSql } = await import("../../utils/account-devices.js");
  const rules = await db
    .select()
    .from(allowedDevices)
    .where(sql`${allowedDevices.apiKeyId} IN ${accountKeyIdsSql(keyId)}`);
  return c.json({ rules });
});

portal.delete("/keys/:id/device-blacklist/:fingerprint", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const keyId = parseInt(c.req.param("id"));
  const fingerprint = decodeURIComponent(c.req.param("fingerprint"));
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1);
  if (!key || key.discordUserId !== discordUserId) return c.json({ error: "Not found" }, 404);
  const { allowedDevices, devices: devicesTable } = await import("../../db/schema.js");
  const { accountKeyIdsSql } = await import("../../utils/account-devices.js");
  const { and: andq, eq: eqq } = await import("drizzle-orm");
  await db.delete(allowedDevices).where(
    andq(
      sql`${allowedDevices.apiKeyId} IN ${accountKeyIdsSql(keyId)}`,
      eqq(allowedDevices.fingerprint, fingerprint),
      eqq(allowedDevices.listType, "block"),
    ),
  );
  await db
    .update(devicesTable)
    .set({ isBlocked: false })
    .where(
      andq(
        sql`${devicesTable.apiKeyId} IN ${accountKeyIdsSql(keyId)}`,
        eqq(devicesTable.fingerprint, fingerprint),
      ),
    );
  return c.json({ success: true });
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

  await destroyAllAuthSessions("portal", discordUserId);
  await destroyPortalSession(c);

  return c.json({ success: true });
});

portal.delete("/settings/password", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  await db.update(userPortalSettings)
    .set({ passwordHash: null, passwordSetAt: null, updatedAt: new Date() })
    .where(eq(userPortalSettings.discordUserId, discordUserId));

  await destroyAllAuthSessions("portal", discordUserId);
  await destroyPortalSession(c);

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

// Preferred UI language (portal + Discord embeds)
portal.put("/settings/lang", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const body = await c.req.json<{ lang?: string }>().catch(() => ({} as { lang?: string }));
  const lang = String(body.lang || "").toLowerCase() === "id" ? "id" : "en";
  const settings = (
    await db.select().from(userPortalSettings).where(eq(userPortalSettings.discordUserId, discordUserId))
  )[0];
  if (settings) {
    await db
      .update(userPortalSettings)
      .set({ preferredLang: lang, updatedAt: new Date() })
      .where(eq(userPortalSettings.discordUserId, discordUserId));
  } else {
    await db.insert(userPortalSettings).values({ discordUserId, preferredLang: lang });
  }
  return c.json({ success: true, preferredLang: lang });
});

// Token Saver per-user overrides (tri-state: null=default, true=on, false=off)
portal.get("/settings/token-saver", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const [settings, config] = await Promise.all([
    db.select().from(userPortalSettings).where(eq(userPortalSettings.discordUserId, discordUserId)).then(r => r[0] ?? null),
    db.select().from(adminConfig).limit(1).then(r => r[0] ?? null),
  ]);
  const { packGlobalTokenSaver, packUserTokenSaverOverrides } = await import("../../utils/token-saver-api.js");
  return c.json({
    global: packGlobalTokenSaver(config),
    overrides: packUserTokenSaverOverrides(settings),
  });
});

portal.put("/settings/token-saver", async (c) => {
  const discordUserId = getPortalDiscordUserId(c)!;
  const body = await c.req.json<any>();
  const { applyUserTokenSaverUpdates, packUserTokenSaverOverrides } = await import("../../utils/token-saver-api.js");

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  applyUserTokenSaverUpdates(body, updates);

  const [existing] = await db
    .select()
    .from(userPortalSettings)
    .where(eq(userPortalSettings.discordUserId, discordUserId))
    .limit(1);

  if (existing) {
    await db
      .update(userPortalSettings)
      .set(updates as any)
      .where(eq(userPortalSettings.discordUserId, discordUserId));
  } else {
    await db.insert(userPortalSettings).values({
      discordUserId,
      ...(updates as any),
    });
  }

  const [refreshed] = await db
    .select()
    .from(userPortalSettings)
    .where(eq(userPortalSettings.discordUserId, discordUserId))
    .limit(1);

  return c.json({
    success: true,
    overrides: packUserTokenSaverOverrides(refreshed),
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