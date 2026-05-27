import { sha256 } from "./crypto.js";

export interface MessageAnalysis {
  hasUserMessage: boolean;
  messageRole: "user" | "assistant" | "tool" | "system" | null;
  messageHash: string | null;
  messageContent: string | null;
  userMessageCount: number;
  assistantMessageCount: number;
  isRawFormat?: boolean;
}

/**
 * Returns true if this request is an internal IDE request (e.g. title generator).
 * These requests should bypass session tracking and counting entirely.
 */
export function isTitleGenRequest(requestBody: any): boolean {
  const messages = requestBody?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const sys = messages[0];
  if (!sys || String(sys.role || "").toLowerCase() !== "system") return false;
  const content = String(sys.content || "").toLowerCase().slice(0, 300);
  return (
    content.includes("title generator") ||
    content.includes("generate a brief title") ||
    content.includes("you output only a thread title") ||
    content.includes("generate a title for this conversation")
  );
}

/**
 * Check if a "user" message is actually a tool result / automated response
 * that should NOT count as a real user prompt.
 *
 * Many IDEs (Cursor, Cline, Roo Code, Kilo, OpenCode) wrap tool results
 * inside a role="user" message. We detect these by looking at the content.
 */
function isToolResultContent(content: string): boolean {
  if (!content) return false;
  const trimmed = content.trimStart().slice(0, 500).toLowerCase();

  // Cursor: tool output like "Subagent is running...", "Wrote contents to ...",
  // or raw file content "1| /* 2| * To change..." or "... N lines not shown ..."
  if (/^\d+\|/.test(content.trimStart())) return true;                         // numbered file lines
  if (trimmed.startsWith("subagent is running")) return true;                  // Cursor subagent
  if (trimmed.startsWith("wrote contents to ")) return true;                   // Cursor write result
  if (trimmed.startsWith("progress update recorded")) return true;             // Cursor progress
  if (/^\.\.\.\s*\d+\s*lines?\s*not\s*shown/.test(content.trimStart())) return true; // truncated output

  // Cline / Roo Code: tool results wrapped as user messages
  // e.g. "[read_file for 'src/foo.ts'] Result: ..."
  // e.g. "[list_files for 'src'] Result: ..."
  // e.g. "[execute_command for 'npm test'] Result: ..."
  if (/^\[(?:read_file|list_files|search_files|write_to_file|execute_command|apply_diff|browser_action|access_mcp_resource)\s+for\s+/.test(content.trimStart())) return true;

  // Cline / Roo Code: "[ERROR] You did not use a tool..."
  if (trimmed.startsWith("[error] you did not use a tool")) return true;

  // Roo Code: summarization system operation
  if (trimmed.startsWith("critical: this summarization request is a system operation")) return true;

  // OpenClaw: cron/subagent automated messages - these are system-initiated, not user prompts
  // e.g. "[cron:uuid ...] ..." or "[Subagent Context] ..."
  if (/^\[cron:[0-9a-f-]+/.test(content.trimStart())) return true;
  if (trimmed.startsWith("[subagent context]")) return true;
  // Retry messages from agent framework
  if (trimmed.startsWith("[retry after the previous model attempt")) return true;

  // Claude Desktop: tool result notifications wrapped as user
  // e.g. "The file /path/to/file has been updated successfully. (file state is current...)"
  if (/^the file .+ has been (updated|created|written) successfully/i.test(content.trimStart())) return true;

  return false;
}

/**
 * Analyze request body to detect user messages.
 * 
 * Supports multiple formats:
 * - Standard OpenAI: { messages: [{role, content}] }
 * - Codex /v1/responses: { input: [{role, content}] } or { input: "string" }
 * - Gemini: { contents: [{role, parts}] }
 * - Antigravity wrapped: { project, request: { contents: [{role, parts}] } }
 * - Anthropic /v1/messages: { messages: [{role, content}] } (same as OpenAI)
 * - Legacy /v1/completions: { prompt: "string" }
 */
export function analyzeRequestMessages(requestBody: any): MessageAnalysis {
  let messages = requestBody?.messages || [];

  // ─── Codex /v1/responses format ──────────────────────────────────────
  // Codex uses `input` (array or string) instead of `messages`.
  // The `input` array has items like {role:"user"|"assistant"|"developer"|"system", content:"..."}
  if (messages.length === 0 && requestBody?.input != null) {
    const input = requestBody.input;
    if (Array.isArray(input)) {
      // input: [{role, content}, ...]
      messages = input.map((m: any) => ({
        role: m.role === "developer" ? "system" : m.role,
        content: typeof m.content === "string" ? m.content
               : Array.isArray(m.content) ? m.content.map((p: any) => p.text || JSON.stringify(p)).join("\n")
               : JSON.stringify(m.content || ""),
      }));
    } else if (typeof input === "string") {
      // input: "plain string prompt"
      return {
        hasUserMessage: true,
        messageRole: "user",
        messageHash: sha256(input),
        messageContent: input.substring(0, 500),
        userMessageCount: 1,
        assistantMessageCount: 0,
      };
    }
  }

  // ─── Antigravity wrapped Gemini format ───────────────────────────────
  // Body: { project, requestId, request: { contents: [{role, parts}] } }
  if (messages.length === 0 && requestBody?.request?.contents) {
    const contents = requestBody.request.contents;
    if (Array.isArray(contents)) {
      messages = contents.map((m: any) => ({
        role: m.role === "model" ? "assistant" : m.role === "function" ? "tool" : "user",
        content: Array.isArray(m.parts)
          ? m.parts.map((p: any) => p.text || "").join("\n")
          : "",
      }));
    }
  }

  // ─── Direct Gemini format ────────────────────────────────────────────
  // Body: { contents: [{role, parts}] }
  if (messages.length === 0 && Array.isArray(requestBody?.contents)) {
    messages = requestBody.contents.map((m: any) => ({
      role: m.role === "model" ? "assistant" : m.role === "function" ? "tool" : "user",
      content: Array.isArray(m.parts) ? m.parts.map((p: any) => p.text || "").join("\n") : "",
    }));
  }

  // ─── Legacy /v1/completions format ───────────────────────────────────
  if (messages.length === 0 && requestBody?.prompt) {
    const p = requestBody.prompt;
    const content = typeof p === "string" ? p : JSON.stringify(p);
    return {
      hasUserMessage: true,
      messageRole: "user",
      messageHash: sha256(content),
      messageContent: content.substring(0, 500),
      userMessageCount: 1,
      assistantMessageCount: 0,
    };
  }

  // ─── No recognizable format ──────────────────────────────────────────
  if (messages.length === 0) {
    if (requestBody && Object.keys(requestBody).length > 0) {
      const rawContent = typeof requestBody === "string" ? requestBody : JSON.stringify(requestBody);
      return {
        hasUserMessage: true,
        messageRole: "user",
        messageHash: sha256(rawContent),
        messageContent: rawContent.substring(0, 500),
        userMessageCount: 1,
        assistantMessageCount: 0,
        isRawFormat: true,
      };
    }
    return {
      hasUserMessage: false,
      messageRole: null,
      messageHash: null,
      messageContent: null,
      userMessageCount: 0,
      assistantMessageCount: 0,
      isRawFormat: false,
    };
  }

  // ─── Count roles ─────────────────────────────────────────────────────
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  for (const msg of messages) {
    const r = String(msg?.role || "").toLowerCase();
    if (r === "user") userMessageCount++;
    else if (r === "assistant") assistantMessageCount++;
  }

  // ─── Analyze last message ────────────────────────────────────────────
  const lastMessage = messages[messages.length - 1];
  const role = lastMessage?.role || null;

  let content = "";
  let isToolResultWrapper = false;

  if (typeof lastMessage?.content === "string") {
    content = lastMessage.content;
  } else if (Array.isArray(lastMessage?.content)) {
    // Anthropic / multi-part content blocks
    content = lastMessage.content
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text || "")
      .join("\n");
    // Detect tool_result or tool_use blocks inside a "user" message
    if (lastMessage.content.some((part: any) =>
      part.type === "tool_result" || part.type === "tool_use"
    )) {
      isToolResultWrapper = true;
    }
  } else if (lastMessage?.content) {
    content = JSON.stringify(lastMessage.content);
  }

  // Determine effective role
  let effectiveRole: string = isToolResultWrapper ? "tool" : role;

  // ─── Detect tool-result-in-user-message (content-based) ──────────────
  // Many IDEs send tool outputs as role="user". If content looks like a
  // tool result, override to "tool" so it doesn't count as a user prompt.
  if (effectiveRole === "user" && content && isToolResultContent(content)) {
    effectiveRole = "tool";
  }

  const messageHash = content ? sha256(content) : null;
  const finalHasUserMessage = effectiveRole === "user";

  return {
    hasUserMessage: finalHasUserMessage,
    messageRole: effectiveRole as MessageAnalysis["messageRole"],
    messageHash,
    messageContent: content.substring(0, 500),
    userMessageCount,
    assistantMessageCount,
  };
}

/**
 * Detect if response contains actual tool calls.
 */
export function detectToolCallsInResponse(responseBody: any): boolean {
  if (responseBody?.choices?.[0]?.message?.tool_calls) return true;
  if (responseBody?.choices?.[0]?.message?.function_call) return true;
  if (responseBody?.content) {
    const content = Array.isArray(responseBody.content) ? responseBody.content : [responseBody.content];
    return content.some((item: any) => item.type === "tool_use");
  }
  return false;
}
