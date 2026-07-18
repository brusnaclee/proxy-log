// RTK (Real Token Killer) — compress tool_result / tool output content.
//
// Problem: Cline/Roo/OpenCode etc. dump full `git`, `grep`, `ls`, `read`, `cat`,
// `find`, `tree`, `wc`, log tails, etc. into the messages array as tool_result
// content. On a "read docs" turn this can balloon to millions of tokens before
// the model even starts. Antigravity compresses client-side; other clients
// don't. RTK compresses at the proxy layer so every client benefits.
//
// Strategy: for content that looks like verbose tool output, keep head+tail
// slices and drop the middle with a "…N chars truncated by RTK…" marker.

const TOOL_ROLES = new Set(['tool', 'function']);

// Rough heuristic: tool_result names / patterns that are almost always huge dumps.
const NOISY_TOOL_HINTS = [
	/^git\b/i,
	/^grep\b/i,
	/\brg\b/i,
	/^ripgrep\b/i,
	/^ls\b/i,
	/^tree\b/i,
	/^find\b/i,
	/^locate\b/i,
	/^cat\b/i,
	/^head\b/i,
	/^tail\b/i,
	/^dir\b/i,
	/^wc\b/i,
	/^du\b/i,
	/^ps\b/i,
	/^netstat\b/i,
	/^lsof\b/i,
	/read[_-]?file/i,
	/list[_-]?files?/i,
	/list[_-]?directory/i,
	/directory[_-]?tree/i,
	/glob/i,
	/search[_-]?(files?|code)/i,
	/^shell\b/i,
	/^bash\b/i,
	/^pwsh\b/i,
	/^powershell\b/i,
	/^cmd\b/i,
	/^exec\b/i,
	/^run[_-]?command/i,
];

function isNoisyToolName(name: unknown): boolean {
	if (typeof name !== 'string' || !name) return true; // no name → assume noisy
	return NOISY_TOOL_HINTS.some((r) => r.test(name));
}

function compressString(text: string, maxChars: number): { out: string; savedChars: number } {
	if (typeof text !== 'string' || text.length <= maxChars) {
		return { out: text, savedChars: 0 };
	}
	// Keep first 60% + last 30% of the budget so both the beginning (headers,
	// tool intent) and the tail (final lines, exit codes) survive.
	const headBudget = Math.floor(maxChars * 0.6);
	const tailBudget = Math.floor(maxChars * 0.3);
	const dropped = text.length - headBudget - tailBudget;
	if (dropped <= 0) return { out: text, savedChars: 0 };
	const head = text.slice(0, headBudget);
	const tail = text.slice(text.length - tailBudget);
	return {
		out: `${head}\n…${dropped} chars truncated by RTK…\n${tail}`,
		savedChars: dropped,
	};
}

function compressContentField(
	content: unknown,
	maxChars: number,
): { out: unknown; savedChars: number } {
	if (typeof content === 'string') {
		return compressString(content, maxChars);
	}
	if (Array.isArray(content)) {
		let saved = 0;
		const out = content.map((part) => {
			if (part && typeof part === 'object') {
				const p = part as any;
				if (typeof p.text === 'string') {
					const r = compressString(p.text, maxChars);
					saved += r.savedChars;
					return { ...p, text: r.out };
				}
				if (typeof p.content === 'string') {
					const r = compressString(p.content, maxChars);
					saved += r.savedChars;
					return { ...p, content: r.out };
				}
				// Anthropic tool_result blocks: { type: 'tool_result', content: [...] }
				if (p.type === 'tool_result' && Array.isArray(p.content)) {
					const inner = compressContentField(p.content, maxChars);
					saved += inner.savedChars;
					return { ...p, content: inner.out };
				}
			}
			return part;
		});
		return { out, savedChars: saved };
	}
	return { out: content, savedChars: 0 };
}

export interface RtkStats {
	messagesCompressed: number;
	charsSaved: number;
}

/**
 * Compress noisy tool outputs in-place inside an OpenAI-format request body.
 * Returns stats; mutates `body.messages` directly.
 */
export function applyRtk(body: any, maxChars: number): RtkStats {
	const stats: RtkStats = { messagesCompressed: 0, charsSaved: 0 };
	if (!body || !Array.isArray(body.messages)) return stats;
	if (!(maxChars > 0)) return stats;

	for (const msg of body.messages) {
		if (!msg || typeof msg !== 'object') continue;
		const role = String((msg as any).role || '').toLowerCase();

		// Case 1: role: 'tool' / 'function' message with a `content` string.
		if (TOOL_ROLES.has(role)) {
			const name = (msg as any).name;
			if (!isNoisyToolName(name)) continue;
			const r = compressContentField((msg as any).content, maxChars);
			if (r.savedChars > 0) {
				(msg as any).content = r.out;
				stats.messagesCompressed += 1;
				stats.charsSaved += r.savedChars;
			}
			continue;
		}

		// Case 2: role: 'user'/'assistant' with tool_result blocks inside content array
		// (Anthropic → OpenAI translation still leaves user turns with tool_result blocks
		// when the request came through /v1/messages).
		if (Array.isArray((msg as any).content)) {
			const r = compressContentField((msg as any).content, maxChars);
			if (r.savedChars > 0) {
				(msg as any).content = r.out;
				stats.messagesCompressed += 1;
				stats.charsSaved += r.savedChars;
			}
		}
	}

	return stats;
}
