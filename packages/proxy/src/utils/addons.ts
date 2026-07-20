import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { addonAssignments, addons, type Addon } from "../db/schema.js";
import { normalizeModelForLimit } from "./rate-limit.js";

export type ActiveAddon = Addon & {
  assignmentId: number;
  expiresAt: Date | null;
};

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

export function modelMatchesAllowlist(model: string, allowlist: string[]): boolean {
  if (!allowlist.length) return false;
  const lower = model.toLowerCase();
  return allowlist.some((pat) => {
    const p = pat.toLowerCase();
    return lower === p || lower.includes(p) || lower.endsWith("/" + p);
  });
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

/** All model patterns locked behind any active add-on catalog entry. */
export async function getLockedModelPatterns(): Promise<string[]> {
  const rows = await db.select().from(addons).where(eq(addons.isActive, true));
  const patterns: string[] = [];
  for (const a of rows) {
    patterns.push(...parseAllowlist(a.modelAllowlist));
  }
  return Array.from(new Set(patterns.map((p) => p.toLowerCase())));
}

export async function checkAddonModelAccess(opts: {
  model: string;
  discordUserId?: string | null;
  apiKeyId?: number | null;
}): Promise<{ allowed: boolean; reason?: string; requiredAddon?: string }> {
  const normalized = await normalizeModelForLimit(opts.model);
  const allAddons = await db.select().from(addons).where(eq(addons.isActive, true));

  // Models not listed in any addon allowlist stay open (base access).
  const locking = allAddons.filter((a) =>
    modelMatchesAllowlist(normalized, parseAllowlist(a.modelAllowlist)) ||
    modelMatchesAllowlist(opts.model, parseAllowlist(a.modelAllowlist)),
  );
  if (locking.length === 0) {
    return { allowed: true };
  }

  const active = await getActiveAddonsForUser({
    discordUserId: opts.discordUserId,
    apiKeyId: opts.apiKeyId,
  });
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

/** Per-model daily token cap from the matching active addon (strictest / first match with limit > 0). */
export function resolveAddonModelDailyTokenLimit(
  active: ActiveAddon[],
  model: string,
): number {
  const lower = model.toLowerCase();
  for (const a of active) {
    const list = parseAllowlist(a.modelAllowlist);
    const matches =
      modelMatchesAllowlist(lower, list) || list.some((p) => lower.includes(p.toLowerCase()));
    if (matches && (a.dailyTokenLimit || 0) > 0) {
      return a.dailyTokenLimit;
    }
  }
  return 0;
}

export { parseAllowlist };
