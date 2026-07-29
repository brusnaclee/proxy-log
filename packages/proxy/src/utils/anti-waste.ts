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
  consecutiveSamePath: number;
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

function buildShortCircuitHint(
  toolName?: string,
  target?: string,
  lang: "en" | "id" = "en",
): string {
  const tool = toolName || "tool";
  const tgt = target ? ` (${target})` : "";
  if (lang === "id") {
    return (
      `Sudah punya hasil ${tool}${tgt} di context. Lanjut langkah berbeda (edit/test) — jangan baca ulang range yang sama.`
    );
  }
  return (
    `Already have this ${tool}${tgt} result in context. Continue with a different step (edit/test) — do not re-read the same range.`
  );
}

function pathLoopNudgeText(
  toolName: string,
  pathKey: string | null,
  lang: "en" | "id",
): string {
  const path = pathKey?.split("|").slice(1).join("|") || "this file";
  if (lang === "id") {
    return (
      `[tokito anti-waste] Kamu sudah memanggil ${toolName} ke ${path} berkali-kali dengan range yang beda-beda. ` +
      `Isi file itu sudah ada di context — berhenti membacanya. Lanjut ke langkah berikutnya (edit/test), ` +
      `atau kalau memang butuh bagian tertentu, sebutkan dulu range mana dan kenapa.`
    );
  }
  return (
    `[tokito anti-waste] You have called ${toolName} on ${path} repeatedly with a shifting range. ` +
    `That file is already in context — stop reading it. Move on to the next step (edit/test), ` +
    `or if you genuinely need a specific part, state which range and why first.`
  );
}

/** Pick a safe agent tool from the request tools list, if any. */
export function resolveShortCircuitAgentTool(
  tools: unknown,
  opts?: { toolName?: string; target?: string; lang?: "en" | "id" },
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

  const hint = buildShortCircuitHint(opts?.toolName, opts?.target, opts?.lang || "en");
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

export type AntiWasteThresholdOverride = {
  nudgeAt: number;
  dedupeAt: number;
  shortCircuitAt: number;
};

export function applyAntiWaste(opts: {
  requestBody: any;
  sessionKey: string;
  isNewPrompt: boolean;
  normalizedIde: string;
  headers?: Headers | Record<string, string | undefined> | null;
  /** When false, skip even if env/header would allow (Token Saver toggle). */
  featureEnabled?: boolean;
  thresholds?: AntiWasteThresholdOverride | null;
  lang?: "en" | "id";
}): AntiWasteApplyResult {
  const flags: string[] = [];
  const empty: AntiWasteApplyResult = {
    enabled: false,
    signature: null,
    seenCount: 0,
    consecutiveIdentical: 0,
    consecutiveSamePath: 0,
    deduped: false,
    charsSaved: 0,
    nudged: false,
    shortCircuit: false,
    shortCircuitTool: null,
    flags,
  };

  if (opts.featureEnabled === false) return empty;
  if (!isAntiWasteEnabled(opts.headers)) return empty;
  if (!opts.requestBody || !Array.isArray(opts.requestBody.messages)) {
    return { ...empty, enabled: true };
  }

  if (opts.isNewPrompt) {
    resetAntiWasteTracker(opts.sessionKey);
  }

  const profile = resolveAntiWasteProfile(opts.normalizedIde);
  const nudgeAt = opts.thresholds?.nudgeAt ?? profile.nudgeAt;
  const dedupeAt = opts.thresholds?.dedupeAt ?? profile.dedupeAt;
  const shortCircuitAt = opts.thresholds?.shortCircuitAt ?? profile.shortCircuitAt;
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
    tracked.seenCount >= dedupeAt
  ) {
    const r = stubLatestDuplicateToolDump(opts.requestBody, signature);
    deduped = r.applied;
    charsSaved = r.charsSaved;
    if (deduped) flags.push("tool_dedupe_applied");
  }

  // A model grinding on one file with a drifting line range never repeats an
  // exact signature, so `consecutiveIdentical` stays at 1 forever. Track the
  // path on its own, one step behind the exact-repeat thresholds.
  const pathLoopNudgeAt = nudgeAt + 1;
  const pathLoopShortCircuitAt = shortCircuitAt + 2;
  const isPathLoop =
    !!signature?.pathKey && tracked.consecutiveSamePath >= pathLoopNudgeAt;

  if (
    signature &&
    isNoisyToolSignature(signature) &&
    (tracked.consecutiveIdentical >= nudgeAt || isPathLoop) &&
    !tracked.nudged
  ) {
    // Exact repeats keep the IDE-specific copy; only a range-drift loop needs the
    // path-specific wording, since the generic text is about identical arguments.
    const usePathCopy = isPathLoop && tracked.consecutiveIdentical < nudgeAt;
    nudged = injectAntiWasteNudge(
      opts.requestBody,
      usePathCopy
        ? pathLoopNudgeText(signature.toolName, signature.pathKey, opts.lang || "en")
        : profile.nudgeText,
    );
    if (nudged) {
      markAntiWasteNudged(opts.sessionKey);
      flags.push(usePathCopy ? "anti_loop_nudge_path" : "anti_loop_nudge");
    }
  }

  if (
    signature &&
    isNoisyToolSignature(signature) &&
    (tracked.consecutiveIdentical >= shortCircuitAt ||
      (!!signature.pathKey && tracked.consecutiveSamePath >= pathLoopShortCircuitAt))
  ) {
    shortCircuitTool = resolveShortCircuitAgentTool(opts.requestBody.tools, {
      toolName: signature.toolName,
      target: signature.target,
      lang: opts.lang || "en",
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
    consecutiveSamePath: tracked.consecutiveSamePath,
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
