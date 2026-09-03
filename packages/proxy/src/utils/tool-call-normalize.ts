/**
 * Normalize OpenAI-compatible tool_calls arrays for streaming/non-streaming.
 *
 * Upstream (esp. gcli/grok, some routers) may send either:
 *   nested: { type, id, function: { name, arguments } }
 *   flat:   { type, id, name, arguments }
 *
 * Clients (OpenAI SDK, Grok Build / grok-shell) read `function.name`.
 * If we invent an empty `function` wrapper without copying flat fields,
 * the IDE sees a blank tool name → "Agent tried calling a tool that doesn't exist".
 */

function asArgString(v: unknown): string {
	if (v == null) return "";
	if (typeof v === "string") return v;
	try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
}

export function normalizeToolCallArray(toolCalls: any[]): void {
	if (!Array.isArray(toolCalls)) return;
	for (let i = 0; i < toolCalls.length; i++) {
		const tc = toolCalls[i];
		if (!tc || typeof tc !== "object") continue;
		if (tc.index == null || tc.index === "") tc.index = i;
		if (!tc.type) tc.type = "function";

		const flatName = typeof tc.name === "string" ? tc.name.trim() : "";
		const flatArgs = tc.arguments != null ? asArgString(tc.arguments) : "";

		if (!tc.function || typeof tc.function !== "object") {
			tc.function = {
				name: flatName,
				arguments: flatArgs,
			};
		} else {
			// Keep non-empty names; only fill null/undefined/empty from flat twin.
			// Never invent "unknown".
			if (tc.function.name == null || tc.function.name === "") {
				tc.function.name = flatName;
			} else if (typeof tc.function.name === "string") {
				tc.function.name = tc.function.name.trim();
			}
			if (tc.function.arguments == null || tc.function.arguments === "") {
				if (flatArgs) tc.function.arguments = flatArgs;
				else if (tc.function.arguments == null) tc.function.arguments = "";
			}
		}
	}
}
