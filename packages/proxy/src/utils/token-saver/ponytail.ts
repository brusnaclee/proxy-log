// Ponytail — inject a structural directive that trims boilerplate around
// tool-heavy IDE workflows (Cline/Roo/OpenCode/ClaudeCode).
//
// Levels:
//   lite  — Skip acknowledgements/plan restatements; go straight to action.
//   full  — lite + no post-tool summaries, no "let me know if…" endings.
//   ultra — full + never restate file contents you just read; refer by path.

const PONYTAIL_PROMPTS: Record<string, string> = {
	lite:
		'Skip acknowledgements ("Sure!", "I will now…", "Let me…"). Do not restate the user plan back to them. Take the next concrete action directly.',
	full:
		'Skip acknowledgements and plan restatements. Do not summarize tool results back to the user; act on them. Do not end with "Let me know if you need anything else" or similar boilerplate.',
	ultra:
		'Skip acknowledgements, plan restatements, and post-tool summaries. Never restate file contents you just read — reference them by path and line number. No closing pleasantries. No "would you like me to…" prompts unless a real decision is required.',
};

export function getPonytailPrompt(level: string): string {
	const l = String(level || 'lite').toLowerCase();
	return PONYTAIL_PROMPTS[l] || PONYTAIL_PROMPTS.lite;
}

/** Inject the ponytail directive as an additional system message. */
export function applyPonytail(body: any, level: string): boolean {
	if (!body || !Array.isArray(body.messages)) return false;
	const prompt = getPonytailPrompt(level);
	body.messages.unshift({ role: 'system', content: `[token-saver:ponytail] ${prompt}` });
	return true;
}
