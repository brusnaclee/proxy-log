import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	buildEdgeKeyRecord,
	isEdgeKeyRecord,
	matchesEdgeApiKey,
	applyEdgeLogFields,
	EDGE_LOG_MARK,
} from "./edge-key.js";

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

	it("applyEdgeLogFields strips bodies only for edge records", () => {
		const edge = buildEdgeKeyRecord("tira");
		const edged = applyEdgeLogFields(
			{
				apiKeyId: 99,
				apiKeyName: "should-replace",
				requestPreview: "SECRET PROMPT",
				responsePreview: "SECRET OUT",
				transcriptSnapshot: "huge",
				isCountedRequest: true,
				promptTokens: 100,
			},
			edge,
		);
		assert.equal(edged.apiKeyId, null);
		assert.equal(edged.apiKeyName, "tira");
		assert.equal(edged.requestPreview, null);
		assert.equal(edged.responsePreview, null);
		assert.equal(edged.transcriptSnapshot, null);
		assert.equal(edged.isCountedRequest, false);
		assert.equal(edged.contextFingerprint, EDGE_LOG_MARK);
		assert.equal(edged.promptTokens, 100);

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
});
