import { sha256 } from "./crypto.js";
import { estimateTokens } from "./detect-ide.js";

const MAX_PREVIEW_LENGTH = 220;

export interface ContextInfo {
  model: string;
  contextTokensBefore: number;
  contextFingerprint: string;
  requestPreview: string;
  requestToolNames: string[];
  transcriptSnapshot: string;
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function truncate(input: string, maxLength: number = MAX_PREVIEW_LENGTH): string {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, maxLength - 1)}...`;
}

function extractText(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return value.map((item) => extractText(item)).filter(Boolean).join(" ");
  }

  if (typeof value === "object") {
    // Skip image_url / image content blocks (base64 data inflates token count)
    if (value.type === "image_url" || value.type === "image") return "";
    // Skip data URIs (base64 encoded content)
    if (typeof value.url === "string" && value.url.startsWith("data:")) return "";

    if (typeof value.text === "string") return value.text;
    if (typeof value.input_text === "string") return value.input_text;
    if (typeof value.output_text === "string") return value.output_text;
    if (typeof value.content === "string") return value.content;
    if (Array.isArray(value.content)) return extractText(value.content);

    const fragments = [
      extractText(value.name),
      extractText(value.value),
      extractText(value.message),
      extractText(value.arguments),
      extractText(value.input),
      extractText(value.output),
      extractText(value.delta),
    ].filter(Boolean);

    if (fragments.length > 0) {
      return fragments.join(" ");
    }

    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }

  return "";
}

function sanitizeToolName(name: string): string | null {
  const clean = normalizeWhitespace(String(name || ""));
  if (!clean) return null;
  if (clean.length > 80) return clean.slice(0, 80);
  return clean;
}

function addToolName(target: Set<string>, value: any) {
  if (typeof value !== "string") return;
  const normalized = sanitizeToolName(value);
  if (normalized) target.add(normalized);
}

function extractToolNamesFromRequestBody(body: any): string[] {
  const tools = new Set<string>();

  if (Array.isArray(body?.tools)) {
    for (const tool of body.tools) {
      addToolName(tools, tool?.function?.name);
      addToolName(tools, tool?.name);
      addToolName(tools, tool?.tool_name);
    }
  }

  if (Array.isArray(body?.functions)) {
    for (const fn of body.functions) {
      addToolName(tools, fn?.name);
    }
  }

  return Array.from(tools);
}

function messageLikeToText(message: any): string {
  const role = typeof message?.role === "string" ? message.role : "unknown";
  const content = extractText(message?.content ?? message?.input ?? message?.text ?? message);
  const normalized = normalizeWhitespace(content);
  return normalized ? `${role}:${normalized}` : `${role}:`;
}

export function extractContextInfo(requestBody: any): ContextInfo {
  const model = typeof requestBody?.model === "string" && requestBody.model.trim()
    ? requestBody.model.trim()
    : "unknown";

  const requestToolNames = extractToolNamesFromRequestBody(requestBody);

  let canonicalContext = "";
  let anchorSeed = "";
  let previewSource = "";
  let transcriptSnapshot = "";

	if (Array.isArray(requestBody?.messages) && requestBody.messages.length > 0) {
    const messages = requestBody.messages as any[];
    const normalizedMessages = messages.map((msg) => messageLikeToText(msg));
    canonicalContext = normalizedMessages.join("\n");
    transcriptSnapshot = canonicalContext;

    const systemMessage = messages.find((msg) => String(msg?.role || "").toLowerCase() === "system");
    const firstUserMessage = messages.find((msg) => String(msg?.role || "").toLowerCase() === "user");
    const anchorMessages = [systemMessage, firstUserMessage]
      .filter(Boolean)
      .map((msg) => messageLikeToText(msg));

    anchorSeed = anchorMessages.join("\n");

    const latestUser = [...messages]
      .reverse()
      .find((msg) => String(msg?.role || "").toLowerCase() === "user");
    previewSource = extractText(latestUser?.content ?? latestUser) || canonicalContext;
  } else if (Array.isArray(requestBody?.input)) {
    // Codex /v1/responses: input is an array of {role, content} messages
    const messages = requestBody.input as any[];
    const normalizedMessages = messages.map((msg) => messageLikeToText(msg));
    canonicalContext = normalizedMessages.join("\n");
    transcriptSnapshot = canonicalContext;

    const systemMessage = messages.find((msg) => {
      const r = String(msg?.role || "").toLowerCase();
      return r === "system" || r === "developer";
    });
    const firstUserMessage = messages.find((msg) => String(msg?.role || "").toLowerCase() === "user");
    const anchorMessages = [systemMessage, firstUserMessage]
      .filter(Boolean)
      .map((msg) => messageLikeToText(msg));

    anchorSeed = anchorMessages.join("\n");

    const latestUser = [...messages]
      .reverse()
      .find((msg) => String(msg?.role || "").toLowerCase() === "user");
    previewSource = extractText(latestUser?.content ?? latestUser) || canonicalContext;
  } else if (requestBody?.input !== undefined) {
    // Codex /v1/responses with string input
    const inputText = extractText(requestBody.input);
    canonicalContext = normalizeWhitespace(inputText);
    anchorSeed = canonicalContext;
    previewSource = canonicalContext;
    transcriptSnapshot = canonicalContext;
  } else if (requestBody?.request?.contents && Array.isArray(requestBody.request.contents)) {
    // Antigravity wrapped Gemini format: { project, request: { contents: [{role, parts}] } }
    const messages = requestBody.request.contents as any[];
    const normalizedMessages = messages.map((msg: any) => {
      const role = msg.role === "model" ? "assistant" : msg.role === "function" ? "tool" : (msg.role || "user");
      const text = Array.isArray(msg.parts) ? msg.parts.map((p: any) => p.text || "").join("\n") : "";
      return `${role}:${normalizeWhitespace(text)}`;
    });
    canonicalContext = normalizedMessages.join("\n");
    transcriptSnapshot = canonicalContext;

    const firstUserMessage = messages.find((msg: any) => msg.role === "user");
    if (firstUserMessage) {
      const text = Array.isArray(firstUserMessage.parts)
        ? firstUserMessage.parts.map((p: any) => p.text || "").join("\n")
        : "";
      anchorSeed = `user:${normalizeWhitespace(text)}`;
    }

    const latestUser = [...messages].reverse().find((msg: any) => msg.role === "user");
    if (latestUser) {
      const text = Array.isArray(latestUser.parts)
        ? latestUser.parts.map((p: any) => p.text || "").join("\n")
        : "";
      previewSource = normalizeWhitespace(text) || canonicalContext;
    } else {
      previewSource = canonicalContext;
    }
  } else {
    canonicalContext = normalizeWhitespace(extractText(requestBody));
    anchorSeed = canonicalContext;
    previewSource = canonicalContext;
    transcriptSnapshot = canonicalContext;
  }

  // Truncate context to ~1M tokens max (4M chars) to prevent inflated estimates from base64/binary data
  if (canonicalContext.length > 4_000_000) {
    canonicalContext = canonicalContext.slice(0, 4_000_000);
  }

  const contextTokensBefore = canonicalContext ? estimateTokens(canonicalContext) : 0;
  const fingerprintSource = anchorSeed || canonicalContext;
  const contextFingerprint = fingerprintSource
    ? sha256(fingerprintSource.slice(0, 4000))
    : "";

  return {
    model,
    contextTokensBefore,
    contextFingerprint,
    requestPreview: truncate(normalizeWhitespace(previewSource || "")),
    requestToolNames,
    transcriptSnapshot,
  };
}

export function detectProvider(upstreamEndpoint: string, model: string): string {
  const endpoint = String(upstreamEndpoint || "").toLowerCase();
  const modelName = String(model || "").toLowerCase();

  if (endpoint.includes("api.openai.com")) return "openai";
  if (endpoint.includes("api.anthropic.com")) return "anthropic";
  if (endpoint.includes("generativelanguage.googleapis.com") || endpoint.includes("googleapis.com")) return "google";
  if (endpoint.includes("api.groq.com")) return "groq";
  if (endpoint.includes("api.deepseek.com")) return "deepseek";
  if (endpoint.includes("openrouter.ai")) return "openrouter";
  if (endpoint.includes("api.x.ai") || endpoint.includes("x.ai")) return "xai";

  if (modelName.startsWith("gpt") || modelName.startsWith("o1") || modelName.startsWith("o3")) return "openai";
  if (modelName.startsWith("claude")) return "anthropic";
  if (modelName.startsWith("gemini")) return "google";
  if (modelName.startsWith("deepseek")) return "deepseek";

  return "unknown";
}

export function detectOperatingSystem(userAgent: string, platformHint: string = ""): string {
  const ua = String(userAgent || "").toLowerCase();
  const platform = String(platformHint || "").toLowerCase();

  if (platform.includes("windows") || ua.includes("windows nt")) return "Windows";
  if (platform.includes("mac") || ua.includes("mac os") || ua.includes("macintosh")) return "macOS";
  if (platform.includes("linux") || ua.includes("linux")) return "Linux";
  if (platform.includes("android") || ua.includes("android")) return "Android";
  if (platform.includes("ios") || ua.includes("iphone") || ua.includes("ipad")) return "iOS";
  if (ua.includes("cros")) return "ChromeOS";
  return "Unknown";
}

function walkToolPayload(node: any, collector: Set<string>, depth: number) {
  if (!node || depth > 8) return;

  if (Array.isArray(node)) {
    for (const item of node) walkToolPayload(item, collector, depth + 1);
    return;
  }

  if (typeof node !== "object") return;

  if (Array.isArray(node.tool_calls)) {
    for (const call of node.tool_calls) {
      addToolName(collector, call?.function?.name);
      addToolName(collector, call?.name);
    }
  }

  if (node.function_call && typeof node.function_call === "object") {
    addToolName(collector, node.function_call.name);
  }

  addToolName(collector, node.tool_name);
  addToolName(collector, node.toolName);

  if (typeof node.type === "string") {
    const type = node.type.toLowerCase();
    if (type.includes("tool") || type.includes("function")) {
      addToolName(collector, node.name);
      addToolName(collector, node.function?.name);
    }
  }

  for (const value of Object.values(node)) {
    walkToolPayload(value, collector, depth + 1);
  }
}

export function extractToolNamesFromPayload(payload: any): string[] {
  const collector = new Set<string>();
  walkToolPayload(payload, collector, 0);
  return Array.from(collector);
}

export function mergeToolNames(...groups: string[][]): string[] {
  const tools = new Set<string>();
  for (const group of groups) {
    for (const tool of group) {
      addToolName(tools, tool);
    }
  }
  return Array.from(tools);
}

export function toToolJson(tools: string[]): string {
  return JSON.stringify(Array.from(new Set(tools.filter(Boolean))));
}

export function parseToolJson(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item)).filter(Boolean);
  } catch {
    return [];
  }
}

export function formatSqliteDate(date: Date = new Date()): string {
  return date.toISOString().replace("T", " ").substring(0, 19);
}
