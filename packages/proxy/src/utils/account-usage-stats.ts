/**
 * Account-scoped usage aggregates — one row per Discord account (sibling keys
 * merged). Same meter as Discord ranking / live-usage / portal / gates:
 *   prompts = COUNT(DISTINCT turn_id) on 2xx
 *             (diluted to floor(turns/N) when account_usage_overrides.turnsPerPrompt set)
 *   input   = credit_in when uc set, else (prompt+cache)×local mult × hop weight
 *   output  = credit_out when uc set, else completion×out mult
 *   tokens  = input + output  (always Total = In + Out)
 *   trial   = 1× multipliers when every key on the account is trial
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { inputHopWeightSqlExpr, sanitizeRows } from './counting.js';
import { sqlMultiplierExpr } from './token-multiplier.js';
import {
	dilutePromptCount,
	getAccountUsageOverrides,
	turnsPerPromptForUser,
} from './account-usage-overrides.js';

export type AccountUsageRow = {
	discordUserId: string | null;
	discordUsername: string | null;
	keyName: string | null;
	isTrial: boolean;
	requests: number;
	apiCalls: number;
	tokens: number;
	promptTokens: number;
	billablePromptTokens: number;
	cachedTokens: number;
	completionTokens: number;
	estimatedCost: number;
};

/**
 * Aggregate usage since `since` (inclusive). Pass a past Date for a window,
 * or epoch for all-time live logs.
 */
export async function getAccountUsageAggregates(
	since: Date | null,
): Promise<AccountUsageRow[]> {
	const wExpr = inputHopWeightSqlExpr();
	const minPaid = sqlMultiplierExpr("input", "hops.model");
	const moutPaid = sqlMultiplierExpr("output", "hops.model");
	const dateFilter = since
		? sql`AND created_at >= ${since}`
		: sql``;

	const rows = sanitizeRows(
		(
			await db.execute(sql`
				WITH acct AS (
					SELECT COALESCE(discord_user_id, id::text) AS acct_key,
						BOOL_AND(COALESCE(is_trial, false)) AS trial_only
					FROM api_keys
					GROUP BY COALESCE(discord_user_id, id::text)
				)
				SELECT
					MAX(h.discord_user_id) AS "discordUserId",
					MAX(h.discord_username) AS "discordUsername",
					MAX(h.api_key_name) AS "keyName",
					BOOL_AND(h.trial_only) AS "isTrial",
					COUNT(DISTINCT h.turn_id) FILTER (WHERE h.turn_id IS NOT NULL) AS requests,
					COUNT(*)::int AS "apiCalls",
					COALESCE(SUM(h.input_credit), 0) AS "promptTokens",
					COALESCE(SUM(h.output_credit), 0) AS "completionTokens",
					COALESCE(SUM(h.input_credit + h.output_credit), 0) AS tokens
				FROM (
					SELECT hops.turn_id,
						k.discord_user_id,
						k.discord_username,
						k.name AS api_key_name,
						COALESCE(a.trial_only, false) AS trial_only,
						COALESCE(k.discord_user_id, hops.api_key_id::text) AS acct_key,
						CASE
							WHEN COALESCE(hops.uc, 0) > 0 THEN GREATEST(0, hops.uc - hops.uc_out) * (${sql.raw(wExpr)})
							ELSE hops.inn * (${sql.raw(wExpr)}) * CASE WHEN COALESCE(a.trial_only, false) THEN 1 ELSE ${sql.raw(minPaid)} END
						END AS input_credit,
						CASE
							WHEN COALESCE(hops.uc, 0) > 0 THEN hops.uc_out
							ELSE hops.outt * CASE WHEN COALESCE(a.trial_only, false) THEN 1 ELSE ${sql.raw(moutPaid)} END
						END AS output_credit
					FROM (
						SELECT api_key_id, turn_id, model,
							(COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0))::float8 AS inn,
							COALESCE(completion_tokens, 0)::float8 AS outt,
							COALESCE(upstream_credits, 0)::float8 AS uc,
							COALESCE(upstream_credits_out, 0)::float8 AS uc_out,
							ROW_NUMBER() OVER (
								PARTITION BY api_key_id, COALESCE(turn_id, 'orphan-' || id::text)
								ORDER BY created_at ASC, id ASC
							) AS rn
						FROM request_logs
						WHERE status_code BETWEEN 200 AND 299
							AND api_key_id IS NOT NULL
							${dateFilter}
					) hops
					LEFT JOIN api_keys k ON k.id = hops.api_key_id
					LEFT JOIN acct a ON a.acct_key = COALESCE(k.discord_user_id, hops.api_key_id::text)
				) h
				GROUP BY h.acct_key
			`)
		).rows as any[],
		['requests', 'apiCalls', 'promptTokens', 'completionTokens', 'tokens'],
	);

	const overrides = await getAccountUsageOverrides();

	return rows.map((r: any) => {
		const promptTokens = Math.round(Number(r.promptTokens) || 0);
		const completionTokens = Math.round(Number(r.completionTokens) || 0);
		const tokens = Math.round(Number(r.tokens) || 0);
		const rawRequests = Number(r.requests) || 0;
		const n = turnsPerPromptForUser(r.discordUserId || null, overrides);
		return {
			discordUserId: r.discordUserId || null,
			discordUsername: r.discordUsername || r.keyName || null,
			keyName: r.keyName || null,
			isTrial: !!r.isTrial,
			requests: dilutePromptCount(rawRequests, n),
			apiCalls: Number(r.apiCalls) || 0,
			tokens,
			promptTokens,
			billablePromptTokens: 0,
			cachedTokens: 0,
			completionTokens,
			estimatedCost: Math.round(promptTokens * 1.5 + completionTokens * 6.0),
		};
	});
}

