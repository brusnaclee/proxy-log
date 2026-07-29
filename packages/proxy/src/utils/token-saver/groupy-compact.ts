/**
 * Groupy Compact — stub older noisy tool dumps before upstream.
 *
 * Keeps the last N tool-result messages full (RTK can still compress them).
 * Older noisy dumps become labeled stubs so agent loops stop replaying
 * full history every hop. Never deletes/reorders messages, never touches
 * assistant.tool_calls or write/edit tool results.
 */

const TOOL_ROLES = new Set(["tool", "function"]);

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
	/^read\b/i,
	/^bash\b/i,
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

const CLINE_USER_DUMP =
	/\[(read_file|search_files|list_files|list_code_definition_names|execute_command|browser_action|ask_followup_question)\s+for\b/i;

const CLINE_PATH_RE =
	/\[(read_file|search_files|list_files|list_code_definition_names|execute_command|browser_action)\s+for\s+'([^']+)'/i;

const STUB_MARKER = "[groupy-compact]";

export type GroupyCompactLevel = "lite" | "balanced" | "aggressive";

export interface GroupyCompactStats {
	stubs: number;
	charsSaved: number;
	level: GroupyCompactLevel;
	assistantTrimmed: number;
}

type LevelConfig = {
	recentKeep: number;
	minChars: number;
	/** Truncate old assistant prose (no tool_calls) above this length; 0 = off */
	assistantProseMax: number;
};

const LEVELS: Record<GroupyCompactLevel, LevelConfig> = {
	lite: { recentKeep: 4, minChars: 4000, assistantProseMax: 0 },
	balanced: { recentKeep: 3, minChars: 1500, assistantProseMax: 0 },
	aggressive: { recentKeep: 2, minChars: 400, assistantProseMax: 8000 },
};

export function normalizeGroupyCompactLevel(raw: unknown): GroupyCompactLevel {
	const l = String(raw || "balanced").toLowerCase();
	if (l === "lite" || l === "balanced" || l === "aggressive") return l;
	return "balanced";
}

function isWriteToolName(name: unknown): boolean {
	if (typeof name !== "string" || !name) return false;
	return WRITE_TOOL_HINTS.some((r) => r.test(name));
}

function isNoisyToolName(name: unknown): boolean {
	if (typeof name !== "string" || !name) return false;
	if (isWriteToolName(name)) return false;
	return NOISY_TOOL_HINTS.some((r) => r.test(name));
}

function contentLength(content: unknown): number {
	if (typeof content === "string") return content.length;
	if (Array.isArray(content)) {
		try {
			return JSON.stringify(content).length;
		} catch {
			return 0;
		}
	}
	if (content == null) return 0;
	try {
		return JSON.stringify(content).length;
	} catch {
		return 0;
	}
}

function getTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((p) => {
				if (typeof p === "string") return p;
				if (p && typeof p === "object") {
					const o = p as any;
					if (typeof o.text === "string") return o.text;
					if (typeof o.content === "string") return o.content;
				}
				return "";
			})
			.join("\n");
	}
	return "";
}

function setContent(msg: any, text: string) {
	if (typeof msg.content === "string" || msg.content == null) {
		msg.content = text;
		return;
	}
	if (Array.isArray(msg.content)) {
		// Preserve structure if Anthropic tool_result blocks — replace text parts only
		const hasToolResult = msg.content.some(
			(p: any) => p && typeof p === "object" && p.type === "tool_result",
		);
		if (hasToolResult) {
			msg.content = msg.content.map((p: any) => {
				if (p && typeof p === "object" && p.type === "tool_result") {
					return { ...p, content: text };
				}
				return p;
			});
			return;
		}
		msg.content = [{ type: "text", text }];
		return;
	}
	msg.content = text;
}

