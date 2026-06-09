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
  // --- AI coding IDE/extensions (specific first) ---
  [/roocode|roo-code|roo[\s-]?cline/i, "Roo Code"],
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

  // --- Antigravity variants (IDE > Hub > CLI fallback) ---
  [/antigravity\/ide/i, "Antigravity IDE"],
  [/antigravity\/hub/i, "Antigravity Hub"],
  [/antigravity/i, "Antigravity CLI"],

  // --- AI agent platforms / proxy clients ---
  [/openclaw/i, "OpenClaw"],
  [/cli-proxy-openai-compat/i, "OpenClaw"],

  // --- SDK / HTTP clients ---
  [/openai-python/i, "OpenAI Python SDK"],
  [/openai-node/i, "OpenAI Node SDK"],
  [/python-requests|python\/requests/i, "Python Requests"],
  [/axios/i, "Axios"],
  [/node-fetch|undici/i, "Node Fetch"],
  [/Go-http-client/i, "Go HTTP Client"],
  [/curl/i, "curl"],

  // --- Browser / shell (low priority, catch-all) ---
  [/WindowsPowerShell|pwsh|PowerShell/i, "PowerShell"],

  // --- Bare Node.js (very low priority — must be last) ---
  [/^node$/i, "Node.js Client"],
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
 * Content-based IDE fallback detection.
 * When User-Agent is generic (e.g. "node"), inspect the request body
 * (system prompt, tool names, transcript) to identify the actual IDE/client.
 *
 * Call this ONLY when detectIde() returned "Unknown".
 */
export function detectIdeFromContent(requestBody: any, transcriptSnapshot?: string): string | null {
  if (!requestBody && !transcriptSnapshot) return null;

  // Check transcript / system messages for known IDE signatures
  const transcript = transcriptSnapshot || "";
  const messages: any[] = requestBody?.messages || requestBody?.input || [];
  const systemText = messages
    .filter((m: any) => m?.role === "system" || m?.role === "developer")
    .map((m: any) => (typeof m?.content === "string" ? m.content : ""))
    .join(" ")
    .slice(0, 5000);

  const searchText = (systemText + " " + transcript).toLowerCase();

  // OpenClaw — "running inside OpenClaw"
  if (searchText.includes("openclaw")) return "OpenClaw";

  // Codex CLI — "Codex desktop context" or "Codex (desktop) app" or codex sandbox_mode
  if (searchText.includes("codex desktop context") || searchText.includes("codex (desktop) app")) return "Codex CLI";

  // Check tool names for IDE fingerprints
  const tools: string[] = [];
  if (Array.isArray(requestBody?.tools)) {
    for (const t of requestBody.tools) {
      const name = t?.function?.name || t?.name || "";
      if (name) tools.push(name.toLowerCase());
    }
  }
  const toolSet = new Set(tools);

  // Codex CLI — uses exec_command, apply_patch, codex_app
  if (toolSet.has("codex_app") || toolSet.has("apply_patch") && toolSet.has("exec_command")) return "Codex CLI";

  // OpenCode — uses TodoWrite, Skill, Glob, Grep, Agent (exact OpenCode toolset)
  if (toolSet.has("todowrite") && toolSet.has("skill") && toolSet.has("glob")) return "OpenCode";
  if (toolSet.has("todowrite") && toolSet.has("webfetch") && toolSet.has("bash")) return "OpenCode";

  // Claude Code — uses Agent, TodoWrite, Bash but with TaskCreate/TaskGet
  if (toolSet.has("taskcreate") && toolSet.has("taskget") && toolSet.has("bash")) return "Claude Code";

  // Roo Code — uses apply_diff, attempt_completion, read_file, write_to_file
  if (toolSet.has("apply_diff") && toolSet.has("attempt_completion") && toolSet.has("read_file")) return "Roo Code";

  // Cline — uses read_file, write_to_file, execute_command, ask_followup_question (without apply_diff)
  if (toolSet.has("execute_command") && toolSet.has("read_file") && toolSet.has("ask_followup_question") && !toolSet.has("apply_diff")) return "Cline";

  // Kiro — uses update_plan, get_goal, create_goal
  if (toolSet.has("update_plan") && toolSet.has("get_goal")) return "Kiro";

  // Check system prompt for other IDE mentions
  if (searchText.includes("running inside opencode") || searchText.includes("you are opencode")) return "OpenCode";
  if (searchText.includes("claude code") || searchText.includes("claude desktop")) return "Claude Code";
  if (searchText.includes("running inside cursor") || searchText.includes("cursor ide")) return "Cursor";
  if (searchText.includes("roo code") || searchText.includes("roocode")) return "Roo Code";
  if (searchText.includes("cline")) return "Cline";
  if (searchText.includes("windsurf")) return "Windsurf";
  if (searchText.includes("aider")) return "Aider";

  return null;
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
  // Cap at 1M tokens — larger estimates are almost certainly inflated by base64/binary data
  return Math.min(Math.ceil(text.length / 4), 1_000_000);
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
