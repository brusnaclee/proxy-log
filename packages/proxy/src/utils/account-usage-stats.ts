/**
 * Account-scoped usage aggregates — one row per Discord account (sibling keys
 * merged). Same formula as Discord ranking / live-usage / portal meters:
 *   prompts = COUNT(DISTINCT turn_id) on 2xx
 *   tokens  = hop-weighted input + 100% output
 *   trial   = 1× multipliers when every key on the account is trial
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { inputHopWeightSqlExpr, sanitizeRows } from './counting.js';
import { sqlMultiplierExpr } from './token-multiplier.js';

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
						(hops.inn * (${sql.raw(wExpr)}) * CASE WHEN COALESCE(a.trial_only, false) THEN 1 ELSE ${sql.raw(minPaid)} END) AS input_credit,
						(hops.outt * CASE WHEN COALESCE(a.trial_only, false) THEN 1 ELSE ${sql.raw(moutPaid)} END) AS output_credit
					FROM (
						SELECT api_key_id, turn_id, model,
							(COALESCE(prompt_tokens, 0) + COALESCE(cached_tokens, 0))::float8 AS inn,
							COALESCE(completion_tokens, 0)::float8 AS outt,
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

	return rows.map((r: any) => {
		const promptTokens = Math.round(Number(r.promptTokens) || 0);
		const completionTokens = Math.round(Number(r.completionTokens) || 0);
		const tokens = Math.round(Number(r.tokens) || 0);
		return {
			discordUserId: r.discordUserId || null,
			discordUsername: r.discordUsername || r.keyName || null,
			keyName: r.keyName || null,
			isTrial: !!r.isTrial,
			requests: Number(r.requests) || 0,
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
