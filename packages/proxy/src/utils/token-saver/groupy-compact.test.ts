import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyGroupyCompact, normalizeGroupyCompactLevel } from "./groupy-compact.js";

function bigDump(label: string, n = 3000): string {
	return `[read_file for '${label}'] Result:\n` + ("line of code\n".repeat(Math.ceil(n / 14)));
}

describe("normalizeGroupyCompactLevel", () => {
	it("defaults to balanced", () => {
		assert.equal(normalizeGroupyCompactLevel(undefined), "balanced");
		assert.equal(normalizeGroupyCompactLevel("nope"), "balanced");
	});
	it("accepts lite/balanced/aggressive", () => {
		assert.equal(normalizeGroupyCompactLevel("lite"), "lite");
		assert.equal(normalizeGroupyCompactLevel("AGGRESSIVE"), "aggressive");
	});
});

describe("applyGroupyCompact", () => {
	it("keeps recent window full and stubs older dumps (balanced)", () => {
		const body = {
			messages: [
				{ role: "user", content: "refactor auth" },
				{ role: "assistant", tool_calls: [{ id: "1", type: "function", function: { name: "read_file", arguments: "{}" } }] },
				{ role: "tool", name: "read_file", tool_call_id: "1", content: bigDump("a.ts", 4000) },
				{ role: "assistant", tool_calls: [{ id: "2", type: "function", function: { name: "read_file", arguments: "{}" } }] },
				{ role: "tool", name: "read_file", tool_call_id: "2", content: bigDump("b.ts", 4000) },
				{ role: "assistant", tool_calls: [{ id: "3", type: "function", function: { name: "read_file", arguments: "{}" } }] },
				{ role: "tool", name: "read_file", tool_call_id: "3", content: bigDump("c.ts", 4000) },
				{ role: "assistant", tool_calls: [{ id: "4", type: "function", function: { name: "read_file", arguments: "{}" } }] },
				{ role: "tool", name: "read_file", tool_call_id: "4", content: bigDump("d.ts", 4000) },
				{ role: "assistant", tool_calls: [{ id: "5", type: "function", function: { name: "read_file", arguments: "{}" } }] },
				{ role: "tool", name: "read_file", tool_call_id: "5", content: bigDump("e.ts", 4000) },
			],
		};

		const beforeIds = body.messages
			.filter((m: any) => m.role === "tool")
			.map((m: any) => m.tool_call_id);
		const stats = applyGroupyCompact(body, "balanced");

		assert.ok(stats.stubs >= 1);
		assert.ok(stats.charsSaved > 0);

		// Pair integrity: same roles, tool_call_ids, tool_calls untouched
		const afterIds = body.messages
			.filter((m: any) => m.role === "tool")
			.map((m: any) => m.tool_call_id);
		assert.deepEqual(afterIds, beforeIds);
		assert.ok(Array.isArray(body.messages[1].tool_calls));
		assert.equal(body.messages[1].tool_calls[0].id, "1");

		// Last 3 tool dumps kept (not stubbed); older ones stubbed
		const tools = body.messages.filter((m: any) => m.role === "tool");
		const stubbed = tools.filter((m: any) => String(m.content).includes("[groupy-compact]"));
		const kept = tools.filter((m: any) => !String(m.content).includes("[groupy-compact]"));
		assert.equal(kept.length, 3);
		assert.equal(stubbed.length, tools.length - 3);
		assert.ok(String(tools[0].content).includes("[groupy-compact]"));
		assert.ok(String(tools[tools.length - 1].content).includes("e.ts"));
	});

	it("never stubs write/edit tool results", () => {
		const patch = "diff --git a/x\n" + "+line\n".repeat(500);
		const body = {
			messages: [
				{ role: "tool", name: "read_file", tool_call_id: "1", content: bigDump("a.ts", 4000) },
				{ role: "tool", name: "read_file", tool_call_id: "2", content: bigDump("b.ts", 4000) },
				{ role: "tool", name: "read_file", tool_call_id: "3", content: bigDump("c.ts", 4000) },
				{ role: "tool", name: "write_to_file", tool_call_id: "4", content: patch },
				{ role: "tool", name: "apply_diff", tool_call_id: "5", content: patch },
			],
		};
		applyGroupyCompact(body, "balanced");
		const write = body.messages.find((m: any) => m.name === "write_to_file");
		const diff = body.messages.find((m: any) => m.name === "apply_diff");
		assert.ok(!String(write.content).includes("[groupy-compact]"));
		assert.ok(!String(diff.content).includes("[groupy-compact]"));
		assert.equal(write.content, patch);
	});

	it("stubs Cline user-role dumps older than recent window", () => {
		const body = {
			messages: [
				{ role: "user", content: bigDump("one.ts", 4000) },
				{ role: "user", content: bigDump("two.ts", 4000) },
				{ role: "user", content: bigDump("three.ts", 4000) },
				{ role: "user", content: bigDump("four.ts", 4000) },
				{ role: "user", content: bigDump("five.ts", 4000) },
			],
		};
		const stats = applyGroupyCompact(body, "balanced");
		assert.ok(stats.stubs >= 1);
		assert.ok(String(body.messages[0].content).includes("[groupy-compact]"));
		assert.ok(String(body.messages[4].content).includes("five.ts"));
		assert.ok(!String(body.messages[4].content).includes("[groupy-compact]"));
	});

	it("does not drop or reorder messages", () => {
		const body = {
			messages: [
				{ role: "system", content: "you are helpful" },
				{ role: "user", content: "hi" },
				{ role: "tool", name: "read_file", tool_call_id: "a", content: bigDump("x.ts", 4000) },
				{ role: "tool", name: "read_file", tool_call_id: "b", content: bigDump("y.ts", 4000) },
				{ role: "tool", name: "read_file", tool_call_id: "c", content: bigDump("z.ts", 4000) },
				{ role: "tool", name: "read_file", tool_call_id: "d", content: bigDump("w.ts", 4000) },
			],
		};
		const rolesBefore = body.messages.map((m: any) => m.role);
		applyGroupyCompact(body, "balanced");
		assert.deepEqual(
			body.messages.map((m: any) => m.role),
			rolesBefore,
		);
		assert.equal(body.messages.length, 6);
		assert.equal(body.messages[0].content, "you are helpful");
	});

	it("lite requires larger dumps before stubbing", () => {
		const medium = bigDump("m.ts", 2000); // ~2k < lite 4k threshold
		const body = {
			messages: [
				{ role: "tool", name: "read_file", tool_call_id: "1", content: medium },
				{ role: "tool", name: "read_file", tool_call_id: "2", content: medium },
				{ role: "tool", name: "read_file", tool_call_id: "3", content: medium },
				{ role: "tool", name: "read_file", tool_call_id: "4", content: medium },
				{ role: "tool", name: "read_file", tool_call_id: "5", content: medium },
			],
		};
		const lite = applyGroupyCompact(structuredClone(body), "lite");
		assert.equal(lite.stubs, 0);
		const bal = applyGroupyCompact(structuredClone(body), "balanced");
		assert.ok(bal.stubs >= 1);
	});

	it("fail-open on null/empty body", () => {
		assert.deepEqual(applyGroupyCompact(null as any).stubs, 0);
		assert.deepEqual(applyGroupyCompact({}).stubs, 0);
	});
});
