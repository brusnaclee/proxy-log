/**
 * Anthropic API Adapter
 * Converts between OpenAI-compatible format (used by clients) and Anthropic format (used by Anthropic upstream).
 */

// ─── Request Conversion (OpenAI -> Anthropic) ────────────────────────────────

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: Array<{ type: "function"; function: { name: string; description?: string; parameters?: any } }>;
  stop?: string | string[];
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: Array<{ name: string; description?: string; input_schema: any }>;
  stop_sequences?: string[];
}

export function convertRequestToAnthropic(openai: OpenAIRequest): AnthropicRequest {
  const messages: OpenAIMessage[] = openai.messages || [];

  // Extract system message
  let system: string | undefined;
  const nonSystemMessages: OpenAIMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system = typeof msg.content === "string" ? msg.content : undefined;
    } else {
      nonSystemMessages.push(msg);
    }
  }

  // Convert messages
  const anthropicMessages: AnthropicMessage[] = [];
  for (const msg of nonSystemMessages) {
    if (msg.role === "user") {
      anthropicMessages.push({
        role: "user",
        content: msg.content || "",
      });
    } else if (msg.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (msg.content) {
        blocks.push({ type: "text", text: msg.content });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let input: any = {};
          try {
            input = JSON.parse(tc.function.arguments || "{}");
          } catch {
            input = {};
          }
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }
      anthropicMessages.push({
        role: "assistant",
        content: blocks.length > 0 ? blocks : msg.content || "",
      });
    } else if (msg.role === "tool") {
      // Tool result -> user message with tool_result content block
      anthropicMessages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: msg.tool_call_id,
          content: msg.content || "",
        }],
      });
    }
  }

  // Convert tools
  let tools: AnthropicRequest["tools"] | undefined;
  if (openai.tools && openai.tools.length > 0) {
    tools = openai.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters || { type: "object", properties: {} },
    }));
  }

  // Handle stop sequences
  let stop_sequences: string[] | undefined;
  if (openai.stop) {
    stop_sequences = Array.isArray(openai.stop) ? openai.stop : [openai.stop];
  }

  return {
    model: openai.model,
    max_tokens: openai.max_tokens || 4096,
    messages: anthropicMessages,
    ...(system ? { system } : {}),
    ...(openai.temperature !== undefined ? { temperature: openai.temperature } : {}),
    ...(openai.top_p !== undefined ? { top_p: openai.top_p } : {}),
    ...(openai.stream !== undefined ? { stream: openai.stream } : {}),
    ...(tools ? { tools } : {}),
    ...(stop_sequences ? { stop_sequences } : {}),
  };
}

// ─── Response Conversion (Anthropic -> OpenAI) ───────────────────────────────

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<{ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: any }>;
  model: string;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

interface OpenAIResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export function convertResponseToOpenAI(anthropic: AnthropicResponse): OpenAIResponse {
  let content: string | null = null;
  const toolCalls: OpenAIResponse["choices"][0]["message"]["tool_calls"] = [];

  for (const block of anthropic.content || []) {
    if (block.type === "text") {
      content = (content || "") + block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
        },
      });
    }
  }

  const finishReasonMap: Record<string, string> = {
    end_turn: "stop",
    max_tokens: "length",
    tool_use: "tool_calls",
    stop_sequence: "stop",
  };

  return {
    id: anthropic.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: anthropic.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: toolCalls.length > 0 && !content ? null : content,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: finishReasonMap[anthropic.stop_reason] || "stop",
    }],
    usage: {
      prompt_tokens: anthropic.usage?.input_tokens || 0,
      completion_tokens: anthropic.usage?.output_tokens || 0,
      total_tokens: (anthropic.usage?.input_tokens || 0) + (anthropic.usage?.output_tokens || 0),
    },
  };
}

// ─── Streaming Conversion (Anthropic SSE -> OpenAI SSE) ──────────────────────

interface StreamState {
  id: string;
  model: string;
  toolCallIndex: number;
  currentToolIndex: number;
  hasContent: boolean;
}

/**
 * Converts an Anthropic SSE event line to one or more OpenAI SSE event lines.
 * Returns an array of SSE lines (each prefixed with "data: ") or empty array to skip.
 */
