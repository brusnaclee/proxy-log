// Caveman — inject a "reply in cave-speak" system prompt to reduce output tokens.
//
// Levels:
//   1 = very light — "Prefer concise responses. Cut filler words."
//   2 = light      — "Reply tersely. Drop articles when unambiguous."
//   3 = medium     — Full caveman: short sentences, drop pronouns/articles.
//   4 = strong     — Bullet-only, no prose, ultra-terse.
//   5 = extreme    — Telegram-style, minimum grammar.

const CAVEMAN_PROMPTS: Record<number, string> = {
	1: 'Be concise. Prefer short sentences. Avoid filler phrases like "in order to", "it is important to note", "as mentioned earlier".',
	2: 'Reply tersely. Drop unnecessary articles and connectives. Keep answers compact and direct. No preamble.',
	3: 'Reply in terse cave-speak. Short sentences. Drop unneeded articles and pronouns. No preamble, no restating the question, no closing pleasantries. Get to the point.',
	4: 'Reply as bullet points only. Each bullet ≤ 12 words. No prose paragraphs. No preamble. No closing summary.',
	5: 'Ultra-terse telegram style. Fragment sentences OK. Drop articles/pronouns/copulas. No preamble. No closing.',
};

export function getCavemanPrompt(level: number): string {
	const l = Math.max(1, Math.min(5, Math.round(level || 2)));
	return CAVEMAN_PROMPTS[l];
}

/** Inject the caveman directive as an additional system message at the top. */
export function applyCaveman(body: any, level: number): boolean {
	if (!body || !Array.isArray(body.messages)) return false;
	const prompt = getCavemanPrompt(level);
	// Prepend a system message so it precedes any user-provided system prompt.
	body.messages.unshift({ role: 'system', content: `[token-saver:caveman] ${prompt}` });
	return true;
}
