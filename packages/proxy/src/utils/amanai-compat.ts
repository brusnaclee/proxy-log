/**
 * Amanai-compatible upstream shaping.
 *
 * Billing (Pricing Engine v3):
 *   credits = ceil( (input - cache_read) * m_in + cache_read * m_cache + output * m_out )
 *   m_cache = 0.25 * m_in  → 75% discount on cached input
 *
 * Docs: https://ai.amanai.dev/docs/billing/
 * Anthropic prompt caching: prefer top-level automatic cache_control for multi-turn,
 * plus explicit breakpoints on tools/system/stable prefix (max 4 explicit).
 */

export type CompatProfile = "default" | "amanai";

export const CACHE_CONTROL_EPHEMERAL = { type: "ephemeral" as const };

/** Anthropic allows up to 4 explicit breakpoints; automatic top-level uses one slot. */
const MAX_EXPLICIT_BREAKPOINTS = 4;

export function normalizeCompatProfile(raw: unknown): CompatProfile {
	const v = String(raw || "default").toLowerCase().trim();
	return v === "amanai" ? "amanai" : "default";
}

/** Infer amanai profile from name/endpoint when creating a provider. */
export function inferCompatProfile(opts: {
	name?: string | null;
	endpoint?: string | null;
	compatProfile?: string | null;
}): CompatProfile {
	if (opts.compatProfile != null && String(opts.compatProfile).trim() !== "") {
		return normalizeCompatProfile(opts.compatProfile);
	}
	const name = String(opts.name || "").toLowerCase();
	const endpoint = String(opts.endpoint || "").toLowerCase();
	if (endpoint.includes("amanai.dev") || name.includes("amanai")) return "amanai";
	return "default";
}

export function providerIsAmanaiCompat(provider: {
	compatProfile?: string | null;
	name?: string | null;
	endpoint?: string | null;
} | null | undefined): boolean {
	if (!provider) return false;
	if (normalizeCompatProfile(provider.compatProfile) === "amanai") return true;
	if (provider.compatProfile == null || provider.compatProfile === "") {
		const name = String(provider.name || "").toLowerCase();
		const endpoint = String(provider.endpoint || "").toLowerCase();
		return endpoint.includes("amanai.dev") || name.includes("amanai");
	}
	return false;
}

function hasCacheControl(obj: any): boolean {
	return !!(obj && typeof obj === "object" && obj.cache_control);
}

/** Count explicit block-level cache_control markers (not top-level body.cache_control). */
function countExplicitBreakpoints(root: any): number {
	let n = 0;
	const visit = (node: any, isRoot: boolean) => {
		if (!node || typeof node !== "object") return;
		if (!isRoot && hasCacheControl(node)) n += 1;
		if (Array.isArray(node)) {
			for (const x of node) visit(x, false);
			return;
		}
		for (const k of Object.keys(node)) {
			if (k === "cache_control") continue;
			visit(node[k], false);
		}
	};
	visit(root, true);
	return n;
}

function markCacheControl(target: any): boolean {
	if (!target || typeof target !== "object") return false;
	if (hasCacheControl(target)) return false;
	target.cache_control = { ...CACHE_CONTROL_EPHEMERAL };
	return true;
}

function ensureTopLevelAutomaticCache(out: any): void {
	// Anthropic automatic caching: top-level cache_control moves with the last
	// cacheable block as conversations grow (best for multi-turn / Claude Code).
	if (!hasCacheControl(out)) {
		out.cache_control = { ...CACHE_CONTROL_EPHEMERAL };
	}
}

function cloneMessageContent(m: any): any {
	return {
		...m,
		content: Array.isArray(m.content)
			? m.content.map((b: any) => (b && typeof b === "object" ? { ...b } : b))
			: m.content,
	};
}

/**
 * Mark the last cacheable turn (prefer penultimate so the growing history prefix
 * is cached). For string content, set message-level cache_control without rewriting
 * to content blocks — converting strings→blocks can bust OpenAI automatic prefix cache.
 */
