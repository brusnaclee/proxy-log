/**
 * You.com Agents API Adapter
 * Converts between OpenAI-compatible Chat Completions format (used by clients)
 * and the you.com Agents API (https://api.you.com/v1/agents/runs).
 *
 * you.com agents take a single `input` string (not messages[]) and return
 * `{ output: [{ type: "message.answer", text }, { type: "web_search.results", content: [...] }] }`.
 *
 * Auth: `Authorization: Bearer <apiKey>` (handled by the proxy, not here).
 *
 * Tool-calling model:
 *   - Client sends `tools: [{type:"function", function:{name:"web_search",...}}]`
 *   - Adapter matches the tool name to a you.com capability:
 *       web_search | search | web              -> "web_search" (express) or "research" (advanced)
 *       research | deep_research               -> "research"   (advanced only)
 *       compute | code | python | interpreter  -> "compute"    (advanced only)
 *   - On the response, we synthesize a real `assistant.tool_calls` block so
 *     orchestrators (OpenAI Agents SDK, LangChain, Vercel AI SDK) treat the
 *     agent like any other function-calling model.
 *   - The synthesized `tool_call_id` is the cache key. When the client echoes
 *     the result back as a `role:"tool"` message, we short-circuit and return
 *     the cached answer without hitting you.com again.
 *
 *   - `verbosity` and `search_effort` can be passed via `extra_body.youcom`
 *     (or `metadata.youcom` as a fallback) for fine-grained control.
 */

import { getToolAnswer, putToolAnswer, type CachedToolAnswer } from "./youcom-tool-cache.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | Array<{ type: string; text?: string }>;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface OpenAITool {
  type: "function";
  function?: {
    name?: string;
    description?: string;
    parameters?: unknown;
  };
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: unknown;
  extra_body?: { youcom?: YouComExtraBody } & Record<string, unknown>;
  metadata?: { youcom?: YouComExtraBody } & Record<string, unknown>;
}

interface YouComExtraBody {
  verbosity?: "low" | "medium" | "high";
  search_effort?: "low" | "medium" | "high" | "auto";
  report_verbosity?: "medium" | "high";
}

export type YouComTool =
  | { type: "web_search" }
  | {
      type: "research";
      search_effort?: "low" | "medium" | "high" | "auto";
      report_verbosity?: "medium" | "high";
    }
  | { type: "compute" };

