/**
 * Additive recap "story" enricher — never replaces core stats.
 * Failures are swallowed so generate path stays healthy.
 */

import { db } from "../db/index.js";
import { sql } from "drizzle-orm";
import type { RecapStats } from "./recap-stats.js";

function num(v: any): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function seedPick<T>(seed: string, arr: T[]): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

export type RecapStory = {
  addon?: {
    name: string;
    dailyTokenLimit: number;
    daysLeft: number | null;
    description: string;
  } | null;
  isTrial?: boolean;
  quota?: {
    dailyPeakPct: number | null;
    monthlyPeakPct: number | null;
    line: string;
  } | null;
  burn?: {
    peakPromptPerHour: number;
    peakPromptAt: string | null;
    peakCallsPerHour: number;
    peakCallsAt: string | null;
  } | null;
  providers?: {
    top: Array<{ name: string; requests: number }>;
    upstream: Array<{ name: string; requests: number }>;
  } | null;
  schedule?: {
    firstDay: string | null;
    lastDay: string | null;
    typicalStartHour: number | null;
    typicalEndHour: number | null;
    favoriteWeekday: string | null;
    weekendSharePct: number;
    warriorLine: string;
  } | null;
  loyalty?: { model: string; streakDays: number } | null;
  tokenSaver?: {
    estimatedSavedTokens: number;
    bestDay: string | null;
    reason: string;
    modes: string[];
  } | null;
  devices?: { count: number; labels: string[] } | null;
  eggs: Array<{ id: string; title: string; desc: string }>;
  fortune: string;
  multiKeyLine?: string | null;
  latencyHero?: boolean;
  communityTwin?: boolean;
};

