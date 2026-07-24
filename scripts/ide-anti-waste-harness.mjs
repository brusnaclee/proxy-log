#!/usr/bin/env node
/**
 * IDE anti-waste smoke harness (fixture-based).
 * Prefer: pnpm --filter proxy test  (covers the same scenarios in anti-waste.test.ts)
 *
 * Usage:
 *   node scripts/ide-anti-waste-harness.mjs
 * Optional live proxy (requires PROXY_URL + PROXY_API_KEY):
 *   PROXY_URL=https://api.tokito.xyz PROXY_API_KEY=sk-... node scripts/ide-anti-waste-harness.mjs --live
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const live = process.argv.includes("--live");

if (!live) {
  console.log("Running proxy unit harness (detect-ide + anti-waste ×10 prompts/IDE)…");
  const r = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsx", "--test", "src/utils/detect-ide.test.ts", "src/utils/anti-waste.test.ts"],
    { cwd: path.join(root, "packages/proxy"), stdio: "inherit", shell: true },
  );
  process.exit(r.status ?? 1);
}

const base = process.env.PROXY_URL || "https://api.tokito.xyz";
const key = process.env.PROXY_API_KEY;
if (!key) {
  console.error("PROXY_API_KEY required for --live");
  process.exit(1);
}

const profiles = [
  { ide: "Cline", ua: "Cline/1.0" },
  { ide: "Cursor", ua: "Cursor/1.0" },
  { ide: "OpenCode", ua: "opencode/1.0" },
  { ide: "Zed", ua: "Zed/1.9.0+stable.test" },
  { ide: "Node", ua: "node" },
];

async function onePrompt(ua, n) {
  const body = {
    model: "auto",
    stream: false,
    messages: [
      { role: "user", content: `harness ping ${n} — reply with pong${n}` },
    ],
  };
  const res = await fetch(`${base.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "User-Agent": ua,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, ok: res.ok };
}

for (const p of profiles) {
  console.log(`\n=== Live 10 prompts: ${p.ide} (${p.ua}) ===`);
  for (let i = 0; i < 10; i++) {
    const r = await onePrompt(p.ua, i);
    console.log(`  #${i + 1} status=${r.status} ok=${r.ok}`);
    if (!r.ok) process.exitCode = 1;
  }
}