export function sortTopByRequests(list: AccountUsageRow[], limit = 10): AccountUsageRow[] {
	return [...list]
		.sort((a, b) => b.requests - a.requests || b.tokens - a.tokens)
		.slice(0, limit);
}

export function sortTopByTokens(list: AccountUsageRow[], limit = 10): AccountUsageRow[] {
	return [...list]
		.sort((a, b) => b.tokens - a.tokens || b.requests - a.requests)
		.slice(0, limit);
}

export type ModelPromptRankRow = {
	model: string;
	count: number;
	tokens: number;
};

/**
 * Top models by prompt-count with per-account turnsPerPrompt dilution.
 * Each account contributes floor(turns_on_model / N) (or raw turns if N unset).
 * Token totals stay undiluted (real hop-weighted usage).
 */
export async function getTopModelsByPromptRequests(
	since: Date | null,
	limit = 10,
): Promise<ModelPromptRankRow[]> {
	const dateFilter = since ? sql`AND rl.created_at >= ${since}` : sql``;
	const overrides = await getAccountUsageOverrides();

	const rows = sanitizeRows(
		(
			await db.execute(sql`
				SELECT
					rl.model AS model,
					k.discord_user_id AS "discordUserId",
					COUNT(DISTINCT rl.turn_id) FILTER (WHERE rl.turn_id IS NOT NULL)::int AS turns,
					COALESCE(SUM(
						CASE
							WHEN COALESCE(rl.upstream_credits, 0) > 0
								THEN COALESCE(rl.upstream_credits, 0)
							ELSE (COALESCE(rl.prompt_tokens, 0) + COALESCE(rl.cached_tokens, 0)
								+ COALESCE(rl.completion_tokens, 0))
						END
					), 0)::float8 AS tokens
				FROM request_logs rl
				LEFT JOIN api_keys k ON k.id = rl.api_key_id
				WHERE rl.status_code BETWEEN 200 AND 299
					AND rl.api_key_id IS NOT NULL
					AND rl.model IS NOT NULL
					AND rl.model <> ''
					${dateFilter}
				GROUP BY rl.model, k.discord_user_id
			`)
		).rows as any[],
		['turns', 'tokens'],
	);

	const byModel = new Map<string, { count: number; tokens: number }>();
	for (const r of rows) {
		const model = String(r.model || '').trim();
		if (!model) continue;
		const n = turnsPerPromptForUser(r.discordUserId || null, overrides);
		const prompts = dilutePromptCount(Number(r.turns) || 0, n);
		const tokens = Math.round(Number(r.tokens) || 0);
		const cur = byModel.get(model) || { count: 0, tokens: 0 };
		cur.count += prompts;
		cur.tokens += tokens;
		byModel.set(model, cur);
	}

	return [...byModel.entries()]
		.map(([model, v]) => ({ model, count: v.count, tokens: v.tokens }))
		.sort((a, b) => b.count - a.count || b.tokens - a.tokens)
		.slice(0, limit);
}
