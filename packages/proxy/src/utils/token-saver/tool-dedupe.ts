/**
 * Cross-hop tool dump dedupe: replace repeated noisy tool results with a short stub
 * so upstream tokens drop without cutting the IDE stream.
 */

import type { ToolSignature } from "../tool-signature.js";

const STUB_PREFIX = "[cached] already provided earlier this turn";

function stubFor(sig: ToolSignature): string {
  const target = sig.target ? ` for ${sig.target}` : "";
  return `${STUB_PREFIX}${target} (${sig.toolName}); use prior content; do not re-read.`;
}

function setContent(msg: any, text: string) {
  if (typeof msg.content === "string") {
    msg.content = text;
    return;
  }
  if (Array.isArray(msg.content)) {
    msg.content = [{ type: "text", text }];
    return;
  }
  msg.content = text;
}

/**
 * Mutate the latest matching tool dump in messages to a stub.
 * Returns chars roughly saved (best-effort).
 */
export function stubLatestDuplicateToolDump(
  requestBody: any,
  sig: ToolSignature,
): { applied: boolean; charsSaved: number } {
  const messages: any[] = requestBody?.messages;
  if (!Array.isArray(messages) || !sig) return { applied: false, charsSaved: 0 };

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    const role = String(m.role || "").toLowerCase();
    const before =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? JSON.stringify(m.content)
          : "";

    if (role === "tool" || role === "function") {
      const name = String(m.name || m.tool_name || "tool").toLowerCase();
      if (name === sig.toolName || sig.toolName === "tool") {
        const stub = stubFor(sig);
        setContent(m, stub);
        return { applied: true, charsSaved: Math.max(0, before.length - stub.length) };
      }
    }

    if (typeof m.content === "string") {
      const text = m.content;
      // Cline / Cursor / Roo dumps live in user messages
      if (
        (sig.target && text.includes(sig.target)) ||
        /\[[a-z0-9_-]+\s+for\s+'/i.test(text) ||
        /called the\s+\w+\s+tool with the following input/i.test(text) ||
        /<tool_response>/i.test(text)
      ) {
        if (before.length < 120 && before.includes(STUB_PREFIX)) {
          return { applied: false, charsSaved: 0 };
        }
        // Keep a short head so IDE still sees tool framing
        const head = text.slice(0, 160);
        const stub = `${head}\n\n${stubFor(sig)}`;
        setContent(m, stub);
        return { applied: true, charsSaved: Math.max(0, before.length - stub.length) };
      }
    }
  }

  return { applied: false, charsSaved: 0 };
}

export function injectAntiWasteNudge(requestBody: any, nudgeText: string): boolean {
  if (!requestBody || !Array.isArray(requestBody.messages) || !nudgeText) return false;
  const marker = "[tokito anti-waste]";
  const already = requestBody.messages.some(
    (m: any) =>
      (m?.role === "system" || m?.role === "developer") &&
      typeof m?.content === "string" &&
      m.content.includes(marker),
  );
  if (already) return false;
  requestBody.messages.unshift({ role: "system", content: nudgeText });
  return true;
}
