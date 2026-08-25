import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { addonAssignments, addons, adminConfig, type Addon } from "../db/schema.js";
import { normalizeModelForLimit } from "./rate-limit.js";
import { getTeaseLimitForModel, isTeaseModelFromLimits } from "./tease-limits-cache.js";

export type ActiveAddon = Addon & {
  assignmentId: number;
  startsAt: Date | null;
  expiresAt: Date | null;
};

export type AccessMode = "allowlist" | "all_except";

function parseAllowlist(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => String(x || "").trim()).filter(Boolean);
  } catch {
    return String(raw || "")
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

export function parsePatternList(raw: string | null | undefined): string[] {
  return parseAllowlist(raw);
}

/** Parse JSON object of pattern -> daily token limit. */
export function parseModelDailyLimits(raw: string | null | undefined): Record<string, number> {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const key = String(k || "").trim();
      const n = Math.max(0, Number(v) || 0);
      if (key && n > 0) out[key] = n;
    }
    return out;
  } catch {
    return {};
  }
}

export function modelMatchesAllowlist(model: string, allowlist: string[]): boolean {
  if (!allowlist.length) return false;
  const lower = model.toLowerCase();
  return allowlist.some((pat) => {
    const p = pat.toLowerCase();
    return lower === p || lower.includes(p) || lower.endsWith("/" + p);
  });
}

function getAccessMode(a: Addon): AccessMode {
  return a.accessMode === "all_except" ? "all_except" : "allowlist";
}

/**
 * Active add-on assignments for a Discord user and/or API key.
 * Role-based eligibility is resolved separately by the bot when assigning;
 * at request time we only honor explicit assignment rows.
 *
 * Matching is fail-open across ownership shapes:
 *   - assignment.discord_user_id = user
 *   - assignment.api_key_id = given key
 *   - assignment.api_key_id on ANY sibling key of the same Discord user
 * Expiry uses SQL NOW() so JS/DB timezone binding cannot false-miss an active pack.
 */
export async function getActiveAddonsForUser(opts: {
  discordUserId?: string | null;
  apiKeyId?: number | null;
}): Promise<ActiveAddon[]> {
  const conditions = [eq(addonAssignments.isActive, true), eq(addons.isActive, true)];

  const ownerParts = [];
  if (opts.discordUserId) {
    ownerParts.push(eq(addonAssignments.discordUserId, opts.discordUserId));
    // Assignments linked only by api_key_id still count for that Discord account
    ownerParts.push(
      sql`${addonAssignments.apiKeyId} IN (
        SELECT id FROM api_keys
        WHERE discord_user_id = ${opts.discordUserId}
      )`,
    );
  }
  if (opts.apiKeyId && opts.apiKeyId > 0) {
    ownerParts.push(eq(addonAssignments.apiKeyId, opts.apiKeyId));
  }
  if (ownerParts.length === 0) return [];

  const rows = await db
    .select({
      addon: addons,
      assignmentId: addonAssignments.id,
      expiresAt: addonAssignments.expiresAt,
      startsAt: addonAssignments.startsAt,
    })
    .from(addonAssignments)
    .innerJoin(addons, eq(addonAssignments.addonId, addons.id))
    .where(
      and(
        ...conditions,
        or(...ownerParts),
        sql`${addonAssignments.startsAt} <= NOW()`,
        or(isNull(addonAssignments.expiresAt), sql`${addonAssignments.expiresAt} > NOW()`),
      ),
    );

  // Dedupe by addon id (user may have key + discord assignment)
  const byId = new Map<number, ActiveAddon>();
  for (const r of rows) {
    if (!byId.has(r.addon.id)) {
      byId.set(r.addon.id, {
        ...r.addon,
        assignmentId: r.assignmentId,
        startsAt: r.startsAt,
        expiresAt: r.expiresAt,
      });
    }
  }
  return Array.from(byId.values());
}

