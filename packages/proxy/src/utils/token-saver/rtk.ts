// RTK (Real Token Killer) — compress tool_result / tool output content.
//
// Problem: Cline/Roo/OpenCode/Kilo dump full git/grep/ls/read/cat/find output
// into messages. On long sessions this balloons to 100k–250k+ prompt tokens.
//
// Strategy (aligned with headroom/rtk research 2026):
//  1. Content-aware cleanup: strip ANSI, collapse blank lines, dedupe runs,
//     minify JSON blobs.
//  2. Head+tail truncate with age-based budgets (older tool dumps get smaller caps).
//  3. Also compress Cline-style user-role tool dumps ([read_file for …]).
//  4. Never touch assistant tool_calls / write-edit tool results.

const TOOL_ROLES = new Set(['tool', 'function']);

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
	/^npm\b/i,
	/^pnpm\b/i,
	/^yarn\b/i,
	/^cargo\b/i,
	/^pytest\b/i,
	/^docker\b/i,
	/^kubectl\b/i,
	/^webfetch\b/i,
	/^browser_/i,
];

const WRITE_TOOL_HINTS = [
	/write[_-]?file/i,
	/create[_-]?file/i,
	/edit[_-]?file/i,
	/multi[_-]?edit/i,
	/apply[_-]?diff/i,
	/apply[_-]?patch/i,
	/search[_-]?replace/i,
	/str[_-]?replace/i,
	/replace[_-]?in[_-]?file/i,
	/insert[_-]?content/i,
	/delete[_-]?file/i,
	/rename[_-]?file/i,
	/move[_-]?file/i,
	/edit[_-]?notebook/i,
	/todo[_-]?write/i,
	/attempt[_-]?completion/i,
	/^write\b/i,
	/^edit\b/i,
	/^create\b/i,
	/^patch\b/i,
	/browser_type|browser_fill|browser_click/i,
];

/** Cline / Roo paste tool dumps into the next user message. */
const CLINE_USER_DUMP =
	/\[(read_file|search_files|list_files|list_code_definition_names|execute_command|browser_action|ask_followup_question)\s+for\b/i;

function isWriteToolName(name: unknown): boolean {
	if (typeof name !== 'string' || !name) return false;
	return WRITE_TOOL_HINTS.some((r) => r.test(name));
}

function isNoisyToolName(name: unknown): boolean {
	if (typeof name !== 'string' || !name) return false;
	if (isWriteToolName(name)) return false;
	return NOISY_TOOL_HINTS.some((r) => r.test(name));
}

/** Strip noise that burns tokens without helping the model decide. */
export function cleanupToolText(text: string): string {
	if (typeof text !== 'string' || text.length < 40) return text;
	let out = text;
	// ANSI escapes
	out = out.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
	out = out.replace(/\x1B\][^\x07]*\x07/g, '');
	// Windows / spinner junk
	out = out.replace(/\r/g, '');
	// Collapse 3+ blank lines → 1
	out = out.replace(/\n{3,}/g, '\n\n');
	// Dedupe consecutive identical lines (git status / log spam)
	const lines = out.split('\n');
	const deduped: string[] = [];
	let prev = '';
	let repeat = 0;
	for (const line of lines) {
		if (line === prev) {
			repeat += 1;
			continue;
		}
		if (repeat > 0 && prev !== '') {
			deduped.push(`…(${repeat} identical lines omitted)…`);
		}
		deduped.push(line);
		prev = line;
		repeat = 0;
	}
	if (repeat > 0 && prev !== '') {
		deduped.push(`…(${repeat} identical lines omitted)…`);
	}
	out = deduped.join('\n');

	// Minify JSON / JSONL blobs that are clearly structured dumps
	const trimmed = out.trim();
	if (
		(trimmed.startsWith('{') && trimmed.endsWith('}')) ||
		(trimmed.startsWith('[') && trimmed.endsWith(']'))
	) {
		try {
			const parsed = JSON.parse(trimmed);
			out = JSON.stringify(parsed);
		} catch {
			/* keep cleaned text */
		}
	}
	return out;
}

function headTailTruncate(text: string, maxChars: number): { out: string; savedChars: number } {
	if (text.length <= maxChars) return { out: text, savedChars: 0 };
	const headBudget = Math.floor(maxChars * 0.55);
	const tailBudget = Math.floor(maxChars * 0.35);
	const dropped = text.length - headBudget - tailBudget;
	if (dropped <= 0) return { out: text, savedChars: 0 };
	return {
		out: `${text.slice(0, headBudget)}\n…${dropped} chars truncated by RTK…\n${text.slice(text.length - tailBudget)}`,
		savedChars: dropped,
	};
}

