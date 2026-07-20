/**
 * Convert Antigravity / Gemini "contents" bodies to OpenAI Chat Completions.
 *
 * Antigravity IDE often POSTs to /v1/chat/completions with:
 *   { model, project, request: { contents: [{ role, parts: [{ text }] }] } }
 * (or bare { contents: [...] }) and no OpenAI `messages` array.
 * Forwarding that raw body to OpenAI-compatible upstreams (amanai, tokito, …)
 * yields: Missing or invalid 'messages' → client 502.
 */

export function getGeminiContents(body: any): any[] | null {
	if (!body || typeof body !== 'object') return null;
	if (Array.isArray(body.request?.contents) && body.request.contents.length > 0) {
		return body.request.contents;
	}
	if (Array.isArray(body.contents) && body.contents.length > 0) {
		return body.contents;
	}
	return null;
}

/** True when body looks like Gemini/Antigravity contents and lacks usable OpenAI messages. */
export function looksLikeGeminiContentsBody(body: any): boolean {
	if (!body || typeof body !== 'object') return false;
	if (Array.isArray(body.messages) && body.messages.length > 0) return false;
	return getGeminiContents(body) != null;
}

function partsToContent(parts: any): string {
	if (!Array.isArray(parts)) return '';
	const texts: string[] = [];
	for (const p of parts) {
		if (!p || typeof p !== 'object') continue;
		if (typeof p.text === 'string' && p.text) texts.push(p.text);
		else if (typeof p.thought === 'string' && p.thought) texts.push(p.thought);
		else if (p.functionCall) {
			texts.push(`[function_call:${p.functionCall.name || 'tool'} ${JSON.stringify(p.functionCall.args || {})}]`);
		} else if (p.functionResponse) {
			const fr = p.functionResponse;
			const payload =
				typeof fr.response === 'string' ? fr.response : JSON.stringify(fr.response ?? fr);
			texts.push(payload);
		}
	}
	return texts.join('\n');
}

/**
 * Map Gemini contents → OpenAI chat body. Preserves model/stream/generationConfig.
 * Returns null if nothing convertible.
 */
export function convertGeminiContentsToOpenAI(body: any): Record<string, any> | null {
	const contents = getGeminiContents(body);
	if (!contents || contents.length === 0) return null;

	const messages: Array<Record<string, any>> = [];
	for (const m of contents) {
		if (!m || typeof m !== 'object') continue;
		const rawRole = String(m.role || 'user').toLowerCase();
		const role =
			rawRole === 'model' || rawRole === 'assistant'
				? 'assistant'
				: rawRole === 'function' || rawRole === 'tool'
					? 'tool'
					: rawRole === 'system'
						? 'system'
						: 'user';
		const content = partsToContent(m.parts);
		if (!content && role !== 'assistant') continue;

		const msg: Record<string, any> = { role, content: content || '' };
		if (role === 'tool' && m.parts) {
			const fr = (m.parts as any[]).find((p) => p?.functionResponse);
			if (fr?.functionResponse?.name) msg.name = fr.functionResponse.name;
			if (fr?.functionResponse?.id) msg.tool_call_id = fr.functionResponse.id;
		}
		messages.push(msg);
	}

	if (messages.length === 0) return null;

	const gen = body.request?.generationConfig || body.generationConfig || {};
	const out: Record<string, any> = {
		model: body.model || body.request?.model || 'unknown',
		messages,
		stream: body.stream ?? body.request?.stream ?? false,
	};

	if (gen.temperature !== undefined) out.temperature = gen.temperature;
	if (gen.topP !== undefined) out.top_p = gen.topP;
	if (gen.maxOutputTokens !== undefined) out.max_tokens = gen.maxOutputTokens;
	else if (body.max_tokens !== undefined) out.max_tokens = body.max_tokens;
	else if (body.max_completion_tokens !== undefined) out.max_tokens = body.max_completion_tokens;

	if (Array.isArray(body.tools)) out.tools = body.tools;
	else if (Array.isArray(body.request?.tools)) out.tools = body.request.tools;

	if (body.tool_choice !== undefined) out.tool_choice = body.tool_choice;
	if (body.stop !== undefined) out.stop = body.stop;

	return out;
}