/**
 * Distinct Discord role IDs attached to active add-on catalog packs.
 * Tier roles (Premium/Pro/Phantom/Staff) are NEVER returned — using those as
 * pack roles polluted every Premium user with an "addon" badge.
 */
export async function listActiveAddonDiscordRoleIds(): Promise<Set<string>> {
  const rows = await db
    .select({ roleId: addons.discordRoleId })
    .from(addons)
    .where(
      and(
        eq(addons.isActive, true),
        sql`${addons.discordRoleId} IS NOT NULL AND TRIM(${addons.discordRoleId}) <> ''`,
      ),
    );
  const tierRoles = await loadKnownTierRoleIds();
  return new Set(
    rows
      .map((r) => String(r.roleId || "").trim())
      .filter((id) => /^\d{15,25}$/.test(id) && !tierRoles.has(id)),
  );
}

/** Role IDs that already mean a membership tier — must not double as pack roles. */
async function loadKnownTierRoleIds(): Promise<Set<string>> {
  const { DEFAULT_ROLE_IDS } = await import("./discord-roles.js");
  const set = new Set<string>(Object.values(DEFAULT_ROLE_IDS));
  try {
    const [cfg] = await db.select().from(adminConfig).where(eq(adminConfig.id, 1)).limit(1);
    if (cfg) {
      for (const v of [
        (cfg as any).requiredRoleId,
        (cfg as any).trialRequiredRoleId,
        (cfg as any).proRoleId,
        (cfg as any).moderatorRoleId,
        (cfg as any).troubleshooterRoleId,
        (cfg as any).contributorRoleId,
        (cfg as any).verifiedRoleId,
        (cfg as any).ownerGroupyRoleId,
      ]) {
        const s = String(v || "").trim();
        if (/^\d{15,25}$/.test(s)) set.add(s);
      }
    }
  } catch {
    /* defaults only */
  }
  return set;
}

export type AddonHistoryRow = {
  id: number;
  addonId: number;
  addonName: string;
  startsAt: string;
  expiresAt: string | null;
  endedAt: string | null;
  isActive: boolean;
  status: "active" | "expired" | "revoked";
  assignedBy: string;
  dailyTokenLimit: number;
};

/** All assignments for a Discord user and/or API keys (active + past). */
export async function listAddonHistoryForUser(
  opts:
    | string
    | {
        discordUserId?: string | null;
        apiKeyIds?: Array<number | null | undefined>;
      },
  limit = 50,
): Promise<AddonHistoryRow[]> {
  const uid =
    typeof opts === "string"
      ? String(opts || "").trim()
      : String(opts?.discordUserId || "").trim();
  const apiKeyIds =
    typeof opts === "string"
      ? []
      : [
          ...new Set(
            (opts?.apiKeyIds || [])
              .map((n) => Number(n))
              .filter((n) => Number.isFinite(n) && n > 0),
          ),
        ];

  const ownerParts = [];
  if (uid) ownerParts.push(eq(addonAssignments.discordUserId, uid));
  if (apiKeyIds.length) ownerParts.push(inArray(addonAssignments.apiKeyId, apiKeyIds));
  if (!ownerParts.length) return [];

  const now = new Date();
  const rows = await db
    .select({
      id: addonAssignments.id,
      addonId: addonAssignments.addonId,
      addonName: addons.name,
      startsAt: addonAssignments.startsAt,
      expiresAt: addonAssignments.expiresAt,
      isActive: addonAssignments.isActive,
      assignedBy: addonAssignments.assignedBy,
      dailyTokenLimit: addons.dailyTokenLimit,
    })
    .from(addonAssignments)
    .innerJoin(addons, eq(addonAssignments.addonId, addons.id))
    .where(or(...ownerParts))
    .orderBy(desc(addonAssignments.startsAt))
    .limit(limit);

  return rows.map((r) => {
    const expired =
      r.expiresAt != null && new Date(r.expiresAt).getTime() <= now.getTime();
    const active = !!r.isActive && !expired;
    const status: AddonHistoryRow["status"] = active
      ? "active"
      : expired
        ? "expired"
        : "revoked";

    return {
      id: r.id,
      addonId: r.addonId,
      addonName: r.addonName,
      startsAt: new Date(r.startsAt).toISOString(),
      expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
      endedAt: active
        ? null
        : r.expiresAt
          ? new Date(r.expiresAt).toISOString()
          : null,
      isActive: active,
      status,
      assignedBy: r.assignedBy || "dashboard",
      dailyTokenLimit: r.dailyTokenLimit || 0,
    };
  });
}

