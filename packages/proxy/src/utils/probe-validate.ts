/**
 * Shared helpers for upstream model-list discovery and probe response validation.
 */

export function buildModelListAuthHeaders(
	apiKey: string,
	endpointType: string,
): Record<string, string> {
	const headers: Record<string, string> = { Accept: 'application/json' };
	const cleanKey = String(apiKey || '')
		.trim()
		.replace(/^Bearer\s+/i, '')
		.replace(/^key:\s*/i, '');
	if (!cleanKey) return headers;
	if (endpointType === 'anthropic') {
		headers['x-api-key'] = cleanKey;
		headers['anthropic-version'] = '2023-06-01';
		headers.Authorization = `Bearer ${cleanKey}`;
	} else {
		headers.Authorization = `Bearer ${cleanKey}`;
	}
	return headers;
}

export function buildModelListCandidateUrls(endpoint: string): string[] {
	const base = String(endpoint || '')
		.trim()
		.replace(/\/+$/, '');
	// Avoid .../v1/v1/models when endpoint already ends with /v1
	const urls: string[] = [];
	if (base.endsWith('/v1')) {
		urls.push(`${base}/models`);
	} else {
		urls.push(`${base}/v1/models`, `${base}/models`);
	}
	return [...new Set(urls)];
}

/**
 * Collapse duplicated API version segments: /v1/v1/chat/... → /v1/chat/...
 * Antigravity (and similar) often set baseURL=.../v1 and still request /v1/chat/completions.
 */
export function collapseDuplicateApiVersionPath(path: string): string {
	let p = String(path || '').replace(/\/+$/, '') || '/';
	let prev = '';
	while (p !== prev) {
		prev = p;
		p = p.replace(/^(\/v\d+)(?:\/v\d+)+(?=\/|$)/, '$1');
	}
	return p;
}

/**
 * Join provider endpoint + client forward path without producing /v1/v1/...
 * (e.g. endpoint https://api.amanai.dev/v1 + /v1/v1/chat/completions → .../v1/chat/completions)
 */
export function joinUpstreamOpenAIUrl(endpoint: string, forwardPath: string): string {
	const upstreamBase = String(endpoint || '').replace(/\/+$/, '');
	let upstreamPath = collapseDuplicateApiVersionPath(forwardPath);
	while (true) {
		const m = upstreamBase.match(/\/(v\d+)$/i);
		if (!m) break;
		const ver = m[1];
		const prefix = `/${ver}`;
		if (upstreamPath === prefix) {
			upstreamPath = '';
			break;
		}
		if (upstreamPath.toLowerCase().startsWith(`${prefix.toLowerCase()}/`)) {
			upstreamPath = upstreamPath.slice(prefix.length);
			continue;
		}
		break;
	}
	return `${upstreamBase}${upstreamPath}`;
}

export function extractModelsArray(payload: any): any[] {
	if (Array.isArray(payload)) return payload;
	if (Array.isArray(payload?.data)) return payload.data;
	if (Array.isArray(payload?.models)) return payload.models;
	return [];
}

/**
 * True when a probe HTTP response actually proves the model is usable.
 * HTTP 200 with empty body / error JSON / empty SSE must NOT count as online.
 */
export function isValidProbeBody(
	status: number,
	contentType: string,
	bodyText: string,
): boolean {
	if (status < 200 || status >= 300) return false;
	const text = String(bodyText || '');
	const ct = String(contentType || '').toLowerCase();

	if (ct.includes('text/event-stream') || /^\s*data:\s*/m.test(text)) {
		let hasContent = false;
		for (const line of text.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed.startsWith('data:')) continue;
			const data = trimmed.slice(5).trim();
			if (!data || data === '[DONE]') continue;
			try {
				const j = JSON.parse(data);
				if (j?.error) return false;
				const delta = j?.choices?.[0]?.delta || j?.choices?.[0]?.message || {};
				const content = delta?.content ?? delta?.text;
				const tools = delta?.tool_calls || j?.choices?.[0]?.message?.tool_calls;
				const reasoning = delta?.reasoning_content || delta?.reasoning;
				if (typeof content === 'string' && content.length > 0) hasContent = true;
				if (typeof reasoning === 'string' && reasoning.length > 0) hasContent = true;
				if (Array.isArray(tools) && tools.length > 0) hasContent = true;
				// Anthropic SSE
				if (j?.type === 'content_block_delta' && j?.delta?.text) hasContent = true;
				if (j?.type === 'message_start') hasContent = true;
			} catch {
				/* ignore bad chunks */
			}
		}
		return hasContent;
	}

	try {
		const j = JSON.parse(text);
		if (j?.error) return false;
		const msg = j?.choices?.[0]?.message;
		const content = msg?.content;
		const tools = msg?.tool_calls;
		const reasoning = msg?.reasoning_content || msg?.reasoning;
		if (typeof content === 'string' && content.trim().length > 0) {
			if (!isPlaceholderEmptyAssistantText(content)) return true;
		} else if (Array.isArray(content) && content.length > 0) return true;
		if (Array.isArray(tools) && tools.length > 0) return true;
		if (typeof reasoning === 'string' && reasoning.trim().length > 0) {
			if (!isPlaceholderEmptyAssistantText(reasoning)) return true;
		}
		// Anthropic Messages JSON
		if (Array.isArray(j?.content) && j.content.length > 0) return true;
		// Reject known placeholder bodies even if usage.completion_tokens > 0
		if (
			typeof content === 'string' &&
			isPlaceholderEmptyAssistantText(content) &&
			!(Array.isArray(tools) && tools.length > 0)
		) {
			return false;
		}
		// Some gateways return {} with usage only — treat as weak success if usage present
		if (j?.usage && (j.usage.completion_tokens > 0 || j.usage.output_tokens > 0)) return true;
		// max_tokens:1 often returns empty content but valid finish_reason
		const fr = String(j?.choices?.[0]?.finish_reason || j?.stop_reason || '').toLowerCase();
		if (fr === 'stop' || fr === 'end_turn' || fr === 'length' || fr === 'max_tokens') {
			return Array.isArray(j?.choices) && j.choices.length > 0;
		}
		return false;
	} catch {
		return text.trim().length > 0 && !/^error/i.test(text.trim());
	}
}