function markTrailingHistoryBreakpoint(
	messages: any[],
	budget: { n: number },
	opts?: { preferMessageLevel?: boolean },
): void {
	if (budget.n <= 0 || !Array.isArray(messages) || messages.length === 0) return;

	// Prefer last assistant (or user) before the final user turn — classic multi-turn.
	let targetIdx = messages.length - 1;
	const last = messages[messages.length - 1];
	if (last?.role === "user" && messages.length >= 2) {
		targetIdx = messages.length - 2;
	}

	const preferMessageLevel = opts?.preferMessageLevel === true;

	for (let i = targetIdx; i >= 0 && budget.n > 0; i--) {
		const msg = messages[i];
		if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;

		if (typeof msg.content === "string" && msg.content.trim().length > 0) {
			if (preferMessageLevel) {
				if (markCacheControl(msg)) budget.n -= 1;
				return;
			}
			msg.content = [
				{
					type: "text",
					text: msg.content,
					cache_control: { ...CACHE_CONTROL_EPHEMERAL },
				},
			];
			budget.n -= 1;
			return;
		}
		if (Array.isArray(msg.content) && msg.content.length > 0) {
			const textBlocks = msg.content.filter(
				(b: any) => b && typeof b === "object" && (b.type === "text" || typeof b.text === "string"),
			);
			for (let t = textBlocks.length - 1; t >= 0; t--) {
				if (markCacheControl(textBlocks[t])) {
					budget.n -= 1;
					return;
				}
			}
		}
	}
}

/**
 * Shape an Anthropic Messages body for Amanai cache hits.
 * - Top-level automatic cache_control (multi-turn)
 * - Explicit: last tool → system → trailing history breakpoint
 */
export function applyAmanaiCacheToAnthropicBody(body: any): any {
	if (!body || typeof body !== "object") return body;
	const out = { ...body };
	ensureTopLevelAutomaticCache(out);

	const budget = {
		n: Math.max(0, MAX_EXPLICIT_BREAKPOINTS - countExplicitBreakpoints(out)),
	};

	// 1) Last tool
	if (budget.n > 0 && Array.isArray(out.tools) && out.tools.length > 0) {
		out.tools = out.tools.map((t: any) => ({ ...t }));
		const last = out.tools[out.tools.length - 1];
		if (markCacheControl(last)) budget.n -= 1;
	}

	// 2) System → text block with cache_control
	if (budget.n > 0 && out.system != null) {
		if (typeof out.system === "string" && out.system.trim()) {
			out.system = [
				{
					type: "text",
					text: out.system,
					cache_control: { ...CACHE_CONTROL_EPHEMERAL },
				},
			];
			budget.n -= 1;
		} else if (Array.isArray(out.system) && out.system.length > 0) {
			out.system = out.system.map((b: any) => ({ ...b }));
			const last = out.system[out.system.length - 1];
			if (last?.type === "text" && markCacheControl(last)) budget.n -= 1;
		}
	}

	// 3) Trailing history breakpoint (moves as conversation grows)
	if (budget.n > 0 && Array.isArray(out.messages)) {
		out.messages = out.messages.map(cloneMessageContent);
		markTrailingHistoryBreakpoint(out.messages, budget);
	}

	return out;
}

/**
 * Shape an OpenAI chat/completions body for Amanai cache hits.
 * Same idea: tools + system + trailing history (not only the first user message).
 * Also set top-level cache_control when Amanai/OpenAI-compat honors it.
 */
export function applyAmanaiCacheToOpenAIBody(body: any): any {
	if (!body || typeof body !== "object") return body;
	const out = { ...body };
	ensureTopLevelAutomaticCache(out);

	const budget = {
		n: Math.max(0, MAX_EXPLICIT_BREAKPOINTS - countExplicitBreakpoints(out)),
	};

	if (budget.n > 0 && Array.isArray(out.tools) && out.tools.length > 0) {
		out.tools = out.tools.map((t: any) => ({
			...t,
			function: t.function ? { ...t.function } : t.function,
		}));
		const last = out.tools[out.tools.length - 1];
		if (markCacheControl(last)) budget.n -= 1;
	}

	if (!Array.isArray(out.messages)) return out;
	out.messages = out.messages.map(cloneMessageContent);

	// System / developer — keep string content intact (OpenAI auto prefix cache);
	// only annotate message-level or existing content-block cache_control.
	for (const msg of out.messages) {
		if (budget.n <= 0) break;
		if (msg.role !== "system" && msg.role !== "developer") continue;
		if (typeof msg.content === "string" && msg.content.trim()) {
			if (markCacheControl(msg)) budget.n -= 1;
		} else if (Array.isArray(msg.content) && msg.content.length > 0) {
			const last = msg.content[msg.content.length - 1];
			if (last && typeof last === "object" && markCacheControl(last)) budget.n -= 1;
		}
	}

	// Trailing history (multi-turn) — message-level for strings
	markTrailingHistoryBreakpoint(out.messages, budget, { preferMessageLevel: true });

	return out;
}

export function applyAmanaiCompatShaping(
	body: any,
	format: "openai" | "anthropic",
): any {
	if (format === "anthropic") return applyAmanaiCacheToAnthropicBody(body);
	return applyAmanaiCacheToOpenAIBody(body);
}