/** Global Settings → models that hard-require an add-on (empty = nothing locked). */
export async function getAddonRequiredPatterns(): Promise<string[]> {
  const [row] = await db
    .select({ raw: adminConfig.addonRequiredModels })
    .from(adminConfig)
    .limit(1);
  return parseAllowlist(row?.raw);
}

/** @deprecated Prefer getAddonRequiredPatterns — catalog allowlists no longer lock globally. */
export async function getLockedModelPatterns(): Promise<string[]> {
  return getAddonRequiredPatterns();
}

/**
 * Access rules:
 * - If user has an active all_except add-on → allow all models except that addon's denylist
 *   (union of denylists if multiple).
 * - Else if model matches global admin_config.addon_required_models → require a pack that
 *   grants the model (allowlist match or all_except). Empty required list = open.
 * - Addon catalog allowlists do NOT lock non-holders; they only define pack benefits.
 */
export async function checkAddonModelAccess(opts: {
  model: string;
  discordUserId?: string | null;
  apiKeyId?: number | null;
}): Promise<{ allowed: boolean; reason?: string; requiredAddon?: string }> {
  const normalized = await normalizeModelForLimit(opts.model);
  const active = await getActiveAddonsForUser({
    discordUserId: opts.discordUserId,
    apiKeyId: opts.apiKeyId,
  });

  const activeAllExcept = active.filter((a) => getAccessMode(a) === "all_except");
  if (activeAllExcept.length > 0) {
    for (const a of activeAllExcept) {
      const deny = parsePatternList(a.modelDenylist);
      if (
        modelMatchesAllowlist(normalized, deny) ||
        modelMatchesAllowlist(opts.model, deny)
      ) {
        return {
          allowed: false,
          reason: `Model "${opts.model}" is excluded by add-on "${a.name}".`,
          requiredAddon: a.name,
        };
      }
    }
    return { allowed: true };
  }

  const required = await getAddonRequiredPatterns();
  if (!required.length) {
    return { allowed: true };
  }

  const needsPack =
    modelMatchesAllowlist(normalized, required) ||
    modelMatchesAllowlist(opts.model, required);
  if (!needsPack) {
    return { allowed: true };
  }

  if (
    addonGrantsModelAccess(active, opts.model) ||
    addonGrantsModelAccess(active, normalized)
  ) {
    return { allowed: true };
  }

  const catalog = await db.select().from(addons).where(eq(addons.isActive, true));
  const suggesting = catalog.filter((a) => {
    if (getAccessMode(a) === "all_except") {
      const deny = parsePatternList(a.modelDenylist);
      return (
        !modelMatchesAllowlist(normalized, deny) &&
        !modelMatchesAllowlist(opts.model, deny)
      );
    }
    const list = parseAllowlist(a.modelAllowlist);
    return (
      modelMatchesAllowlist(normalized, list) ||
      modelMatchesAllowlist(opts.model, list)
    );
  });
  const names = suggesting.map((a) => a.name);
  const hint = names.length ? names.join(", ") : "vibecode-10m";

  return {
    allowed: false,
    reason: `Model "${opts.model}" requires an active add-on (${hint}). Upgrade to a Vibecode pack for access — ask in Discord for payment.`,
    requiredAddon: names[0] || "vibecode-10m",
  };
}

