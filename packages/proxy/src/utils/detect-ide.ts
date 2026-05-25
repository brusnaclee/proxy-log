/**
 * IDE Detection from User-Agent header
 * 
 * Different AI coding tools send distinctive User-Agent strings:
 * - Cursor: contains "Cursor" or "cursor"
 * - VS Code / Continue: contains "vscode" or "Visual Studio Code"
 * - JetBrains: contains "JetBrains" or "IntelliJ" or "PyCharm" etc.
 * - Windsurf: contains "Windsurf" or "windsurf"
 * - Neovim: contains "Neovim" or "nvim"
 * - Cline: contains "Cline"
 * - Aider: contains "aider"
 * - OpenAI SDK: contains "OpenAI"
 */

interface IdeInfo {
  name: string;
  raw: string;
}

const IDE_PATTERNS: [RegExp, string][] = [
  [/cline.*vscode/i, "Cline (VS Code)"],
  [/cline/i, "Cline"],
  [/codex.*vscode/i, "Codex (VS Code)"],
  [/codex/i, "Codex"],
  [/opencode.*vscode/i, "OpenCode (VS Code)"],
  [/opencode/i, "OpenCode"],
  [/cursor/i, "Cursor"],
  [/pearai/i, "PearAI"],
  [/windsurf/i, "Windsurf"],
  [/continue.*vscode/i, "Continue (VS Code)"],
  [/continue/i, "Continue"],
  [/github-copilot|copilot/i, "GitHub Copilot"],
  [/9router|9-router/i, "9router"],
  [/omnirouter|omni-router/i, "OmniRouter"],
  [/glm/i, "GLM"],
  [/kiro/i, "Kiro"],
  [/kilo/i, "Kilo"],
  [/tabby/i, "Tabby IDE"],
  [/codeium/i, "Codeium"],
  [/cody|sourcegraph/i, "Cody (Sourcegraph)"],
  [/supermaven/i, "Supermaven"],
  [/swe-bench|swe-agent/i, "SWE-Agent"],
  [/aider/i, "Aider"],
  [/neovim|nvim/i, "Neovim"],
  [/jetbrains|intellij|pycharm|webstorm|goland|rider|phpstorm|rubymine|clion|datagrip/i, "JetBrains"],
  [/vscode|visual\s*studio\s*code/i, "VS Code"],
  [/claude/i, "Claude Desktop"],
  [/openai-python/i, "OpenAI Python SDK"],
  [/openai-node/i, "OpenAI Node SDK"],
  [/python-requests/i, "Python Requests"],
  [/axios/i, "Axios"],
  [/node-fetch|undici/i, "Node Fetch"],
  [/curl/i, "curl"],
];

/**
 * Detect IDE/client from User-Agent string
 */
export function detectIde(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown";

  for (const [pattern, name] of IDE_PATTERNS) {
    if (pattern.test(userAgent)) {
      return name;
    }
  }

  return "Unknown";
}

/**
 * Normalize IDE/client name into a stable lowercase key for policy checks.
 */
export function normalizeIdeName(ideName: string | null | undefined): string {
  return (ideName || "unknown").trim().toLowerCase();
}

/**
 * Estimate token count from text using the ~4 chars per token heuristic
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract client IP from request headers
 */
export function getClientIp(headers: Headers, fallback?: string): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    fallback ||
    "unknown"
  );
}
