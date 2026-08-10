/**
 * Per-provider vendor segment aliases for public model IDs.
 * Example: upstream `amanai/glm-5.2` → public `vibecode/glm-5.2`
 * → full client id `phantom/vibecode/glm-5.2` while upstream body stays `amanai/glm-5.2`.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { providers } from "../db/schema.js";

export type VendorAliasMap = Record<string, string>;

export type VendorAliasIndex = {
	/** lower(providerName) → canonical provider name */
	canonicalName: Map<string, string>;
	/** lower(providerName) → upstreamVendor → publicVendor */
	byProviderName: Map<string, VendorAliasMap>;
	/** lower(providerName) → lower(publicVendor) → upstreamVendor */
	reverseByProviderName: Map<string, Map<string, string>>;
};

let cachedIndex: { value: VendorAliasIndex; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

export function invalidateVendorAliasCache(): void {
	cachedIndex = null;
}

export function vendorOf(modelId: string): string | null {
	const id = String(modelId || "").trim();
	const slash = id.indexOf("/");
	if (slash <= 0) return null;
	return id.slice(0, slash);
}

export function parseVendorAliases(raw: unknown): VendorAliasMap {
	if (!raw) return {};
	let obj: unknown = raw;
	if (typeof raw === "string") {
		const s = raw.trim();
		if (!s || s === "{}") return {};
		try {
			obj = JSON.parse(s);
		} catch {
			return {};
		}
	}
	if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
	return normalizeVendorAliases(obj as Record<string, unknown>);
}

/** Validate + normalize. Throws Error with message on invalid input. */
export function normalizeVendorAliases(
	input: Record<string, unknown>,
): VendorAliasMap {
	const out: VendorAliasMap = {};
	const usedPublic = new Set<string>();
	const usedReal = new Set<string>();

	for (const [k, v] of Object.entries(input || {})) {
		const real = String(k || "").trim();
		const pub = String(v ?? "").trim();
		if (!real) continue;
		if (!pub || pub === real) continue; // empty / same = no override
		if (real.includes("/") || pub.includes("/")) {
			throw new Error("Vendor names cannot contain '/'");
		}
		if (/\s/.test(real) || /\s/.test(pub)) {
			throw new Error("Vendor names cannot contain whitespace");
		}
		const realKey = real.toLowerCase();
		const pubKey = pub.toLowerCase();
		if (usedReal.has(realKey)) {
			throw new Error(`Duplicate upstream vendor "${real}"`);
		}
		if (usedPublic.has(pubKey)) {
			throw new Error(`Duplicate public vendor "${pub}"`);
		}
		// Public name must not collide with another upstream vendor key
		for (const other of Object.keys(input || {})) {
			const o = String(other || "").trim().toLowerCase();
			if (o && o !== realKey && o === pubKey) {
				throw new Error(
					`Public vendor "${pub}" collides with upstream vendor "${other}"`,
				);
			}
		}
		usedReal.add(realKey);
		usedPublic.add(pubKey);
		out[real] = pub;
	}
	return out;
}

export function stringifyVendorAliases(map: VendorAliasMap): string {
	return JSON.stringify(map || {});
}

export function toPublicUpstreamId(
	upstreamId: string,
	aliases: VendorAliasMap,
): string {
	const id = String(upstreamId || "").trim();
	const vendor = vendorOf(id);
	if (!vendor || !aliases || !Object.keys(aliases).length) return id;
	for (const [real, pub] of Object.entries(aliases)) {
		if (
			real.toLowerCase() === vendor.toLowerCase() &&
			pub &&
			pub.toLowerCase() !== real.toLowerCase()
		) {
			return `${pub}${id.slice(vendor.length)}`;
		}
	}
	return id;
}

export function toRealUpstreamId(
	publicOrRealId: string,
	aliases: VendorAliasMap,
): string {
	const id = String(publicOrRealId || "").trim();
	const vendor = vendorOf(id);
	if (!vendor || !aliases || !Object.keys(aliases).length) return id;
	for (const [real, pub] of Object.entries(aliases)) {
		if (
			pub &&
			pub.toLowerCase() === vendor.toLowerCase() &&
			real.toLowerCase() !== pub.toLowerCase()
		) {
			return `${real}${id.slice(vendor.length)}`;
		}
	}
	return id;
}

export function toPublicModelId(
	providerName: string,
	upstreamId: string,
	aliases: VendorAliasMap,
): string {
	const pubSuffix = toPublicUpstreamId(upstreamId, aliases);
	const prov = String(providerName || "").trim();
	if (!prov) return pubSuffix;
	return `${prov}/${pubSuffix}`;
}

function buildIndex(
	rows: Array<{ name: string; vendorAliases?: string | null }>,
): VendorAliasIndex {
	const canonicalName = new Map<string, string>();
	const byProviderName = new Map<string, VendorAliasMap>();
	const reverseByProviderName = new Map<string, Map<string, string>>();

	for (const row of rows) {
		const name = String(row.name || "").trim();
		if (!name) continue;
		const lower = name.toLowerCase();
		canonicalName.set(lower, name);
		const aliases = parseVendorAliases(row.vendorAliases);
		byProviderName.set(lower, aliases);
		const rev = new Map<string, string>();
		for (const [real, pub] of Object.entries(aliases)) {
			if (pub) rev.set(pub.toLowerCase(), real);
		}
		reverseByProviderName.set(lower, rev);
	}

	return { canonicalName, byProviderName, reverseByProviderName };
}

export async function loadVendorAliasIndex(
	force = false,
): Promise<VendorAliasIndex> {
	if (
		!force &&
		cachedIndex &&
		cachedIndex.expiresAt > Date.now()
	) {
		return cachedIndex.value;
	}
	const rows = await db
		.select({
			name: providers.name,
			vendorAliases: providers.vendorAliases,
		})
		.from(providers);
	const value = buildIndex(rows as any);
	cachedIndex = { value, expiresAt: Date.now() + CACHE_TTL_MS };
	return value;
}

export function getAliasesForProviderName(
	index: VendorAliasIndex,
	providerName: string,
): VendorAliasMap {
	return (
		index.byProviderName.get(String(providerName || "").toLowerCase()) || {}
	);
}

/**
 * Rewrite a stored/logged model string to the current public vendor form.
 * Handles `provider/vendor/model`, bare `vendor/model`, and `auto (…)` wrappers.
 */
export function publicizeModelString(
	model: string | null | undefined,
	index: VendorAliasIndex,
): string {
	const raw = String(model ?? "");
	if (!raw) return raw;

	const trimmed = raw.trim();
	const autoMatch = /^auto\s*\((.+)\)$/i.exec(trimmed);
	if (autoMatch) {
		return `auto (${publicizeModelString(autoMatch[1], index)})`;
	}

	const slash = trimmed.indexOf("/");
	if (slash <= 0) return raw;

	const first = trimmed.slice(0, slash);
	const rest = trimmed.slice(slash + 1);
	const firstLower = first.toLowerCase();

	// provider/vendor/leaf
	const provAliases = index.byProviderName.get(firstLower);
	if (provAliases) {
		const canon = index.canonicalName.get(firstLower) || first;
		return `${canon}/${toPublicUpstreamId(rest, provAliases)}`;
	}

	// bare vendor/leaf — try each provider's map (same upstream vendor rename)
	for (const aliases of index.byProviderName.values()) {
		const pub = toPublicUpstreamId(trimmed, aliases);
		if (pub !== trimmed) return pub;
	}

	return raw;
}

/** Map `model` / nested model fields on plain objects / arrays for API responses. */
export function publicizeModelsDeep(
	value: unknown,
	index: VendorAliasIndex,
): unknown {
	if (value == null) return value;
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value.map((v) => publicizeModelsDeep(v, index));
	}
	if (typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(obj)) {
			if (
				(k === "model" || k === "modelId" || k === "topModel") &&
				typeof v === "string"
			) {
				out[k] = publicizeModelString(v, index);
			} else if (k === "id" && typeof v === "string" && v.includes("/")) {
				out[k] = publicizeModelString(v, index);
			} else if (v && typeof v === "object") {
				out[k] = publicizeModelsDeep(v, index);
			} else {
				out[k] = v;
			}
		}
		return out;
	}
	return value;
}

