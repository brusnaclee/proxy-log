/**
 * Extract latest tool signature from an OpenAI-style chat body
 * (Cline XML dumps, Roo tool_response, Cursor "Called the X tool", role=tool).
 */

import { createHash } from "node:crypto";

export type ToolSignature = {
  toolName: string;
  argsHash: string;
  /** Stable id toolName|argsHash */
  key: string;
  /** Human path/target if known */
  target?: string;
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

function makeSig(toolName: string, argsRaw: string, target?: string): ToolSignature {
  const name = (toolName || "tool").toLowerCase().trim();
  const argsHash = hashArgs(argsRaw || target || name);
  const noisy = NOISY.test(name) || NOISY.test(argsRaw) || (!!target && !WRITE.test(name));
  const write = WRITE.test(name);
  return {
    toolName: name,
    argsHash,
    key: `${name}|${argsHash}`,
    target,
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
      const target =
        (typeof m.tool_call_id === "string" ? m.tool_call_id : undefined) ||
        undefined;
      return makeSig(name, text.slice(0, 500) || target || name, target);
    }

    // Cline: [read_file for 'path']
    const cline = text.match(/\[([a-z0-9_-]+)\s+for\s+['"]([^'"]+)['"]\]/i);
    if (cline) {
      return makeSig(cline[1], cline[2], cline[2]);
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
      return makeSig(cursor[1], cursor[2].slice(0, 400), target);
    }

    // Roo: <tool_response> ... often preceded by tool name in nearby text
    if (/<tool_response>/i.test(text)) {
      const nameMatch = text.match(/tool(?:_|\s)?name['":\s]+([a-z0-9_-]+)/i);
      const pathMatch = text.match(/(?:path|file)['":\s]+['"]([^'"]+)['"]/i);
      return makeSig(nameMatch?.[1] || "tool_response", pathMatch?.[1] || text.slice(0, 200), pathMatch?.[1]);
    }
  }

  return null;
}

export function isNoisyToolSignature(sig: ToolSignature | null | undefined): boolean {
  return !!sig?.noisy;
}
