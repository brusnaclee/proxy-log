/**
 * Anthropic Messages tool normalisation for native /v1/messages passthrough.
 *
 * Claude Code sends beta tool types (bash_20250124, text_editor_*, web_search_*,
 * custom, …). Amanai and similar Anthropic-compatible upstreams reject those
 * with 400 "tools[0].type is not supported by this endpoint", which the proxy
 * surfaces as a 502 and makes Claude Code retry forever.
 *
 * Convert everything to the classic Anthropic tool shape:
 *   { name, description?, input_schema }
 * (no `type` field — that is what upstream rejects).
 */

export type AnthropicNormalizedTool = {
	name: string;
	description?: string;
	input_schema: Record<string, any>;
};

function schemaForTypedTool(type: string, name: string): Record<string, any> {
	const t = type.toLowerCase();
	if (t.startsWith('bash') || name.toLowerCase() === 'bash' || name === 'local_shell') {
		return {
			type: 'object',
			properties: {
				command: { type: 'string', description: 'Shell command to run' },
			},
			required: ['command'],
		};
	}
	if (t.startsWith('text_editor') || /str_replace|editor/i.test(name)) {
		return {
			type: 'object',
			properties: {
				command: { type: 'string' },
				path: { type: 'string' },
				file_text: { type: 'string' },
				old_str: { type: 'string' },
				new_str: { type: 'string' },
			},
			additionalProperties: true,
		};
	}
	if (t.startsWith('web_search') || /web_search/i.test(name)) {
		return {
			type: 'object',
			properties: { query: { type: 'string' } },
			required: ['query'],
		};
	}
	if (t.startsWith('computer') || /computer/i.test(name)) {
		return {
			type: 'object',
			properties: {
				action: { type: 'string' },
				coordinate: { type: 'array', items: { type: 'number' } },
				text: { type: 'string' },
			},
			additionalProperties: true,
		};
	}
	return { type: 'object', properties: {}, additionalProperties: true };
}

function descriptionForTypedTool(type: string, name: string, existing?: string): string | undefined {
	if (existing) return existing;
	const t = type.toLowerCase();
	if (t.startsWith('bash') || name.toLowerCase() === 'bash') return 'Run a shell command.';
	if (t.startsWith('text_editor')) return 'View and edit files in the workspace.';
	if (t.startsWith('web_search')) return 'Search the web.';
	if (t.startsWith('computer')) return 'Control a computer desktop.';
	if (t === 'custom' || t === 'local_shell') return `Tool: ${name}`;
	return undefined;
}

/**
 * Normalise an Anthropic Messages `tools` array for upstreams that only accept
 * classic {name, description, input_schema} entries.
 */
export function normalizeAnthropicToolsForUpstream(
	tools: unknown,
): AnthropicNormalizedTool[] | undefined {
	if (!Array.isArray(tools) || tools.length === 0) return undefined;

	const out: AnthropicNormalizedTool[] = [];
	for (const t of tools) {
		if (!t || typeof t !== 'object') continue;
		const anyT = t as any;

		// Already classic Anthropic — strip forbidden `type` if present.
		const name = String(anyT.name || anyT.function?.name || '').trim();
		if (!name) {
			// Typed tools sometimes omit name and only send type.
			const typeOnly = String(anyT.type || '').trim();
			const inferred =
				typeOnly.startsWith('bash')
					? 'bash'
					: typeOnly.startsWith('text_editor')
						? 'str_replace_editor'
						: typeOnly.startsWith('web_search')
							? 'web_search'
							: typeOnly.startsWith('computer')
								? 'computer'
								: typeOnly === 'local_shell'
									? 'local_shell'
									: '';
			if (!inferred) continue;
			const tool: AnthropicNormalizedTool = {
				name: inferred,
				input_schema: schemaForTypedTool(typeOnly, inferred),
			};
			const desc = descriptionForTypedTool(typeOnly, inferred, anyT.description);
			if (desc) tool.description = desc;
			out.push(tool);
			continue;
		}

		const type = String(anyT.type || '').trim();
		const inputSchema =
			anyT.input_schema ??
			anyT.parameters ??
			anyT.function?.parameters ??
			(type ? schemaForTypedTool(type, name) : { type: 'object', properties: {}, additionalProperties: true });

		const tool: AnthropicNormalizedTool = {
			name,
			input_schema: inputSchema,
		};
		const desc = descriptionForTypedTool(
			type,
			name,
			anyT.description ?? anyT.function?.description,
		);
		if (desc) tool.description = desc;
		out.push(tool);
	}

	return out.length > 0 ? out : undefined;
}
