/**
 * Extract latest tool signature from an OpenAI-style chat body
 * (Cline XML dumps, Roo tool_response, Cursor "Called the X tool", role=tool).
 *
 * Partial reads of the same path with different line ranges must NOT collide —
 * include path+range or content sample in the hash.
 */

import { createHash } from "node:crypto";

export type ToolSignature = {
  toolName: string;
  argsHash: string;
  /** Stable id toolName|argsHash */
  key: string;
  /** Human path/target if known */
  target?: string;
  /**
   * Identity of the *path* only, ignoring line range. Lets callers spot a model
   * grinding on one file with a drifting window — `key` deliberately differs on
   * every range, so it can never catch that loop on its own.
   */
  pathKey: string | null;
  noisy: boolean;
};

const NOISY =
  /read[_-]?file|^read$|search[_-]?files?|list[_-]?files?|list[_-]?dir|glob|grep|ripgrep|cat\b|head\b|tail\b|ls\b|find\b|webfetch|bash|shell|execute_command|run_command/i;

const WRITE =
  /write[_-]?file|edit[_-]?file|apply[_-]?diff|apply[_-]?patch|str[_-]?replace|search[_-]?replace|create[_-]?file|delete[_-]?file|attempt_completion/i;

function hashArgs(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object" && typeof (p as any).text === "string") return (p as any).text;
        return "";
      })
      .join("\n");
  }
  return "";
}

/** Pull start/end/offset/limit from free text or JSON-ish args. */
export function extractRangeHint(text: string): string {
  if (!text) return "";
  const bits: string[] = [];
  const start =
    text.match(/start[_-]?line['":\s]+(\d+)/i) ||
    text.match(/"startLine"\s*:\s*(\d+)/i) ||
    text.match(/\boffset['":\s]+(\d+)/i);
  const end =
    text.match(/end[_-]?line['":\s]+(\d+)/i) ||
    text.match(/"endLine"\s*:\s*(\d+)/i);
  const limit = text.match(/\blimit['":\s]+(\d+)/i);
  const lineRange = text.match(/lines?\s+(\d+)\s*[-–—]\s*(\d+)/i);
  if (start) bits.push(`s${start[1]}`);
  if (end) bits.push(`e${end[1]}`);
  if (limit) bits.push(`l${limit[1]}`);
  if (lineRange) bits.push(`r${lineRange[1]}-${lineRange[2]}`);
  return bits.join(":");
}

/** Content fingerprint so different chunks of the same file don't collide. */
function contentSampleHash(text: string): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return "empty";
  const head = t.slice(0, 240);
  const mid = t.length > 500 ? t.slice(Math.floor(t.length / 2) - 80, Math.floor(t.length / 2) + 80) : "";
  const tail = t.length > 240 ? t.slice(-120) : "";
  return hashArgs(`${t.length}|${head}|${mid}|${tail}`);
}

function makeSig(toolName: string, argsRaw: string, target?: string): ToolSignature {
  const name = (toolName || "tool").toLowerCase().trim();
  const range = extractRangeHint(argsRaw);
  const sample = contentSampleHash(argsRaw);
  // Prefer path+range; if no range, include content sample so partial reads differ
  const identity = target
    ? range
      ? `${target}|${range}`
      : `${target}|${sample}`
    : argsRaw || name;
  const argsHash = hashArgs(identity);
  const noisy = NOISY.test(name) || NOISY.test(argsRaw) || (!!target && !WRITE.test(name));
  const write = WRITE.test(name);
  return {
    toolName: name,
    argsHash,
    key: `${name}|${argsHash}`,
    target: target ? (range ? `${target}:${range}` : target) : undefined,
    pathKey: target ? `${name}|${target}` : null,
    noisy: noisy && !write,
  };
}

/**
 * Walk messages from the end; return the most recent tool-result signature.
 */
export function extractLatestToolSignature(requestBody: any): ToolSignature | null {
  const messages: any[] = requestBody?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    const role = String(m.role || "").toLowerCase();
    const text = contentToText(m.content);

    if (role === "tool" || role === "function") {
      const name = String(m.name || m.tool_name || "tool");
      // Prefer path from nearby assistant tool_calls args over call id alone
      let pathTarget: string | undefined;
      let rangeFromArgs = "";
      if (i > 0) {
        const prev = messages[i - 1];
        const calls = prev?.tool_calls;
        const callId = typeof m.tool_call_id === "string" ? m.tool_call_id : null;
        if (Array.isArray(calls)) {
          for (const tc of calls) {
            if (callId && tc?.id && tc.id !== callId) continue;
            const argsStr =
              typeof tc?.function?.arguments === "string"
                ? tc.function.arguments
                : JSON.stringify(tc?.function?.arguments || tc?.arguments || {});
            rangeFromArgs = extractRangeHint(argsStr);
            try {
              const j = JSON.parse(argsStr);
              pathTarget =
                j.filePath || j.path || j.target_file || j.absolutePath || j.glob || undefined;
            } catch {
              const pm = argsStr.match(/"(?:filePath|path|target_file|absolutePath)"\s*:\s*"([^"]+)"/);
              if (pm) pathTarget = pm[1];
            }
            if (pathTarget || rangeFromArgs) break;
          }
        }
      }
      const combined = `${pathTarget || ""} ${rangeFromArgs} ${text.slice(0, 800)}`;
      return makeSig(name, combined, pathTarget || undefined);
    }

    // Cline: [read_file for 'path'] — must not hash path alone
    const cline = text.match(/\[([a-z0-9_-]+)\s+for\s+['"]([^'"]+)['"]\]/i);
    if (cline) {
      const range = extractRangeHint(text);
      const bodyAfter = text.slice(cline.index! + cline[0].length);
      const argsRaw = range
        ? `${cline[2]}|${range}|${bodyAfter.slice(0, 400)}`
        : `${cline[2]}|${bodyAfter.slice(0, 800)}`;
      return makeSig(cline[1], argsRaw, cline[2]);
    }

    // Cursor: Called the Read tool with the following input: {...}
    const cursor = text.match(
      /called the\s+(\w+)\s+tool with the following input:\s*(\{[\s\S]*?\})/i,
    );
    if (cursor) {
      let target: string | undefined;
      try {
        const j = JSON.parse(cursor[2]);
        target = j.filePath || j.path || j.target_file || j.glob || undefined;
      } catch {
        /* ignore */
      }
      return makeSig(cursor[1], cursor[2].slice(0, 600), target);
    }

    // Roo: <tool_response>
    if (/<tool_response>/i.test(text)) {
      const nameMatch = text.match(/tool(?:_|\s)?name['":\s]+([a-z0-9_-]+)/i);
      const pathMatch = text.match(/(?:path|file)['":\s]+['"]([^'"]+)['"]/i);
      const range = extractRangeHint(text);
      const argsRaw = `${pathMatch?.[1] || ""}|${range}|${text.slice(0, 400)}`;
      return makeSig(nameMatch?.[1] || "tool_response", argsRaw, pathMatch?.[1]);
    }
  }

  return null;
}

export function isNoisyToolSignature(sig: ToolSignature | null | undefined): boolean {
  return !!sig?.noisy;
}
