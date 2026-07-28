// Batch — nudge the model to request multiple reads/edits together in ONE
// response (parallel tool_calls) instead of one file at a time, so an agent
// session needs fewer round-trips (hops) and resends its growing history
// fewer times.
//
// Soft wording: never push incomplete writes (missing `content`). Cline/Roo/Zoo
// get a stricter variant because those clients reject partial write_to_file.
//
// This only injects a system-prompt directive; it cannot force compliance.
// Skips requests that use the legacy singular OpenAI `functions`/`function_call`
// schema, since that format structurally allows only one call per response —
// nudging batching there would just confuse the model.

const BATCH_PROMPT =
	'When you need several independent reads/searches this turn, prefer requesting them together as multiple tool_calls in ONE response instead of one-at-a-time. For edits/writes: only emit a tool_call when every required parameter is present and complete (especially file content/body). Prefer batching small independent edits; for large rewrites, one careful write with full content is better than parallel incomplete writes. Separate round-trips are fine when a later step depends on an earlier result.';

/** Safer for Cline / Roo / Zoo / Kilo — incomplete write_to_file content hard-fails. */
const BATCH_PROMPT_CLINE_FAMILY =
	'Batch independent read_file/search_files/list_files in ONE response when you already know the paths. For write_to_file / write / apply_diff / edit tools: NEVER omit required fields — especially `content`, `diff`, or the full file body. Do not fire large parallel writes; finish one complete write (all params filled) before the next big write. Incomplete tool arguments cause hard client failures. Separate hops are OK when you must see a prior result first.';

export function isClineFamilyIde(ideName?: string | null): boolean {
	const k = String(ideName || '')
		.trim()
		.toLowerCase();
	if (!k || k === 'unknown') return false;
	return (
		k === 'cline' ||
		k.startsWith('cline ') ||
		k === 'roo code' ||
		k === 'zoo code' ||
		k === 'zoo' ||
		k === 'kilo' ||
		k.startsWith('kilo ')
	);
}

export function getBatchPrompt(ideName?: string | null): string {
	return isClineFamilyIde(ideName) ? BATCH_PROMPT_CLINE_FAMILY : BATCH_PROMPT;
}

/** True if the request only supports the legacy single function_call schema (no `tools` array). */
export function usesLegacyFunctionsOnly(body: any): boolean {
	const hasModernTools = Array.isArray(body?.tools) && body.tools.length > 0;
	const hasLegacyFunctions = Array.isArray(body?.functions) && body.functions.length > 0;
	return hasLegacyFunctions && !hasModernTools;
}

/** Inject the batch directive as an additional system message at the top. */
export function applyBatch(body: any, ideName?: string | null): boolean {
	if (!body || !Array.isArray(body.messages)) return false;
	if (usesLegacyFunctionsOnly(body)) return false;
	const prompt = getBatchPrompt(ideName);
	body.messages.unshift({ role: 'system', content: `[token-saver:batch] ${prompt}` });
	return true;
}
