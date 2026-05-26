import { sha256 } from "./crypto.js";

export interface MessageAnalysis {
  hasUserMessage: boolean;
  messageRole: "user" | "assistant" | "tool" | "system" | null;
  messageHash: string | null;
  messageContent: string | null;
  /** Number of user messages in the request */
  userMessageCount: number;
  /** Number of assistant messages in the request (indicates conversation history) */
  assistantMessageCount: number;
  /** True if this looks like an internal IDE request (title gen, etc.), not a real chat */
  isInternalRequest: boolean;
}

/**
 * Analyze request body to detect user messages
 */
export function analyzeRequestMessages(requestBody: any): MessageAnalysis {
  const messages = requestBody?.messages || [];
  
  if (messages.length === 0) {
    return {
      hasUserMessage: false,
      messageRole: null,
      messageHash: null,
      messageContent: null,
      userMessageCount: 0,
      assistantMessageCount: 0,
      isInternalRequest: false,
    };
  }
  
  // Count message roles
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let isInternalRequest = false;
  
  for (const msg of messages) {
    const r = String(msg?.role || "").toLowerCase();
    if (r === "user") userMessageCount++;
    else if (r === "assistant") assistantMessageCount++;
    else if (r === "system") {
      // Detect internal IDE requests like title generators, embeddings, etc.
      const sysContent = String(msg?.content || "").toLowerCase();
      if (
        sysContent.includes("title generator") ||
        sysContent.includes("generate a title") ||
        sysContent.includes("you output only a thread title") ||
        sysContent.includes("generate a brief title")
      ) {
        isInternalRequest = true;
      }
    }
  }
  
  const lastMessage = messages[messages.length - 1];
  const role = lastMessage?.role || null;
  
  // Extract content
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
  const messageHash = content ? sha256(content) : null;
  
  // Internal requests (title gen) should NOT be counted as user prompts
  const hasUserMessage = effectiveRole === "user" && !isInternalRequest;
  
  return {
    hasUserMessage,
    messageRole: effectiveRole,
    messageHash,
    messageContent: content.substring(0, 500),
    userMessageCount,
    assistantMessageCount,
    isInternalRequest,
  };
}

/**
 * Detect if response contains actual tool calls
 */
export function detectToolCallsInResponse(responseBody: any): boolean {
  // Check OpenAI format
  if (responseBody?.choices?.[0]?.message?.tool_calls) {
    return true;
  }
  
  // Check function_call format (legacy)
  if (responseBody?.choices?.[0]?.message?.function_call) {
    return true;
  }
  
  // Check Anthropic format
  if (responseBody?.content) {
    const content = Array.isArray(responseBody.content) 
      ? responseBody.content 
      : [responseBody.content];
    
    return content.some((item: any) => item.type === "tool_use");
  }
  
  return false;
}
