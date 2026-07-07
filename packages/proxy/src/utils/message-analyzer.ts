import { sha256 } from "./crypto.js";

export interface MessageAnalysis {
  hasUserMessage: boolean;
  messageRole: "user" | "assistant" | "tool" | "system" | null;
  messageHash: string | null;
  messageContent: string | null;
  userMessageCount: number;
  assistantMessageCount: number;
  toolMessageCount: number;
  isRawFormat?: boolean;
  turnKind?: "user_prompt" | "tool_followup" | "internal";
  /**
   * True when the last "user" message is a follow-up added to an ongoing
   * tool-execution chain (e.g. OpenCode appends a new instruction at the end
   * of `tool` role messages). This should NOT count as a new prompt.
   */
  isToolChainFollowup?: boolean;
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
	// e.g. "[replace_in_file for 'src/foo.ts'] Result: ..."
	// e.g. "[execute_command for 'npm test'] Result: ..."
	if (/^\[(?:read_file|list_files|search_files|write_to_file|replace_in_file|execute_command|apply_diff|apply_patch|browser_action|access_mcp_resource|web_search|web_fetch|list_code_definition_names|use_mcp_tool)\s+for\s+/.test(content.trimStart())) return true;

	// Cline / Roo Code: "[ERROR] You did not use a tool..."
	if (trimmed.startsWith("[error] you did not use a tool")) return true;

	// Roo Code XML block for tool results (this specifically catches Roo Code's `<tool_response>` wrapping)
	if (trimmed.startsWith("<tool_response>") || trimmed.includes("tool_response>")) return true;
	if (/^<[\w_]+_response>/.test(trimmed)) return true; // e.g., <search_files_response>

	// Roo Code: summarization system operation
	if (trimmed.startsWith("critical: this summarization request is a system operation")) return true;

	// OpenClaw: cron/subagent automated messages - these are system-initiated, not user prompts
	// e.g. "[cron:uuid ...] ..." or "[Subagent Context] ..."
	if (/^\[cron:[0-9a-f-]+/.test(content.trimStart())) return true;
	if (trimmed.startsWith("[subagent context]")) return true;
	// Retry messages from agent framework
	if (trimmed.startsWith("[retry after the previous model attempt")) return true;

	// Cline: ephemeral messages embedded in context (not a real user message)
	if (trimmed.startsWith("step id:") && trimmed.includes("<ephemeral_message>")) return true;

	// Claude Desktop: tool result notifications wrapped as user
	if (/^the file .+ has been (updated|created|written) successfully/i.test(content.trimStart())) return true;

	// OpenCode / Claude Code / generic tool wrappers
	if (trimmed.startsWith("[tool result]")) return true;
	if (trimmed.startsWith("tool result:")) return true;
	if (trimmed.startsWith("called tool")) return true;
	if (trimmed.startsWith("result of tool")) return true;
	if (/^tool:\s*\w+/i.test(content.trimStart())) return true;
	if (trimmed.includes("todowrite") && (trimmed.includes("successfully updated") || trimmed.includes("todos"))) return true;

	// Codex command output
	if (trimmed.startsWith("command output:")) return true;
	if (trimmed.startsWith("apply_patch result")) return true;

	// === NEW PATTERNS FROM DATABASE ANALYSIS ===

	// Hermes patterns - Hermes Agent system messages
	if (trimmed.startsWith("[fri ") && trimmed.includes("[retry after the previous model attempt")) return true;
	if (trimmed.startsWith("[subagent context]")) return true;
	if (trimmed.includes("[hermes]")) return true;
	if (trimmed.includes("hermes-agent")) return true;
	// Hermes file notifications
	if (trimmed.includes("[replied-to document")) return true;
	if (trimmed.includes(".hermes/cache/documents")) return true;

	// Zed editor patterns
	if (trimmed.includes("[zed]") || trimmed.includes("zed.dev")) return true;

	// OpenClaw extended patterns (already partially covered, adding more)
	if (trimmed.startsWith("[openclaw")) return true;
	if (trimmed.includes("[attempt_completion]")) return true;
	if (trimmed.includes("[search-mode]")) return true;

	// Antigravity patterns
	if (trimmed.includes("antigravity")) return true;

	// Generic continue pattern (Cline/Roo Code continuation)
	if (trimmed.startsWith("continue")) return true;
	if (trimmed.includes("<open_and_recently_viewed_files>")) return true;
	if (trimmed.includes("<system-reminder>")) return true;
	if (trimmed.includes("<environment_details>")) return true;
	if (trimmed.includes("<user-prompt-submit-hook>")) return true;
	if (trimmed.includes("<conversation-summary>")) return true;

	// MCP tool patterns (Continue, Kilo, Windsurf)
	if (trimmed.startsWith("[mcp_tool")) return true;
	if (trimmed.includes("_mcp_server")) return true;
	if (trimmed.includes("[tool_use")) return true;

	// Windsurf patterns
	if (trimmed.includes("[file modification]")) return true;
	if (trimmed.includes("[search results]")) return true;

	// Generic progress/task patterns
	if (trimmed.includes("progress update recorded")) return true;
	if (trimmed.includes("attached media from tool result")) return true;

	// API/proxy related patterns (not user prompts)
	if (trimmed.includes("cli-proxy-openai-compat")) return true;

	// Claude Code extended patterns
	if (trimmed.includes("[task]")) return true;
	if (trimmed.includes("load agents, skills, references")) return true;

	// === GENERIC AGENT / WORKFLOW patterns (from DB analysis) ===

	// Claude Code session/plan patterns
	if (trimmed.includes("<session>") && trimmed.includes("you are fixing pr")) return true;
	if (trimmed.includes("exited plan mode") || trimmed.includes("re-entering plan mode")) return true;
	if (trimmed.includes("exited auto mode") || trimmed.includes("re-entering auto mode")) return true;
	if (trimmed.includes("claudeMd") && trimmed.includes("currentdate")) return true;
	if (trimmed.includes("mcp server instructions")) return true;

	// Generic system message wrappers
	if (trimmed.includes("<system-message>") || trimmed.includes("<system_message>")) return true;
	if (trimmed.includes("system message") && trimmed.includes("timestamp=")) return true;
	if (trimmed.includes("[role:")) return true; // Role-based agent

	// DeepPresenter / Ralph Agent
	if (trimmed.includes("deeppresenter")) return true;
	if (trimmed.includes("brainstorm companion")) return true;
	if (trimmed.includes("ralph agent")) return true;

	// WhatsApp/Signal agent patterns
	if (trimmed.includes("whatsapp gateway disconnected")) return true;
	if (trimmed.includes("whatsapp gateway connected as")) return true;

	// Windows terminal patterns
	if (trimmed.includes("windows powershell copyright")) return true;
	if (trimmed.includes("install the latest powershell")) return true;

	// Router patterns
	if (trimmed.includes("via provider 9router")) return true;

	// 9Router model switching
	if (trimmed.includes("active model for this chat has changed to")) return true;

	// Generic MCP patterns
	if (trimmed.includes("<ephemeral_message>")) return true;

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
  let toolMessageCount = 0;
  for (const msg of messages) {
    const r = String(msg?.role || "").toLowerCase();
    if (r === "user") userMessageCount++;
    else if (r === "assistant") assistantMessageCount++;
    else if (r === "tool") toolMessageCount++;
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
  if (effectiveRole === "user" && toolMessageCount > 0 && assistantMessageCount === 0 && userMessageCount <= 1) {
    // Single user message in a tool-only turn is often a tool result wrapper.
    if (isToolResultContent(content)) effectiveRole = "tool";
  }

  // ─── Detect tool-result-in-user-message (content-based) ──────────────
  // Many IDEs send tool outputs as role="user". If content looks like a
  // tool result, override to "tool" so it doesn't count as a user prompt.
  if (effectiveRole === "user" && content && isToolResultContent(content)) {
    effectiveRole = "tool";
  }

  const messageHash = content ? sha256(content) : null;
  const finalHasUserMessage = effectiveRole === "user";

  // Detect "tool chain followup": OpenCode-style flow where the request
  // contains a sequence of [assistant, tool, tool, ..., user] and the final
  // "user" message is a new instruction appended to an ongoing tool chain.
  // The existing `effectiveRole === "tool"` only fires when the *last* message
  // is a tool result wrapper. This catches the case where the *last* message
  // is a new user instruction but it follows a chain of tool messages.
  let isToolChainFollowup = false;
  if (
    finalHasUserMessage &&
    toolMessageCount > 0 &&
    assistantMessageCount > 0 &&
    Array.isArray(requestBody?.messages)
  ) {
    // Walk backwards from the last user message and check if we hit tool/assistant
    // messages before another user message. If so, this user message is a
    // follow-up added mid-chain, not a new prompt.
    const msgs: any[] = requestBody.messages;
    let foundUserAtIndex = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (String(msgs[i]?.role || "").toLowerCase() === "user") {
        foundUserAtIndex = i;
        break;
      }
    }
    if (foundUserAtIndex > 0) {
      // Check what's immediately before the last user message
      const prev = msgs[foundUserAtIndex - 1];
      const prevRole = String(prev?.role || "").toLowerCase();
      // If previous message is tool or assistant (with tool_calls), this is
      // a follow-up appended to a tool chain.
      if (prevRole === "tool") {
        isToolChainFollowup = true;
      } else if (prevRole === "assistant") {
        // Check if assistant has tool_calls
        const tc = prev?.tool_calls || prev?.toolCallCalls || prev?.function_call;
        if (tc && Array.isArray(tc) && tc.length > 0) {
          isToolChainFollowup = true;
        } else {
          // Check content for tool_call markers (OpenCode text format)
          const assistantContent = typeof prev?.content === "string" ? prev.content : "";
          if (/\[tool_call[s]?:/i.test(assistantContent) || /```tool_call/i.test(assistantContent)) {
            isToolChainFollowup = true;
          }
        }
      }
    }
  }
  
  let turnKind: MessageAnalysis["turnKind"] = "internal";
  if (finalHasUserMessage) turnKind = "user_prompt";
  else if (effectiveRole === "tool") turnKind = "tool_followup";

  return {
    hasUserMessage: finalHasUserMessage,
    messageRole: effectiveRole as MessageAnalysis["messageRole"],
    messageHash,
    messageContent: content.substring(0, 500),
    userMessageCount,
    assistantMessageCount,
    toolMessageCount,
    turnKind,
    isToolChainFollowup,
  };
}

/**
 * Extract the full text of the last turn (or all messages if not large) for a more accurate token estimate,
 * without the 500-char UI limit.
 */
export function getLastTurnTextForTokenEstimate(requestBody: any): string {
  if (!requestBody) return "";
  
  if (requestBody.input != null) {
    if (typeof requestBody.input === "string") return requestBody.input;
    if (Array.isArray(requestBody.input)) {
        const last = requestBody.input[requestBody.input.length - 1];
        if (last && typeof last.content === "string") return last.content;
    }
  }

  let messages = requestBody.messages || requestBody?.request?.contents || requestBody.contents;
  if (!Array.isArray(messages) || messages.length === 0) {
      if (typeof requestBody === "string") return requestBody;
      return JSON.stringify(requestBody);
  }

  const lastMessage = messages[messages.length - 1];
  let content = "";
  if (typeof lastMessage?.content === "string") {
    content = lastMessage.content;
  } else if (Array.isArray(lastMessage?.content)) {
    content = lastMessage.content
      .filter((part: any) => part.type === "text" || part.text)
      .map((part: any) => part.text || part.type || JSON.stringify(part))
      .join("\\n");
  } else if (lastMessage?.parts && Array.isArray(lastMessage.parts)) {
    content = lastMessage.parts.map((p: any) => p.text || "").join("\\n");
  } else if (lastMessage?.content) {
    content = JSON.stringify(lastMessage.content);
  }
  
  return content;
}

/**
 * Detect if response contains actual tool calls.
 */
export function detectToolCallsInResponse(responseBody: any): boolean {
  if (responseBody?.choices?.[0]?.message?.tool_calls) return true;
  if (responseBody?.choices?.[0]?.message?.function_call) return true;
  if (responseBody?.choices?.[0]?.delta?.tool_calls) return true;
  if (responseBody?.choices?.[0]?.delta?.function_call) return true;
  if (responseBody?.content) {
    const content = Array.isArray(responseBody.content) ? responseBody.content : [responseBody.content];
    if (content.some((item: any) => item.type === "tool_use")) return true;
  }
  // OpenCode text-format tool_call markers (used in Cline/OpenCode chat streams)
  const text = extractTextContent(responseBody);
  if (text && /\[tool_call[s]?:\d+/i.test(text)) return true;
  if (text && /```tool_call\b/i.test(text)) return true;
  return false;

  // helper: pull plain text from any response shape
  function extractTextContent(rb: any): string {
    if (!rb) return "";
    if (typeof rb.content === "string") return rb.content;
    if (Array.isArray(rb.content)) {
      return rb.content
        .map((c: any) => (typeof c === "string" ? c : c?.text || ""))
        .join(" ");
    }
    if (rb.choices?.[0]?.message?.content) {
      const c = rb.choices[0].message.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.map((x: any) => x?.text || "").join(" ");
    }
    if (rb.choices?.[0]?.delta?.content) {
      const c = rb.choices[0].delta.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.map((x: any) => x?.text || "").join(" ");
    }
    return "";
  }
}
