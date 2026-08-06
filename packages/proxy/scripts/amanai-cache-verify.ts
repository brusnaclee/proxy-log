/**
 * Multi-hop Amanai cache verify harness.
 *
 * Env:
 *   PROXY_BASE          default http://127.0.0.1:3000
 *   PROXY_KEY           sk-proxy-… (routes to phantom/amanai)
 *   AMANAI_VERIFY_KEY   sk-amanai-… (same account as upstream for /v1/usage)
 *   HOP_COUNT           default 12
 *   DATABASE_URL        optional — if set, summarize request_logs after run
 *
 *   cd packages/proxy && pnpm exec tsx scripts/amanai-cache-verify.ts
 */
import { estimateAmanaiCreditsForLogRow } from "../src/utils/amanai-credits.js";

const PROXY_BASE = (process.env.PROXY_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const PROXY_KEY = process.env.PROXY_KEY || "";
const AMANAI_KEY = process.env.AMANAI_VERIFY_KEY || "";
const HOP_COUNT = Math.max(4, Math.min(20, Number(process.env.HOP_COUNT) || 12));
const TAG = `amanai-cache-verify-${Date.now()}`;

const SYSTEM = [
	"You are a coding agent running inside an IDE.",
	"Follow tool protocols strictly. Prefer concise replies.",
	"Stable system prompt block for cache prefix testing — ".padEnd(800, "x"),
	"Project context: monit_api Groupy proxy Hono Drizzle PostgreSQL Discord bot.",
	"Do not invent secrets. When asked to use tools, call them with valid JSON.",
].join("\n");

const TOOLS_OPENAI = [
	{
		type: "function",
		function: {
			name: "read_file",
			description: "Read a file from the workspace",
			parameters: {
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "list_dir",
			description: "List directory entries",
			parameters: {
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "run_terminal",
			description: "Run a shell command",
			parameters: {
				type: "object",
				properties: { command: { type: "string" } },
				required: ["command"],
			},
		},
	},
];

const TOOLS_ANTHROPIC = TOOLS_OPENAI.map((t) => ({
	name: t.function.name,
	description: t.function.description,
	input_schema: t.function.parameters,
}));

type HopStat = {
	hop: number;
	path: string;
	model: string;
	ok: boolean;
	status: number;
	prompt?: number;
	cached?: number;
	completion?: number;
	error?: string;
};

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

async function amanaiUsage(): Promise<{ credit_used: number; credit_remaining: number; raw: any }> {
	if (!AMANAI_KEY) return { credit_used: 0, credit_remaining: 0, raw: { skipped: true } };
	const res = await fetch("https://api.amanai.dev/v1/usage", {
		headers: { Authorization: `Bearer ${AMANAI_KEY}` },
	});
	const raw = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(`amanai /v1/usage ${res.status}: ${JSON.stringify(raw)}`);
	return {
		credit_used: Number(raw.credit_used) || 0,
		credit_remaining: Number(raw.credit_remaining) || 0,
		raw,
	};
}

function extractOpenAIUsage(body: any): { prompt: number; cached: number; completion: number } {
	const u = body?.usage || {};
	const prompt = Number(u.prompt_tokens) || 0;
	const cached = Number(u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens) || 0;
	const completion = Number(u.completion_tokens) || 0;
	return { prompt, cached, completion };
}

function extractAnthropicUsage(body: any): { prompt: number; cached: number; completion: number } {
	const u = body?.usage || {};
	const input = Number(u.input_tokens) || 0;
	const cached = Number(u.cache_read_input_tokens) || 0;
	const created = Number(u.cache_creation_input_tokens) || 0;
	const completion = Number(u.output_tokens) || 0;
	return { prompt: input + cached + created, cached, completion };
}

async function openaiHop(
	model: string,
	messages: any[],
	hop: number,
): Promise<{ stat: HopStat; messages: any[] }> {
	const res = await fetch(`${PROXY_BASE}/v1/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${PROXY_KEY}`,
			"Content-Type": "application/json",
			"User-Agent": `AmanaiCacheVerify/1.0 (${TAG})`,
		},
		body: JSON.stringify({
			model,
			messages,
			tools: TOOLS_OPENAI,
			stream: false,
			max_tokens: 256,
			temperature: 0,
		}),
	});
	const text = await res.text();
	let body: any = {};
	try {
		body = JSON.parse(text);
	} catch {
		body = { raw: text.slice(0, 500) };
	}
	const usage = extractOpenAIUsage(body);
	const msg = body?.choices?.[0]?.message;
	const next = [...messages];
	if (msg) {
		next.push(msg);
		if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
			for (const tc of msg.tool_calls) {
				next.push({
					role: "tool",
					tool_call_id: tc.id,
					content: JSON.stringify({
						ok: true,
						hop,
						tag: TAG,
						path: tc.function?.name === "list_dir" ? ["a.ts", "b.ts"] : "file contents " + "y".repeat(120),
					}),
				});
			}
		} else {
			next.push({
				role: "user",
				content: `Continue hop ${hop + 1}/${HOP_COUNT}. Use a tool if helpful. tag=${TAG}`,
			});
		}
	} else {
		next.push({
			role: "user",
			content: `Retry hop ${hop}. tag=${TAG}`,
		});
	}
	return {
		stat: {
			hop,
			path: "openai",
			model,
			ok: res.ok,
			status: res.status,
			prompt: usage.prompt,
			cached: usage.cached,
			completion: usage.completion,
			error: res.ok ? undefined : text.slice(0, 300),
		},
		messages: next,
	};
}

