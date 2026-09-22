/**
 * Add-on assignment history trimming.
 *
 * Keep the most recent N rows per scope (discord user / api key / global),
 * soft-archive (set `archived_at`) older rows. Archived rows are hidden from
 * default listing but still kept for audit. Auto-cleanup runs:
 *   - on proxy startup (best-effort)
 *   - after each POST /addon-assignments (keeps the new row + trims old)
 *
 * Configurable via env `ADDON_ASSIGNMENT_KEEP_LATEST` (default 10).
 */
import { and, desc, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { addonAssignments } from "../db/schema.js";

const KEEP_LATEST = Math.max(
	1,
	Number(process.env.ADDON_ASSIGNMENT_KEEP_LATEST) || 10,
);

export const ADDON_KEEP_LATEST = KEEP_LATEST;

/**
 * Archive (soft-delete) any rows beyond the latest N per scope.
 * - For discord user scope: keep latest N rows where discord_user_id = X.
 * - For api key scope: keep latest N rows where api_key_id = X.
 * - For null discord_user_id / null api_key_id ("system" rows): keep latest N global.
 * Already-archived rows (archived_at IS NOT NULL) are ignored.
 */
export async function archiveAddonAssignmentsBeyondLimit(): Promise<{
	archived: number;
	keepLatest: number;
}> {
	const rows = await db
		.select({
			id: addonAssignments.id,
			discordUserId: addonAssignments.discordUserId,
			apiKeyId: addonAssignments.apiKeyId,
		})
		.from(addonAssignments)
		.where(isNull(addonAssignments.archivedAt))
		.orderBy(desc(addonAssignments.id));

	// Group by scope. Null/null counts as the "system" bucket.
	const buckets = new Map<string, number[]>();
	for (const r of rows) {
		const key = r.discordUserId
			? `u:${r.discordUserId}`
			: r.apiKeyId != null
				? `k:${r.apiKeyId}`
				: "sys";
		const list = buckets.get(key) || [];
		list.push(r.id);
		buckets.set(key, list);
	}

	const toArchive: number[] = [];
	for (const [, ids] of buckets) {
		if (ids.length <= KEEP_LATEST) continue;
		// ids is DESC-ordered (newest first). Skip the first N.
		toArchive.push(...ids.slice(KEEP_LATEST));
	}

	if (toArchive.length === 0) return { archived: 0, keepLatest: KEEP_LATEST };

	// Archive in batches.
	const now = new Date();
	let archived = 0;
	for (let i = 0; i < toArchive.length; i += 200) {
		const slice = toArchive.slice(i, i + 200);
		await db
			.update(addonAssignments)
			.set({ archivedAt: now })
			.where(
				and(
					sql`${addonAssignments.id} IN (${sql.join(slice.map((id) => sql`${id}`), sql`, `)})`,
					isNull(addonAssignments.archivedAt),
				),
			);
		archived += slice.length;
	}
	return { archived, keepLatest: KEEP_LATEST };
}

/** Test helper: do NOT call from prod. */
export async function _peekCounts(): Promise<{
	totalActive: number;
	totalArchived: number;
}> {
	const rows = await db
		.select({
			id: addonAssignments.id,
			archivedAt: addonAssignments.archivedAt,
		})
		.from(addonAssignments);
	let totalActive = 0;
	let totalArchived = 0;
	for (const r of rows) {
		if (r.archivedAt) totalArchived++;
		else totalActive++;
	}
	return { totalActive, totalArchived };
}