/** Extra daily tokens granted by active add-ons (stacked onto Input only). */
export function sumAddonDailyTokenBonus(active: ActiveAddon[]): number {
  return active.reduce((sum, a) => sum + Math.max(0, a.dailyTokenLimit || 0), 0);
}

export function sumAddonMonthlyTokenBonus(active: ActiveAddon[]): number {
  return active.reduce((sum, a) => sum + Math.max(0, a.monthlyTokenLimit || 0), 0);
}

/**
 * Whether this role inherits global In/Out when key custom is unset.
 * Premium/Pro (`zero_unless_addon`) do NOT inherit global Input.
 * With add-on they still get global Output as baseOut (see resolveAddonQuotaStack).
 */
export function roleInheritsGlobalIo(opts: {
  roleLimitMode?: string | null;
  isTrial?: boolean;
}): boolean {
  if (opts.isTrial) return true;
  return String(opts.roleLimitMode || "").trim() !== "zero_unless_addon";
}

/**
 * Custom key daily only — role default daily is always unlimited (never inherit global daily).
 * Kept for callers that still pass resolvedKeyOrGlobalDaily; only keyDailyTokenLimit is used.
 */
export function stackBaseDailyForKey(opts: {
  hasActiveAddon?: boolean;
  isTrial?: boolean;
  keyDailyTokenLimit?: number | null;
  resolvedKeyOrGlobalDaily?: number;
}): number {
  return Math.max(0, Number(opts.keyDailyTokenLimit) || 0);
}

export type QuotaStackResult = {
  /** Hard input cap (includes pack when addon) */
  dailyInputLimit: number;
  /** Hard output cap */
  dailyOutputLimit: number;
  /** Base input before pack (for UI breakdown) */
  inputBase: number;
  /** Base output (for UI breakdown) */
  outputBase: number;
  /** Custom key daily only (0 = unlimited) */
  baseDaily: number;
  addonBonus: number;
  /** Hard daily total — custom key only (0 = unlimited). Pack does NOT add here. */
  effectiveDaily: number;
  /** Always false — I/O are hard caps */
  bypassIo: boolean;
  /** Add-on bypasses per-model prompt caps */
  bypassPerModelPrompts: boolean;
};

/**
 * Quota stacking (PM rules):
 *
 * Base In / Out priority:
 *   1. Key custom > 0
 *   2. Else global — Phantom/Staff/trial (follow_global)
 *   3. Else 0 for Premium/Pro baseIn; baseOut uses global when add-on active
 *
 * Without add-on: hard In/Out = bases; daily = custom key only (else unlimited).
 * With add-on: hard In = baseIn + pack; hard Out = baseOut; daily unchanged (pack → input only).
 * I/O are always hard caps (bypassIo = false).
 */
