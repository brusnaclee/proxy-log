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
	};
}

function sse(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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
	if (Array.isArray(toolDeltas)) {
		ensureMessageScaffold(state, out);
		for (const tc of toolDeltas) {
			if (!tc) continue;
			if (tc.id && tc.function?.name) {
				out.push(
					sse("response.output_item.added", {
						type: "response.output_item.added",
						output_index: 0,
						item: {
							type: "function_call",
							id: tc.id,
							call_id: tc.id,
							name: tc.function.name,
							arguments: tc.function.arguments || "",
						},
					}),
				);
			} else if (typeof tc.function?.arguments === "string" && tc.function.arguments) {
				out.push(
					sse("response.function_call_arguments.delta", {
						type: "response.function_call_arguments.delta",
						delta: tc.function.arguments,
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

	// Empty upstream still needs a completed envelope so Codex does not hang.
	if (!state.sentCreated) {
		ensureMessageScaffold(state, out);
	} else if (state.sentItemAdded && !state.sentContentPart && state.text === "") {
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

	if (state.sentContentPart) {
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

	if (state.sentItemAdded) {
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

	out.push(
		sse("response.completed", {
			type: "response.completed",
			response: {
				id: state.responseId,
				object: "response",
				status: "completed",
				output: state.sentItemAdded
					? [
							{
								type: "message",
								id: state.itemId,
								role: "assistant",
								status: "completed",
								content: [{ type: "output_text", text: state.text }],
							},
						]
					: [],
			},
		}),
	);

	state.completed = true;
	return out;
}
