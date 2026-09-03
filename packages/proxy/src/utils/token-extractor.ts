/**
 * Token extraction utility.
 *
 * Pulls completion text from a wide variety of upstream response formats
 * so completion_tokens estimation works even when content lives in
 * tool_calls, output_text, content_block_delta, etc.
 *
 * Used by the streaming and non-streaming code paths in proxy.ts.
 */

import { estimateTokens } from "./detect-ide.js";

const safeJsonStringify = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const collectFromContentBlocks = (blocks: any[]): string => {
  const parts: string[] = [];
  for (const block of blocks) {
    if (!block) continue;
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    const type = String(block.type || "").toLowerCase();
    if (type === "text" || type === "output_text") {
      if (typeof block.text === "string") parts.push(block.text);
      if (typeof block.content === "string") parts.push(block.content);
    } else if (type === "tool_use" || type === "function_call") {
      const name = block.name || block.tool_name || "";
      const input = block.input ?? block.arguments ?? block.params;
      parts.push("[tool_use:" + name + " " + safeJsonStringify(input) + "]");
    } else if (type === "tool_result") {
      const content = block.content;
      if (typeof content === "string") parts.push(content);
      else parts.push(safeJsonStringify(content));
    } else if (type === "thinking" || type === "reasoning") {
      if (typeof block.thinking === "string") parts.push(block.thinking);
      else if (typeof block.text === "string") parts.push(block.text);
      else if (typeof block.content === "string") parts.push(block.content);
    } else if (type === "message" && block.content) {
      if (Array.isArray(block.content)) parts.push(collectFromContentBlocks(block.content));
      else if (typeof block.content === "string") parts.push(block.content);
    }
  }
  return parts.join("");
};

export interface UpstreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
}

export interface CompletionAccumulator {
  text: string;
  toolArgs: Map<string, string>;
  /** Parallel to toolArgs — first non-empty function.name seen per call index/id. */
  toolNames: Map<string, string>;
  hadUsage: boolean;
  usage: UpstreamUsage;
}

export function makeAccumulator(): CompletionAccumulator {
  return {
    text: "",
    toolArgs: new Map(),
    toolNames: new Map(),
    hadUsage: false,
    usage: {},
  };
}

function appendToolArg(acc: CompletionAccumulator, idx: any, fragment: string) {
  if (!fragment) return;
  const key = idx == null ? "default" : String(idx);
  acc.toolArgs.set(key, (acc.toolArgs.get(key) || "") + fragment);
}

function noteToolName(acc: CompletionAccumulator, idx: any, name: unknown) {
  if (typeof name !== "string") return;
  const n = name.trim();
  if (!n) return;
  const key = idx == null ? "default" : String(idx);
  if (!acc.toolNames.has(key)) acc.toolNames.set(key, n);
}

