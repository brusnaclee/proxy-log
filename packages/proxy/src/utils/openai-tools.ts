/**
 * Shared tool-shape normalisation for every OpenAI-compatible endpoint.
 *
 * Clients send tools in three different shapes and upstreams only accept one:
 *   - canonical chat : {type:"function", function:{name, description, parameters}}
 *   - flat/Responses : {type:"function", name, description, parameters}
 *   - non-function   : {type:"local_shell"|"custom"|"web_search", ...}
 *
 * Forwarding a flat or non-function tool straight through produces an upstream
 * 400 ("invalid request") which the proxy surfaces as a 502. Normalising here
 * means /v1/responses, /v1/chat/completions and /v1/messages all present the
 * identical tool list to the upstream.
 */

export type NormalizedTool = {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters: Record<string, any>;
		strict?: boolean;
	};
};

/** Fallback name for Responses-only tool types that carry no name. */
function implicitToolName(type: string): string {
	switch (type) {
		case 'local_shell':
			return 'local_shell';
		case 'web_search':
			return 'web_search';
		case 'computer_use_preview':
			return 'computer_use_preview';
		default:
			return '';
	}
}

/** Schema so strict upstreams that reject a missing/null schema still accept it. */
function implicitToolSchema(type: string, name: string): Record<string, any> {
	switch (type) {
		case 'local_shell':
			return {
				type: 'object',
				properties: { command: { type: 'array', items: { type: 'string' } } },
				required: ['command'],
			};
		case 'web_search':
			return {
				type: 'object',
				properties: { query: { type: 'string' } },
				required: ['query'],
			};
		default:
			// custom/apply_patch style tools take free-form input; keep it permissive.
			return name
				? { type: 'object', properties: {}, additionalProperties: true }
				: { type: 'object', properties: {} };
	}
}

function implicitToolDescription(type: string, name: string): string | undefined {
	switch (type) {
		case 'local_shell':
			return 'Run a shell command locally in the workspace.';
		case 'web_search':
			return 'Search the web.';
		case 'custom':
			return `Custom tool: ${name}`;
		default:
			return undefined;
	}
}

/**
 * Normalise any client tool list into the nested chat-completions function shape.
 * Junk entries are dropped; non-function tools are downgraded, never dropped.
 */
export function normalizeToolsForUpstream(tools: unknown): NormalizedTool[] | undefined {
	if (!Array.isArray(tools) || tools.length === 0) return undefined;

	const out: NormalizedTool[] = [];
	for (const t of tools) {
		if (!t || typeof t !== 'object') continue;

		// Already canonical — keep the wire fields exactly as the client sent them.
		if (t.function && typeof t.function === 'object') {
			const fn = t.function as any;
			const name = String(fn?.name || '').trim();
			if (!name) continue;
			const normalized: NormalizedTool = {
				type: 'function',
				function: {
					name,
					parameters: fn?.parameters ?? implicitToolSchema('function', name),
				},
			};
			// Only attach optional keys when the client actually sent them.
			if (fn?.description !== undefined) normalized.function.description = fn.description;
			if (fn?.strict !== undefined) normalized.function.strict = fn.strict;
			out.push(normalized);
			continue;
		}

		const type = String((t as any).type || 'function');
		const name = String((t as any).name || implicitToolName(type)).trim();
		if (!name) continue;

		const normalized: NormalizedTool = {
			type: 'function',
			function: {
				name,
				parameters: (t as any).parameters ?? implicitToolSchema(type, name),
			},
		};
		const description =
			(t as any).description ?? implicitToolDescription(type, name);
		if (description !== undefined) normalized.function.description = description;
		if ((t as any).strict !== undefined) normalized.function.strict = (t as any).strict;
		out.push(normalized);
	}

	return out.length > 0 ? out : undefined;
}