export function resolveAddonQuotaStack(opts: {
  hasActiveAddon: boolean;
  isTrial?: boolean;
  roleLimitMode?: string | null;
  keyDailyInput?: number | null;
  keyDailyOutput?: number | null;
  /** @deprecated Prefer keyDailyTotal — custom key daily only */
  keyOrGlobalDaily?: number;
  keyDailyTotal?: number | null;
  globalDailyInput?: number | null;
  globalDailyOutput?: number | null;
  /** @deprecated Prefer keyDailyInput/globalDailyInput — pre-resolved bases */
  dailyInput?: number;
  dailyOutput?: number;
  addonDailyBonus: number;
}): QuotaStackResult {
  const bonus = Math.max(0, opts.addonDailyBonus || 0);
  const hasAddon = !!opts.hasActiveAddon;
  const inheritIo = roleInheritsGlobalIo({
    roleLimitMode: opts.roleLimitMode,
    isTrial: opts.isTrial,
  });

  const keyIn = Math.max(0, Number(opts.keyDailyInput) || 0);
  const keyOut = Math.max(0, Number(opts.keyDailyOutput) || 0);
  const gIn = Math.max(0, Number(opts.globalDailyInput) || 0);
  const gOut = Math.max(0, Number(opts.globalDailyOutput) || 0);

  // Legacy path: callers that still pass pre-resolved dailyInput/dailyOutput without key/global split
  const legacyResolved =
    opts.keyDailyInput == null &&
    opts.keyDailyOutput == null &&
    opts.globalDailyInput == null &&
    opts.globalDailyOutput == null &&
    (opts.dailyInput != null || opts.dailyOutput != null);

  let baseIn: number;
  let baseOut: number;
  if (legacyResolved) {
    baseIn = Math.max(0, Number(opts.dailyInput) || 0);
    baseOut = Math.max(0, Number(opts.dailyOutput) || 0);
  } else {
    if (keyIn > 0) baseIn = keyIn;
    else if (inheritIo) baseIn = gIn;
    else baseIn = 0;

    if (keyOut > 0) baseOut = keyOut;
    else if (inheritIo || hasAddon) baseOut = gOut;
    else baseOut = 0;
  }

  const customDaily = Math.max(
    0,
    Number(opts.keyDailyTotal ?? opts.keyOrGlobalDaily) || 0,
  );

  if (!hasAddon) {
    return {
      dailyInputLimit: baseIn,
      dailyOutputLimit: baseOut,
      inputBase: baseIn,
      outputBase: baseOut,
      baseDaily: customDaily,
      addonBonus: 0,
      effectiveDaily: customDaily,
      bypassIo: false,
      bypassPerModelPrompts: false,
    };
  }

  return {
    dailyInputLimit: baseIn + bonus,
    dailyOutputLimit: baseOut,
    inputBase: baseIn,
    outputBase: baseOut,
    baseDaily: customDaily,
    addonBonus: bonus,
    effectiveDaily: customDaily,
    bypassIo: false,
    bypassPerModelPrompts: true,
  };
}

/**
 * Per-model daily token cap from active addons' modelDailyLimits map
 * (substring match). Returns the lowest positive matching cap (strictest).
 * Pack-level dailyTokenLimit is account bonus via sumAddonDailyTokenBonus, not here.
 */
export function resolveAddonModelDailyTokenLimit(
  active: ActiveAddon[],
  model: string,
): number {
  const lower = model.toLowerCase();
  let best = 0;

  for (const a of active) {
    const map = parseModelDailyLimits(a.modelDailyLimits);
    for (const [pat, lim] of Object.entries(map)) {
      const p = pat.toLowerCase();
      if (lower === p || lower.includes(p) || lower.endsWith("/" + p)) {
        if (lim > 0 && (best === 0 || lim < best)) best = lim;
      }
    }
  }

  return best;
}

/**
 * Premium tease: non-addon prompt caps come from global model_limits (Settings → overrides).
 */
export function getAddonTeaseDefaultLimit(model: string): number {
	return getTeaseLimitForModel(model);
}

export function isAddonTeaseModel(model: string): boolean {
	return isTeaseModelFromLimits(model);
}

/** @deprecated Tease limits live in model_limits; kept for imports only. */
export const ADDON_TEASE_DEFAULT_PROMPT_LIMIT = 0;

/** True if any active add-on grants access to this model (allowlist match or all_except). */
export function addonGrantsModelAccess(active: ActiveAddon[], model: string): boolean {
  if (!active.length) return false;
  const lower = model.toLowerCase();
  for (const a of active) {
    if (getAccessMode(a) === "all_except") {
      const deny = parsePatternList(a.modelDenylist);
      if (!modelMatchesAllowlist(model, deny) && !modelMatchesAllowlist(lower, deny)) {
        return true;
      }
    } else {
      const list = parseAllowlist(a.modelAllowlist);
      if (modelMatchesAllowlist(model, list) || modelMatchesAllowlist(lower, list)) {
        return true;
      }
    }
  }
  return false;
}

export { parseAllowlist };

