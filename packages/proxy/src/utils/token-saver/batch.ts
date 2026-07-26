// Batch — nudge the model to request multiple reads/edits together in ONE
// response (parallel tool_calls) instead of one file at a time, so an agent
// session needs fewer round-trips (hops) and resends its growing history
// fewer times.
//
// This only injects a system-prompt directive; it cannot force compliance.
// Skips requests that use the legacy singular OpenAI `functions`/`function_call`
// schema, since that format structurally allows only one call per response —
// nudging batching there would just confuse the model.

const BATCH_PROMPT =
	'Before calling tools, plan every read/search you will need this turn and request them together as multiple tool_calls in ONE response — do not read one file, wait, then read the next. When making multiple edits, emit all edit/write tool_calls for every file together in one response instead of one file at a time. Only do a separate round-trip when you truly cannot know what is needed until you see a prior result.';

export function getBatchPrompt(): string {
	return BATCH_PROMPT;
}

/** True if the request only supports the legacy single function_call schema (no `tools` array). */
export function usesLegacyFunctionsOnly(body: any): boolean {
	const hasModernTools = Array.isArray(body?.tools) && body.tools.length > 0;
	const hasLegacyFunctions = Array.isArray(body?.functions) && body.functions.length > 0;
	return hasLegacyFunctions && !hasModernTools;
}

/** Inject the batch directive as an additional system message at the top. */
export function applyBatch(body: any): boolean {
	if (!body || !Array.isArray(body.messages)) return false;
	if (usesLegacyFunctionsOnly(body)) return false;
	body.messages.unshift({ role: 'system', content: `[token-saver:batch] ${BATCH_PROMPT}` });
	return true;
}