export interface YouComRequest {
  agent: string;
  input: string;
  stream: false;
  tools?: YouComTool[];
  verbosity?: "low" | "medium" | "high";
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
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ConvertRequestResult {
  request: YouComRequest | null;
  cachedAnswer: CachedToolAnswer | null;
  cacheMiss?: boolean;
  cacheMissToolCallId?: string;
  matchedToolName: string | null;
  lastUserText: string;
}

export interface ConvertResponseResult {
  openaiResponse: OpenAIResponse;
  toolCallId: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Built-in you.com agent ids that map directly to the `agent` field. */
const BUILTIN_AGENTS = new Set(["express", "advanced"]);

const TOOL_NAME_PATTERNS: Array<{ re: RegExp; type: YouComTool["type"] }> = [
  { re: /^(web_?search|search|web)$/i, type: "web_search" },
  { re: /^(research|deep_?research)$/i, type: "research" },
  { re: /^(compute|code|python|code_?interpreter|repl)$/i, type: "compute" },
];

function messageContentToString(content: OpenAIMessage["content"]): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
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

function randSuffix(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ─── Tool name → you.com capability ──────────────────────────────────────────

/**
 * Inspects the client-provided `tools[]` array and returns the matched you.com
 * tool descriptors, plus the human-readable name that was matched (used to
 * label the synthesized tool_call back to the orchestrator).
 *
 * Rules:
 *  - express  : only `web_search` is allowed. `research` and `compute` are
 *               dropped with a warning (fall back to no grounding).
 *  - advanced : `research` and `compute` are allowed. A client `web_search`
 *               request is mapped to `research` (advanced has no native
 *               web_search tool; research subsumes it).
 *
 * Search effort / report verbosity are pulled from `extra_body.youcom` first
 * and `metadata.youcom` as a fallback.
 */
export function resolveYouComTools(
  openaiTools: OpenAITool[] | undefined,
  agent: string,
  extra?: YouComExtraBody,
): { tools: YouComTool[]; matchedName: string | null } {
  if (!Array.isArray(openaiTools) || openaiTools.length === 0) {
    return { tools: [], matchedName: null };
  }

  const matchedTypes = new Set<YouComTool["type"]>();
  let matchedName: string | null = null;
  let firstName: string | null = null;

  for (const t of openaiTools) {
    const name = t?.function?.name;
    if (!name) continue;
    if (firstName == null) firstName = name;
    for (const p of TOOL_NAME_PATTERNS) {
      if (p.re.test(name)) {
        matchedTypes.add(p.type);
        if (matchedName == null) matchedName = name;
        break;
      }
    }
  }

  if (matchedTypes.size === 0) {
    return { tools: [], matchedName: null };
  }

  // Agent capability filter
  const out: YouComTool[] = [];
  if (agent === "express") {
    if (matchedTypes.has("web_search")) {
      out.push({ type: "web_search" });
    }
    if (matchedTypes.has("research") || matchedTypes.has("compute")) {
      console.warn(
        `[youcom-adapter] express agent does not support research/compute; falling back to web_search.`,
      );
      if (!out.some((t) => t.type === "web_search")) {
        out.push({ type: "web_search" });
      }
    }
  } else {
    if (matchedTypes.has("research")) {
      const t: { type: "research"; search_effort?: "low" | "medium" | "high" | "auto"; report_verbosity?: "medium" | "high" } = {
        type: "research",
      };
      if (extra?.search_effort) t.search_effort = extra.search_effort;
      if (extra?.report_verbosity) t.report_verbosity = extra.report_verbosity;
      out.push(t);
    } else if (matchedTypes.has("web_search")) {
      // advanced has no native web_search; map to research (which uses it internally)
      const t: { type: "research"; search_effort?: "low" | "medium" | "high" | "auto"; report_verbosity?: "medium" | "high" } = {
        type: "research",
      };
      if (extra?.search_effort) t.search_effort = extra.search_effort;
      if (extra?.report_verbosity) t.report_verbosity = extra.report_verbosity;
      out.push(t);
    }
    if (matchedTypes.has("compute")) {
      out.push({ type: "compute" });
    }
  }

  return { tools: out, matchedName: matchedName || firstName };
}

// ─── Request Conversion (OpenAI -> You.com) ──────────────────────────────────

/**
 * Flattens an OpenAI chat request into a single you.com agents request, OR
 * detects a tool-round-trip short-circuit.
 *
 *   - If the last message is `role:"tool"` and its `tool_call_id` is in the
 *     cache, returns `{ request: null, cachedAnswer: <hit>, ... }`. The caller
 *     should skip the upstream call and return the cached answer.
 *   - Otherwise builds the upstream request:
 *       - System messages become a leading "Instructions:" block.
 *       - Remaining turns are flattened as "Role: content" lines.
 *       - `upstreamModel` selects the agent: "express"/"advanced" are built-ins;
 *         any other value is treated as a custom agent id.
 *       - Client `tools[]` are mapped to you.com capabilities via
 *         `resolveYouComTools`.
 *       - `extra_body.youcom.verbosity` is forwarded for advanced.
 */
export function convertRequestToYouCom(
  openai: OpenAIRequest,
  upstreamModel: string,
): ConvertRequestResult {
  const messages: OpenAIMessage[] = openai.messages || [];

  // Tool-round-trip short-circuit
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "tool" && m.tool_call_id) {
      const hit = getToolAnswer(m.tool_call_id);
      if (hit) {
        return {
          request: null,
          cachedAnswer: hit,
          matchedToolName: null,
          lastUserText: "",
        };
      }
      return {
        request: null,
        cachedAnswer: null,
        cacheMiss: true,
        cacheMissToolCallId: m.tool_call_id,
        matchedToolName: null,
        lastUserText: "",
      };
    }
    // Stop scanning backwards once we hit a non-tool message
    if (m.role !== "tool") break;
  }

