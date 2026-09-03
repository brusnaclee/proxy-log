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
	[/zoocode|zoo[\s_-]?code/i, "Zoo Code"],
	[/roocode|roo[\s_-]?code|roo[\s-]?cline/i, "Roo Code"],
	[/cline.*vscode/i, "Cline (VS Code)"],
	[/cline/i, "Cline"],
	// Codex VS Code uses `codex_vscode/...` (underscore) in real UAs
	[/codex[_-]?vscode|codex.*vscode/i, "Codex (VS Code)"],
	[/codex[_-]?cli/i, "Codex CLI"],
	[/codex/i, "Codex"],
	[/opencode.*vscode/i, "OpenCode (VS Code)"],
	[/opencode/i, "OpenCode"],
	// xAI Grok Build harness (grok-pager / grok-shell) — before body "n8n" false-positive
	[/grok-pager|grok-shell|grok.?build/i, "Grok Build"],
	// Trae can identify itself explicitly. Its observed bare `hertz` UA is only
	// ByteDance's generic Go HTTP stack, not proof of the IDE; classify that as
	// generic below and require a body marker/toolset before calling it Trae.
	[/\btrae\b/i, "Trae"],
	[/cursor/i, "Cursor"],
	[/pearai/i, "PearAI"],
	[/windsurf/i, "Windsurf"],
	[/continue.*vscode/i, "Continue (VS Code)"],
	[/continue/i, "Continue"],
	[/github-copilot|copilot/i, "GitHub Copilot"],
	[/9router|9-router/i, "9router"],
	[/omnirouter|omni-router/i, "OmniRouter"],
	[/\bglm[-/]/i, "GLM"],
	[/\bkiro\b/i, "Kiro"],
	[/kilo[\s_-]?code|kilo/i, "Kilo"],
	[/zcode\/|zcode|z-code/i, "ZCode"],
	[/tabby/i, "Tabby IDE"],
	[/codeium/i, "Codeium"],
	[/cody|sourcegraph/i, "Cody (Sourcegraph)"],
	[/supermaven/i, "Supermaven"],
	[/swe-bench|swe-agent/i, "SWE-Agent"],
	[/aider/i, "Aider"],
	[/neovim|nvim/i, "Neovim"],
	[/jetbrains|intellij|pycharm|webstorm|goland|rider|phpstorm|rubymine|clion|datagrip/i, "JetBrains"],
	[/vscode|visual\s*studio\s*code/i, "VS Code"],
	// Claude Code CLI before Desktop — `claude-cli` must not map to Desktop
	[/claude-cli/i, "Claude Code"],
	[/claude.*code/i, "Claude Code"],
	[/claude.*desktop|claude-desktop/i, "Claude Desktop"],

	// Zed editor (UA is often `Zed/1.x+stable…`)
	[/^zed\/|zed\/|\bzed\.dev\b/i, "Zed"],

	// Pi coding agent (`pi/0.80.x (linux; node/…)`)
	[/^pi\/|\bpi\/\d/i, "Pi Agent"],

	// Internal Tokito probes
	[/tokitoprobe|tokitocompare/i, "Tokito Probe"],

	// Antigravity variants (IDE > Hub > CLI fallback)
	[/antigravity\/ide/i, "Antigravity IDE"],
	[/antigravity\/hub/i, "Antigravity Hub"],
	[/antigravity/i, "Antigravity CLI"],

	// --- AI agent platforms / proxy clients ---
	[/openclaw/i, "OpenClaw"],
	[/cli-proxy-openai-compat/i, "OpenClaw"],
	[/hermes-agent|hermes\//i, "Hermes"],
	[/litellm/i, "LiteLLM"],
	[/anthropic\/python|anthropic-python/i, "Anthropic Python SDK"],
	// Claude Desktop Electron UA embeds Claude/… Electron
	[/Claude\/[\d.]+.*Electron|Electron\/[\d.]+.*Claude/i, "Claude Desktop"],

	// --- SDK / HTTP clients ---
	[/asyncopenai|openai\/python|openai-python/i, "OpenAI Python SDK"],
	[/openai\/js|openai-node|openai.*node/i, "OpenAI Node SDK"],
	[/openai\/go|openai-go/i, "OpenAI Go SDK"],
	[/openai\/(python|js|node|go)/i, "OpenAI SDK"],
	[/python\/\d+\.\d+.*aiohttp|aiohttp\/\d/i, "Python aiohttp"],
	[/python-requests|python\/requests|python-urllib|python-httpx/i, "Python Requests"],
	[/axios/i, "Axios"],
	[/node-fetch|undici/i, "Node Fetch"],
	[/^bun\/|\bbun\/\d/i, "Bun Client"],
	[/okhttp/i, "OkHttp Client"],
	[/postmanruntime|postman/i, "Postman"],
	[/Go-http-client|go-resty/i, "Go HTTP Client"],
	[/^hertz(\/|$)/i, "Hertz Client"],
	[/curl/i, "curl"],

	// --- Browser / shell (low priority, catch-all) ---
	[/WindowsPowerShell|pwsh|PowerShell/i, "PowerShell"],
	[/Mozilla\/5\.0.*Chrome|AppleWebKit.*Safari/i, "Browser Client"],

	// --- Bare Node.js (very low priority — must be last) ---
	[/^node$/i, "Node.js Client"],
];

