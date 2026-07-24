/**
 * IDE Smart Anti-Waste orchestration.
 * Feature flag: ANTI_WASTE_ENABLED (default on) or header X-Anti-Waste: off
 */

import { resolveAntiWasteProfile } from "./ide-profiles.js";
import {
  extractLatestToolSignature,
  isNoisyToolSignature,
  type ToolSignature,
} from "./tool-signature.js";
import {
  markAntiWasteNudged,
  recordToolSignature,
  resetAntiWasteTracker,
} from "./anti-waste-tracker.js";
import {
  injectAntiWasteNudge,
  stubLatestDuplicateToolDump,
} from "./token-saver/tool-dedupe.js";

/** Agent tools safe to invoke synthetically so IDEs don't reject plain assistant text. */
export const SAFE_AGENT_SHORTCIRCUIT_TOOLS = [
  "ask_followup_question",
  "attempt_completion",
  "ask_question",
] as const;

export type ShortCircuitAgentTool = {
  name: string;
  arguments: Record<string, unknown>;
};

export type AntiWasteApplyResult = {
  enabled: boolean;
  signature: ToolSignature | null;
  seenCount: number;
  consecutiveIdentical: number;
  deduped: boolean;
  charsSaved: number;
  nudged: boolean;
  shortCircuit: boolean;
  shortCircuitTool: ShortCircuitAgentTool | null;
  flags: string[];
};

export function isAntiWasteEnabled(
  headers?: Headers | Record<string, string | undefined> | null,
): boolean {
  const env = (process.env.ANTI_WASTE_ENABLED || "1").trim().toLowerCase();
  if (env === "0" || env === "false" || env === "off" || env === "disabled") return false;

  if (headers) {
    const get = (k: string): string | undefined => {
      if (typeof (headers as Headers).get === "function") {
        return (headers as Headers).get(k) || undefined;
      }
      const rec = headers as Record<string, string | undefined>;
      return rec[k] ?? rec[k.toLowerCase()];
    };
    const raw = (get("x-anti-waste") || get("X-Anti-Waste") || "").trim().toLowerCase();
    if (raw === "off" || raw === "0" || raw === "false" || raw === "disabled") return false;
  }
  return true;
}

function buildShortCircuitHint(toolName?: string, target?: string): string {
  const tool = toolName || "tool";
  const tgt = target ? `(${target})` : "";
  return (
    `Already have result of ${tool}${tgt}; continue with next distinct step — do not re-read.`
  );
}

/** Pick a safe agent tool from the request tools list, if any. */
export function resolveShortCircuitAgentTool(
  tools: unknown,
  opts?: { toolName?: string; target?: string },
): ShortCircuitAgentTool | null {
  if (!Array.isArray(tools) || tools.length === 0) return null;

  const byLower = new Map<string, string>();
  for (const t of tools) {
    const n =
      (t && typeof t === "object" && (t as any).function?.name) ||
      (t && typeof t === "object" && (t as any).name) ||
      null;
    if (typeof n === "string" && n.trim()) {
      byLower.set(n.trim().toLowerCase(), n.trim());
    }
  }

  let picked: string | null = null;
  for (const preferred of SAFE_AGENT_SHORTCIRCUIT_TOOLS) {
    const orig = byLower.get(preferred);
    if (orig) {
      picked = orig;
      break;
    }
  }
  if (!picked) return null;

  const hint = buildShortCircuitHint(opts?.toolName, opts?.target);
  const lower = picked.toLowerCase();
  let args: Record<string, unknown>;
  if (lower === "attempt_completion") {
    args = { result: hint };
  } else if (lower === "ask_followup_question") {
    args = { question: hint };
  } else {
    // ask_question and similar
    args = { question: hint };
  }
  return { name: picked, arguments: args };
}

