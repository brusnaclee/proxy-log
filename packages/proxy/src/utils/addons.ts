import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { addonAssignments, addons, type Addon } from "../db/schema.js";
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

/** All model patterns locked behind any active allowlist add-on catalog entry. */
export async function getLockedModelPatterns(): Promise<string[]> {
  const rows = await db.select().from(addons).where(eq(addons.isActive, true));
  const patterns: string[] = [];
  for (const a of rows) {
    if (getAccessMode(a) === "allowlist") {
      patterns.push(...parseAllowlist(a.modelAllowlist));
    }
  }
  return Array.from(new Set(patterns.map((p) => p.toLowerCase())));
}

/**
 * Access rules:
 * - If user has an active all_except add-on → allow all models except that addon's denylist
 *   (union of denylists if multiple).
 * - Else if model matches any catalog allowlist add-on → require assignment to one of those.
 * - Else → open (base access).
 */
export async function checkAddonModelAccess(opts: {
  model: string;
  discordUserId?: string | null;
  apiKeyId?: number | null;
}): Promise<{ allowed: boolean; reason?: string; requiredAddon?: string }> {
  const normalized = await normalizeModelForLimit(opts.model);
  const allAddons = await db.select().from(addons).where(eq(addons.isActive, true));
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

  // Models listed on any allowlist-mode addon require that addon (or another matching one).
  const locking = allAddons.filter((a) => {
    if (getAccessMode(a) !== "allowlist") return false;
    const list = parseAllowlist(a.modelAllowlist);
    return (
      modelMatchesAllowlist(normalized, list) ||
      modelMatchesAllowlist(opts.model, list)
    );
  });
  if (locking.length === 0) {
    return { allowed: true };
  }

  const hasMatch = locking.some((lock) => active.some((a) => a.id === lock.id));
  if (hasMatch) return { allowed: true };

  return {
    allowed: false,
    reason: `Model "${opts.model}" requires an active add-on (${locking.map((a) => a.name).join(", ")}).`,
    requiredAddon: locking[0]?.name,
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