export async function withPublicizedModels<T>(payload: T): Promise<T> {
	const index = await loadVendorAliasIndex();
	return publicizeModelsDeep(payload, index) as T;
}

export async function publicizeModelField(
	model: string | null | undefined,
): Promise<string> {
	const index = await loadVendorAliasIndex();
	return publicizeModelString(model, index);
}

/** Expand candidate upstream ids with real+public vendor forms. */
export function expandUpstreamIdCandidates(
	rest: string,
	aliases: VendorAliasMap,
): string[] {
	const out: string[] = [];
	const add = (s: string) => {
		if (s && !out.includes(s)) out.push(s);
	};
	add(rest);
	add(toRealUpstreamId(rest, aliases));
	add(toPublicUpstreamId(rest, aliases));
	return out;
}

/**
 * Publicize monitor row modelId (nested vendor only) using that row's upstream provider.
 * Mutations must reverse via resolveRawMonitorModelId.
 */
export function publicizeMonitorModelId(
	provider: string | null | undefined,
	modelId: string,
	index: VendorAliasIndex,
): string {
	const aliases = getAliasesForProviderName(index, String(provider || ""));
	return toPublicUpstreamId(String(modelId || ""), aliases);
}

/** Reverse public vendor form back to raw upstream model id for DB ops. */
export async function resolveRawMonitorModelId(
	provider: string | null | undefined,
	modelId: string,
): Promise<string> {
	const index = await loadVendorAliasIndex();
	const mid = String(modelId || "").trim();
	if (!mid) return mid;
	if (provider) {
		const aliases = getAliasesForProviderName(index, String(provider));
		return toRealUpstreamId(mid, aliases);
	}
	for (const aliases of index.byProviderName.values()) {
		const real = toRealUpstreamId(mid, aliases);
		if (real !== mid) return real;
	}
	return mid;
}
