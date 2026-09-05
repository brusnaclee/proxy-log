/**
 * Normalize OpenAI-compatible tool_calls arrays for streaming/non-streaming.
 *
 * Upstream (esp. gcli/grok, some routers) may send either:
 *   nested: { type, id, function: { name, arguments } }
 *   flat:   { type, id, name, arguments }
 *
 * Clients (OpenAI SDK, Grok Build / grok-shell) accumulate by index and often do
 *   toolCall.function.name = delta.function.name
 * If a later arguments-only delta carries `name: ""` (or we invent it), the
 * client WIPEs the real name from chunk 1 → "Agent tried calling a tool that
 * doesn't exist".
 *
 * Rules:
 * - Copy flat → nested when flat has a real name/args
 * - Never invent "unknown"
 * - Never emit/leave empty-string `function.name` on the wire — omit the field
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

function cleanName(v: unknown): string {
	if (typeof v !== "string") return "";
	return v.trim();
}

export function normalizeToolCallArray(toolCalls: any[]): void {
	if (!Array.isArray(toolCalls)) return;
	for (let i = 0; i < toolCalls.length; i++) {
		const tc = toolCalls[i];
		if (!tc || typeof tc !== "object") continue;
		if (tc.index == null || tc.index === "") tc.index = i;
		if (!tc.type) tc.type = "function";

		const flatName = cleanName(tc.name);
		const hasFlatArgs = Object.prototype.hasOwnProperty.call(tc, "arguments");
		const flatArgs = hasFlatArgs ? asArgString(tc.arguments) : "";

		if (!tc.function || typeof tc.function !== "object") {
			tc.function = {} as { name?: string; arguments?: string };
			if (flatName) tc.function.name = flatName;
			if (hasFlatArgs) tc.function.arguments = flatArgs;
		} else {
			const nestedName = cleanName(tc.function.name);
			if (nestedName) {
				tc.function.name = nestedName;
			} else if (flatName) {
				tc.function.name = flatName;
			} else {
				// Absent or empty — drop so later arg deltas don't wipe client state.
				delete tc.function.name;
			}

			if (tc.function.arguments == null || tc.function.arguments === "") {
				if (hasFlatArgs) tc.function.arguments = flatArgs;
				else if (tc.function.arguments == null && hasFlatArgs === false) {
					// leave undefined on pure name-setup chunks
				}
			}
		}

		// Also drop empty flat name so dual-shape clients don't wipe either.
		if (typeof tc.name === "string" && !cleanName(tc.name)) {
			delete tc.name;
		}
	}
}
