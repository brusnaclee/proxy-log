import { sha256 } from "./crypto.js";

export interface MessageAnalysis {
  hasUserMessage: boolean;
  messageRole: "user" | "assistant" | "tool" | "system" | null;
  messageHash: string | null;
  messageContent: string | null;
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
    };
  }
  
  const lastMessage = messages[messages.length - 1];
  const role = lastMessage?.role || null;
  
  // Extract content
  let content = "";
  let isToolResultWrapper = false;
  
  if (typeof lastMessage?.content === "string") {
    content = lastMessage.content;
  } else if (Array.isArray(lastMessage?.content)) {
    // Handle multi-part content (text + images + tool results)
    content = lastMessage.content
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text || "")
      .join("\n");
      
    // Check if this array contains a tool result
    if (lastMessage.content.some((part: any) => part.type === "tool_result" || part.type === "tool_use")) {
      isToolResultWrapper = true;
    }
  } else if (lastMessage?.content) {
    content = JSON.stringify(lastMessage.content);
  }
  
  // If role is user but it's just wrapping a tool result, treat it as a tool role functionally
  // Or simply set hasUserMessage to false.
  const effectiveRole = isToolResultWrapper ? "tool" : role;
  
  const messageHash = content ? sha256(content) : null;
  
  return {
    hasUserMessage: effectiveRole === "user",
    messageRole: effectiveRole,
    messageHash,
    messageContent: content.substring(0, 500), // First 500 chars for preview
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
