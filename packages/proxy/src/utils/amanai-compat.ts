/**
 * Amanai-compatible upstream shaping.
 *
 * Billing (Pricing Engine v3): 
 *   credits = ceil( (input - cache_read) * m_in + cache_read * m_cache + output * m_out )
 *   m_cache = 0.25 * m_in  → 75% discount on cached input
 *   At ~60% cache-hit, effective input ≈ 0.55 × m_in
 *
 * Docs: https://ai.amanai.dev/docs/billing/
 *
 * We inject Anthropic-style `cache_control: { type: "ephemeral" }` breakpoints on
 * stable prefixes (tools → system → early messages) so multi-turn agent traffic
 * can hit cache_read instead of full m_in. OpenAI chat path uses the same markers
 * on content blocks / tools (Amanai accepts both OpenAI + Anthropic APIs).
 */

export type CompatProfile = "default" | "amanai";

export const CACHE_CONTROL_EPHEMERAL = { type: "ephemeral" as const };

const MAX_BREAKPOINTS = 4;

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
	// Legacy fallback before column backfill completes
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

function countBreakpoints(root: any): number {
	let n = 0;
	const visit = (node: any) => {
		if (!node || typeof node !== "object") return;
		if (hasCacheControl(node)) n += 1;
		if (Array.isArray(node)) {
			for (const x of node) visit(x);
			return;
		}
		for (const k of Object.keys(node)) {
			if (k === "cache_control") continue;
			visit(node[k]);
		}
	};
	visit(root);
	return n;
}

function markCacheControl(target: any): boolean {
	if (!target || typeof target !== "object") return false;
	if (hasCacheControl(target)) return false;
	target.cache_control = { ...CACHE_CONTROL_EPHEMERAL };
	return true;
}

/**
 * Shape an Anthropic Messages body for Amanai cache hits.
 * Order of breakpoints (Anthropic): tools → system → messages.
 */
export function applyAmanaiCacheToAnthropicBody(body: any): any {
	if (!body || typeof body !== "object") return body;
	const out = { ...body };
	let budget = Math.max(0, MAX_BREAKPOINTS - countBreakpoints(out));

	// 1) Last tool
	if (budget > 0 && Array.isArray(out.tools) && out.tools.length > 0) {
		out.tools = out.tools.map((t: any) => ({ ...t }));
		const last = out.tools[out.tools.length - 1];
		if (markCacheControl(last)) budget -= 1;
	}

	// 2) System → text block with cache_control
	if (budget > 0 && out.system != null) {
		if (typeof out.system === "string" && out.system.trim()) {
			out.system = [
				{
					type: "text",
					text: out.system,
					cache_control: { ...CACHE_CONTROL_EPHEMERAL },
				},
			];
			budget -= 1;
		} else if (Array.isArray(out.system) && out.system.length > 0) {
			out.system = out.system.map((b: any) => ({ ...b }));
			const last = out.system[out.system.length - 1];
			if (last?.type === "text" && markCacheControl(last)) budget -= 1;
		}
	}

	// 3) Early stable user message (first non-tool_result user with text)
	if (budget > 0 && Array.isArray(out.messages)) {
		out.messages = out.messages.map((m: any) => ({
			...m,
			content: Array.isArray(m.content)
				? m.content.map((b: any) => (b && typeof b === "object" ? { ...b } : b))
				: m.content,
		}));
		for (const msg of out.messages) {
			if (budget <= 0) break;
			if (msg.role !== "user") continue;
			if (typeof msg.content === "string" && msg.content.trim().length > 200) {
				msg.content = [
					{
						type: "text",
						text: msg.content,
						cache_control: { ...CACHE_CONTROL_EPHEMERAL },
					},
				];
				budget -= 1;
				break;
			}
			if (Array.isArray(msg.content) && msg.content.length > 0) {
				const textBlocks = msg.content.filter((b: any) => b?.type === "text" && b.text);
				if (textBlocks.length === 0) continue;
				const lastText = textBlocks[textBlocks.length - 1];
				if (String(lastText.text || "").length > 200 && markCacheControl(lastText)) {
					budget -= 1;
					break;
				}
			}
		}
	}

	return out;
}

/**
 * Shape an OpenAI chat/completions (or similar) body for Amanai cache hits.
 * Uses content-block + tool-level cache_control markers accepted by dual gateways.
 */
export function applyAmanaiCacheToOpenAIBody(body: any): any {
	if (!body || typeof body !== "object") return body;
	const out = { ...body };
	let budget = Math.max(0, MAX_BREAKPOINTS - countBreakpoints(out));

	// Tools: mark last function tool
	if (budget > 0 && Array.isArray(out.tools) && out.tools.length > 0) {
		out.tools = out.tools.map((t: any) => ({ ...t, function: t.function ? { ...t.function } : t.function }));
		const last = out.tools[out.tools.length - 1];
		if (markCacheControl(last)) budget -= 1;
	}

	if (!Array.isArray(out.messages)) return out;
	out.messages = out.messages.map((m: any) => ({ ...m }));

	// System / developer messages → content blocks with cache_control
	for (const msg of out.messages) {
		if (budget <= 0) break;
		if (msg.role !== "system" && msg.role !== "developer") continue;
		if (typeof msg.content === "string" && msg.content.trim()) {
			msg.content = [
				{
					type: "text",
					text: msg.content,
					cache_control: { ...CACHE_CONTROL_EPHEMERAL },
				},
			];
			budget -= 1;
		} else if (Array.isArray(msg.content) && msg.content.length > 0) {
			msg.content = msg.content.map((b: any) => (b && typeof b === "object" ? { ...b } : b));
			const last = msg.content[msg.content.length - 1];
			if (last && typeof last === "object" && markCacheControl(last)) budget -= 1;
		}
	}

	// First large user message
	if (budget > 0) {
		for (const msg of out.messages) {
			if (msg.role !== "user") continue;
			if (typeof msg.content === "string" && msg.content.trim().length > 200) {
				msg.content = [
					{
						type: "text",
						text: msg.content,
						cache_control: { ...CACHE_CONTROL_EPHEMERAL },
					},
				];
				budget -= 1;
				break;
			}
			if (Array.isArray(msg.content)) {
				msg.content = msg.content.map((b: any) => (b && typeof b === "object" ? { ...b } : b));
				const textBlocks = msg.content.filter((b: any) => b?.type === "text");
				const last = textBlocks[textBlocks.length - 1];
				if (last && String(last.text || "").length > 200 && markCacheControl(last)) {
					budget -= 1;
					break;
				}
			}
		}
	}

	return out;
}

export function applyAmanaiCompatShaping(
	body: any,
	format: "openai" | "anthropic",
): any {
	if (format === "anthropic") return applyAmanaiCacheToAnthropicBody(body);
	return applyAmanaiCacheToOpenAIBody(body);
}
