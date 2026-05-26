import { sha256 } from "./crypto.js";

export interface MessageAnalysis {
  hasUserMessage: boolean;
  messageRole: "user" | "assistant" | "tool" | "system" | null;
  messageHash: string | null;
  messageContent: string | null;
  userMessageCount: number;
  assistantMessageCount: number;
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
 * Analyze request body to detect user messages.
 */
export function analyzeRequestMessages(requestBody: any): MessageAnalysis {
  let messages = requestBody?.messages || [];

  // Fallback for /v1/completions or /v1/responses
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

  if (messages.length === 0) {
    return {
      hasUserMessage: false,
      messageRole: null,
      messageHash: null,
      messageContent: null,
      userMessageCount: 0,
      assistantMessageCount: 0,
    };
  }

  let userMessageCount = 0;
  let assistantMessageCount = 0;
  for (const msg of messages) {
    const r = String(msg?.role || "").toLowerCase();
    if (r === "user") userMessageCount++;
    else if (r === "assistant") assistantMessageCount++;
  }

  const lastMessage = messages[messages.length - 1];
  const role = lastMessage?.role || null;

  let content = "";
  let isToolResultWrapper = false;

  if (typeof lastMessage?.content === "string") {
    content = lastMessage.content;
  } else if (Array.isArray(lastMessage?.content)) {
    content = lastMessage.content
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text || "")
      .join("\n");
    if (lastMessage.content.some((part: any) => part.type === "tool_result" || part.type === "tool_use")) {
      isToolResultWrapper = true;
    }
  } else if (lastMessage?.content) {
    content = JSON.stringify(lastMessage.content);
  }

  const effectiveRole = isToolResultWrapper ? "tool" : role;
  let messageHash = content ? sha256(content) : null;
  let finalHasUserMessage = effectiveRole === "user";
  let finalRole = effectiveRole;

  // Fallback for completely unknown JSON structures (e.g. custom IDE endpoints)
  if (!finalHasUserMessage && requestBody && Object.keys(requestBody).length > 0 && !messages.length) {
    const rawContent = typeof requestBody === "string" ? requestBody : JSON.stringify(requestBody);
    finalHasUserMessage = true;
    finalRole = "user";
    messageHash = sha256(rawContent);
    content = rawContent;
  }

  return {
    hasUserMessage: finalHasUserMessage,
    messageRole: finalRole,
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