  const extra: YouComExtraBody | undefined =
    (openai.extra_body && openai.extra_body.youcom) ||
    (openai.metadata && openai.metadata.youcom) ||
    undefined;

  const systemParts: string[] = [];
  const turnParts: string[] = [];
  let lastUserText = "";

  for (const msg of messages) {
    const text = messageContentToString(msg.content);
    if (msg.role === "system") {
      if (text) systemParts.push(text);
    } else if (msg.role === "user") {
      if (text) {
        turnParts.push(`User: ${text}`);
        lastUserText = text;
      }
    } else if (msg.role === "assistant") {
      if (text) turnParts.push(`Assistant: ${text}`);
    } else if (msg.role === "tool") {
      if (text) turnParts.push(`Tool result: ${text}`);
    }
  }

  const inputSegments: string[] = [];
  if (systemParts.length > 0) {
    inputSegments.push(`Instructions:\n${systemParts.join("\n\n")}`);
  }
  if (turnParts.length > 0) {
    inputSegments.push(turnParts.join("\n"));
  }

  let input: string;
  if (systemParts.length === 0 && turnParts.length === 1) {
    input = messageContentToString(
      messages.find((m) => m.role === "user")?.content ?? "",
    );
  } else {
    input = inputSegments.join("\n\n");
  }

  const agent = BUILTIN_AGENTS.has(upstreamModel)
    ? upstreamModel
    : upstreamModel;

  const request: YouComRequest = {
    agent,
    input: input || "",
    stream: false,
  };

  // Tool mapping
  const { tools, matchedName } = resolveYouComTools(openai.tools, upstreamModel, extra);
  if (tools.length > 0) {
    request.tools = tools;
  }

  // Verbosity (advanced only)
  if (upstreamModel === "advanced" && extra?.verbosity) {
    request.verbosity = extra.verbosity;
  }

  return {
    request,
    cachedAnswer: null,
    matchedToolName: matchedName,
    lastUserText,
  };
}

// ─── Response Conversion (You.com -> OpenAI) ─────────────────────────────────

/**
 * Converts a you.com agents response into an OpenAI chat.completion object.
 *
 * If `clientSentTools` is true, the response is shaped as a real tool_call:
 *   - `content` is null
 *   - `tool_calls[0]` carries the matched tool name and the answer+sources
 *     tucked into the JSON `arguments` (`_answer`, `_sources`, `query`)
 *   - `finish_reason` is `tool_calls`
 *   - The `tool_call_id` is also stored in the round-trip cache so the next
 *     turn can be served without an upstream call.
 *
 * If `clientSentTools` is false, falls back to the plain-text shape with
 * citations appended as a "Sources" footnote.
 */
export function convertResponseToYouComOpenAI(
  you: YouComResponse,
  model: string,
  opts: {
    promptText?: string;
    clientSentTools?: boolean;
    matchedToolName?: string | null;
    lastUserText?: string;
  } = {},
): ConvertResponseResult {
  let answer = "";
  const sources: Array<{ title: string; url: string }> = [];

  for (const item of you.output || []) {
    if (item.type === "message.answer" && item.text) {
      answer += item.text;
    } else if (
      item.type === "web_search.results" &&
      Array.isArray(item.content)
    ) {
      for (const result of item.content) {
        const url = result.url || result.citation_uri;
        if (url) {
          sources.push({ title: result.title || url, url });
        }
      }
    }
  }

  const promptText = opts.promptText || "";
  const completionTokens = estimateTokens(answer);
  const promptTokens = estimateTokens(promptText);
  const id = `chatcmpl-you-${Date.now()}-${randSuffix().slice(0, 6)}`;

  if (opts.clientSentTools) {
    const toolCallId = `call_${randSuffix()}`;
    const toolName = opts.matchedToolName || "web_search";
    const args = {
      query: opts.lastUserText || "",
      _answer: answer,
      _sources: sources,
    };

    // Store the round-trip answer so the next `role:"tool"` turn can echo it
    // back without hitting you.com again.
    putToolAnswer(toolCallId, answer, sources);

    return {
      toolCallId,
      openaiResponse: {
        id,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: toolCallId,
                  type: "function",
                  function: {
                    name: toolName,
                    arguments: JSON.stringify(args),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      },
    };
  }

  // Plain-text fallback
  let content = answer;
  if (sources.length > 0) {
    const seen = new Set<string>();
    const unique = sources.filter((s) => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });
    const md = unique
      .map((s) => `- [${s.title}](${s.url})`)
      .join("\n");
    content += `\n\n---\n\n**Sources:**\n${md}`;
  }

  return {
    toolCallId: null,
    openaiResponse: {
      id,
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
    },
  };
}

/**
 * Builds a single-shot (non-streaming) OpenAI chat.completion from a cached
 * round-trip answer. Used when the client echoed the synthesized tool result
 * back as a `role:"tool"` message and the cache hit.
 */
export function buildCachedRoundTripResponse(
  model: string,
  cached: CachedToolAnswer,
): OpenAIResponse {
  let content = cached.answer;
  if (cached.sources.length > 0) {
    const seen = new Set<string>();
    const unique = cached.sources.filter((s) => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });
    const md = unique
      .map((s) => `- [${s.title}](${s.url})`)
      .join("\n");
    content += `\n\n---\n\n**Sources:**\n${md}`;
  }

