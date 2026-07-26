// Simulates applyTokenSavers() against request-body shapes representative of
// real IDEs hitting the proxy (Cline/Roo/Kilo, Cursor/Continue/OpenCode/Zed,
// Claude Code, GitHub Copilot, plus legacy function-calling clients) to make
// sure the new Batch step never corrupts the OpenAI-format body — regardless
// of whether Batch/Caveman/Ponytail are on, and regardless of tool schema —
// since by the time applyTokenSavers runs, every upstream format has already
// been normalized into OpenAI chat.completions shape (proxy.ts step 7d, after
// Anthropic→OpenAI conversion).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyTokenSavers, resolveTokenSaverFlags } from "./index.js";

const ALL_ON_FLAGS = resolveTokenSaverFlags(
	{
		tokenSaverRtkEnabled: true,
		tokenSaverGroupyCompactEnabled: true,
		tokenSaverHeadroomEnabled: false,
		tokenSaverCavemanEnabled: true,
		tokenSaverCavemanLevel: 2,
		tokenSaverPonytailEnabled: true,
		tokenSaverPonytailLevel: "lite",
		tokenSaverBatchEnabled: true,
	},
	null,
	null,
);

function assertValidOpenAiBody(body: any) {
	// Must still round-trip through JSON (what we actually send upstream).
	const serialized = JSON.stringify(body);
	assert.ok(serialized.length > 0);
	assert.ok(Array.isArray(body.messages));
	// Every tool-role message must still carry its tool_call_id (adapters need this).
	for (const m of body.messages) {
		if (m.role === "tool") {
			assert.ok(m.tool_call_id, "tool message must retain tool_call_id");
		}
	}
	// Injected system messages must never be placed between an assistant's
	// tool_calls and the corresponding tool result (providers reject that order).
	for (let i = 0; i < body.messages.length; i++) {
		const m = body.messages[i];
		if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
			const next = body.messages[i + 1];
			assert.ok(
				next && (next.role === "tool" || (next.role === "assistant" && Array.isArray(next.tool_calls))),
				"assistant tool_calls must be immediately followed by a tool result",
			);
		}
	}
}

// ─── Cline / Roo / Kilo (XML-ish tool markers inside plain text + tool role) ──
function clineStyleBody() {
	return {
		model: "phantom/amanai/glm-5.2",
		stream: true,
		tools: [
			{ type: "function", function: { name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } } } } },
			{ type: "function", function: { name: "write_to_file", parameters: { type: "object" } } },
		],
		messages: [
			{ role: "system", content: "You are Cline, an autonomous coding agent." },
			{ role: "user", content: "Fix the auth bug in src/auth.ts" },
			{ role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"src/auth.ts"}' } }] },
			{ role: "tool", tool_call_id: "call_1", name: "read_file", content: "[read_file for 'src/auth.ts'] Result:\n" + "line\n".repeat(500) },
			{ role: "assistant", content: "I see the issue, let me fix it." },
		],
	};
}

// ─── Cursor / Continue / OpenCode / Zed (parallel tool_calls already used) ───
function cursorStyleBodyWithParallelCalls() {
	return {
		model: "tokitoV2/gcli/grok-4.5",
		tools: [
			{ type: "function", function: { name: "read_file" } },
			{ type: "function", function: { name: "edit_file" } },
		],
		messages: [
			{ role: "system", content: "You are an AI coding assistant." },
			{ role: "user", content: "Refactor these 3 files to use the new API." },
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{ id: "call_a", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
					{ id: "call_b", type: "function", function: { name: "read_file", arguments: '{"path":"b.ts"}' } },
					{ id: "call_c", type: "function", function: { name: "read_file", arguments: '{"path":"c.ts"}' } },
				],
			},
			{ role: "tool", tool_call_id: "call_a", content: "content of a.ts".repeat(100) },
			{ role: "tool", tool_call_id: "call_b", content: "content of b.ts".repeat(100) },
			{ role: "tool", tool_call_id: "call_c", content: "content of c.ts".repeat(100) },
		],
	};
}

// ─── Claude Code (already normalized to OpenAI shape by anthropic-adapter) ──
function claudeCodeStyleBody() {
	return {
		model: "tokitoV2/cc/claude-opus-4-7",
		tools: [{ type: "function", function: { name: "Read" } }, { type: "function", function: { name: "Bash" } }],
		messages: [
			{ role: "system", content: "You are Claude Code." },
			{ role: "user", content: [{ type: "text", text: "Run the test suite and fix failures." }] },
			{ role: "assistant", tool_calls: [{ id: "toolu_1", type: "function", function: { name: "Bash", arguments: '{"command":"npm test"}' } }] },
			{ role: "tool", tool_call_id: "toolu_1", content: "FAIL src/x.test.ts\n".repeat(50) },
		],
	};
}

