import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { addonAssignments, addons, adminConfig, type Addon } from "../db/schema.js";
import { normalizeModelForLimit } from "./rate-limit.js";

export type ActiveAddon = Addon & {
  assignmentId: number;
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
 */
export async function getActiveAddonsForUser(opts: {
  discordUserId?: string | null;
  apiKeyId?: number | null;
}): Promise<ActiveAddon[]> {
  const now = new Date();
  const conditions = [eq(addonAssignments.isActive, true), eq(addons.isActive, true)];

  const ownerParts = [];
  if (opts.discordUserId) {
    ownerParts.push(eq(addonAssignments.discordUserId, opts.discordUserId));
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
        sql`${addonAssignments.startsAt} <= ${now}`,
        or(isNull(addonAssignments.expiresAt), gt(addonAssignments.expiresAt, now)),
      ),
    );

  // Dedupe by addon id (user may have key + discord assignment)
  const byId = new Map<number, ActiveAddon>();
  for (const r of rows) {
    if (!byId.has(r.addon.id)) {
      byId.set(r.addon.id, {
        ...r.addon,
        assignmentId: r.assignmentId,
        expiresAt: r.expiresAt,
      });
    }
  }
  return Array.from(byId.values());
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
    reason: `Model "${opts.model}" requires an active add-on (${hint}). Upgrade to a Vibecode pack (vibecode-5m / 50M · vibecode-10m / 100M) for access — ask in Discord for payment.`,
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
 * Premium tease models: non-addon users get a small prompt allowance instead of hard lock.
 * Longer patterns win (e.g. chatgpt-5.5 over gpt-5.5). All tease families = 3 prompts.
 */
const ADDON_TEASE_RULES: Array<{ pattern: string; limit: number }> = [
	{ pattern: "chatgpt-5.5", limit: 3 },
	{ pattern: "gpt-5.5", limit: 3 },
	{ pattern: "chatgpt-5.6", limit: 3 },
	{ pattern: "gpt-5.6", limit: 3 },
	{ pattern: "claude", limit: 3 },
];

/** Fallback when no model_limits row matches (legacy callers). Prefer getAddonTeaseDefaultLimit. */
export const ADDON_TEASE_DEFAULT_PROMPT_LIMIT = 3;

export function getAddonTeaseDefaultLimit(model: string): number {
	const lower = (model || "").toLowerCase();
	if (!lower) return 0;
	const sorted = [...ADDON_TEASE_RULES].sort((a, b) => b.pattern.length - a.pattern.length);
	for (const rule of sorted) {
		if (lower.includes(rule.pattern)) return rule.limit;
	}
	return 0;
}

export function isAddonTeaseModel(model: string): boolean {
	return getAddonTeaseDefaultLimit(model) > 0;
}

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
  "minimax-m2.7",
  "minimax-m3",
  "grok-4.5",
];

const VIBECODE_SUBCAPS = {
  "gpt-5.6-terra": 30_000_000,
  "gpt-5.6-sol": 30_000_000,
  "gpt-5.6-luna": 30_000_000,
};

/** Upsert Vibecode catalog packs to latest Discord post specs. */
export async function ensureVibecodeCatalog(): Promise<void> {
  const packs: Array<{
    name: string;
    description: string;
    daily: number;
    days: number;
    slotsNote: number;
    active: boolean;
    discordRoleId: string | null;
  }> = [
    {
      name: "vibecode-5m",
      description:
        "Vibecode 50M · @300k · Requires Premium role · if Phantom, stacks with Phantom daily (20M + pack) · max 1 device · slots ~20 · no weekly limit",
      daily: 50_000_000,
      days: 15,
      slotsNote: 20,
      active: true,
      discordRoleId: "1530923797220167710",
    },
    {
      name: "vibecode-10m",
      description:
        "Vibecode 100M · @459k · Requires Premium role · if Phantom, stacks with Phantom daily (20M + pack) · max 1 device · slots ~10 · no weekly limit",
      daily: 100_000_000,
      days: 30,
      slotsNote: 10,
      active: true,
      discordRoleId: "1530923797220167710",
    },
    {
      name: "vibecode-3m",
      description: "Deprecated — deactivated (not in current Discord post)",
      daily: 3_000_000,
      days: 7,
      slotsNote: 0,
      active: false,
      discordRoleId: null as string | null,
    },
  ];

  for (const p of packs) {
    const [existing] = await db.select().from(addons).where(eq(addons.name, p.name)).limit(1);
    const payload = {
      description: p.description,
      modelAllowlist: JSON.stringify(VIBECODE_ALLOWLIST),
      accessMode: "allowlist" as const,
      modelDenylist: "[]",
      modelDailyLimits: JSON.stringify(VIBECODE_SUBCAPS),
      dailyTokenLimit: p.daily,
      monthlyTokenLimit: 0,
      maxDevices: 1,
      defaultDurationDays: p.days,
      isActive: p.active,
      discordRoleId: p.discordRoleId,
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update(addons).set(payload).where(eq(addons.id, existing.id));
    } else if (p.active) {
      await db.insert(addons).values({ name: p.name, ...payload });
    }
  }

  // Any active pack still missing a Discord role → default Vibecode add-on role
  const DEFAULT_ADDON_DISCORD_ROLE = "1530923797220167710";
  await db
    .update(addons)
    .set({ discordRoleId: DEFAULT_ADDON_DISCORD_ROLE, updatedAt: new Date() })
    .where(
      and(
        eq(addons.isActive, true),
        or(isNull(addons.discordRoleId), eq(addons.discordRoleId, "")),
      ),
    );
}