/** Resolve the file path a role=tool result belongs to via the calling assistant. */
function targetFromCallingAssistant(messages: any[], idx: number): string {
	const msg = messages[idx];
	const callId = typeof msg?.tool_call_id === "string" ? msg.tool_call_id : null;
	for (let i = idx - 1; i >= 0 && i >= idx - 3; i--) {
		const calls = messages[i]?.tool_calls;
		if (!Array.isArray(calls)) continue;
		for (const tc of calls) {
			if (callId && tc?.id && tc.id !== callId) continue;
			const argsStr =
				typeof tc?.function?.arguments === "string"
					? tc.function.arguments
					: JSON.stringify(tc?.function?.arguments || tc?.arguments || {});
			try {
				const j = JSON.parse(argsStr);
				const p = j.filePath || j.file_path || j.path || j.target_file || j.absolutePath || j.glob;
				if (typeof p === "string" && p) return p;
			} catch {
				const pm = argsStr.match(
					/"(?:filePath|file_path|path|target_file|absolutePath)"\s*:\s*"([^"]+)"/,
				);
				if (pm) return pm[1];
			}
		}
	}
	return "";
}

function extractToolMeta(msg: any, messages?: any[], idx?: number): { toolName: string; target: string } {
	const role = String(msg?.role || "").toLowerCase();
	if (TOOL_ROLES.has(role)) {
		const toolName = String(msg.name || msg.tool_name || "tool");
		const target =
			messages && typeof idx === "number" ? targetFromCallingAssistant(messages, idx) : "";
		return { toolName, target };
	}
	const text = getTextContent(msg?.content);
	const m = text.match(CLINE_PATH_RE);
	if (m) return { toolName: m[1], target: m[2] || "" };
	const dump = text.match(CLINE_USER_DUMP);
	if (dump) return { toolName: dump[1], target: "" };
	// Anthropic tool_result in content
	if (Array.isArray(msg?.content)) {
		for (const p of msg.content) {
			if (p && typeof p === "object" && p.type === "tool_result") {
				const name = String(p.name || p.tool_name || "tool");
				if (!isWriteToolName(name)) return { toolName: name, target: "" };
			}
		}
	}
	return { toolName: "tool", target: "" };
}

function buildStub(toolName: string, target: string, chars: number): string {
	const pathPart = target ? ` path=${target}` : "";
	// Must never invite a blind re-read: literal models (GLM/Qwen class) treat
	// "re-read if you need it" as an instruction and loop on the same path
	// forever, so the file content never accumulates in context.
	return (
		`${STUB_MARKER} You ALREADY received the full ${toolName} result${pathPart} ` +
		`(${chars} chars) earlier in this session; only the text is elided here to save tokens. ` +
		`Do NOT call ${toolName} on this path again — use what you already know and move to the next step. ` +
		`Re-read only if you can name a specific line range you have never seen.`
	);
}

function looksLikeClineUserDump(msg: any): boolean {
	const role = String(msg?.role || "").toLowerCase();
	if (role !== "user") return false;
	const text = getTextContent(msg?.content);
	if (CLINE_USER_DUMP.test(text)) return true;
	if (
		/called the\s+\w+\s+tool with the following input/i.test(text) ||
		/<tool_response>/i.test(text)
	) {
		return text.length > 800;
	}
	return false;
}