const VIBECODE_ALLOWLIST = [
  "claude-opus-4.8",
  "claude-sonnet-4.6",
  "claude-sonnet-5",
  "sonnet-5",
  "fable-5",
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "codex",
  "glm-5.2",
  "glm-5.3",
  "deepseek-v4-flash-0731",
  "deepseek-v4-pro",
  "minimax-m2.7",
  "minimax-m3",
  "grok-4.5",
];

/** Dedicated Vibecode Discord role — NOT Premium/Pro/Phantom/Staff. */
export const VIBECODE_DISCORD_ROLE_ID = "1530923797220167710";

/** Upsert Vibecode catalog pack shells — limits/description/subcaps are admin-owned in Add-ons UI. */
export async function ensureVibecodeCatalog(): Promise<void> {
  // Pack Discord role must stay the dedicated Vibecode role. Never use Premium
  // (or any other tier role) — that collision stamped every Premium member as
  // an add-on holder.
  const packs: Array<{
    name: string;
    insertDescription: string;
    insertDaily: number;
    insertSubcaps: Record<string, number>;
    days: number;
    active: boolean;
  }> = [
    {
      name: "vibecode-25m",
      insertDescription: "Vibecode pack — 25M/day (edit in Admin → Add-ons)",
      insertDaily: 0,
      insertSubcaps: {},
      days: 15,
      active: true,
    },
    {
      name: "vibecode-50m",
      insertDescription: "Vibecode pack — 50M/day, 15 days (edit in Admin → Add-ons)",
      insertDaily: 0,
      insertSubcaps: {},
      days: 15,
      active: true,
    },
    {
      name: "vibecode-50m-30d",
      insertDescription: "Vibecode pack — 50M/day, 30 days (edit in Admin → Add-ons)",
      insertDaily: 0,
      insertSubcaps: {},
      days: 30,
      active: true,
    },
    {
      name: "vibecode-100m",
      insertDescription: "Vibecode pack — 100M/day, 30 days (edit in Admin → Add-ons)",
      insertDaily: 0,
      insertSubcaps: {},
      days: 30,
      active: true,
    },
  ];

  const tierRoles = await loadKnownTierRoleIds();

  for (const p of packs) {
    const [existing] = await db.select().from(addons).where(eq(addons.name, p.name)).limit(1);
    if (existing) {
      const currentRole = String(existing.discordRoleId || "").trim();
      // Keep a custom non-tier role if admin set one; otherwise pin dedicated Vibecode role.
      const nextRole =
        currentRole && !tierRoles.has(currentRole)
          ? currentRole
          : VIBECODE_DISCORD_ROLE_ID;
      await db
        .update(addons)
        .set({
          defaultDurationDays: p.days,
          isActive: p.active,
          discordRoleId: nextRole,
          updatedAt: new Date(),
        })
        .where(eq(addons.id, existing.id));
    } else if (p.active) {
      await db.insert(addons).values({
        name: p.name,
        description: p.insertDescription,
        modelAllowlist: JSON.stringify(VIBECODE_ALLOWLIST),
        accessMode: "allowlist",
        modelDenylist: "[]",
        modelDailyLimits: JSON.stringify(p.insertSubcaps),
        dailyTokenLimit: p.insertDaily,
        monthlyTokenLimit: 0,
        maxDevices: 2,
        defaultDurationDays: p.days,
        isActive: p.active,
        discordRoleId: VIBECODE_DISCORD_ROLE_ID,
      });
    } else if (!p.active) {
      await db
        .update(addons)
        .set({ isActive: p.active, updatedAt: new Date() })
        .where(eq(addons.id, existing.id));
    }
  }

  // Belt: any pack still pointing at a membership tier role → dedicated Vibecode role.
  if (tierRoles.size) {
    await db
      .update(addons)
      .set({ discordRoleId: VIBECODE_DISCORD_ROLE_ID, updatedAt: new Date() })
      .where(inArray(addons.discordRoleId, [...tierRoles]));
  }
}