function captureUsage(acc: CompletionAccumulator, usage: any) {
  if (!usage || typeof usage !== "object") return;

  // Anthropic-native fields on the raw event (passthrough path)
  let normalized = usage;
  if (
    usage.input_tokens != null ||
    usage.cache_read_input_tokens != null ||
    usage.cache_creation_input_tokens != null
  ) {
    const input = Number(usage.input_tokens) || 0;
    const cached = Number(usage.cache_read_input_tokens) || 0;
    const created = Number(usage.cache_creation_input_tokens) || 0;
    const output =
      typeof usage.output_tokens === "number"
        ? usage.output_tokens
        : typeof usage.completion_tokens === "number"
          ? usage.completion_tokens
          : undefined;
    normalized = {
      ...(typeof output === "number" ? { completion_tokens: output } : {}),
      prompt_tokens: input + cached + created,
      ...(cached > 0 ? { prompt_tokens_details: { cached_tokens: cached } } : {}),
      ...(typeof output === "number"
        ? { total_tokens: input + cached + created + output }
        : {}),
    };
  }

  const next: UpstreamUsage = { ...acc.usage };

  if (typeof normalized.prompt_tokens === "number") {
    next.prompt_tokens = normalized.prompt_tokens;
  }
  if (typeof normalized.completion_tokens === "number") {
    next.completion_tokens = normalized.completion_tokens;
  } else if (typeof normalized.output_tokens === "number") {
    next.completion_tokens = normalized.output_tokens;
  }
  if (typeof normalized.total_tokens === "number") {
    next.total_tokens = normalized.total_tokens;
  }

  if (normalized.prompt_tokens_details?.cached_tokens != null) {
    next.cached_tokens = Number(normalized.prompt_tokens_details.cached_tokens) || 0;
  } else if (typeof normalized.cached_tokens === "number") {
    next.cached_tokens = normalized.cached_tokens;
  } else if (typeof normalized.cache_read_input_tokens === "number") {
    next.cached_tokens = normalized.cache_read_input_tokens;
  } else if (typeof normalized.cache_read_tokens === "number") {
    // Amanai /v1/usage recent uses cache_read_tokens; some gateways echo it on usage
    next.cached_tokens = normalized.cache_read_tokens;
  }
  // Keep prior cache if this chunk omitted it (e.g. output-only message_delta)
  if (next.cached_tokens == null && acc.usage.cached_tokens != null) {
    next.cached_tokens = acc.usage.cached_tokens;
  }

  if (normalized.completion_tokens_details?.reasoning_tokens != null) {
    next.reasoning_tokens = normalized.completion_tokens_details.reasoning_tokens;
  }

  if (
    next.prompt_tokens != null ||
    next.completion_tokens != null ||
    next.total_tokens != null ||
    next.cached_tokens != null
  ) {
    if (
      next.total_tokens == null &&
      next.prompt_tokens != null &&
      next.completion_tokens != null
    ) {
      next.total_tokens = next.prompt_tokens + next.completion_tokens;
    }
    acc.usage = next;
    acc.hadUsage = true;
  }
}

export function consumeStreamPayload(acc: CompletionAccumulator, data: any): void {
  if (!data || typeof data !== "object") return;

  if (data.usage) captureUsage(acc, data.usage);
  // Anthropic message_start nests usage under message.usage
  if (data.message?.usage) captureUsage(acc, data.message.usage);
  if (data.type === "message_start" && data.message?.usage) {
    captureUsage(acc, data.message.usage);
  }
  if (data.type === "message_delta" && data.usage) {
    captureUsage(acc, data.usage);
  }

  const choices = Array.isArray(data.choices) ? data.choices : [];
  for (const choice of choices) {
    const delta = choice?.delta;
    const message = choice?.message;
    if (delta) {
      if (typeof delta.content === "string") acc.text += delta.content;
      if (Array.isArray(delta.content)) acc.text += collectFromContentBlocks(delta.content);
      if (typeof delta.reasoning === "string") acc.text += delta.reasoning;
      if (typeof delta.reasoning_content === "string") acc.text += delta.reasoning_content;
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          // Flat (name/arguments at root) or nested (function.*) — gcli/grok may send either.
          noteToolName(acc, tc.index ?? tc.id, tc?.function?.name ?? tc?.name);
          const fragment = tc?.function?.arguments ?? tc?.arguments;
          if (typeof fragment === "string") appendToolArg(acc, tc.index ?? tc.id, fragment);
          else if (fragment != null) appendToolArg(acc, tc.index ?? tc.id, safeJsonStringify(fragment));
        }
      }
    }
    if (message) {
      if (typeof message.content === "string") acc.text += message.content;
      if (Array.isArray(message.content)) acc.text += collectFromContentBlocks(message.content);
      if (typeof message.reasoning === "string") acc.text += message.reasoning;
      if (typeof message.reasoning_content === "string") acc.text += message.reasoning_content;
      if (Array.isArray(message.tool_calls)) {
        for (const tc of message.tool_calls) {
          noteToolName(acc, tc.id ?? tc.index, tc?.function?.name ?? tc?.name);
          const args = tc?.function?.arguments ?? tc?.arguments;
          if (typeof args === "string") appendToolArg(acc, tc.id ?? tc.index, args);
          else if (args != null) appendToolArg(acc, tc.id ?? tc.index, safeJsonStringify(args));
        }
      }
    }
    if (typeof choice?.text === "string") acc.text += choice.text;
  }

  if (typeof data.output_text === "string") acc.text += data.output_text;
  if (typeof data?.delta?.text === "string") acc.text += data.delta.text;
  if (data?.type === "content_block_delta" && data?.delta?.text) acc.text += data.delta.text;
  if (data?.type === "content_block_delta" && data?.delta?.thinking) acc.text += data.delta.thinking;
  if (data?.type === "content_block_delta" && data?.delta?.partial_json) {
    appendToolArg(acc, data.index, data.delta.partial_json);
  }
  if (Array.isArray(data.output)) {
    acc.text += collectFromContentBlocks(data.output);
  }
  if (Array.isArray(data.content)) {
    acc.text += collectFromContentBlocks(data.content);
  }
}