function isNoisyToolDump(msg: any): boolean {
	if (!msg || typeof msg !== "object") return false;
	const role = String(msg.role || "").toLowerCase();

	// Never touch assistant tool_calls structure
	if (role === "assistant" && Array.isArray(msg.tool_calls)) return false;

	if (TOOL_ROLES.has(role)) {
		const name = msg.name || msg.tool_name;
		if (isWriteToolName(name)) return false;
		if (isNoisyToolName(name)) return true;
		// Unknown tool names: treat large bodies as noisy
		return contentLength(msg.content) > 2000;
	}

	if (Array.isArray(msg.content)) {
		const hasNoisyResult = msg.content.some((p: any) => {
			if (!p || typeof p !== "object" || p.type !== "tool_result") return false;
			const name = p.name || p.tool_name;
			if (isWriteToolName(name)) return false;
			return isNoisyToolName(name) || contentLength(p.content) > 2000;
		});
		if (hasNoisyResult) return true;
	}

	if (looksLikeClineUserDump(msg)) {
		const text = getTextContent(msg.content);
		// Skip write-related Cline dumps
		if (/\[(write_to_file|replace_in_file|apply_diff)\s+for\b/i.test(text)) return false;
		return true;
	}

	return false;
}

function alreadyStubbed(msg: any): boolean {
	const text = getTextContent(msg?.content);
	return text.includes(STUB_MARKER);
}

function headTailTruncate(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const headBudget = Math.floor(maxChars * 0.55);
	const tailBudget = Math.floor(maxChars * 0.35);
	const dropped = text.length - headBudget - tailBudget;
	if (dropped <= 0) return text;
	return `${text.slice(0, headBudget)}\n…${dropped} chars truncated by groupy-compact…\n${text.slice(text.length - tailBudget)}`;
}

/**
 * Apply Groupy Compact in-place on an OpenAI-format (or converted) request body.
 */
export function applyGroupyCompact(
	body: any,
	levelRaw: string | GroupyCompactLevel = "balanced",
	override?: { recentKeep?: number; minChars?: number; assistantProseMax?: number } | null,
): GroupyCompactStats {
	const level = normalizeGroupyCompactLevel(levelRaw);
	const base = LEVELS[level];
	const cfg: LevelConfig = {
		recentKeep: override?.recentKeep ?? base.recentKeep,
		minChars: override?.minChars ?? base.minChars,
		assistantProseMax: override?.assistantProseMax ?? base.assistantProseMax,
	};
	const stats: GroupyCompactStats = {
		stubs: 0,
		charsSaved: 0,
		level,
		assistantTrimmed: 0,
	};

	if (!body || !Array.isArray(body.messages)) return stats;
	const messages = body.messages as any[];

	const dumpIndices: number[] = [];
	for (let i = 0; i < messages.length; i++) {
		if (isNoisyToolDump(messages[i]) && !alreadyStubbed(messages[i])) {
			dumpIndices.push(i);
		}
	}

	if (dumpIndices.length <= cfg.recentKeep) {
		// Still may trim assistant prose in aggressive mode
	} else {
		const meta = new Map<number, { toolName: string; target: string }>();
		for (const idx of dumpIndices) {
			meta.set(idx, extractToolMeta(messages[idx], messages, idx));
		}

		// For a path read repeatedly (paged reads, or a model grinding on one file),
		// keep its newest chunk alive. Stubbing every hop means the content never
		// accumulates in context, which pushes literal models into re-reading the
		// same file indefinitely. Paths touched only once follow recentKeep as
		// usual, and the rescue is capped so a wide crawl can't undo the savings.
		const seenPerTarget = new Map<string, number>();
		for (const idx of dumpIndices) {
			const target = meta.get(idx)?.target;
			if (target) seenPerTarget.set(target, (seenPerTarget.get(target) || 0) + 1);
		}
		const rescued = new Set<number>();
		const rescuedTargets = new Set<string>();
		for (let i = dumpIndices.length - 1; i >= 0; i--) {
			if (rescued.size >= cfg.recentKeep) break;
			const idx = dumpIndices[i];
			const target = meta.get(idx)?.target;
			if (!target || rescuedTargets.has(target)) continue;
			if ((seenPerTarget.get(target) || 0) < 2) continue;
			rescuedTargets.add(target);
			rescued.add(idx);
		}

		const keep = new Set<number>([
			...dumpIndices.slice(dumpIndices.length - cfg.recentKeep),
			...rescued,
		]);

		for (const idx of dumpIndices) {
			if (keep.has(idx)) continue;
			const msg = messages[idx];
			const len = contentLength(msg.content);
			if (len < cfg.minChars) continue;
			const { toolName, target } = meta.get(idx)!;
			if (isWriteToolName(toolName)) continue;
			const stub = buildStub(toolName, target, len);
			setContent(msg, stub);
			stats.stubs += 1;
			stats.charsSaved += Math.max(0, len - stub.length);
		}
	}

	if (cfg.assistantProseMax > 0) {
		// Keep last 2 assistant messages full; trim older prose-only assistants
		let assistantSeen = 0;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			const role = String(msg?.role || "").toLowerCase();
			if (role !== "assistant") continue;
			if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) continue;
			assistantSeen += 1;
			if (assistantSeen <= 2) continue;
			const text = getTextContent(msg.content);
			if (text.length <= cfg.assistantProseMax) continue;
			const trimmed = headTailTruncate(text, cfg.assistantProseMax);
			const before = text.length;
			setContent(msg, trimmed);
			stats.assistantTrimmed += 1;
			stats.charsSaved += Math.max(0, before - trimmed.length);
		}
	}

	return stats;
}