export function convertStreamEvent(line: string, state: StreamState): string[] {
  if (!line.startsWith("event:") && !line.startsWith("data:")) return [];

  // Parse event type and data
  let eventType = "";
  let dataStr = "";

  const lines = line.split("\n");
  for (const l of lines) {
    if (l.startsWith("event: ")) {
      eventType = l.slice(7).trim();
    } else if (l.startsWith("data: ")) {
      dataStr = l.slice(6).trim();
    }
  }

  if (!dataStr) return [];

  let data: any;
  try {
    data = JSON.parse(dataStr);
  } catch {
    return [];
  }

  const lines_out: string[] = [];

  switch (eventType) {
    case "message_start": {
      // Emit initial chunk with role
      state.id = data.message?.id || state.id;
      state.model = data.message?.model || state.model;
      const chunk = {
        id: state.id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: state.model,
        choices: [{
          index: 0,
          delta: { role: "assistant", content: "" },
          finish_reason: null,
        }],
      };
      lines_out.push(`data: ${JSON.stringify(chunk)}`);
      break;
    }

    case "content_block_delta": {
      if (data.delta?.type === "text_delta" && data.delta?.text) {
        state.hasContent = true;
        const chunk = {
          id: state.id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: state.model,
          choices: [{
            index: 0,
            delta: { content: data.delta.text },
            finish_reason: null,
          }],
        };
        lines_out.push(`data: ${JSON.stringify(chunk)}`);
      } else if (data.delta?.type === "input_json_delta" && data.delta?.partial_json) {
        // Tool use input streaming
        const chunk = {
          id: state.id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: state.model,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: state.currentToolIndex,
                function: { arguments: data.delta.partial_json },
              }],
            },
            finish_reason: null,
          }],
        };
        lines_out.push(`data: ${JSON.stringify(chunk)}`);
      }
      break;
    }

    case "content_block_start": {
      if (data.content_block?.type === "tool_use") {
        state.currentToolIndex = state.toolCallIndex++;
        const chunk = {
          id: state.id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: state.model,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: state.currentToolIndex,
                id: data.content_block.id,
                type: "function",
                function: {
                  name: data.content_block.name,
                  arguments: "",
                },
              }],
            },
            finish_reason: null,
          }],
        };
        lines_out.push(`data: ${JSON.stringify(chunk)}`);
      }
      break;
    }

    case "message_delta": {
      const finishReasonMap: Record<string, string> = {
        end_turn: "stop",
        max_tokens: "length",
        tool_use: "tool_calls",
        stop_sequence: "stop",
      };
      const chunk = {
        id: state.id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: state.model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: finishReasonMap[data.delta?.stop_reason] || "stop",
        }],
        usage: data.usage ? {
          prompt_tokens: data.usage.input_tokens || 0,
          completion_tokens: data.usage.output_tokens || 0,
          total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
        } : undefined,
      };
      lines_out.push(`data: ${JSON.stringify(chunk)}`);
      break;
    }

    case "message_stop": {
      lines_out.push("data: [DONE]");
      break;
    }

    // ping, content_block_stop, etc. — ignore
  }

  return lines_out;
}

/**
 * Creates a new stream state for tracking conversion context.
 */
export function createStreamState(model: string): StreamState {
  return {
    id: `chatcmpl-${Date.now()}`,
    model,
    toolCallIndex: 0,
    currentToolIndex: 0,
    hasContent: false,
  };
}

/** Build final upstream URL for Anthropic providers: {base}/v1/messages */
export function resolveAnthropicUpstreamUrl(endpoint: string): string {
  const upstreamBase = String(endpoint || "").trim().replace(/\/$/, "");
  if (upstreamBase.endsWith("/v1")) {
    return `${upstreamBase}/messages`;
  }
  return `${upstreamBase}/v1/messages`;
}

/** Upstream headers for Anthropic — never forwards client Authorization. */
export function buildAnthropicUpstreamHeaders(
  apiKey: string,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      const lower = key.toLowerCase();
      if (
        lower === "authorization" ||
        lower === "host" ||
        lower === "content-length" ||
        lower === "content-encoding" ||
        lower === "transfer-encoding"
      ) {
        continue;
      }
      if (lower === "content-type") continue;
      headers[key] = value;
    }
  }

  return headers;
}

export function prepareAnthropicUpstreamBody(openaiBody: OpenAIRequest): string {
  return JSON.stringify(convertRequestToAnthropic(openaiBody));
}
