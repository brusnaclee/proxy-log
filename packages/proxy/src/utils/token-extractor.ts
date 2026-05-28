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
      if (typeof block.text === "string") parts.push(block.text);
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
}

export interface CompletionAccumulator {
  text: string;
  toolArgs: Map<string, string>;
  hadUsage: boolean;
  usage: UpstreamUsage;
}

export function makeAccumulator(): CompletionAccumulator {
  return { text: "", toolArgs: new Map(), hadUsage: false, usage: {} };
}

function appendToolArg(acc: CompletionAccumulator, idx: any, fragment: string) {
  if (!fragment) return;
  const key = idx == null ? "default" : String(idx);
  acc.toolArgs.set(key, (acc.toolArgs.get(key) || "") + fragment);
}

function captureUsage(acc: CompletionAccumulator, usage: any) {
  if (!usage || typeof usage !== "object") return;
  const next: UpstreamUsage = {
    prompt_tokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : acc.usage.prompt_tokens,
    completion_tokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : acc.usage.completion_tokens,
    total_tokens: typeof usage.total_tokens === "number" ? usage.total_tokens : acc.usage.total_tokens,
  };
  if (next.prompt_tokens != null || next.completion_tokens != null || next.total_tokens != null) {
    acc.usage = next;
    acc.hadUsage = true;
  }
}

export function consumeStreamPayload(acc: CompletionAccumulator, data: any): void {
  if (!data || typeof data !== "object") return;

  if (data.usage) captureUsage(acc, data.usage);

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
          const fragment = tc?.function?.arguments;
          if (typeof fragment === "string") appendToolArg(acc, tc.index ?? tc.id, fragment);
        }
      }
    }
    if (message) {
      if (typeof message.content === "string") acc.text += message.content;
      if (Array.isArray(message.content)) acc.text += collectFromContentBlocks(message.content);
      if (Array.isArray(message.tool_calls)) {
        for (const tc of message.tool_calls) {
          const args = tc?.function?.arguments;
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
  hasUpstreamUsage: boolean;
} {
  let completionText = acc.text;
  if (acc.toolArgs.size > 0) {
    const tail: string[] = [];
    for (const [key, value] of acc.toolArgs) {
      tail.push("[tool_call:" + key + " " + value + "]");
    }
    completionText = (completionText ? completionText + "\n" : "") + tail.join("\n");
  }
  const promptTokens = acc.usage.prompt_tokens;
  const upstreamCompletion = acc.usage.completion_tokens;
  const totalTokens = acc.usage.total_tokens;
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
    hasUpstreamUsage: acc.hadUsage,
  };
}

/**
 * Resolves billable prompt tokens and completion tokens.
 * Priority for prompt tokens:
 * 1. Upstream usage (if provided and valid)
 * 2. Delta mechanism (if contextDelta > 0 is passed)
 * 3. Text estimation using the full recent turn
 */
export function resolveBillableTokens(
  finalized: { promptTokens?: number, completionTokens?: number },
  contextDeltaTokens: number,
  fullLastUserTurnText: string
): { promptTokens: number, completionTokens: number, totalTokens: number } {
  let pToks = 0;
  if (typeof finalized.promptTokens === "number" && finalized.promptTokens > 0) {
    pToks = finalized.promptTokens;
  } else if (contextDeltaTokens > 0) {
    pToks = contextDeltaTokens;
  } else {
    pToks = estimateTokens(fullLastUserTurnText);
  }

  const cToks = finalized.completionTokens || 0;
  return {
    promptTokens: pToks,
    completionTokens: cToks,
    totalTokens: pToks + cToks
  };
}
