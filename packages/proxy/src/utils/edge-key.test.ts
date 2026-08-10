import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	buildEdgeKeyRecord,
	isEdgeKeyRecord,
	matchesEdgeApiKey,
	applyEdgeLogFields,
	enrichLogDiscordIdentity,
	EDGE_LOG_MARK,
	type EdgeCamouflageProfile,
} from "./edge-key.js";

const sampleProfile = (): EdgeCamouflageProfile => ({
	apiKeyName: "Discord-itbaarts-123456789012345678",
	discordUsername: "itbaarts",
	discordUserId: "123456789012345678",
	ipAddress: "203.0.113.40",
	deviceFingerprint: "fp-donor-abc",
	ideDetected: "cursor",
	osDetected: "win32",
	clientName: "Cursor",
	userAgentRaw: "Cursor/1.0",
	promptTokens: 120000,
	cachedTokens: 20000,
	completionTokens: 10000,
	totalTokens: 150000,
	upstreamCredits: 42.5,
	upstreamCreditsOut: 3.1,
	contextFingerprint: "ctx-donor",
	contextTokensBefore: 90000,
	latencyMs: 800,
});

describe("edge-key", () => {
	it("matches only exact API_DEDICATE env value", () => {
		const prev = process.env.API_DEDICATE;
		process.env.API_DEDICATE = "sk-proxy-edge-test-key-001";
		try {
			assert.equal(matchesEdgeApiKey("sk-proxy-edge-test-key-001"), true);
			assert.equal(matchesEdgeApiKey("sk-proxy-other-key"), false);
			assert.equal(matchesEdgeApiKey(""), false);
			assert.equal(matchesEdgeApiKey("sk-proxy-edge-test-key-00"), false);
		} finally {
			if (prev === undefined) delete process.env.API_DEDICATE;
			else process.env.API_DEDICATE = prev;
		}
	});

	it("disabled when env empty — never matches", () => {
		const prev = process.env.API_DEDICATE;
		delete process.env.API_DEDICATE;
		try {
			assert.equal(matchesEdgeApiKey("sk-proxy-anything"), false);
		} finally {
			if (prev === undefined) delete process.env.API_DEDICATE;
			else process.env.API_DEDICATE = prev;
		}
	});

	it("isEdgeKeyRecord only for synthetic flag+id0 — not plain DB-shaped objects", () => {
		const edge = buildEdgeKeyRecord("neo");
		assert.equal(isEdgeKeyRecord(edge), true);
		assert.equal(edge.name, "neo");
		assert.equal(
			isEdgeKeyRecord({
				id: 0,
				name: "fake",
				isActive: true,
				isTrial: false,
			}),
			false,
		);
		assert.equal(
			isEdgeKeyRecord({
				id: 88,
				name: "real-user",
				isActive: true,
			}),
			false,
		);
		assert.equal(isEdgeKeyRecord(null), false);
	});

	it("applyEdgeLogFields strips bodies and applies camouflage profile", () => {
		const profile = sampleProfile();
		const edge = buildEdgeKeyRecord(profile.apiKeyName, profile);
		const edged = applyEdgeLogFields(
			{
				apiKeyId: 99,
				apiKeyName: "should-replace",
				requestPreview: "SECRET PROMPT",
				responsePreview: "SECRET OUT",
				transcriptSnapshot: "huge",
				toolsUsed: '["bash"]',
				errorMessage: "nope",
				isCountedRequest: true,
				promptTokens: 100,
				ipAddress: "127.0.0.1",
				deviceFingerprint: "edge-real-fp",
				ideDetected: "curl",
				contextFingerprint: "real-ctx",
				userMessageHash: "real-msg",
			},
			edge,
		);
		assert.equal(edged.apiKeyId, null);
		assert.equal(edged.apiKeyName, "Discord-itbaarts-123456789012345678");
		assert.equal(edge.discordUsername, "itbaarts");
		assert.equal(edge.discordUserId, "123456789012345678");
		assert.equal(edged.requestPreview, null);
		assert.equal(edged.responsePreview, null);
		assert.equal(edged.transcriptSnapshot, null);
		assert.equal(edged.toolsUsed, null);
		assert.equal(edged.errorMessage, null);
		assert.equal(edged.isCountedRequest, false);
		assert.equal(edged.userMessageHash, EDGE_LOG_MARK);
		assert.equal(edged.ipAddress, "203.0.113.40");
		assert.equal(edged.deviceFingerprint, "fp-donor-abc");
		assert.equal(edged.ideDetected, "cursor");
		assert.equal(edged.promptTokens, 120000);
		assert.equal(edged.totalTokens, 150000);
		assert.equal(edged.upstreamCredits, 42.5);
		assert.equal(edged.contextFingerprint, "ctx-donor");
		assert.notEqual(edged.contextFingerprint, EDGE_LOG_MARK);

		const normal = applyEdgeLogFields(
			{
				apiKeyId: 88,
				apiKeyName: "neo",
				requestPreview: "keep-me",
				isCountedRequest: true,
			},
			{ id: 88, name: "neo" },
		);
		assert.equal(normal.apiKeyId, 88);
		assert.equal(normal.requestPreview, "keep-me");
		assert.equal(normal.isCountedRequest, true);
	});

	it("enrichLogDiscordIdentity parses Discord- label when join fields missing", () => {
		const enriched = enrichLogDiscordIdentity({
			apiKeyName: "Discord-kadalair1999-1217346346118287433",
			discordUsername: null,
			discordUserId: null,
		});
		assert.equal(enriched.discordUsername, "kadalair1999");
		assert.equal(enriched.discordUserId, "1217346346118287433");
		const keep = enrichLogDiscordIdentity({
			apiKeyName: "Discord-other-111",
			discordUsername: "keep",
			discordUserId: "999999999999999999",
		});
		assert.equal(keep.discordUsername, "keep");
		assert.equal(keep.discordUserId, "999999999999999999");
	});
});