export function applyAntiWaste(opts: {
  requestBody: any;
  sessionKey: string;
  isNewPrompt: boolean;
  normalizedIde: string;
  headers?: Headers | Record<string, string | undefined> | null;
}): AntiWasteApplyResult {
  const flags: string[] = [];
  const empty: AntiWasteApplyResult = {
    enabled: false,
    signature: null,
    seenCount: 0,
    consecutiveIdentical: 0,
    deduped: false,
    charsSaved: 0,
    nudged: false,
    shortCircuit: false,
    shortCircuitTool: null,
    flags,
  };

  if (!isAntiWasteEnabled(opts.headers)) return empty;
  if (!opts.requestBody || !Array.isArray(opts.requestBody.messages)) {
    return { ...empty, enabled: true };
  }

  if (opts.isNewPrompt) {
    resetAntiWasteTracker(opts.sessionKey);
  }

  const profile = resolveAntiWasteProfile(opts.normalizedIde);
  const signature = extractLatestToolSignature(opts.requestBody);
  const tracked = recordToolSignature(opts.sessionKey, signature);

  let deduped = false;
  let charsSaved = 0;
  let nudged = false;
  let shortCircuit = false;
  let shortCircuitTool: ShortCircuitAgentTool | null = null;

  if (
    signature &&
    isNoisyToolSignature(signature) &&
    tracked.seenCount >= profile.dedupeAt
  ) {
    const r = stubLatestDuplicateToolDump(opts.requestBody, signature);
    deduped = r.applied;
    charsSaved = r.charsSaved;
    if (deduped) flags.push("tool_dedupe_applied");
  }

  if (
    signature &&
    isNoisyToolSignature(signature) &&
    tracked.consecutiveIdentical >= profile.nudgeAt &&
    !tracked.nudged
  ) {
    nudged = injectAntiWasteNudge(opts.requestBody, profile.nudgeText);
    if (nudged) {
      markAntiWasteNudged(opts.sessionKey);
      flags.push("anti_loop_nudge");
    }
  }

  if (
    signature &&
    isNoisyToolSignature(signature) &&
    tracked.consecutiveIdentical >= profile.shortCircuitAt
  ) {
    shortCircuitTool = resolveShortCircuitAgentTool(opts.requestBody.tools, {
      toolName: signature.toolName,
      target: signature.target,
    });
    if (shortCircuitTool) {
      shortCircuit = true;
      flags.push("short_circuited");
    } else {
      flags.push("short_circuit_skipped_no_safe_tool");
    }
  }

  return {
    enabled: true,
    signature,
    seenCount: tracked.seenCount,
    consecutiveIdentical: tracked.consecutiveIdentical,
    deduped,
    charsSaved,
    nudged,
    shortCircuit,
    shortCircuitTool,
    flags,
  };
}

function shortCircuitCallId(): string {
  return `call_aw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Build a minimal OpenAI chat.completion stream with synthetic tool_calls. */
export function buildAntiWasteShortCircuitSse(opts: {
  model: string;
  toolName?: string;
  target?: string;
  agentTool: ShortCircuitAgentTool;
}): string {
  const id = `chatcmpl-aw-${Date.now().toString(36)}`;
  const callId = shortCircuitCallId();
  const argsJson = JSON.stringify(opts.agentTool.arguments);

  const chunk = (
    delta: Record<string, unknown>,
    finish_reason: string | null = null,
  ) =>
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: opts.model || "anti-waste",
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;

  return (
    chunk({ role: "assistant", content: null }) +
    chunk({
      tool_calls: [
        {
          index: 0,
          id: callId,
          type: "function",
          function: { name: opts.agentTool.name, arguments: "" },
        },
      ],
    }) +
    chunk({
      tool_calls: [
        {
          index: 0,
          function: { arguments: argsJson },
        },
      ],
    }) +
    chunk({}, "tool_calls") +
    "data: [DONE]\n\n"
  );
}

/** Non-stream OpenAI chat.completion JSON with synthetic tool_calls. */
export function buildAntiWasteShortCircuitJson(opts: {
  model: string;
  toolName?: string;
  target?: string;
  agentTool: ShortCircuitAgentTool;
}) {
  const callId = shortCircuitCallId();
  return {
    id: `chatcmpl-aw-${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: opts.model || "anti-waste",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: callId,
              type: "function",
              function: {
                name: opts.agentTool.name,
                arguments: JSON.stringify(opts.agentTool.arguments),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
