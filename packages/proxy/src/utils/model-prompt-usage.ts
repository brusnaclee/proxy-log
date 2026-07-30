/**
 * Per-model prompt usage rows for Dashboard / Portal / Discord.
 *
 * Built from the same `checkModelPromptLimit` the request gate uses, so a user
 * blocked with "3/3 prompts used" always reads 3/3 here too. Earlier versions
 * listed configured rules with a hardcoded `used: 0` and discovered models from
 * "today WIB" only, which hid usage that the gate had already counted:
 * a pattern rule (`gpt-5.5`) never string-equals a logged id
 * (`phantom/amanai/gpt-5.5`), and `auto (...)` ids were collapsed to `auto`,
 * which matches no rule.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { modelLimits } from '../db/schema.js';
import {
	checkModelPromptLimit,
	parseRateLimitWindow,
} from './rate-limit.js';
import { getAddonTeaseDefaultLimit, isAddonTeaseModel } from './addons.js';

export type ModelPromptLimitSource = 'override' | 'global' | 'none' | 'addon';

export interface ModelPromptUsageRow {
	model: string;
	used: number;
	limit: number;
	window: string;
	remaining: number | null;
	resetAt: string | null;
	source: ModelPromptLimitSource;
}

export interface BuildModelPromptUsageOpts {
	/** Account key ids; index 0 owns key-scoped override lookup (same as the gate). */
	scopeIds: number[];
	isTrial: boolean;
	/** Any active add-on bypasses per-model prompt rows entirely. */
	hasActiveAddons: boolean;
	perKeyDefaultLimit: number;
	perKeyDefaultWindow: string | null;
	globalDefaultLimit: number;
	globalDefaultWindow: string;
	/** Cap on logged models inspected for default/tease limits. */
	discoveryLimit?: number;
}

/** Key-default resolves to a per-key override bar; everything else reads as global. */
function toSource(
	source: Awaited<ReturnType<typeof checkModelPromptLimit>>['source'],
): ModelPromptLimitSource {
	return source === 'key_default' ? 'override' : 'global';
}

function teaseFor(model: string): number {
	return isAddonTeaseModel(model) ? getAddonTeaseDefaultLimit(model) : 0;
}

export async function buildModelPromptUsage(
	opts: BuildModelPromptUsageOpts,
): Promise<ModelPromptUsageRow[]> {
	const {
		scopeIds,
		isTrial,
		hasActiveAddons,
		perKeyDefaultLimit,
		perKeyDefaultWindow,
		globalDefaultLimit,
		globalDefaultWindow,
		discoveryLimit = 15,
	} = opts;

	if (isTrial || hasActiveAddons || scopeIds.length === 0) return [];

	const overrideKeyId = scopeIds[0];
	const windowStr = perKeyDefaultWindow || globalDefaultWindow || '1d';
	const windowMs = parseRateLimitWindow(windowStr);

	const check = (model: string) =>
		checkModelPromptLimit(
			scopeIds,
			model,
			perKeyDefaultLimit,
			perKeyDefaultWindow,
			globalDefaultLimit,
			globalDefaultWindow,
			{ teaseDefaultLimit: teaseFor(model) },
		);

	const rows: ModelPromptUsageRow[] = [];
	const seen = new Set<string>();

	const push = (
		model: string,
		result: Awaited<ReturnType<typeof checkModelPromptLimit>>,
	) => {
		if (result.effectiveLimit <= 0) return;
		if (seen.has(model)) return;
		seen.add(model);
		rows.push({
			model,
			used: result.used,
			limit: result.effectiveLimit,
			window: windowStr,
			remaining: Math.max(0, result.effectiveLimit - result.used),
			resetAt:
				result.resetMs > 0
					? new Date(Date.now() + result.resetMs).toISOString()
					: null,
			source: toSource(result.source),
		});
	};

	// 1. One row per configured rule, counted exactly like the gate counts it.
	const rules = await db
		.select()
		.from(modelLimits)
		.where(
			sql`((${modelLimits.scope} = 'global' AND ${modelLimits.scopeId} = 0)
			  OR (${modelLimits.scope} = 'key' AND ${modelLimits.scopeId} = ${overrideKeyId}))
			 AND COALESCE(${modelLimits.promptLimit}, 0) > 0`,
		);

	for (const rule of rules) {
		if (!rule.model) continue;
		const result = await check(rule.model);
		// A key-scoped rule can outrank the global one we asked about; label the
		// row with whatever the gate actually resolved so both agree.
		push(result.overrideModel || rule.model, result);
	}

	// 2. Logged models that fall back to a default/tease limit instead of a rule.
	//    Skipped when no such default exists, which keeps this off the hot path.
	const hasFallbackLimit = perKeyDefaultLimit > 0 || globalDefaultLimit > 0;
	const since = new Date(Date.now() - windowMs);
	const recent = (
		await db.execute(sql`
			SELECT model, COUNT(DISTINCT turn_id)::int AS requests
			FROM request_logs
			WHERE api_key_id IN (${sql.join(
				scopeIds.map((id) => sql`${id}`),
				sql`, `,
			)})
				AND created_at >= ${since}
				AND status_code BETWEEN 200 AND 299
				AND turn_id IS NOT NULL
			GROUP BY 1
			ORDER BY 2 DESC
			LIMIT ${discoveryLimit}
		`)
	).rows as Array<{ model: string | null }>;

	for (const row of recent) {
		const model = row.model;
		if (!model || seen.has(model)) continue;
		if (!hasFallbackLimit && teaseFor(model) <= 0) continue;
		const result = await check(model);
		// Covered by a rule already emitted in pass 1 — don't duplicate the family.
		if (result.source === 'override') continue;
		push(model, result);
	}

	rows.sort((a, b) => b.used - a.used || a.model.localeCompare(b.model));
	return rows;
}
