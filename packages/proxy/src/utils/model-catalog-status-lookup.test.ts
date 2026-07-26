import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProviderStrictStatusLookup, type ClientCatalogMonitorRow } from "./model-catalog.js";

function row(
	partial: Partial<ClientCatalogMonitorRow> & Pick<ClientCatalogMonitorRow, "modelId" | "provider">,
): ClientCatalogMonitorRow {
	const published = partial.published ?? true;
	const probeOk = partial.probeOk ?? true;
	return {
		latencyMs: partial.latencyMs ?? 100,
		baseUrl: "",
		httpStatus: partial.httpStatus ?? 200,
		published,
		probeOk,
		visible: published,
		clientOnline: published && probeOk,
		requestable: published,
		...partial,
	};
}

describe("buildProviderStrictStatusLookup", () => {
	it("does not let force-off tokito sonnet borrow Online from another provider", () => {
		const { lookup } = buildProviderStrictStatusLookup([
			row({
				provider: "tokitoV2",
				modelId: "cc/claude-sonnet-5",
				published: false,
				probeOk: true,
			}),
			row({
				provider: "phantom",
				modelId: "amanai/claude-sonnet-5",
				published: true,
				probeOk: true,
			}),
			row({
				provider: "69",
				modelId: "kagiro/claude-sonnet-5",
				published: false,
				probeOk: true,
			}),
		]);

		const tokito = lookup("tokitoV2/cc/claude-sonnet-5");
		assert.ok(tokito);
		assert.equal(tokito.visible, false);
		assert.equal(tokito.clientOnline, false);

		const phantom = lookup("phantom/amanai/claude-sonnet-5");
		assert.ok(phantom);
		assert.equal(phantom.visible, true);
		assert.equal(phantom.clientOnline, true);

		const kagiro = lookup("69/kagiro/claude-sonnet-5");
		assert.ok(kagiro);
		assert.equal(kagiro.visible, false);
		assert.equal(kagiro.clientOnline, false);

		// Bare leaf must NOT resolve across providers
		assert.equal(lookup("claude-sonnet-5"), null);
	});

	it("resolves exact provider-scoped catalog ids", () => {
		const { lookup } = buildProviderStrictStatusLookup([
			row({
				provider: "tokitoV2",
				modelId: "gemini/gemini-3.1-flash-lite-preview",
				published: true,
				probeOk: true,
				latencyMs: 1257,
			}),
		]);
		const hit = lookup("tokitoV2/gemini/gemini-3.1-flash-lite-preview");
		assert.ok(hit);
		assert.equal(hit.clientOnline, true);
		assert.equal(hit.latencyMs, 1257);
	});
});