/** Generic UA labels that usually hide a real IDE — run content detection. */
export const GENERIC_IDE_LABELS = new Set([
	"unknown",
	"node.js client",
	"node fetch",
	"openai sdk",
	"openai python sdk",
	"openai node sdk",
	"openai go sdk",
	"python requests",
	"python aiohttp",
	"axios",
	"curl",
	"go http client",
	"hertz client",
	"powershell",
	"browser client",
	"vs code",
	"bun client",
	"okhttp client",
	"postman",
	"tokito probe",
	"pi agent",
	"litellm",
	"anthropic python sdk",
]);

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

	// Also check user message content for patterns
	const userMessages = messages
		.filter((m: any) => m?.role === "user")
		.map((m: any) => (typeof m?.content === "string" ? m.content : ""))
		.join(" ")
		.slice(0, 3000);

	const searchText = (systemText + " " + userMessages + " " + transcript).toLowerCase();

	// === OPENCLAW patterns (before generic node/claude) ===
	if (searchText.includes("openclaw")) return "OpenClaw";
	if (searchText.includes("[openclaw")) return "OpenClaw";
	if (searchText.includes("[cron:")) return "OpenClaw";
	if (searchText.includes("openclaw heartbeat") || searchText.includes("[openclaw heartbeat")) return "OpenClaw";
	if (searchText.includes("openclaw runtime context")) return "OpenClaw";
	if (searchText.includes("read heartbeat.md") || searchText.includes("heartbeat.md if it exists")) return "OpenClaw";
	if (searchText.includes("mt5") && searchText.includes("monitor")) return "OpenClaw";
	if (searchText.includes("whatsapp gateway")) return "OpenClaw";

	// === CURSOR agent tool dumps (before Claude <system_reminder>) ===
	if (searchText.includes("called the read tool with the following input")) return "Cursor";
	if (searchText.includes("called the write tool with the following input")) return "Cursor";
	if (searchText.includes("called the grep tool with the following input")) return "Cursor";
	if (searchText.includes("<user_query>") && searchText.includes("called the ")) return "Cursor";

	// === RALPH AGENT ===
	if (searchText.includes("ralph agent")) return "Ralph Agent";
	if (searchText.includes("# ralph agent instructions")) return "Ralph Agent";

	// === PI AGENT ===
	if (searchText.includes("you are pi") || searchText.includes("pi coding agent")) return "Pi Agent";

	// === HERMES patterns ===
	if (searchText.includes("hermes-agent")) return "Hermes";
	if (searchText.includes("[subagent context]")) return "Hermes";
	if (searchText.includes("[retry after the previous model attempt")) return "Hermes";
	if (searchText.includes("hermes/cache/documents")) return "Hermes";

	// === Grok Build (body markers; UA handled in IDE_PATTERNS) ===
	if (searchText.includes("grok-pager") || searchText.includes("grok-shell")) return "Grok Build";

	// === N8N Workflow ===
	if (searchText.includes("n8n")) return "n8n Workflow";

	// === ZED editor ===
	if (searchText.includes("zed.dev")) return "Zed";
	if (searchText.includes("[zed]")) return "Zed";

	// === TRAE (ByteDance) — before OpenCode, whose TodoWrite/Skill/Glob rule matches too ===
	if (searchText.includes("<trae_command>")) return "Trae";
	if (searchText.includes("<trae_rule>") || searchText.includes("trae_agent")) return "Trae";

	// === OPENCODEMULTI patterns ===
	if (searchText.includes("you are opencode") || searchText.includes("you are an opencode")) return "OpenCode";
	if (searchText.includes("interactive cli tool that helps")) return "OpenCode";
	if (searchText.includes(".opencode/plans") || searchText.includes("/.opencode/")) return "OpenCode";
	if (searchText.includes("read your plan at") && searchText.includes("opencode")) return "OpenCode";

	// === CLAUDE CODE patterns (specific markers) ===
	if (searchText.includes("<session>") && searchText.includes("you are fixing pr")) return "Claude Code";
	if (searchText.includes("<system_reminder>")) return "Claude Code";
	if (searchText.includes("<current_user_request>")) return "Claude Code";
	if (searchText.includes("<user_request>")) return "Claude Code";
	if (searchText.includes("exited plan mode") || searchText.includes("re-entering plan mode")) return "Claude Code";
	if (searchText.includes("exited auto mode") || searchText.includes("re-entering auto mode")) return "Claude Code";
	if (searchText.includes("claudemd") && searchText.includes("currentdate")) return "Claude Code";
	if (searchText.includes("mcp server instructions") && !searchText.includes("called the read tool")) return "Claude Code";
	if (searchText.includes("async delegation batch complete")) return "Claude Code";
	if (searchText.includes("background fan-out")) return "Claude Code";
	if (searchText.includes("prompt limits global:")) return "Claude Code";
	if (searchText.includes("token limits harian")) return "Claude Code";

	// === Continue extension (MCP-based IDE) ===
	if (searchText.includes("continue") && searchText.includes("mcp")) return "Continue";
	if (searchText.includes("continue extension")) return "Continue";

	// === ZOO CODE (Cline fork) ===
	if (searchText.includes("zoo code") || searchText.includes("zoocode")) return "Zoo Code";
	if (searchText.includes("extension version:") && searchText.includes("write_to_file") && searchText.includes("zoo")) {
		return "Zoo Code";
	}

	// === ROO CODE patterns ===
	if (searchText.includes("attempt_completion")) return "Roo Code";
	if (searchText.includes("roocode")) return "Roo Code";
	if (searchText.includes("roo-code")) return "Roo Code";
	if (searchText.includes("<tool_response>")) return "Roo Code";

	// === Cline patterns ===
	if (searchText.includes("[read_file for")) return "Cline";
	if (searchText.includes("[search_files for")) return "Cline";
	if (searchText.includes("[execute_command for")) return "Cline";
	if (searchText.includes("[write_to_file for")) return "Cline";
	if (searchText.includes("[duplicate read]")) return "Cline";

	// === GENERIC AGENT patterns ===
	if (searchText.includes("<system-message>") || searchText.includes("<system_message>")) return "Generic Agent";
	if (searchText.includes("deeppresenter")) return "DeepPresenter";
	if (searchText.includes("brainstorm companion")) return "Brainstorm Companion";
	if (searchText.includes("[role:")) return "Generic Agent";

	// === 9Router / OmniRouter ===
	if (searchText.includes("via provider 9router")) return "9Router";
	if (searchText.includes("active model for this chat has changed to")) return "9Router";

	// === Gemini specific ===
	if (searchText.includes("gemini") && searchText.includes("google")) return "Gemini";

	// === MCP Client ===
	if (searchText.includes("_mcp_server")) return "MCP Client";

	// === Codex CLI ===
	if (searchText.includes("codex desktop context") || searchText.includes("codex (desktop) app")) return "Codex CLI";

	// === Tool-based detection ===
	const tools: string[] = [];
	if (Array.isArray(requestBody?.tools)) {
		for (const t of requestBody.tools) {
			const name = t?.function?.name || t?.name || "";
			if (name) tools.push(name.toLowerCase());
		}
	}
	const toolSet = new Set(tools);

	// Codex CLI
	if (toolSet.has("codex_app") || (toolSet.has("apply_patch") && toolSet.has("exec_command"))) return "Codex CLI";

	// Trae — SearchCodebase combined with its preview/MCP surface, or its full
	// goal-tool trio, are high-confidence fingerprints observed alongside the
	// literal <trae_command> marker. Avoid inferring Trae from generic command
	// runner tools alone; several agents expose those.
	// Must precede OpenCode: Trae also ships TodoWrite + Skill + Glob.
	if (toolSet.has("searchcodebase") && (toolSet.has("openpreview") || toolSet.has("run_mcp"))) return "Trae";
	if (toolSet.has("create_goal") && toolSet.has("update_goal") && toolSet.has("get_goal")) return "Trae";

	// OpenCode — uses TodoWrite, Skill, Glob, Grep, Agent
	if (toolSet.has("todowrite") && toolSet.has("skill") && toolSet.has("glob")) return "OpenCode";
	if (toolSet.has("todowrite") && toolSet.has("webfetch") && toolSet.has("bash")) return "OpenCode";

	// Claude Code — uses Agent, TaskCreate/TaskGet
	if (toolSet.has("taskcreate") && toolSet.has("taskget") && toolSet.has("bash")) return "Claude Code";

	// Roo Code — uses apply_diff, attempt_completion
	if (toolSet.has("apply_diff") && toolSet.has("attempt_completion") && toolSet.has("read_file")) return "Roo Code";

	// Cline — uses ask_followup_question (without apply_diff)
	if (toolSet.has("execute_command") && toolSet.has("read_file") && toolSet.has("ask_followup_question") && !toolSet.has("apply_diff")) return "Cline";

	// Kiro
	if (toolSet.has("update_plan") && toolSet.has("get_goal")) return "Kiro";

	// Windsurf
	if (toolSet.has("windsurf") || searchText.includes("windsurf")) return "Windsurf";

	// === String-based system prompt checks ===
	if (searchText.includes("running inside opencode") || searchText.includes("you are opencode")) return "OpenCode";
	if (searchText.includes("claude code") || searchText.includes("claude desktop")) return "Claude Code";
	if (searchText.includes("running inside cursor") || searchText.includes("cursor ide")) return "Cursor";
	if (searchText.includes("roo code") || searchText.includes("roocode")) return "Roo Code";
	if (searchText.includes("cline")) return "Cline";
	if (searchText.includes("windsurf")) return "Windsurf";
	if (searchText.includes("aider")) return "Aider";

	// === Final fallback checks ===
	if (searchText.includes("exited plan mode") || searchText.includes("re-entering plan mode")) return "Claude Code";
	if (searchText.includes("exited auto mode") || searchText.includes("re-entering auto mode")) return "Claude Code";

	// === ZCode IDE (Windows AI coding tool) ===
	if (searchText.includes("zcode") || searchText.includes("z-code")) return "ZCode";
	if (searchText.includes("using-superpowers")) return "ZCode";
	if (searchText.includes("/superpowers/skill")) return "ZCode";
	if (searchText.includes("fitstamp")) return "ZCode";

	// === STAMP/FitStamp patterns ===
	if (searchText.includes("fitstamp")) return "FitStamp";

	// === Generic agent (non-Code) ===
	if (searchText.includes("polymarket")) return "Polymarket Trader";
	if (searchText.includes("quantitative trader")) return "Trading Bot";
	if (searchText.includes("binary markets")) return "Trading Bot";

	// === ZCode CLI ===
	if (searchText.includes("/model")) return "ZCode";
	if (searchText.includes("/init")) return "ZCode";
	if (searchText.includes("<command-name>")) return "ZCode";

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
