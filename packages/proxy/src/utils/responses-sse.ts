/**
 * Convert OpenAI Chat Completions SSE chunks → Responses API SSE events.
 * Codex (wire_api=responses) requires response.completed before the stream ends;
 * a bare close after output_text.delta causes:
 *   "stream disconnected before completion: stream closed before response.completed"
 */

export type ResponsesSseState = {
	responseId: string;
	itemId: string;
	sentCreated: boolean;
	sentItemAdded: boolean;
	sentContentPart: boolean;
	completed: boolean;
	text: string;
	/**
	 * In-flight function_call items keyed by tool-call index. Codex only runs
	 * the next agent step after it sees output_item.done for the call, so
	 * these must be tracked and closed — otherwise the loop stops at the user.
	 */
	toolCalls: Map<number, {
		callId: string;
		name: string;
		args: string;
		added: boolean;
	}>;
};

export function createResponsesSseState(now = Date.now()): ResponsesSseState {
	return {
		responseId: `resp_${now}`,
		itemId: `msg_${now}`,
		sentCreated: false,
		sentItemAdded: false,
		sentContentPart: false,
		completed: false,
		text: "",
		toolCalls: new Map(),
	};
}

function sse(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** response.created must exist before any output item, so it does not need a message scaffold. */
function ensureResponseCreated(state: ResponsesSseState, out: string[]): void {
	if (state.sentCreated) return;
	state.sentCreated = true;
	out.push(
		sse("response.created", {
			type: "response.created",
			response: {
				id: state.responseId,
				object: "response",
				status: "in_progress",
			},
		}),
	);
}

function ensureMessageScaffold(state: ResponsesSseState, out: string[]): void {
	if (!state.sentCreated) {
		state.sentCreated = true;
		out.push(
			sse("response.created", {
				type: "response.created",
				response: {
					id: state.responseId,
					object: "response",
					status: "in_progress",
				},
			}),
		);
	}
	if (!state.sentItemAdded) {
		state.sentItemAdded = true;
		out.push(
			sse("response.output_item.added", {
				type: "response.output_item.added",
				output_index: 0,
				item: {
					type: "message",
					id: state.itemId,
					role: "assistant",
					status: "in_progress",
					content: [],
				},
			}),
		);
	}
	if (!state.sentContentPart) {
		state.sentContentPart = true;
		out.push(
			sse("response.content_part.added", {
				type: "response.content_part.added",
				item_id: state.itemId,
				output_index: 0,
				content_index: 0,
				part: { type: "output_text", text: "" },
			}),
		);
	}
}

/** Handle one Chat Completions `data: {...}` payload (not [DONE]). */
export function responsesSseFromChatPayload(
	state: ResponsesSseState,
	data: any,
): string[] {
	const out: string[] = [];
	if (state.completed) return out;

	if (data?.id && typeof data.id === "string") {
		state.responseId = data.id.replace(/^chatcmpl[-_]?/i, "resp_") || state.responseId;
	}

	const delta = data?.choices?.[0]?.delta;
	const textDelta =
		typeof delta?.content === "string"
			? delta.content
			: typeof data?.choices?.[0]?.message?.content === "string" && !delta
				? data.choices[0].message.content
				: "";

	if (textDelta) {
		ensureMessageScaffold(state, out);
		state.text += textDelta;
		out.push(
			sse("response.output_text.delta", {
				type: "response.output_text.delta",
				item_id: state.itemId,
				output_index: 0,
				content_index: 0,
				delta: textDelta,
			}),
		);
	}

	const toolDeltas = delta?.tool_calls;
	if (Array.isArray(toolDeltas) && toolDeltas.length > 0) {
		ensureResponseCreated(state, out);
		for (const tc of toolDeltas) {
			if (!tc) continue;
			const key = typeof tc.index === "number" ? tc.index : toolDeltas.indexOf(tc);
			const name =
				(typeof tc.function?.name === "string" && tc.function.name.trim()) ||
				(typeof tc.name === "string" && tc.name.trim()) ||
				"";
			const args =
				(typeof tc.function?.arguments === "string" && tc.function.arguments) ||
				(typeof tc.arguments === "string" && tc.arguments) ||
				"";
			// OpenAI streams often send name on the first delta with only `index`
			// (no id yet), and arguments across several deltas. Keep one entry per
			// index so the item can be closed with the full argument string.
			const existing = state.toolCalls.get(key);
			const entry =
				existing ||
				({
					callId:
						(typeof tc.id === "string" && tc.id) ||
						`call_idx_${key}`,
					name: "",
					args: "",
					added: false,
				} as ResponsesSseState["toolCalls"] extends Map<number, infer V> ? V : never);
			if (name) entry.name = name;
			if (args) entry.args += args;
			if (typeof tc.id === "string" && tc.id) entry.callId = tc.id;
			state.toolCalls.set(key, entry);

			if (!entry.added && entry.name) {
				entry.added = true;
				out.push(
					sse("response.output_item.added", {
						type: "response.output_item.added",
						output_index: 0,
						item: {
							type: "function_call",
							id: entry.callId,
							call_id: entry.callId,
							name: entry.name,
							arguments: "",
						},
					}),
				);
			}
			if (entry.added && args) {
				out.push(
					sse("response.function_call_arguments.delta", {
						type: "response.function_call_arguments.delta",
						item_id: entry.callId,
						output_index: 0,
						delta: args,
					}),
				);
			}
		}
	}

	const finish = data?.choices?.[0]?.finish_reason;
	if (finish) {
		out.push(...finalizeResponsesSse(state));
	}

	return out;
}

/** Always call on stream end / [DONE] so Codex sees response.completed. */
export function finalizeResponsesSse(state: ResponsesSseState): string[] {
	if (state.completed) return [];
	const out: string[] = [];

	const pendingTools = [...state.toolCalls.values()].filter((t) => t.added);
	const hasToolCalls = pendingTools.length > 0;

	// A tool-call turn must NOT open a message item: Codex treats a completed
	// message as "assistant answered", which ends the agent loop. Only emit the
	// message scaffold when there is real assistant text to deliver.
	if (!hasToolCalls && !state.sentItemAdded) {
		ensureMessageScaffold(state, out);
	} else if (!hasToolCalls && state.sentItemAdded && !state.sentContentPart) {
		// created + item but no text — still close content part cleanly
		state.sentContentPart = true;
		out.push(
			sse("response.content_part.added", {
				type: "response.content_part.added",
				item_id: state.itemId,
				output_index: 0,
				content_index: 0,
				part: { type: "output_text", text: "" },
			}),
		);
	}

	if (!hasToolCalls && state.sentContentPart) {
		out.push(
			sse("response.output_text.done", {
				type: "response.output_text.done",
				item_id: state.itemId,
				output_index: 0,
				content_index: 0,
				text: state.text,
			}),
		);
		out.push(
			sse("response.content_part.done", {
				type: "response.content_part.done",
				item_id: state.itemId,
				output_index: 0,
				content_index: 0,
				part: { type: "output_text", text: state.text },
			}),
		);
	}

	if (!hasToolCalls && state.sentItemAdded) {
		out.push(
			sse("response.output_item.done", {
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "message",
					id: state.itemId,
					role: "assistant",
					status: "completed",
					content: state.sentContentPart
						? [{ type: "output_text", text: state.text }]
						: [],
				},
			}),
		);
	}

	// Close every function_call item. Without output_item.done Codex never
	// executes the tool and the loop dies waiting on the user.
	for (const tool of pendingTools) {
		out.push(
			sse("response.output_item.done", {
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "function_call",
					id: tool.callId,
					call_id: tool.callId,
					name: tool.name,
					arguments: tool.args || "{}",
					status: "completed",
				},
			}),
		);
	}

	const output: any[] = [];
	if (!hasToolCalls && state.sentItemAdded) {
		output.push({
			type: "message",
			id: state.itemId,
			role: "assistant",
			status: "completed",
			content: state.sentContentPart
				? [{ type: "output_text", text: state.text }]
				: [],
		});
	}
	for (const tool of pendingTools) {
		output.push({
			type: "function_call",
			id: tool.callId,
			call_id: tool.callId,
			name: tool.name,
			arguments: tool.args || "{}",
			status: "completed",
		});
	}

	out.push(
		sse("response.completed", {
			type: "response.completed",
			response: {
				id: state.responseId,
				object: "response",
				status: "completed",
				output,
			},
		}),
	);

	state.completed = true;
	return out;
}
