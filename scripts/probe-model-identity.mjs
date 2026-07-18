#!/usr/bin/env node
/**
 * One-shot identity probe for online models via Tokito proxy.
 * Usage (on server or local with env):
 *   PROXY_BASE=https://api.tokito.xyz API_KEY=sk-proxy-... node scripts/probe-model-identity.mjs
 *   Or: node scripts/probe-model-identity.mjs --from-db  (SSH/server only, reads monit_api)
 */
import pg from "pg";

const PROXY_BASE = (process.env.PROXY_BASE || "https://api.tokito.xyz").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS) || 60_000;
const CONCURRENCY = Number(process.env.PROBE_CONCURRENCY) || 6;

async function getApiKeyFromDb() {
  const url =
    process.env.DATABASE_URL ||
    "postgresql://monit_api:rendang123pg@localhost:5432/monit_api";
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    const r = await pool.query(
      `SELECT key FROM api_keys WHERE is_active = true AND is_trial = false ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
    );
    return r.rows[0]?.key || null;
  } finally {
    await pool.end();
  }
}

async function getOnlineModelsFromDb() {
  const url =
    process.env.DATABASE_URL ||
    "postgresql://monit_api:rendang123pg@localhost:5432/monit_api";
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    const r = await pool.query(
      `SELECT DISTINCT ON (provider, model_id)
         provider, model_id, latency_ms, http_status
       FROM model_monitor
       WHERE is_online = true AND http_status = 200
       ORDER BY provider, model_id, checked_at DESC`,
    );
    return r.rows.map((row) => ({
      id: row.provider ? `${row.provider}/${row.model_id}` : row.model_id,
      provider: row.provider,
      modelId: row.model_id,
      latencyMs: row.latency_ms,
    }));
  } finally {
    await pool.end();
  }
}

async function listModelsFromApi(apiKey) {
  const res = await fetch(`${PROXY_BASE}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`/v1/models HTTP ${res.status}`);
  const json = await res.json();
  const data = Array.isArray(json?.data) ? json.data : [];
  return data
    .filter((m) => m?.is_online || m?.online)
    .map((m) => ({ id: m.id, provider: null, modelId: m.id }));
}

async function askIdentity(apiKey, modelId) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PROXY_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: "user",
            content:
              "Reply with ONLY your exact model name in one short line. No greeting.",
          },
        ],
        max_tokens: 48,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    const answer =
      body?.choices?.[0]?.message?.content ||
      body?.error?.message ||
      text.slice(0, 160);
    return { ok: res.ok, status: res.status, answer: String(answer).trim().slice(0, 200) };
  } catch (err) {
    return { ok: false, status: 0, answer: err?.message || "error" };
  } finally {
    clearTimeout(t);
  }
}

async function mapPool(items, limit, fn) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function main() {
  const fromDb = process.argv.includes("--from-db");
  let apiKey = process.env.API_KEY || "";
  if (!apiKey && fromDb) apiKey = (await getApiKeyFromDb()) || "";
  if (!apiKey) {
    console.error("Need API_KEY env or --from-db on server");
    process.exit(1);
  }

  let models;
  if (fromDb) {
    models = await getOnlineModelsFromDb();
    console.log(`[probe] ${models.length} online models from DB`);
  } else {
    models = await listModelsFromApi(apiKey);
    console.log(`[probe] ${models.length} online models from /v1/models`);
  }

  if (!models.length) {
    console.log("No online models to probe");
    return;
  }

  const results = await mapPool(models, CONCURRENCY, async (m) => {
    const r = await askIdentity(apiKey, m.id);
    const line = `${r.ok ? "OK" : "FAIL"} ${m.id} → ${r.answer.replace(/\s+/g, " ")}`;
    console.log(line);
    return { model: m.id, ...r };
  });

  const ok = results.filter((r) => r.ok).length;
  console.log(`\n[probe] done: ${ok}/${results.length} ok`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
