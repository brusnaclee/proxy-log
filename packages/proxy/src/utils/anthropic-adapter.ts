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
  type: "text" | "tool_use" | "tool_result" | "image" | "thinking";
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: string;
  thinking?: string;
  source?: { type: "base64"; media_type: string; data: string };
}

function openAIContentToAnthropic(content: OpenAIMessage["content"]): string | AnthropicContentBlock[] {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const blocks: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (part?.type === "text" && part.text) {
      blocks.push({ type: "text", text: part.text });
    } else if (part?.type === "image_url" && part.image_url?.url) {
      const url = String(part.image_url.url);
      const dataMatch = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (dataMatch) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: dataMatch[1], data: dataMatch[2] },
        });
      }
    }
  }
  return blocks.length > 0 ? blocks : "";
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
        content: openAIContentToAnthropic(msg.content),
      });
    } else if (msg.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (typeof msg.content === "string" && msg.content) {
        blocks.push({ type: "text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content as any[]) {
          if (part?.type === "text" && part.text) blocks.push({ type: "text", text: part.text });
          else if (part?.type === "thinking" && (part.thinking || part.text)) {
            blocks.push({ type: "thinking", thinking: part.thinking || part.text });
          }
        }
      }
      const reasoning = (msg as any).reasoning_content || (msg as any).reasoning;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        blocks.push({ type: "thinking", thinking: reasoning });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let input: any = {};
          try {
            input = JSON.parse(tc.function.arguments || "{}");
          } catch (err) {
            console.warn(
              `[anthropic-adapter] invalid tool arguments for ${tc.function.name}:`,
              (err as Error).message,
            );
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
      const toolBlock = {
        type: "tool_result" as const,
        tool_use_id: msg.tool_call_id || "",
        content: msg.content || "",
      };
      const last = anthropicMessages[anthropicMessages.length - 1];
      if (
        last?.role === "user" &&
        Array.isArray(last.content) &&
        last.content.length > 0 &&
        last.content.every((b) => b.type === "tool_result")
      ) {
        last.content.push(toolBlock);
      } else {
        anthropicMessages.push({
          role: "user",
          content: [toolBlock],
        });
      }
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
  let reasoningContent: string | null = null;
  const toolCalls: OpenAIResponse["choices"][0]["message"]["tool_calls"] = [];

  for (const block of anthropic.content || []) {
    if (block.type === "text") {
      content = (content || "") + block.text;
    } else if ((block as any).type === "thinking") {
      const thinkingText = (block as any).thinking || "";
      if (thinkingText) {
        reasoningContent = (reasoningContent || "") + thinkingText;
      }
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

  const message: OpenAIResponse["choices"][0]["message"] & {
    reasoning_content?: string;
  } = {
    role: "assistant",
    content: toolCalls.length > 0 && !content && !reasoningContent ? null : content,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
  };

  if (!message.content && reasoningContent) {
    message.content = reasoningContent;
  }

  return {
    id: anthropic.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: anthropic.model,
    choices: [{
      index: 0,
      message,
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
 * Split a buffer of Anthropic SSE events into complete event blocks + remainder.
 * Some Anthropic-compatible gateways (Nero gateway) emit events where `event:` and
 * `data:` lines are in separate blocks separated by `\r\n\r\n` instead of bundled
 * together. This normalizes line endings and splits on double-newline boundaries.
 */
export function splitAnthropicSseEvents(buffer: string): { events: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const remainder = parts.pop() || "";
  const events = parts.filter((p) => p.trim().length > 0);
  return { events, remainder };
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

  // Some gateways split event: and data: into separate SSE blocks; if eventType
  // is missing, derive it from the data payload's `type` field.
  if (!eventType && dataStr) {
    try {
      const parsed = JSON.parse(dataStr);
      if (parsed?.type) eventType = parsed.type;
    } catch {
      // fallthrough
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
      } else if (
        data.delta?.type === "thinking_delta" &&
        (data.delta?.thinking || data.delta?.text)
      ) {
        state.hasContent = true;
        const thinkingText = data.delta.thinking || data.delta.text || "";
        const chunk = {
          id: state.id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: state.model,
          choices: [{
            index: 0,
            delta: { reasoning_content: thinkingText },
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

/** Upstream headers for Anthropic — never forwards client Authorization / x-api-key. */
export function buildAnthropicUpstreamHeaders(
  apiKey: string,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      const lower = key.toLowerCase();
      if (
        lower === "authorization" ||
        lower === "x-api-key" ||
        lower === "anthropic-version" ||
        lower === "host" ||
        lower === "content-length" ||
        lower === "content-encoding" ||
        lower === "transfer-encoding" ||
        lower === "content-type"
      ) {
        continue;
      }
      // Forward anthropic-beta / anthropic-beta-* headers to upstream
      if (lower === "anthropic-beta" || lower.startsWith("anthropic-beta")) {
        headers[key] = value;
        continue;
      }
      headers[key] = value;
    }
  }

  // Always win over any client auth headers (Claude Code sends x-api-key=sk-proxy-…).
  headers["x-api-key"] = apiKey;
  headers["anthropic-version"] = "2023-06-01";
  // Some dual OpenAI+Anthropic gateways (amanai) also accept Bearer.
  headers["Authorization"] = `Bearer ${apiKey}`;
  // Neutral UA — amanai WAF blocks OpenAI/Python SDK fingerprints.
  if (!headers["User-Agent"] && !headers["user-agent"]) {
    headers["User-Agent"] = "TokitoProxy/1.0";
  }

  return headers;
}

export function prepareAnthropicUpstreamBody(openaiBody: OpenAIRequest): string {
  return JSON.stringify(convertRequestToAnthropic(openaiBody));
}

// ─── Reverse Direction: Anthropic → OpenAI (for clients that send Anthropic Messages) ──

interface AnthropicToOpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface AnthropicToOpenAIRequest {
  model: string;
  messages: AnthropicToOpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: Array<{ type: "function"; function: { name: string; description?: string; parameters?: any } }>;
  stop?: string | string[];
  system?: string | Array<{ type: "text"; text: string; cache_control?: any }>;
}

/**
 * Convert an Anthropic Messages request body to OpenAI Chat Completions format.
 * - system prompt becomes a system message
 * - tool_use blocks become assistant tool_calls
 * - tool_result blocks become role=tool messages with tool_call_id
 */
export function convertAnthropicToOpenAI(anthropic: AnthropicToOpenAIRequest): OpenAIRequest {
  const outMessages: OpenAIMessage[] = [];

  // Extract system prompt (Anthropic puts it as top-level field, not in messages array)
  if (typeof anthropic.system === "string" && anthropic.system.trim()) {
    outMessages.push({ role: "system", content: anthropic.system });
  } else if (Array.isArray(anthropic.system)) {
    const sysText = anthropic.system.map((b) => b?.text || "").join("\n").trim();
    if (sysText) outMessages.push({ role: "system", content: sysText });
  }

  for (const msg of anthropic.messages || []) {
    if (msg.role === "user") {
      // user.content can be a string or array of content blocks
      if (typeof msg.content === "string") {
        outMessages.push({ role: "user", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const blocks = msg.content as AnthropicContentBlock[];
        const textParts: string[] = [];
        const toolResults: Array<{ tool_call_id: string; content: string }> = [];
        for (const b of blocks) {
          if (b.type === "text" && b.text) textParts.push(b.text);
          else if (b.type === "image" && b.source?.data) {
            textParts.push(`[image:${b.source.media_type}]`);
          }
          else if (b.type === "tool_result" && b.tool_use_id) {
            const resultContent = typeof b.content === "string"
              ? b.content
              : Array.isArray(b.content)
                ? b.content.map((x: any) => x?.text || "").join("\n")
                : "";
            toolResults.push({ tool_call_id: b.tool_use_id, content: resultContent });
          }
        }
        for (const tr of toolResults) {
          outMessages.push({ role: "tool", tool_call_id: tr.tool_call_id, content: tr.content });
        }
        if (textParts.length > 0) {
          outMessages.push({ role: "user", content: textParts.join("\n") });
        }
      }
    } else if (msg.role === "assistant") {
      // assistant.content can be string or array of content blocks (text/tool_use)
      if (typeof msg.content === "string") {
        outMessages.push({ role: "assistant", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const blocks = msg.content as AnthropicContentBlock[];
        const textParts: string[] = [];
        const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
        for (const b of blocks) {
          if (b.type === "text" && b.text) textParts.push(b.text);
          else if (b.type === "thinking" && (b.thinking || b.text)) {
            textParts.push(`[thinking]${b.thinking || b.text}`);
          }
          else if (b.type === "tool_use" && b.id && b.name) {
            toolCalls.push({
              id: b.id,
              type: "function",
              function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
            });
          }
        }
        outMessages.push({
          role: "assistant",
          content: textParts.join("\n") || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
      }
    }
  }

  // Convert tools (Anthropic uses input_schema, OpenAI uses parameters)
  const openaiTools = (anthropic.tools || []).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  return {
    model: anthropic.model,
    messages: outMessages,
    max_tokens: anthropic.max_tokens,
    temperature: anthropic.temperature,
    top_p: anthropic.top_p,
    stream: anthropic.stream,
    tools: openaiTools.length > 0 ? openaiTools : undefined,
    stop: anthropic.stop_sequences,
  };
}

/**
 * Convert an OpenAI Chat Completions response back to Anthropic Messages format
 * (used after upstream returns, so we can serve Anthropic-shaped responses to clients).
 */
export function convertOpenAIToAnthropicResponse(openai: OpenAIResponse): AnthropicResponse {
  const choice = openai.choices?.[0];
  const message = choice?.message || ({} as any);
  const contentBlocks: AnthropicContentBlock[] = [];
  if (typeof message?.content === "string" && message.content.length > 0) {
    contentBlocks.push({ type: "text", text: message.content });
  }
  const reasoningText = (message as any)?.reasoning_content || (message as any)?.reasoning;
  if (
    typeof reasoningText === "string" &&
    reasoningText.length > 0 &&
    reasoningText !== message?.content
  ) {
    contentBlocks.push({ type: "thinking", thinking: reasoningText } as AnthropicContentBlock);
  }
  if (Array.isArray(message?.tool_calls)) {
    for (const tc of message.tool_calls) {
      contentBlocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function?.name || "",
        input: (() => {
          try { return JSON.parse(tc.function?.arguments || "{}"); } catch { return {}; }
        })(),
      });
    }
  }
  return {
    id: (openai.id || `msg_${Date.now()}`).replace(/^chatcmpl-/, "msg_"),
    type: "message",
    role: "assistant",
    model: openai.model,
    content: contentBlocks,
    stop_reason:
      choice?.finish_reason === "tool_calls" ? "tool_use" :
      choice?.finish_reason === "length" ? "max_tokens" :
      choice?.finish_reason === "stop" ? "end_turn" :
      "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: openai.usage?.prompt_tokens || 0,
      output_tokens: openai.usage?.completion_tokens || 0,
    },
  };
}

/**
 * Detect if a request body looks like an Anthropic Messages payload.
 * Heuristic: top-level `system` field (string or array) AND `max_tokens` number AND `messages` array.
 */
export function looksLikeAnthropicMessages(body: any): boolean {
  if (!body || typeof body !== "object") return false;
  if (typeof body.system !== "string" && !Array.isArray(body.system)) return false;
  if (typeof body.max_tokens !== "number") return false;
  if (!Array.isArray(body.messages)) return false;
  return true;
}

/**
 * Detect if a request path matches the Anthropic Messages endpoint.
 * Accepts: /v1/messages, /v1/messages/, /v1/v1/messages (defensive)
 */
export function isAnthropicMessagesPath(path: string): boolean {
  const cleaned = path.replace(/\/+$/, "");
  return /\/v\d+\/messages\/?$/.test(cleaned) || /\/v\d+\/v\d+\/messages\/?$/.test(cleaned);
}

// ─── Anthropic SSE Stream Conversion (OpenAI chunks → Anthropic events) ────────

export interface AnthropicStreamState {
  messageId: string;
  model: string;
  contentBlockIndex: number;
  contentBlockOpen: boolean;
  thinkingBlockOpen: boolean;
  toolBlockOpen: boolean;
  toolIndex: number;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  textAccumulated: string;
  messageStarted: boolean;
  streamTerminated: boolean;
}

export function createAnthropicStreamState(model: string, msgId?: string): AnthropicStreamState {
  return {
    messageId: msgId || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    model,
    contentBlockIndex: 0,
    contentBlockOpen: false,
    thinkingBlockOpen: false,
    toolBlockOpen: false,
    toolIndex: 0,
    stopReason: null,
    inputTokens: 0,
    outputTokens: 0,
    textAccumulated: "",
    messageStarted: false,
    streamTerminated: false,
  };
}

function sseEvent(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Convert a single OpenAI SSE chunk (e.g. `data: {...}`) to one or more Anthropic SSE events.
 * Returns empty string if no conversion should be emitted for this chunk.
 */
export function convertOpenAIChunkToAnthropicEvents(chunk: string, state: AnthropicStreamState): string {
  // Strip "data: " prefix
  const trimmed = chunk.replace(/^data:\s*/, "").trim();
  if (!trimmed || trimmed === "[DONE]") {
    if (trimmed === "[DONE]") {
      if (state.streamTerminated) return "";
      state.streamTerminated = true;
      // Flush: close any open content block, send message_delta + message_stop
      let out = "";
      if (state.contentBlockOpen || state.thinkingBlockOpen) {
        out += sseEvent("content_block_stop", { type: "content_block_stop", index: state.contentBlockIndex });
        state.contentBlockOpen = false;
        state.thinkingBlockOpen = false;
      }
      if (state.toolBlockOpen) {
        out += sseEvent("content_block_stop", { type: "content_block_stop", index: state.contentBlockIndex });
        state.toolBlockOpen = false;
      }
      if (!state.stopReason) state.stopReason = "end_turn";
      out += sseEvent("message_delta", {
        type: "message_delta",
        delta: { stop_reason: state.stopReason, stop_sequence: null },
        usage: { output_tokens: state.outputTokens },
      });
      out += sseEvent("message_stop", { type: "message_stop" });
      return out;
    }
    return "";
  }

  let parsed: any;
  try { parsed = JSON.parse(trimmed); } catch { return ""; }

  let out = "";

  // Capture usage if present (some providers send it in the last chunk)
  if (parsed.usage) {
    state.inputTokens = parsed.usage.prompt_tokens || state.inputTokens;
    state.outputTokens = parsed.usage.completion_tokens || state.outputTokens;
  }

  const choice = parsed.choices?.[0];
  if (!choice) {
    // Could be a usage-only chunk — emit message_delta with usage later
    if (parsed.usage) {
      // The DONE event will emit final message_delta
    }
    return out;
  }

  // First chunk: emit message_start once
  if (!state.messageStarted) {
    state.messageStarted = true;
    out += sseEvent("message_start", {
      type: "message_start",
      message: {
        id: state.messageId,
        type: "message",
        role: "assistant",
        model: state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: state.inputTokens, output_tokens: 0 },
      },
    });
  }

  const delta = choice.delta || {};

  const closeTextBlock = () => {
    if (state.contentBlockOpen) {
      out += sseEvent("content_block_stop", { type: "content_block_stop", index: state.contentBlockIndex });
      state.contentBlockOpen = false;
      state.contentBlockIndex++;
    }
  };

  const closeThinkingBlock = () => {
    if (state.thinkingBlockOpen) {
      out += sseEvent("content_block_stop", { type: "content_block_stop", index: state.contentBlockIndex });
      state.thinkingBlockOpen = false;
      state.contentBlockIndex++;
    }
  };

  // Handle text content
  if (typeof delta.content === "string" && delta.content.length > 0) {
    closeThinkingBlock();
    if (!state.contentBlockOpen) {
      out += sseEvent("content_block_start", {
        type: "content_block_start",
        index: state.contentBlockIndex,
        content_block: { type: "text", text: "" },
      });
      state.contentBlockOpen = true;
    }
    out += sseEvent("content_block_delta", {
      type: "content_block_delta",
      index: state.contentBlockIndex,
      delta: { type: "text_delta", text: delta.content },
    });
    state.textAccumulated += delta.content;
  }

  // Handle reasoning_content as thinking block (extended thinking clients)
  const reasoningText = (delta as any).reasoning_content || (delta as any).reasoning;
  if (typeof reasoningText === "string" && reasoningText.length > 0) {
    closeTextBlock();
    if (!state.thinkingBlockOpen) {
      out += sseEvent("content_block_start", {
        type: "content_block_start",
        index: state.contentBlockIndex,
        content_block: { type: "thinking", thinking: "" },
      });
      state.thinkingBlockOpen = true;
    }
    out += sseEvent("content_block_delta", {
      type: "content_block_delta",
      index: state.contentBlockIndex,
      delta: { type: "thinking_delta", thinking: reasoningText },
    });
    state.textAccumulated += reasoningText;
  }

  // Handle tool calls
  if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
    for (const tc of delta.tool_calls) {
      closeTextBlock();
      closeThinkingBlock();
      // Open tool_use block on first chunk (has id+name); subsequent chunks append arguments via input_json_delta
      const idx = typeof tc.index === "number" ? tc.index : state.toolIndex;
      if (tc.id && tc.function?.name && !state.toolBlockOpen) {
        out += sseEvent("content_block_start", {
          type: "content_block_start",
          index: state.contentBlockIndex,
          content_block: {
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: {},
          },
        });
        state.toolBlockOpen = true;
        state.toolIndex = idx;
      }
      if (tc.function?.arguments) {
        out += sseEvent("content_block_delta", {
          type: "content_block_delta",
          index: state.contentBlockIndex,
          delta: {
            type: "input_json_delta",
            partial_json: tc.function.arguments,
          },
        });
      }
    }
  }

  // Handle finish_reason
  if (choice.finish_reason) {
    if (state.contentBlockOpen || state.toolBlockOpen) {
      out += sseEvent("content_block_stop", { type: "content_block_stop", index: state.contentBlockIndex });
      state.contentBlockOpen = false;
      state.toolBlockOpen = false;
      state.contentBlockIndex++;
    }
    state.stopReason =
      choice.finish_reason === "tool_calls" ? "tool_use" :
      choice.finish_reason === "length" ? "max_tokens" :
      "end_turn";
  }

  return out;
}

/**
 * Flush helper: emit any closing events for an incomplete stream.
 */
export function flushAnthropicStream(state: AnthropicStreamState): string {
  if (state.streamTerminated) return "";
  state.streamTerminated = true;
  let out = "";
  if (state.contentBlockOpen || state.thinkingBlockOpen) {
    out += sseEvent("content_block_stop", { type: "content_block_stop", index: state.contentBlockIndex });
    state.contentBlockOpen = false;
    state.thinkingBlockOpen = false;
  }
  if (state.toolBlockOpen) {
    out += sseEvent("content_block_stop", { type: "content_block_stop", index: state.contentBlockIndex });
    state.toolBlockOpen = false;
  }
  if (!state.stopReason) state.stopReason = "end_turn";
  out += sseEvent("message_delta", {
    type: "message_delta",
    delta: { stop_reason: state.stopReason, stop_sequence: null },
    usage: { output_tokens: state.outputTokens },
  });
  out += sseEvent("message_stop", { type: "message_stop" });
  return out;
}