function compressString(text: string, maxChars: number): { out: string; savedChars: number } {
	if (typeof text !== 'string') return { out: text, savedChars: 0 };
	const cleaned = cleanupToolText(text);
	const cleanSaved = Math.max(0, text.length - cleaned.length);
	const truncated = headTailTruncate(cleaned, maxChars);
	return {
		out: truncated.out,
		savedChars: cleanSaved + truncated.savedChars,
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

function compressToolResultBlocks(
	content: unknown,
	maxChars: number,
	toolNameHint?: string,
): { out: unknown; savedChars: number } {
	if (!Array.isArray(content)) return { out: content, savedChars: 0 };
	if (isWriteToolName(toolNameHint)) return { out: content, savedChars: 0 };

	let saved = 0;
	const out = content.map((part) => {
		if (!part || typeof part !== 'object') return part;
		const p = part as any;
		if (p.type !== 'tool_result') return part;
		if (isWriteToolName(p.name) || isWriteToolName(p.tool_name)) return part;
		const name = p.name || p.tool_name || toolNameHint;
		const contentLen =
			typeof p.content === 'string'
				? p.content.length
				: Array.isArray(p.content)
					? JSON.stringify(p.content).length
					: 0;
		const shouldCompress =
			isNoisyToolName(name) || contentLen > maxChars * 1.5 || (!name && contentLen > maxChars);
		if (!shouldCompress) return part;

		const inner = compressContentField(p.content, maxChars);
		if (inner.savedChars > 0) {
			saved += inner.savedChars;
			return { ...p, content: inner.out };
		}
		return part;
	});
	return { out, savedChars: saved };
}

function looksLikeClineUserDump(content: unknown): boolean {
	if (typeof content === 'string') return CLINE_USER_DUMP.test(content) || content.length > 8000;
	if (Array.isArray(content)) {
		return content.some(
			(p) =>
				p &&
				typeof p === 'object' &&
				typeof (p as any).text === 'string' &&
				(CLINE_USER_DUMP.test((p as any).text) || (p as any).text.length > 8000),
		);
	}
	return false;
}

export interface RtkStats {
	messagesCompressed: number;
	charsSaved: number;
}

/**
 * Compress noisy tool outputs in-place. Mutates `body.messages`.
 * Age-based: older tool dumps get tighter caps (more savings on long sessions).
 */
export function applyRtk(body: any, maxChars: number): RtkStats {
	const stats: RtkStats = { messagesCompressed: 0, charsSaved: 0 };
	if (!body || !Array.isArray(body.messages)) return stats;
	if (!(maxChars > 0)) return stats;

	const messages = body.messages as any[];
	const n = messages.length;

	for (let i = 0; i < n; i++) {
		const msg = messages[i];
		if (!msg || typeof msg !== 'object') continue;
		const role = String(msg.role || '').toLowerCase();

		// Never touch assistant tool_calls structure.
		if (role === 'assistant' && Array.isArray(msg.tool_calls)) continue;

		// Newer messages (last ~6) keep fuller budget; older dumps get 40%.
		const fromEnd = n - 1 - i;
		const ageFactor = fromEnd <= 5 ? 1 : fromEnd <= 20 ? 0.55 : 0.35;
		const budget = Math.max(400, Math.floor(maxChars * ageFactor));

		if (TOOL_ROLES.has(role)) {
			const name = msg.name;
			if (isWriteToolName(name)) continue;
			const content = msg.content;
			const contentLen =
				typeof content === 'string'
					? content.length
					: Array.isArray(content)
						? JSON.stringify(content).length
						: 0;
			if (!isNoisyToolName(name) && !(contentLen > budget * 1.5)) continue;
			const r = compressContentField(content, budget);
			if (r.savedChars > 0) {
				msg.content = r.out;
				stats.messagesCompressed += 1;
				stats.charsSaved += r.savedChars;
			}
			continue;
		}

		// Anthropic-style tool_result blocks inside content arrays
		if (Array.isArray(msg.content)) {
			const r = compressToolResultBlocks(msg.content, budget);
			if (r.savedChars > 0) {
				msg.content = r.out;
				stats.messagesCompressed += 1;
				stats.charsSaved += r.savedChars;
				continue;
			}
		}

		// Cline/Roo: tool dumps embedded in user messages
		if (role === 'user' && looksLikeClineUserDump(msg.content)) {
			const contentLen =
				typeof msg.content === 'string'
					? msg.content.length
					: JSON.stringify(msg.content || '').length;
			if (contentLen > budget) {
				const r = compressContentField(msg.content, budget);
				if (r.savedChars > 0) {
					msg.content = r.out;
					stats.messagesCompressed += 1;
					stats.charsSaved += r.savedChars;
				}
			}
		}
	}

	return stats;
}
