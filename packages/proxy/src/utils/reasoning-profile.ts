/**
 * Per-IDE handling of reasoning_content vs content.
 *
 * - keep_separate: Pi / Continue / Cursor / Cline-like — do NOT copy reasoning into content
 * - strip: OpenCode / Kilo — drop reasoning fields (they spam a Thought block per delta)
 * - backfill: Hermes / default — copy reasoning → content only when content empty
 *   (avoids empty bubbles; never concatenates both into one string)
 *
 * Streaming caveat: never per-delta backfill. Models like gcli/grok-* emit a long
 * reasoning_content trail then a short content answer. Copying each reasoning delta
 * into content makes clients accumulate CoT as the visible reply (direct upstream OK,
 * proxy looked "broken"). For backfill IDEs, defer to a single end-of-stream inject
 * when the stream had reasoning but no plain content.
 */

export type ReasoningProfile = "keep_separate" | "strip" | "backfill";

export function resolveReasoningProfile(ide: string | null | undefined): ReasoningProfile {
	const n = String(ide || "").toLowerCase().trim();
	if (
		n === "opencode" ||
		n === "opencode (vs code)" ||
		n === "kilo" ||
		n.startsWith("kilo ")
	) {
		return "strip";
	}
	if (
		n === "pi agent" ||
		n === "pi" ||
		n.startsWith("pi ") ||
		n === "continue" ||
		n === "cursor" ||
		n === "claude code" ||
		n === "claude desktop" ||
		n === "cline" ||
		n === "roo code" ||
		n === "zcode" ||
		n === "zed" ||
		n === "windsurf" ||
		n === "github copilot"
	) {
		return "keep_separate";
	}
	// Hermes, Unknown, Node.js Client, etc.
	return "backfill";
}

/** True when a stream should emit one content chunk from buffered reasoning at [DONE]. */
export function shouldInjectStreamReasoningBackfill(opts: {
	profile: ReasoningProfile;
	sawPlainContent: boolean;
	reasoningText: string;
	hasToolCalls?: boolean;
}): boolean {
	if (opts.profile !== "backfill") return false;
	if (opts.sawPlainContent || opts.hasToolCalls) return false;
	return Boolean(String(opts.reasoningText || "").trim());
}
