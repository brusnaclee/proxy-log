/**
 * Live IDE protocol smoke against production proxy.
 * Usage: PROXY_API_KEY=sk-... node scripts/live-ide-smoke.mjs
 */
const BASE = (process.env.PROXY_BASE || "https://api.tokito.xyz").replace(/\/$/, "");
const KEY = process.env.PROXY_API_KEY;
const MODEL = process.env.PROXY_MODEL || "auto";
const PROMPTS = Math.min(5, Math.max(1, Number(process.env.PROMPTS_PER_IDE) || 2));

if (!KEY) {
  console.error("PROXY_API_KEY required");
  process.exit(1);
}

/** @type {{name:string, ua:string, body?:(n:number)=>any}[]} */
const IDES = [
  { name: "Cline", ua: "Cline/2.0.0" },
  { name: "Roo Code", ua: "RooCode/1.0.0" },
  { name: "Continue", ua: "Continue/1.0.0" },
  { name: "Cursor", ua: "Cursor/1.0.0" },
  { name: "OpenCode", ua: "opencode/1.0.0" },
  { name: "Claude Code", ua: "claude-cli/1.0.0" },
  { name: "Claude Desktop", ua: "Mozilla/5.0 Claude/1.20186.1 Chrome/148.0.7778.271 Electron/42.5.1 Safari/537.36" },
  { name: "OpenClaw", ua: "openclaw/1.0.0" },
  { name: "Kilo", ua: "kilo-code/1.0.0" },
  { name: "Hermes", ua: "hermes-agent/1.0.0" },
  { name: "Zed", ua: "Zed/1.9.0+stable.316.test (macos; aarch64)" },
  { name: "ZCode", ua: "ZCode/3.3.4 ai/6.0.193" },
  { name: "Codex", ua: "codex/1.0.0" },
  { name: "Codex CLI", ua: "codex_cli/1.0.0" },
  { name: "Antigravity IDE", ua: "antigravity/ide/1.0" },
  { name: "Windsurf", ua: "Windsurf/1.0.0" },
  { name: "Kiro", ua: "kiro/1.0.0" },
  { name: "GitHub Copilot", ua: "GitHub-Copilot/1.0" },
  { name: "Bun Client", ua: "Bun/1.3.14" },
  { name: "LiteLLM", ua: "litellm/1.93.0" },
  { name: "OpenAI Go SDK", ua: "OpenAI/Go 3.15.0" },
  { name: "OpenAI Node SDK", ua: "OpenAI/JS 6.26.0" },
  { name: "OpenAI Python SDK", ua: "OpenAI/Python 2.24.0" },
  { name: "Anthropic Python SDK", ua: "Anthropic/Python 0.117.0" },
  { name: "Pi Agent", ua: "pi/0.80.3 (linux; node/v24.11.0; x64)" },
  { name: "Tokito Probe", ua: "TokitoProbe/1.0 (Windows NT 10.0; Win64; x64)" },
  { name: "Postman", ua: "PostmanRuntime/7.54.0" },
  { name: "OkHttp Client", ua: "okhttp/4.9.2" },
  { name: "Node.js Client", ua: "node" },
  { name: "Browser Client", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36" },
  { name: "curl", ua: "curl/8.5.0" },
];

async function one(ua, n, name) {
  const body = {
    model: MODEL,
    stream: false,
    max_tokens: 16,
    messages: [
      {
        role: "user",
        content: `Reply with exactly one token: PONG-${name.replace(/\s+/g, "")}-${n}`,
      },
    ],
  };
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        "User-Agent": ua,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    const text = await res.text();
    let preview = "";
    try {
      const j = JSON.parse(text);
      preview = j?.choices?.[0]?.message?.content || j?.error?.message || text.slice(0, 80);
    } catch {
      preview = text.slice(0, 80);
    }
    return {
      status: res.status,
      ok: res.ok,
      ms: Date.now() - t0,
      preview: String(preview).replace(/\s+/g, " ").slice(0, 100),
    };
  } catch (e) {
    return { status: 0, ok: false, ms: Date.now() - t0, preview: String(e.message || e).slice(0, 100) };
  }
}

const summary = [];
console.log(`Live smoke ${IDES.length} IDEs × ${PROMPTS} prompts → ${BASE} model=${MODEL}\n`);

for (const ide of IDES) {
  const rows = [];
  for (let i = 1; i <= PROMPTS; i++) {
    const r = await one(ide.ua, i, ide.name);
    rows.push(r);
    const mark = r.ok ? "OK" : "FAIL";
    console.log(`[${mark}] ${ide.name} #${i} status=${r.status} ${r.ms}ms :: ${r.preview}`);
  }
  const pass = rows.filter((r) => r.ok).length;
  summary.push({ name: ide.name, pass, total: PROMPTS, fail: PROMPTS - pass });
}

console.log("\n======== SUMMARY ========");
let allPass = 0;
let allFail = 0;
for (const s of summary) {
  const mark = s.fail === 0 ? "PASS" : "FAIL";
  console.log(`${mark}  ${s.name}: ${s.pass}/${s.total}`);
  allPass += s.pass;
  allFail += s.fail;
}
console.log(`\nTOTAL ${allPass} ok / ${allFail} fail (${allPass + allFail} requests)`);
process.exit(allFail > 0 ? 1 : 0);