export function consumeNonStreamingPayload(acc: CompletionAccumulator, parsed: any): void {
  if (!parsed || typeof parsed !== "object") return;
  consumeStreamPayload(acc, parsed);
}

export function finalizeCompletion(acc: CompletionAccumulator): {
  completionText: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  hasUpstreamUsage: boolean;
} {
  let completionText = acc.text;
  if (acc.toolArgs.size > 0 || acc.toolNames.size > 0) {
    const tail: string[] = [];
    const keys = new Set([...acc.toolArgs.keys(), ...acc.toolNames.keys()]);
    for (const key of keys) {
      const name = acc.toolNames.get(key);
      const value = acc.toolArgs.get(key) || "";
      tail.push(
        name
          ? "[tool_call:" + key + " " + name + " " + value + "]"
          : "[tool_call:" + key + " " + value + "]",
      );
    }
    completionText = (completionText ? completionText + "\n" : "") + tail.join("\n");
  }
  const promptTokens = acc.usage.prompt_tokens;
  const upstreamCompletion = acc.usage.completion_tokens;
  const totalTokens = acc.usage.total_tokens;
  const cachedTokens = acc.usage.cached_tokens;
  const reasoningTokens = acc.usage.reasoning_tokens;
  const completionTokens = (upstreamCompletion != null && upstreamCompletion > 0)
    ? upstreamCompletion
    : completionText
      ? estimateTokens(completionText)
      : undefined;
  return {
    completionText,
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens,
    reasoningTokens,
    hasUpstreamUsage: acc.hadUsage,
  };
}

/**
 * Resolves billable prompt tokens and completion tokens.
 * 
 * Key insight: upstream prompt_tokens includes full context (cached + new).
 * For billing, we want only NEW computation tokens = prompt_tokens - cached_tokens.
 * 
 * Priority for prompt tokens (new computation only):
 * 1. Upstream prompt_tokens - cached_tokens (if provided)
 * 2. Delta mechanism (if contextDelta > 0)
 * 3. Text estimation using the last user turn
 */
export function resolveBillableTokens(
  finalized: { promptTokens?: number, completionTokens?: number, cachedTokens?: number },
  contextDeltaTokens: number,
  fullLastUserTurnText: string
): { promptTokens: number, completionTokens: number, cachedTokens: number, totalTokens: number } {
  const rawPrompt = typeof finalized.promptTokens === "number" ? finalized.promptTokens : 0;
  const cached = finalized.cachedTokens || 0;
  
  let pToks = 0;
  if (rawPrompt > 0) {
    // Billable input = total prompt minus cached (new computation only)
    pToks = Math.max(rawPrompt - cached, 0);
  } else if (contextDeltaTokens > 0) {
    pToks = contextDeltaTokens;
  } else {
    pToks = estimateTokens(fullLastUserTurnText);
  }

  const cToks = finalized.completionTokens || 0;

  // Safety net: if we got completion tokens (upstream responded) but prompt tokens
  // resolved to 0 (e.g. new session with no contextDelta, upstream didn't report usage),
  // re-estimate from the user turn text or use a floor of 1.
  // Without this, hasActualContent() returns false and the request is invisible to all
  // stats queries, charts, and leaderboards.
  if (pToks === 0 && cToks > 0) {
    if (fullLastUserTurnText) {
      pToks = Math.max(estimateTokens(fullLastUserTurnText), 1);
    } else {
      pToks = 1;
    }
  }

  return {
    promptTokens: pToks,
    completionTokens: cToks,
    cachedTokens: cached,
    /** Full row total for display: billable input + cache + completion */
    totalTokens: pToks + cached + cToks,
  };
}