async function anthropicHop(
	model: string,
	messages: any[],
	hop: number,
): Promise<{ stat: HopStat; messages: any[] }> {
	const res = await fetch(`${PROXY_BASE}/v1/messages`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${PROXY_KEY}`,
			"x-api-key": PROXY_KEY,
			"anthropic-version": "2023-06-01",
			"Content-Type": "application/json",
			"User-Agent": `AmanaiCacheVerify/1.0 (${TAG})`,
		},
		body: JSON.stringify({
			model,
			system: SYSTEM,
			messages,
			tools: TOOLS_ANTHROPIC,
			stream: false,
			max_tokens: 256,
			temperature: 0,
		}),
	});
	const text = await res.text();
	let body: any = {};
	try {
		body = JSON.parse(text);
	} catch {
		body = { raw: text.slice(0, 500) };
	}
	const usage = extractAnthropicUsage(body);
	const next = [...messages];
	const content = body?.content || [];
	const toolUses = content.filter((b: any) => b.type === "tool_use");
	if (toolUses.length > 0) {
		next.push({ role: "assistant", content });
		next.push({
			role: "user",
			content: toolUses.map((tu: any) => ({
				type: "tool_result",
				tool_use_id: tu.id,
				content: JSON.stringify({ ok: true, hop, tag: TAG, data: "z".repeat(120) }),
			})),
		});
	} else {
		next.push({
			role: "user",
			content: `Continue hop ${hop + 1}/${HOP_COUNT}. Call a tool if useful. tag=${TAG}`,
		});
	}
	return {
		stat: {
			hop,
			path: "anthropic",
			model,
			ok: res.ok,
			status: res.status,
			prompt: usage.prompt,
			cached: usage.cached,
			completion: usage.completion,
			error: res.ok ? undefined : text.slice(0, 300),
		},
		messages: next,
	};
}

function summarize(label: string, hops: HopStat[], creditDelta: number) {
	const ok = hops.filter((h) => h.ok);
	const sumPrompt = ok.reduce((s, h) => s + (h.prompt || 0), 0);
	const sumCached = ok.reduce((s, h) => s + (h.cached || 0), 0);
	const sumComp = ok.reduce((s, h) => s + (h.completion || 0), 0);
	const fullIn = sumPrompt; // OpenAI-shaped total from response (includes cache in prompt for our openai extract)
	// For openai extract: prompt is total, cached is subset. Billable = prompt - cached.
	// For anthropic extract we already set prompt = input+cache.
	const billable = ok.reduce((s, h) => s + Math.max((h.prompt || 0) - (h.cached || 0), 0), 0);
	const model = ok[0]?.model || hops[0]?.model || "";
	let est = 0;
	for (const h of ok) {
		const bill = Math.max((h.prompt || 0) - (h.cached || 0), 0);
		est += estimateAmanaiCreditsForLogRow({
			model,
			promptTokens: bill,
			cachedTokens: h.cached || 0,
			completionTokens: h.completion || 0,
		}).credits;
	}
	const cachePct = fullIn > 0 ? ((sumCached / fullIn) * 100).toFixed(1) : "0.0";
	const match =
		creditDelta <= 0
			? "n/a"
			: Math.abs(est - creditDelta) / Math.max(creditDelta, 1) < 0.25
				? "close"
				: "differs";
	return {
		label,
		hops: ok.length,
		fail: hops.length - ok.length,
		sum_prompt_total: sumPrompt,
		sum_cached: sumCached,
		sum_billable: billable,
		sum_completion: sumComp,
		cache_hit_pct: cachePct,
		est_credits: est,
		amanai_credit_delta: creditDelta,
		match,
	};
}

async function runBatch(
	label: string,
	model: string,
	path: "openai" | "anthropic",
): Promise<{ summary: any; hops: HopStat[] }> {
	const before = await amanaiUsage();
	const hops: HopStat[] = [];
	if (path === "openai") {
		let messages: any[] = [
			{ role: "system", content: SYSTEM },
			{ role: "user", content: `Start multi-hop agent task. tag=${TAG}. List the project root with a tool.` },
		];
		for (let i = 1; i <= HOP_COUNT; i++) {
			const { stat, messages: next } = await openaiHop(model, messages, i);
			hops.push(stat);
			messages = next;
			if (!stat.ok) break;
			await sleep(200);
		}
	} else {
		let messages: any[] = [
			{ role: "user", content: `Start multi-hop agent task. tag=${TAG}. List the project root with a tool.` },
		];
		for (let i = 1; i <= HOP_COUNT; i++) {
			const { stat, messages: next } = await anthropicHop(model, messages, i);
			hops.push(stat);
			messages = next;
			if (!stat.ok) break;
			await sleep(200);
		}
	}
	await sleep(800);
	const after = await amanaiUsage();
	const delta = after.credit_used - before.credit_used;
	return { summary: summarize(label, hops, delta), hops };
}

async function main() {
	if (!PROXY_KEY) {
		console.error("PROXY_KEY required");
		process.exit(1);
	}
	console.log(JSON.stringify({ tag: TAG, PROXY_BASE, hops: HOP_COUNT, hasAmanaiKey: !!AMANAI_KEY }, null, 2));

	const models = {
		glm: process.env.MODEL_GLM || "phantom/amanai/glm-5.2",
		gpt: process.env.MODEL_GPT || "phantom/amanai/gpt-5.4-mini",
		claude: process.env.MODEL_CLAUDE || "phantom/amanai/claude-haiku-4.5",
	};

	const rows: any[] = [];
	const allHops: HopStat[] = [];

	for (const [label, model] of [
		["glm-openai", models.glm],
		["gpt-openai", models.gpt],
	] as const) {
		console.log(`\n=== ${label} ${model} ===`);
		const { summary, hops } = await runBatch(label, model, "openai");
		rows.push(summary);
		allHops.push(...hops);
		console.log(JSON.stringify(summary, null, 2));
		const failed = hops.find((h) => !h.ok);
		if (failed) console.log("first failure:", failed.error);
	}

	console.log(`\n=== claude-anthropic ${models.claude} ===`);
	{
		const { summary, hops } = await runBatch("claude-anthropic", models.claude, "anthropic");
		rows.push(summary);
		allHops.push(...hops);
		console.log(JSON.stringify(summary, null, 2));
		const failed = hops.find((h) => !h.ok);
		if (failed) console.log("first failure:", failed.error);
	}

	console.log("\n=== COMPARISON TABLE ===");
	console.log(
		"| batch | hops | billable | cached | cache% | completion | est_credits | amanai_delta | match |",
	);
	console.log("|---|---|---|---|---|---|---|---|---|");
	for (const r of rows) {
		console.log(
			`| ${r.label} | ${r.hops} | ${r.sum_billable} | ${r.sum_cached} | ${r.cache_hit_pct}% | ${r.sum_completion} | ${r.est_credits} | ${r.amanai_credit_delta} | ${r.match} |`,
		);
	}

	console.log("\n=== HOP DETAIL (ok only, first 3 + last 3 per batch) ===");
	for (const label of ["glm-openai", "gpt-openai", "claude-anthropic"]) {
		const subset = allHops.filter((h) => h.model.includes(label.split("-")[0]) || true);
		void subset;
	}
	for (const r of rows) {
		const batchHops = allHops.filter((h) => {
			if (r.label.startsWith("glm")) return h.model.includes("glm");
			if (r.label.startsWith("gpt")) return h.model.includes("gpt");
			return h.path === "anthropic" || h.model.includes("claude");
		});
		const show = [...batchHops.slice(0, 3), ...batchHops.slice(-3)];
		console.log(r.label, JSON.stringify(show));
	}

	console.log("\nTAG_FOR_SQL=", TAG);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
