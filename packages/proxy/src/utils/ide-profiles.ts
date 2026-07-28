/**
 * IDE anti-waste profiles — soft nudge copy + thresholds.
 * Model-agnostic; keyed by normalizeIdeName().
 */

export type AntiWasteProfile = {
  /** Soft system nudge after identicalSignatureCount >= nudgeAt */
  nudgeAt: number;
  /** Stub-dedupe tool dumps after seenCount >= dedupeAt */
  dedupeAt: number;
  /** Short-circuit upstream after consecutiveIdentical >= shortCircuitAt */
  shortCircuitAt: number;
  nudgeText: string;
};

const CLINE_FAMILY: AntiWasteProfile = {
  nudgeAt: 2,
  dedupeAt: 3,
  shortCircuitAt: 5,
  nudgeText:
    "[tokito anti-waste] Do not re-read the same file path. Batch read_file/search_files for paths you still need, then edit. Prefer one multi-file pass.",
};

const CURSOR_FAMILY: AntiWasteProfile = {
  nudgeAt: 2,
  dedupeAt: 3,
  shortCircuitAt: 5,
  nudgeText:
    "[tokito anti-waste] Stop identical tool calls with the same arguments. Use parallel tool_calls for unread files only; reuse content already in context.",
};

const CLAUDE_FAMILY: AntiWasteProfile = {
  nudgeAt: 2,
  dedupeAt: 3,
  shortCircuitAt: 5,
  nudgeText:
    "[tokito anti-waste] Avoid repeating the same Read/Bash cat on one path. Summarize what you already have and proceed to the edit plan.",
};

const DEFAULT_PROFILE: AntiWasteProfile = {
  nudgeAt: 2,
  dedupeAt: 3,
  shortCircuitAt: 5,
  nudgeText:
    "[tokito anti-waste] You already received this tool result earlier in the turn. Do not repeat the same tool; continue with a different action.",
};

const PROFILE_BY_KEY: Record<string, AntiWasteProfile> = {
  cline: CLINE_FAMILY,
  "cline (vs code)": CLINE_FAMILY,
  "roo code": CLINE_FAMILY,
  "zoo code": CLINE_FAMILY,
  zoo: CLINE_FAMILY,
  kilo: CLINE_FAMILY,
  cursor: CURSOR_FAMILY,
  continue: CURSOR_FAMILY,
  "continue (vs code)": CURSOR_FAMILY,
  opencode: CURSOR_FAMILY,
  "opencode (vs code)": CURSOR_FAMILY,
  "claude code": CLAUDE_FAMILY,
  "claude desktop": CLAUDE_FAMILY,
  openclaw: CLAUDE_FAMILY,
  hermes: CLAUDE_FAMILY,
  "pi agent": CLAUDE_FAMILY,
  "ralph agent": CLAUDE_FAMILY,
};

export function resolveAntiWasteProfile(normalizedIde: string): AntiWasteProfile {
  const key = (normalizedIde || "unknown").trim().toLowerCase();
  return PROFILE_BY_KEY[key] || DEFAULT_PROFILE;
}