function keyScopeSql(keyIds: number[]) {
  const ids = keyIds.length ? keyIds : [0];
  if (ids.length === 1) return sql`api_key_id = ${ids[0]}`;
  return sql`api_key_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;
}

/** Attach story + extra achievements/facts. Mutates stats.extras & stats.story. */
export async function enrichRecapStory(opts: {
  stats: RecapStats & { story?: RecapStory };
  keyId: number;
  keyIds: number[];
  isTrial: boolean;
  yearMonth: string;
  prevYearMonth: string;
  communityPeakHours?: number[];
}): Promise<void> {
  const { stats, keyIds, isTrial, yearMonth } = opts;
  const eggs: RecapStory["eggs"] = [];
  const seed = `${opts.keyId}:${yearMonth}:${stats.totals.requests}`;

  // Resolve discord + key limits
  let discordUserId: string | null = null;
  let dailyLimit = 0;
  let monthlyLimit = 0;
  try {
    const kr = (
      await db.execute(sql`
      SELECT discord_user_id, daily_token_limit, monthly_token_limit, is_trial
      FROM api_keys WHERE id = ${opts.keyId} LIMIT 1
    `)
    ).rows[0] as any;
    discordUserId = kr?.discord_user_id ? String(kr.discord_user_id) : null;
    dailyLimit = num(kr?.daily_token_limit);
    monthlyLimit = num(kr?.monthly_token_limit);
  } catch {
    /* ignore */
  }

  // Addon holder (positive only)
  let addon: RecapStory["addon"] = null;
  try {
    if (discordUserId) {
      const row = (
        await db.execute(sql`
        SELECT a.name, a.description, a.daily_token_limit, aa.expires_at
        FROM addon_assignments aa
        JOIN addons a ON a.id = aa.addon_id
        WHERE aa.is_active = true AND a.is_active = true
          AND (aa.discord_user_id = ${discordUserId} OR aa.api_key_id IN (${sql.join(
            keyIds.map((id) => sql`${id}`),
            sql`, `,
          )}))
        ORDER BY aa.expires_at NULLS LAST
        LIMIT 1
      `)
      ).rows[0] as any;
      if (row?.name) {
        let daysLeft: number | null = null;
        if (row.expires_at) {
          const ms = new Date(row.expires_at).getTime() - Date.now();
          daysLeft = Math.max(0, Math.ceil(ms / 86400000));
        }
        addon = {
          name: String(row.name),
          description: String(row.description || ""),
          dailyTokenLimit: num(row.daily_token_limit),
          daysLeft,
        };
        eggs.push({
          id: "vibecode_unicorn",
          title: "Pemegang Pack",
          desc: `Kamu jalan dengan ${row.name} — elite vibes.`,
        });
      }
    }
  } catch {
    /* ignore */
  }

  // Prev rank from user_recaps
  let rankUpVsPrev: number | null = null;
  try {
    if (discordUserId && opts.prevYearMonth) {
      const prev = (
        await db.execute(sql`
        SELECT rank_requests FROM user_recaps
        WHERE discord_user_id = ${discordUserId} AND year_month = ${opts.prevYearMonth}
        LIMIT 1
      `)
      ).rows[0] as any;
      const prevRank = num(prev?.rank_requests);
      const curRank = stats.rank.requests;
      if (prevRank > 0 && curRank > 0) {
        // lower rank number = better; positive = naik peringkat
        rankUpVsPrev = prevRank - curRank;
      }
    }
  } catch {
    /* ignore */
  }

  // Burn peaks (prompt turns / hour and calls / hour)
  let burn: RecapStory["burn"] = null;
  try {
    const scope = keyScopeSql(keyIds);
    const promptBurst = (
      await db.execute(sql`
      SELECT to_char(date_trunc('hour', created_at AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD HH24') AS h,
             COUNT(DISTINCT turn_id)::int AS c
      FROM request_logs
      WHERE ${scope}
        AND to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') = ${yearMonth}
        AND turn_id IS NOT NULL
      GROUP BY 1
      ORDER BY c DESC
      LIMIT 1
    `)
    ).rows[0] as any;
    const callBurst = (
      await db.execute(sql`
      SELECT to_char(date_trunc('hour', created_at AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD HH24') AS h,
             COUNT(*)::int AS c
      FROM request_logs
      WHERE ${scope}
        AND to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') = ${yearMonth}
      GROUP BY 1
      ORDER BY c DESC
      LIMIT 1
    `)
    ).rows[0] as any;
    burn = {
      peakPromptPerHour: num(promptBurst?.c),
      peakPromptAt: promptBurst?.h ? String(promptBurst.h) : null,
      peakCallsPerHour: num(callBurst?.c),
      peakCallsAt: callBurst?.h ? String(callBurst.h) : null,
    };
    if (burn.peakPromptPerHour >= 40) {
      eggs.push({
        id: "prompt_storm",
        title: "Prompt Storm",
        desc: `${burn.peakPromptPerHour} prompt dalam 1 jam${burn.peakPromptAt ? ` (${burn.peakPromptAt})` : ""} — gas pol!`,
      });
    }
  } catch {
    /* ignore */
  }

  // Providers + upstream
  let providers: RecapStory["providers"] = null;
  try {
    const scope = keyScopeSql(keyIds);
    const topP = (
      await db.execute(sql`
      SELECT COALESCE(provider, '(unknown)') AS name, COUNT(*)::int AS c
      FROM request_logs
      WHERE ${scope}
        AND to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') = ${yearMonth}
      GROUP BY 1 ORDER BY c DESC LIMIT 5
    `)
    ).rows as any[];
    const topU = (
      await db.execute(sql`
      SELECT split_part(model, '/', 1) AS name, COUNT(*)::int AS c
      FROM request_logs
      WHERE ${scope}
        AND to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') = ${yearMonth}
        AND position('/' in model) > 0
      GROUP BY 1 ORDER BY c DESC LIMIT 5
    `)
    ).rows as any[];
    providers = {
      top: topP.map((r) => ({ name: String(r.name), requests: num(r.c) })),
      upstream: topU.map((r) => ({ name: String(r.name), requests: num(r.c) })),
    };
    if ((providers.upstream?.length || 0) >= 4) {
      eggs.push({
        id: "upstream_nomad",
        title: "Upstream Nomad",
        desc: `Nyasar ke ${providers.upstream.length}+ upstream — explorer sejati.`,
      });
    }
  } catch {
    /* ignore */
  }

  // Daily start/end hours (median of first/last hop per active day)
  let typicalStartHour: number | null = null;
  let typicalEndHour: number | null = null;
  try {
    const scope = keyScopeSql(keyIds);
    const rows = (
      await db.execute(sql`
      SELECT
        EXTRACT(HOUR FROM MIN(created_at AT TIME ZONE 'Asia/Jakarta'))::int AS start_h,
        EXTRACT(HOUR FROM MAX(created_at AT TIME ZONE 'Asia/Jakarta'))::int AS end_h
      FROM request_logs
      WHERE ${scope}
        AND to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') = ${yearMonth}
      GROUP BY to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')
    `)
    ).rows as any[];
    if (rows.length) {
      const starts = rows.map((r) => num(r.start_h)).sort((a, b) => a - b);
      const ends = rows.map((r) => num(r.end_h)).sort((a, b) => a - b);
      typicalStartHour = starts[Math.floor(starts.length / 2)] ?? null;
      typicalEndHour = ends[Math.floor(ends.length / 2)] ?? null;
    }
  } catch {
    /* ignore */
  }

  const weekend = stats.activity.weekendRequests || 0;
  const weekday = stats.activity.weekdayRequests || 0;
  const totalWd = Math.max(weekend + weekday, 1);
  const weekendSharePct = Math.round((weekend / totalWd) * 100);
  let warriorLine = "Weekday warrior — productif di hari kerja.";
  if (weekendSharePct >= 45) warriorLine = "Weekend warrior — weekend tetap gas ngoding!";
  else if (weekendSharePct <= 15 && weekday > 0) warriorLine = "Weekday specialist — weekend buat recharge.";

  const schedule: RecapStory["schedule"] = {
    firstDay: stats.activity.firstActiveDay,
    lastDay: stats.activity.lastActiveDay,
    typicalStartHour,
    typicalEndHour,
    favoriteWeekday: stats.activity.favoriteWeekday,
    weekendSharePct,
    warriorLine,
  };

  // Model loyalty streak (longest consecutive days with same daily #1 model)
  let loyalty: RecapStory["loyalty"] = null;
  try {
    const scope = keyScopeSql(keyIds);
    const daily = (
      await db.execute(sql`
      SELECT day, model FROM (
        SELECT to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day,
               model,
               COUNT(*)::int AS c,
               ROW_NUMBER() OVER (
                 PARTITION BY to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')
                 ORDER BY COUNT(*) DESC
               ) AS rn
        FROM request_logs
        WHERE ${scope}
          AND to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') = ${yearMonth}
          AND model IS NOT NULL AND model <> ''
        GROUP BY 1, 2
      ) t WHERE rn = 1 ORDER BY day
    `)
    ).rows as any[];
    let best = 0;
    let bestModel = "";
    let cur = 0;
    let curModel = "";
    for (const r of daily) {
      const m = String(r.model);
      if (m === curModel) cur += 1;
      else {
        curModel = m;
        cur = 1;
      }
      if (cur > best) {
        best = cur;
        bestModel = curModel;
      }
    }
    if (best >= 3 && bestModel) {
      loyalty = { model: bestModel, streakDays: best };
      eggs.push({
        id: "loyalty_streak",
        title: "Model Loyalty",
        desc: `${best} hari beruntun #1 harian: ${bestModel}`,
      });
    }
  } catch {
    /* ignore */
  }

  // Token saver estimate from cache / non-billable + RTK flags
  let tokenSaver: RecapStory["tokenSaver"] = null;
  try {
    const scope = keyScopeSql(keyIds);
    const saved = num(stats.totals.cachedTokens);
    const best = (
      await db.execute(sql`
      SELECT to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day,
             COALESCE(SUM(CASE WHEN COALESCE(is_billable_token, true) = false THEN GREATEST(prompt_tokens,0) ELSE 0 END),0)::bigint AS cached
      FROM request_logs
      WHERE ${scope}
        AND to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') = ${yearMonth}
      GROUP BY 1
      ORDER BY cached DESC
      LIMIT 1
    `)
    ).rows[0] as any;
    const cfg = (
      await db.execute(sql`
      SELECT token_saver_rtk_enabled, token_saver_caveman_enabled, token_saver_ponytail_enabled, token_saver_headroom_enabled
      FROM admin_config WHERE id = 1
    `)
    ).rows[0] as any;
    const modes: string[] = [];
    if (cfg?.token_saver_rtk_enabled) modes.push("RTK");
    if (cfg?.token_saver_caveman_enabled) modes.push("Caveman");
    if (cfg?.token_saver_ponytail_enabled) modes.push("Ponytail");
    if (cfg?.token_saver_headroom_enabled) modes.push("Headroom");
    if (saved > 0 || modes.length) {
      tokenSaver = {
        estimatedSavedTokens: saved,
        bestDay: best?.day ? String(best.day) : null,
        reason:
          saved > 0
            ? "Cache / konteks yang tidak ditagih ulang (plus Token Saver RTK bila aktif)."
            : "Mode Token Saver aktif menjaga prompt tetap ramping.",
        modes: modes.length ? modes : ["RTK"],
      };
      if (saved > 1_000_000) {
        eggs.push({
          id: "cache_magician",
          title: "Cache Magician",
          desc: `~${Math.round(saved / 1_000_000)}M token hemat dari cache/konteks.`,
        });
      }
    }
  } catch {
    /* ignore */
  }

  // Devices
  let devices: RecapStory["devices"] = null;
  try {
    const rows = (
      await db.execute(sql`
      SELECT COALESCE(device_name, os_detected, ide_detected, fingerprint) AS label
      FROM devices
      WHERE api_key_id IN (${sql.join(
        keyIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      ORDER BY last_seen DESC NULLS LAST
      LIMIT 8
    `)
    ).rows as any[];
    const labels = rows.map((r) => String(r.label || "").slice(0, 40)).filter(Boolean);
    const count = Math.max(stats.devices.uniqueCount || 0, labels.length);
    if (count > 0) {
      devices = { count, labels };
      if (count >= 3) {
        eggs.push({
          id: "device_armada",
          title: "Armada Device",
          desc: `${count} perangkat ikut ngoding bareng kamu.`,
        });
      }
    }
  } catch {
    /* ignore */
  }

  // Custom model explorer
  try {
    const scope = keyScopeSql(keyIds);
    const hit = (
      await db.execute(sql`
      SELECT COUNT(*)::int AS c
      FROM request_logs rl
      WHERE ${scope}
        AND to_char(rl.created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') = ${yearMonth}
        AND EXISTS (
          SELECT 1 FROM custom_models cm
          WHERE cm.is_active = true
            AND (
              rl.model ILIKE '%' || cm.model_id || '%'
              OR (cm.display_name IS NOT NULL AND rl.model ILIKE '%' || cm.display_name || '%')
            )
        )
    `)
    ).rows[0] as any;
    if (num(hit?.c) > 0) {
      eggs.push({
        id: "custom_model_explorer",
        title: "Custom Model Explorer",
        desc: "Kamu nyobain model custom dari katalog — pioneer vibes.",
      });
    }
  } catch {
    /* ignore */
  }

  // Community twin
  let communityTwin = false;
  const myHour = stats.activity.mostActiveHour?.hour;
  const peaks = opts.communityPeakHours || [0, 20, 1, 21, 2, 23];
  if (myHour !== undefined && myHour !== null && peaks.includes(myHour)) {
    communityTwin = true;
    eggs.push({
      id: "community_twin",
      title: "Community Twin",
      desc: `Jam sibukmu (${myHour}:00) nyambung sama jam rame komunitas.`,
    });
  }

  // Latency hero (enrich existing speed story)
  let latencyHero = false;
  const avg = stats.latency?.avgMs || 0;
  if (avg > 0 && avg < 2500 && stats.totals.requests >= 30) {
    latencyHero = true;
    eggs.push({
      id: "latency_hero",
      title: "Latency Hero",
      desc: `Rata-rata ${avg}ms — responsnya snappy.`,
    });
  }

  // Night owl from activity
  const nightShare =
    (stats.activity.perHour || [])
      .filter((h) => h.hour >= 0 && h.hour < 5)
      .reduce((s, h) => s + h.requests, 0) / Math.max(stats.totals.requests, 1);
  if (nightShare >= 0.4) {
    eggs.push({
      id: "midnight_mayor",
      title: "Midnight Mayor",
      desc: "Mayoritas traffic di jam 0–4 — kerajaan malam.",
    });
  }

  // Multi-key funny line
  let multiKeyLine: string | null = null;
  if ((stats.keys?.count || 0) >= 2) {
    multiKeyLine = seedPick(seed, [
      `${stats.keys.count} key aktif — Double Key Energy. Bukan curang, ini lab cadangan 🧪`,
      `Punya ${stats.keys.count} kunci? Mencurigakan… tapi lucu. Usage tetap digabung per Discord.`,
      `Multi-key detected. Tenang, kami hitung sebagai satu akun — eksperimen diizinkan.`,
    ]);
    eggs.push({
      id: "double_key",
      title: "Double Key Energy",
      desc: multiKeyLine,
    });
  }

  // Quota % (positive framing)
  let quota: RecapStory["quota"] = null;
  const packDaily = addon?.dailyTokenLimit || 0;
  const effDaily = Math.max(dailyLimit, packDaily);
  let dailyPeakPct: number | null = null;
  let monthlyPeakPct: number | null = null;
  try {
    if (effDaily > 0) {
      const scope = keyScopeSql(keyIds);
      const peak = (
        await db.execute(sql`
        SELECT MAX(day_tok)::bigint AS m FROM (
          SELECT COALESCE(SUM(GREATEST(prompt_tokens,0) + GREATEST(completion_tokens,0)),0) AS day_tok
          FROM request_logs
          WHERE ${scope}
            AND to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') = ${yearMonth}
          GROUP BY to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')
        ) t
      `)
      ).rows[0] as any;
      dailyPeakPct = Math.min(999, Math.round((num(peak?.m) / effDaily) * 100));
    }
    if (monthlyLimit > 0) {
      monthlyPeakPct = Math.min(
        999,
        Math.round((stats.totals.totalTokens / monthlyLimit) * 100),
      );
    }
    if (dailyPeakPct !== null || monthlyPeakPct !== null) {
      let line = "Kuota masih longgar — main santai.";
      const peak = Math.max(dailyPeakPct || 0, monthlyPeakPct || 0);
      if (peak >= 90) line = "Full send! Hampir/lebih ngejar plafon — semangat juara.";
      else if (peak >= 60) line = "Pemakaian mantap, pas di sweet spot.";
      else if (effDaily === 0 && monthlyLimit === 0) line = "Unlimited mode — gas tanpa plafon.";
      quota = { dailyPeakPct, monthlyPeakPct, line };
    } else if (effDaily <= 0 && monthlyLimit <= 0) {
      quota = {
        dailyPeakPct: null,
        monthlyPeakPct: null,
        line: "Unlimited mode — gas tanpa plafon.",
      };
    }
  } catch {
    /* ignore */
  }

  if (isTrial) {
    eggs.push({
      id: "explorer_trial",
      title: "Explorer Trial",
      desc: "Mode trial — eksplor dengan gaya, tanpa drama.",
    });
  }

  const fortune = seedPick(seed, [
    "Bulan depan lebih gila — tapi ingat minum air.",
    "AI-nya sudah kenal gaya kamu. Jangan ghosting.",
    "Satu commit lagi bisa jadi legenda.",
    "Kalau stuck, jalan kaki 5 menit. Lalu gas lagi.",
    "Recap ini bukti kamu tidak afk dari ide.",
    "Keep shipping. Meme mengikuti yang berani push.",
  ]);

  const story: RecapStory = {
    addon,
    isTrial,
    quota,
    burn,
    providers,
    schedule,
    loyalty,
    tokenSaver,
    devices,
    eggs,
    fortune,
    multiKeyLine,
    latencyHero,
    communityTwin,
  };

  (stats as any).story = story;

  // Merge achievements / fun facts additively
  if (!stats.extras) {
    stats.extras = {
      restWeekday: null,
      achievements: [],
      funFacts: [],
      community: null,
      projection: null,
      rankUpVsPrev: null,
    };
  }
  stats.extras.rankUpVsPrev = rankUpVsPrev;
  for (const e of eggs.slice(0, 6)) {
    if (!stats.extras.achievements.some((a) => a.title === e.title)) {
      stats.extras.achievements.push({
        icon: "✨",
        title: e.title,
        desc: e.desc,
      });
    }
  }
  if (schedule?.warriorLine) stats.extras.funFacts.push(schedule.warriorLine);
  if (loyalty) {
    stats.extras.funFacts.push(
      `Loyalty streak: ${loyalty.streakDays} hari #1 harian ke ${loyalty.model} (beda dari total favorite kalau pola pecah).`,
    );
  }
  if (burn?.peakPromptPerHour) {
    stats.extras.funFacts.push(
      `Peak prompt: ${burn.peakPromptPerHour}/jam${burn.peakPromptAt ? ` @ ${burn.peakPromptAt}` : ""}.`,
    );
  }
  if (tokenSaver?.estimatedSavedTokens) {
    stats.extras.funFacts.push(
      `Token Saver / cache memperkirakan ~${tokenSaver.estimatedSavedTokens.toLocaleString("id-ID")} token hemat.`,
    );
  }
  if (fortune) stats.extras.funFacts.push(`Fortune: ${fortune}`);
}