// ─── GitHub Copilot / n8n Workflow — minimal tool schema, few messages ──────
function copilotMinimalBody() {
	return {
		model: "69/kagiro/gemini-3-Flash",
		tools: [{ type: "function", function: { name: "get_file" } }],
		messages: [
			{ role: "user", content: "List the files in ./src" },
		],
	};
}

// ─── Legacy OpenAI function-calling client (deprecated `functions` field) ───
function legacyFunctionsBody() {
	return {
		model: "phantom/amanai/gpt-5.5",
		functions: [{ name: "get_weather", parameters: { type: "object" } }],
		function_call: "auto",
		messages: [
			{ role: "user", content: "What's the weather in Jakarta?" },
		],
	};
}

// ─── Tiny one-shot chat, no tools at all ────────────────────────────────────
function tinyNoToolsBody() {
	return {
		model: "tokito/combogroupy",
		messages: [{ role: "user", content: "Say hi" }],
	};
}

describe("applyTokenSavers across IDE-shaped payloads (full pipeline ON)", () => {
	it("Cline-style body stays valid and gets a Batch nudge (has tools)", async () => {
		const body = clineStyleBody();
		const result = await applyTokenSavers(body, ALL_ON_FLAGS);
		assertValidOpenAiBody(body);
		assert.equal(result.batch, true);
		assert.ok(body.messages.some((m: any) => m.role === "system" && String(m.content).includes("[token-saver:batch]")));
	});

	it("Cursor-style body with pre-existing parallel tool_calls stays valid", async () => {
		const body = cursorStyleBodyWithParallelCalls();
		const before = body.messages.filter((m: any) => m.role === "tool").length;
		const result = await applyTokenSavers(body, ALL_ON_FLAGS);
		assertValidOpenAiBody(body);
		assert.equal(result.batch, true);
		// Compact/RTK must never drop or reorder tool results.
		assert.equal(body.messages.filter((m: any) => m.role === "tool").length, before);
	});

	it("Claude Code (post-adapter OpenAI shape) stays valid", async () => {
		const body = claudeCodeStyleBody();
		await applyTokenSavers(body, ALL_ON_FLAGS);
		assertValidOpenAiBody(body);
	});

	it("Copilot minimal body (has tools, no prior tool_calls) gets batch nudge", async () => {
		const body = copilotMinimalBody();
		const result = await applyTokenSavers(body, ALL_ON_FLAGS);
		assertValidOpenAiBody(body);
		assert.equal(result.batch, true);
	});

	it("legacy `functions`-only client is left untouched by Batch (no tools array)", async () => {
		const body = legacyFunctionsBody();
		const result = await applyTokenSavers(body, ALL_ON_FLAGS);
		assertValidOpenAiBody(body);
		assert.equal(result.batch, false);
		assert.equal(body.messages.some((m: any) => String(m.content || "").includes("token-saver:batch")), false);
	});

	it("tiny one-shot chat with no tools skips Batch entirely", async () => {
		const body = tinyNoToolsBody();
		const result = await applyTokenSavers(body, ALL_ON_FLAGS);
		assertValidOpenAiBody(body);
		assert.equal(result.batch, false);
		assert.equal(body.messages.length, 1);
	});

	it("fail-open: malformed body (no messages array) never throws", async () => {
		await assert.doesNotReject(async () => {
			await applyTokenSavers({ tools: [{ type: "function" }] } as any, ALL_ON_FLAGS);
		});
		await assert.doesNotReject(async () => {
			await applyTokenSavers(null, ALL_ON_FLAGS);
		});
	});

	it("Batch flag OFF (header kill switch) never injects the directive", async () => {
		const headers = new Headers({ "x-token-saver": "off" });
		const flags = resolveTokenSaverFlags(
			{ tokenSaverBatchEnabled: true },
			null,
			headers,
		);
		const body = cursorStyleBodyWithParallelCalls();
		const result = await applyTokenSavers(body, flags);
		assert.equal(flags.disabledByHeader, true);
		assert.equal(result.batch, false);
		assert.equal(body.messages.some((m: any) => String(m.content || "").includes("token-saver:batch")), false);
	});

	it("per-user override OFF beats admin default ON for Batch", async () => {
		const flags = resolveTokenSaverFlags(
			{ tokenSaverBatchEnabled: true },
			{ tokenSaverBatchOverride: false },
			null,
		);
		assert.equal(flags.batch, false);
	});
});
