import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { recapTestimonialRewards } from "../db/schema.js";
import { monthLabelFromYearMonth } from "./recap-window.js";

export const TESTIMONIAL_REWARD_DAYS = 7;

export type TestimonialRewardView = {
  yearMonth: string;
  monthLabel: string;
  dailyTokens: number;
  startsAt: string;
  expiresAt: string;
  source: "testimonial";
  fresh?: boolean;
};

/**
 * Gacha for a testimonial grant.
 * 1–3 jt 20%, 4–6 jt 60%, 7–10 jt 20%. Expected value ≈ 5.1 jt.
 * 4 sits only in the middle band so the ranges do not overlap.
 */
export function rollTestimonialDailyTokens(rng: () => number = Math.random): number {
  const band = rng();
  const roll = rng();
  let millions: number;
  if (band < 0.2) millions = 1 + Math.floor(roll * 3);
  else if (band < 0.8) millions = 4 + Math.floor(roll * 3);
  else millions = 7 + Math.floor(roll * 4);
  return millions * 1_000_000;
}

function toView(row: typeof recapTestimonialRewards.$inferSelect, fresh = false): TestimonialRewardView {
  return {
    yearMonth: row.yearMonth,
    monthLabel: monthLabelFromYearMonth(row.yearMonth),
    dailyTokens: row.dailyTokens,
    startsAt: new Date(row.startsAt).toISOString(),
    expiresAt: new Date(row.expiresAt).toISOString(),
    source: "testimonial",
    fresh,
  };
}

export function sumTestimonialDailyTokens(grants: Array<{ dailyTokens: number }>): number {
  return grants.reduce((sum, g) => sum + Math.max(0, Math.floor(g.dailyTokens || 0)), 0);
}

/** Grants whose 7-day window is still open. Same user can have two if months overlap. */
export async function getActiveTestimonialRewards(discordUserId: string | null | undefined): Promise<TestimonialRewardView[]> {
  const id = String(discordUserId || "").trim();
  if (!id) return [];
  const rows = await db.select().from(recapTestimonialRewards).where(and(
    eq(recapTestimonialRewards.discordUserId, id),
    gt(recapTestimonialRewards.expiresAt, new Date()),
  ));
  return rows.map((row) => toView(row, false));
}

export async function getActiveTestimonialRewardsForUsers(discordUserIds: string[]): Promise<Map<string, TestimonialRewardView[]>> {
  const ids = [...new Set(discordUserIds.map((id) => String(id || "").trim()).filter(Boolean))];
  const out = new Map<string, TestimonialRewardView[]>();
  if (!ids.length) return out;
  const rows = await db.select().from(recapTestimonialRewards).where(and(
    inArray(recapTestimonialRewards.discordUserId, ids),
    gt(recapTestimonialRewards.expiresAt, new Date()),
  ));
  for (const row of rows) {
    const list = out.get(row.discordUserId) || [];
    list.push(toView(row, false));
    out.set(row.discordUserId, list);
  }
  return out;
}

/**
 * First testimonial of a recap month rolls once. Later submits the same month
 * return the existing row and do not move the expiry.
 */
export async function grantTestimonialRewardOnce(opts: {
  discordUserId: string;
  yearMonth: string;
  stars: number;
  now?: Date;
  rng?: () => number;
}): Promise<TestimonialRewardView> {
  const discordUserId = String(opts.discordUserId || "").trim();
  const yearMonth = String(opts.yearMonth || "").trim();
  const now = opts.now || new Date();
  const existing = (await db.select().from(recapTestimonialRewards).where(and(
    eq(recapTestimonialRewards.discordUserId, discordUserId),
    eq(recapTestimonialRewards.yearMonth, yearMonth),
  )))[0];
  if (existing) return toView(existing, false);

  const dailyTokens = rollTestimonialDailyTokens(opts.rng);
  const expiresAt = new Date(now.getTime() + TESTIMONIAL_REWARD_DAYS * 24 * 60 * 60 * 1000);
  const inserted = await db.insert(recapTestimonialRewards).values({
    discordUserId,
    yearMonth,
    stars: Math.max(1, Math.min(5, Math.round(opts.stars || 5))),
    dailyTokens,
    startsAt: now,
    expiresAt,
    source: "testimonial",
  }).onConflictDoNothing({
    target: [recapTestimonialRewards.discordUserId, recapTestimonialRewards.yearMonth],
  }).returning();
  if (inserted[0]) return toView(inserted[0], true);

  const raced = (await db.select().from(recapTestimonialRewards).where(and(
    eq(recapTestimonialRewards.discordUserId, discordUserId),
    eq(recapTestimonialRewards.yearMonth, yearMonth),
  )))[0];
  if (!raced) throw new Error("testimonial reward missing after insert");
  return toView(raced, false);
}
