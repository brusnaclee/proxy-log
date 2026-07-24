import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
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
    reason: `Model "${opts.model}" requires an active add-on (${hint}). Upgrade to a Vibecode pack (vibecode-5m / vibecode-10m) for access — ask in Discord for payment.`,
    requiredAddon: names[0] || "vibecode-10m",
  };
}

/** Extra daily tokens granted by active add-ons (stacked on base quota). */
export function sumAddonDailyTokenBonus(active: ActiveAddon[]): number {
  return active.reduce((sum, a) => sum + Math.max(0, a.dailyTokenLimit || 0), 0);
}

export function sumAddonMonthlyTokenBonus(active: ActiveAddon[]): number {
  return active.reduce((sum, a) => sum + Math.max(0, a.monthlyTokenLimit || 0), 0);
}

/**
 * When any add-on is active:
 * - Input / output caps are bypassed (unlimited)
 * - Daily pool = (input+output if either set, else key/global daily) + pack bonus
 *   e.g. Phantom daily 2M + vibecode-10m → 12M
 *   e.g. Input 2M + Output 5M + pack 10M → 17M (I/O bars hidden)
 */
export function resolveAddonQuotaStack(opts: {
  hasActiveAddon: boolean;
  keyOrGlobalDaily: number;
  dailyInput: number;
  dailyOutput: number;
  addonDailyBonus: number;
}): {
  dailyInputLimit: number;
  dailyOutputLimit: number;
  baseDaily: number;
  addonBonus: number;
  effectiveDaily: number;
  bypassIo: boolean;
  bypassPerModelPrompts: boolean;
} {
  const keyDaily = Math.max(0, opts.keyOrGlobalDaily || 0);
  const input = Math.max(0, opts.dailyInput || 0);
  const output = Math.max(0, opts.dailyOutput || 0);
  const bonus = Math.max(0, opts.addonDailyBonus || 0);

  if (!opts.hasActiveAddon) {
    return {
      dailyInputLimit: input,
      dailyOutputLimit: output,
      baseDaily: keyDaily,
      addonBonus: 0,
      effectiveDaily: keyDaily,
      bypassIo: false,
      bypassPerModelPrompts: false,
    };
  }

  const ioSum = input + output;
  // Prefer explicit daily when set; otherwise fold input+output into the daily pool.
  const baseDaily = keyDaily > 0 ? keyDaily : ioSum;
  return {
    dailyInputLimit: 0,
    dailyOutputLimit: 0,
    baseDaily,
    addonBonus: bonus,
    effectiveDaily: baseDaily + bonus,
    bypassIo: true,
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

/** Premium tease models: non-addon users may use a small prompt allowance instead of hard lock. */
const ADDON_TEASE_PATTERNS = ["claude", "gpt-5.6", "chatgpt-5.6"];

/** Default prompts/day for non-addon tease when no model_limits row applies. */
export const ADDON_TEASE_DEFAULT_PROMPT_LIMIT = 5;

export function isAddonTeaseModel(model: string): boolean {
  const lower = (model || "").toLowerCase();
  return ADDON_TEASE_PATTERNS.some((p) => lower.includes(p));
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
  "gpt-5.6-terra": 3_000_000,
  "gpt-5.6-sol": 3_000_000,
  "gpt-5.6-luna": 3_000_000,
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
  }> = [
    {
      name: "vibecode-5m",
      description:
        "Vibecode 5M · @300k · Requires Premium role · if Phantom, stacks with Phantom daily (2M + pack) · max 1 device · slots ~20 · no weekly limit",
      daily: 5_000_000,
      days: 15,
      slotsNote: 20,
      active: true,
    },
    {
      name: "vibecode-10m",
      description:
        "Vibecode 10M · @459k · Requires Premium role · if Phantom, stacks with Phantom daily (2M + pack) · max 1 device · slots ~10 · no weekly limit",
      daily: 10_000_000,
      days: 30,
      slotsNote: 10,
      active: true,
    },
    {
      name: "vibecode-3m",
      description: "Deprecated — deactivated (not in current Discord post)",
      daily: 3_000_000,
      days: 7,
      slotsNote: 0,
      active: false,
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
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update(addons).set(payload).where(eq(addons.id, existing.id));
    } else if (p.active) {
      await db.insert(addons).values({ name: p.name, ...payload });
    }
  }
}
