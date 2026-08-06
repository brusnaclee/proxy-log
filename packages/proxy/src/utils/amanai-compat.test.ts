import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	applyAmanaiCacheToAnthropicBody,
	applyAmanaiCacheToOpenAIBody,
	inferCompatProfile,
	normalizeCompatProfile,
	providerIsAmanaiCompat,
} from "./amanai-compat.js";

describe("compat profile helpers", () => {
	it("normalizes amanai vs default", () => {
		assert.equal(normalizeCompatProfile("amanai"), "amanai");
		assert.equal(normalizeCompatProfile("AMANAI"), "amanai");
		assert.equal(normalizeCompatProfile("default"), "default");
		assert.equal(normalizeCompatProfile(""), "default");
	});

	it("infers amanai from endpoint/name", () => {
		assert.equal(
			inferCompatProfile({ endpoint: "https://api.amanai.dev/v1" }),
			"amanai",
		);
		assert.equal(inferCompatProfile({ name: "Amanai Prod" }), "amanai");
		assert.equal(
			inferCompatProfile({ endpoint: "https://api.openai.com/v1" }),
			"default",
		);
		assert.equal(
			inferCompatProfile({
				endpoint: "https://api.amanai.dev/v1",
				compatProfile: "default",
			}),
			"default",
		);
	});

	it("providerIsAmanaiCompat respects flag and legacy heuristic", () => {
		assert.equal(providerIsAmanaiCompat({ compatProfile: "amanai" }), true);
		assert.equal(providerIsAmanaiCompat({ compatProfile: "default" }), false);
		assert.equal(
			providerIsAmanaiCompat({
				compatProfile: null,
				endpoint: "https://api.amanai.dev/v1",
			}),
			true,
		);
	});
});

describe("amanai cache shaping", () => {
	it("marks anthropic system + last tool with cache_control", () => {
		const shaped = applyAmanaiCacheToAnthropicBody({
			model: "amanai/glm-5.2",
			max_tokens: 100,
			system: "You are a helpful coding agent with a long stable prompt.",
			tools: [
				{ name: "read", description: "r", input_schema: { type: "object" } },
				{ name: "write", description: "w", input_schema: { type: "object" } },
			],
			messages: [
				{
					role: "user",
					content: "x".repeat(250),
				},
			],
		});
		assert.ok(Array.isArray(shaped.system));
		assert.equal(shaped.system[0].cache_control?.type, "ephemeral");
		assert.equal(shaped.tools[1].cache_control?.type, "ephemeral");
		assert.ok(!shaped.tools[0].cache_control);
		assert.equal(shaped.messages[0].content[0].cache_control?.type, "ephemeral");
	});

	it("marks openai system content blocks + last tool", () => {
		const shaped = applyAmanaiCacheToOpenAIBody({
			model: "amanai/glm-5.2",
			messages: [
				{ role: "system", content: "Stable system instructions here." },
				{ role: "user", content: "hi" },
			],
			tools: [
				{
					type: "function",
					function: { name: "a", parameters: {} },
				},
				{
					type: "function",
					function: { name: "b", parameters: {} },
				},
			],
		});
		assert.equal(shaped.messages[0].content[0].cache_control?.type, "ephemeral");
		assert.equal(shaped.tools[1].cache_control?.type, "ephemeral");
		assert.equal(shaped.messages[1].content, "hi");
	});

	it("does not double-apply existing cache_control", () => {
		const shaped = applyAmanaiCacheToAnthropicBody({
			system: [
				{
					type: "text",
					text: "already",
					cache_control: { type: "ephemeral" },
				},
			],
			tools: [
				{
					name: "t",
					input_schema: {},
					cache_control: { type: "ephemeral" },
				},
			],
			messages: [],
		});
		assert.equal(shaped.system[0].cache_control.type, "ephemeral");
		assert.equal(shaped.tools[0].cache_control.type, "ephemeral");
	});
});
