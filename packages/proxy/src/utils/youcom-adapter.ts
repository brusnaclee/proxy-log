/**
 * You.com Agents API Adapter
 * Converts between OpenAI-compatible Chat Completions format (used by clients)
 * and the you.com Agents API (https://api.you.com/v1/agents/runs).
 *
 * you.com agents take a single `input` string (not messages[]) and return
 * `{ output: [{ type: "message.answer", text }, { type: "web_search.results", content: [...] }] }`.
 *
 * Auth: `Authorization: Bearer <apiKey>` (handled by the proxy, not here).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | Array<{ type: string; text?: string }>;
  tool_call_id?: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  tools?: Array<{ type: string; function?: { name: string } }>;
}

export interface YouComRequest {
  agent: string;
  input: string;
  stream: false;
  tools?: Array<{ type: "web_search" | "research" }>;
}

interface YouComWebResult {
  source_type?: string;
  citation_uri?: string;
  title?: string;
  snippet?: string;
  url?: string;
}

interface YouComOutputItem {
  type: "message.answer" | "web_search.results" | string;
  text?: string;
  content?: YouComWebResult[];
}

interface YouComResponse {
  agent?: string;
  mode?: string;
  output?: YouComOutputItem[];
}

interface OpenAIResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string | null };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Built-in you.com agent ids that map directly to the `agent` field. */
const BUILTIN_AGENTS = new Set(["express", "advanced"]);

function messageContentToString(
  content: OpenAIMessage["content"],
): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  // Array content (multimodal) -> concatenate text parts
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string" ? part : part?.text ? part.text : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Rough token estimate (~4 chars per token) used for usage reporting. */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

// ─── Request Conversion (OpenAI -> You.com) ──────────────────────────────────

/**
 * Flattens an OpenAI chat request into a single you.com agents request.
 * - System messages become a leading "Instructions:" block.
 * - Remaining turns are flattened as "Role: content" lines.
 * - `upstreamModel` selects the agent: "express"/"advanced" are built-ins;
 *   any other value is treated as a custom agent id (configured at you.com/agents).
 * - If the client sent `tools`, web grounding is enabled
 *   (express -> web_search, advanced -> research).
 */
export function convertRequestToYouCom(
  openai: OpenAIRequest,
  upstreamModel: string,
): YouComRequest {
  const messages: OpenAIMessage[] = openai.messages || [];

  const systemParts: string[] = [];
  const turnParts: string[] = [];

  for (const msg of messages) {
    const text = messageContentToString(msg.content);
    if (!text && msg.role !== "assistant") continue;

    if (msg.role === "system") {
      systemParts.push(text);
    } else if (msg.role === "user") {
      turnParts.push(`User: ${text}`);
    } else if (msg.role === "assistant") {
      if (text) turnParts.push(`Assistant: ${text}`);
    } else if (msg.role === "tool") {
      turnParts.push(`Tool result: ${text}`);
    }
  }

  const inputSegments: string[] = [];
  if (systemParts.length > 0) {
    inputSegments.push(`Instructions:\n${systemParts.join("\n\n")}`);
  }
  if (turnParts.length > 0) {
    inputSegments.push(turnParts.join("\n"));
  }

  // If only a single user message exists, send it bare (cleaner for the agent).
  let input: string;
  if (systemParts.length === 0 && turnParts.length === 1) {
    input = messageContentToString(
      messages.find((m) => m.role === "user")?.content ?? "",
    );
  } else {
    input = inputSegments.join("\n\n");
  }

  const agent = BUILTIN_AGENTS.has(upstreamModel) ? upstreamModel : upstreamModel;

  const request: YouComRequest = {
    agent,
    input: input || "",
    stream: false,
  };

  // Map client-provided tools to you.com web grounding.
  if (openai.tools && openai.tools.length > 0) {
    if (upstreamModel === "advanced") {
      request.tools = [{ type: "research" }];
    } else {
      request.tools = [{ type: "web_search" }];
    }
  }

  return request;
}

// ─── Response Conversion (You.com -> OpenAI) ─────────────────────────────────

/**
 * Converts a you.com agents response into an OpenAI chat.completion object.
 * Pulls the `message.answer` text and appends any web_search citations as a
 * "Sources" footnote list.
 */
export function convertResponseToYouComOpenAI(
  you: YouComResponse,
  model: string,
  promptText = "",
): OpenAIResponse {
  let answer = "";
  const citations: string[] = [];

  for (const item of you.output || []) {
    if (item.type === "message.answer" && item.text) {
      answer += item.text;
    } else if (item.type === "web_search.results" && Array.isArray(item.content)) {
      for (const result of item.content) {
        const url = result.url || result.citation_uri;
        if (url) {
          const title = result.title || url;
          citations.push(`- [${title}](${url})`);
        }
      }
    }
  }

  let content = answer;
  if (citations.length > 0) {
    // Deduplicate citations while preserving order.
    const seen = new Set<string>();
    const unique = citations.filter((c) => {
      if (seen.has(c)) return false;
      seen.add(c);
      return true;
    });
    content += `\n\n---\n\n**Sources:**\n${unique.join("\n")}`;
  }

  const completionTokens = estimateTokens(content);
  const promptTokens = estimateTokens(promptText);

  return {
    id: `chatcmpl-you-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || "",
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

/**
 * Builds the single OpenAI SSE chunk sequence for a fake-streamed response.
 * you.com agents are called non-streaming, so when a client requests
 * `stream: true` we emit the whole answer as one chunk followed by [DONE].
 */
export function buildYouComStreamChunks(
  openaiResponse: OpenAIResponse,
): string[] {
  const { id, model } = openaiResponse;
  const created = Math.floor(Date.now() / 1000);
  const content = openaiResponse.choices[0]?.message?.content || "";

  const roleChunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      { index: 0, delta: { role: "assistant", content: "" }, finish_reason: null },
    ],
  };

  const contentChunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };

  const finalChunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: openaiResponse.usage,
  };

  return [
    `data: ${JSON.stringify(roleChunk)}`,
    `data: ${JSON.stringify(contentChunk)}`,
    `data: ${JSON.stringify(finalChunk)}`,
    "data: [DONE]",
  ];
}