  return {
    id: `chatcmpl-you-${Date.now()}-${randSuffix().slice(0, 6)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: estimateTokens(content),
      total_tokens: estimateTokens(content),
    },
  };
}

/**
 * Builds the single OpenAI SSE chunk sequence for a fake-streamed response.
 * you.com agents are called non-streaming, so when a client requests
 * `stream: true` we emit the whole answer as a sequence of chunks.
 *
 * Supports two shapes:
 *  - Plain text: role chunk + content chunk + final chunk + [DONE]
 *  - Tool call:  role chunk + tool_calls chunk + final chunk + [DONE]
 */
export function buildYouComStreamChunks(
  openaiResponse: OpenAIResponse,
): string[] {
  const { id, model } = openaiResponse;
  const created = Math.floor(Date.now() / 1000);
  const choice = openaiResponse.choices[0];
  const toolCall = choice?.message?.tool_calls?.[0];

  if (toolCall) {
    const roleChunk = {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: null },
          finish_reason: null,
        },
      ],
    };

    const toolCallChunk = {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: toolCall.id,
                type: "function",
                function: {
                  name: toolCall.function.name,
                  arguments: toolCall.function.arguments,
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };

    const finalChunk = {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: openaiResponse.usage,
    };

    return [
      `data: ${JSON.stringify(roleChunk)}`,
      `data: ${JSON.stringify(toolCallChunk)}`,
      `data: ${JSON.stringify(finalChunk)}`,
      "data: [DONE]",
    ];
  }

  const content = choice?.message?.content || "";
  const reasoning =
    (choice?.message as any)?.reasoning_content ||
    (choice?.message as any)?.reasoning ||
    "";

  const roleChunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "" },
        finish_reason: null,
      },
    ],
  };

  // Reasoning models (glm, minimax, …) may answer with reasoning_content only;
  // forward it so streaming clients don't receive an empty completion.
  const reasoningChunk = reasoning
    ? {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          { index: 0, delta: { reasoning_content: reasoning }, finish_reason: null },
        ],
      }
    : null;

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
    ...(reasoningChunk ? [`data: ${JSON.stringify(reasoningChunk)}`] : []),
    `data: ${JSON.stringify(contentChunk)}`,
    `data: ${JSON.stringify(finalChunk)}`,
    "data: [DONE]",
  ];
}
