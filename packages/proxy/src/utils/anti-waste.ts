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

export type AntiWasteApplyResult = {
  enabled: boolean;
  signature: ToolSignature | null;
  seenCount: number;
  consecutiveIdentical: number;
  deduped: boolean;
  charsSaved: number;
  nudged: boolean;
  shortCircuit: boolean;
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
    shortCircuit = true;
    flags.push("short_circuited");
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
    flags,
  };
}

/** Build a minimal OpenAI chat.completion stream that IDEs can consume. */
export function buildAntiWasteShortCircuitSse(opts: {
  model: string;
  toolName?: string;
  target?: string;
}): string {
  const id = `chatcmpl-aw-${Date.now().toString(36)}`;
  const target = opts.target ? ` (${opts.target})` : "";
  const tool = opts.toolName || "tool";
  const content =
    `I already have the result of ${tool}${target} from earlier in this turn. ` +
    `I will not call the same tool again. Continuing with the next distinct step.`;

  const chunk = (delta: Record<string, unknown>) =>
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: opts.model || "anti-waste",
      choices: [{ index: 0, delta, finish_reason: null }],
    })}\n\n`;

  const done = `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: opts.model || "anti-waste",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  })}\n\n`;

  return (
    chunk({ role: "assistant", content: "" }) +
    chunk({ content }) +
    done +
    "data: [DONE]\n\n"
  );
}

/** Non-stream OpenAI chat.completion JSON for short-circuit. */
export function buildAntiWasteShortCircuitJson(opts: {
  model: string;
  toolName?: string;
  target?: string;
}) {
  const target = opts.target ? ` (${opts.target})` : "";
  const tool = opts.toolName || "tool";
  const content =
    `I already have the result of ${tool}${target} from earlier in this turn. ` +
    `I will not call the same tool again. Continuing with the next distinct step.`;
  return {
    id: `chatcmpl-aw-${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: opts.model || "anti-waste",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