/**
 * Conduit / some gateways return HTTP 200 with placeholder text like
 * "[Empty message]" (~4 tokens). Clients (Cursor/Hermes) still show Empty message.
 * Treat those as empty so we can retry / 502 instead of passing junk through.
 */
export function isPlaceholderEmptyAssistantText(text: unknown): boolean {
	if (text == null) return true;
	if (typeof text !== 'string') return false;
	const t = text.trim();
	if (!t) return true;
	if (/^\[?Empty message\]?\.?$/i.test(t)) return true;
	if (/^Empty response\.?$/i.test(t)) return true;
	if (/^\(no content\)$/i.test(t)) return true;
	return false;
}

/** True when an OpenAI-style assistant message has usable text, reasoning, or tools. */
export function messageHasUsableAssistantOutput(msg: any): boolean {
	if (!msg || typeof msg !== 'object') return false;
	if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return true;
	const content = msg.content;
	if (typeof content === 'string' && !isPlaceholderEmptyAssistantText(content)) {
		return true;
	}
	if (Array.isArray(content) && content.length > 0) {
		for (const block of content) {
			if (typeof block === 'string' && !isPlaceholderEmptyAssistantText(block)) {
				return true;
			}
			if (block?.type === 'text' && !isPlaceholderEmptyAssistantText(block.text)) {
				return true;
			}
			if (block?.type === 'tool_use' || block?.type === 'function') return true;
		}
	}
	const reasoning = msg.reasoning_content || msg.reasoning;
	if (typeof reasoning === 'string' && !isPlaceholderEmptyAssistantText(reasoning)) {
		return true;
	}
	return false;
}

/**
 * Aggregate OpenAI-style SSE into a single chat.completion JSON string.
 */
export function sseTextToOpenAICompletion(
	sseText: string,
	model: string,
): string | null {
	const text = String(sseText || '');
	if (!text.includes('data:')) return null;

	let id = `chatcmpl-${Date.now()}`;
	let content = '';
	let finishReason = 'stop';
	let promptTokens = 0;
	let completionTokens = 0;
	const toolCalls: any[] = [];

	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('data:')) continue;
		const data = trimmed.slice(5).trim();
		if (!data || data === '[DONE]') continue;
		try {
			const j = JSON.parse(data);
			if (j?.id) id = j.id;
			if (j?.model) model = j.model;
			if (j?.usage) {
				promptTokens = j.usage.prompt_tokens || promptTokens;
				completionTokens = j.usage.completion_tokens || completionTokens;
			}
			const choice = j?.choices?.[0];
			if (!choice) continue;
			if (choice.finish_reason) finishReason = choice.finish_reason;
			const delta = choice.delta || choice.message || {};
			if (typeof delta.content === 'string') content += delta.content;
			if (Array.isArray(delta.tool_calls)) {
				for (const tc of delta.tool_calls) {
					const idx = typeof tc.index === 'number' ? tc.index : toolCalls.length;
					if (!toolCalls[idx]) {
						toolCalls[idx] = {
							id: tc.id || `call_${idx}`,
							type: 'function',
							function: { name: '', arguments: '' },
						};
					}
					if (tc.id) toolCalls[idx].id = tc.id;
					if (tc.function?.name) toolCalls[idx].function.name = tc.function.name;
					if (tc.function?.arguments) {
						toolCalls[idx].function.arguments += tc.function.arguments;
					}
				}
			}
		} catch {
			/* skip */
		}
	}

	const message: any = { role: 'assistant', content: content || null };
	const cleanedTools = toolCalls.filter(Boolean);
	if (cleanedTools.length) {
		message.tool_calls = cleanedTools;
		if (!finishReason || finishReason === 'stop') finishReason = 'tool_calls';
	}

	if (!content && cleanedTools.length === 0) {
		// Still return a structured empty completion so callers can 502-guard
		message.content = '';
	}

	return JSON.stringify({
		id,
		object: 'chat.completion',
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [
			{
				index: 0,
				message,
				finish_reason: finishReason,
			},
		],
		usage: {
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens || (content ? 1 : 0),
			total_tokens: promptTokens + (completionTokens || (content ? 1 : 0)),
		},
	});
}
