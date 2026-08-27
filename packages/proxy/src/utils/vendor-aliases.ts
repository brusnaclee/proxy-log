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
		// Public may equal another upstream vendor key (e.g. tokito→ikan while
		// ikan→amanai). Request-time resolve picks among colliding reals.
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
	// Prefer reverse public→real (deterministic for monitor/DB). Do not keep
	// the public-only vendor as "real" when it only exists as an alias target.
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

/**
 * All real upstream ids that a client public (or raw) id could mean.
 * Example aliases { ikan:"amanai", tokito:"ikan" }, client amanai/glm:
 * → [amanai/glm, ikan/glm]
 */
export function toRealUpstreamIdCandidates(
	publicOrRealId: string,
	aliases: VendorAliasMap,
): string[] {
	const id = String(publicOrRealId || "").trim();
	if (!id) return [];
	const vendor = vendorOf(id);
	if (!vendor) return [id];
	const leaf = id.slice(vendor.length + 1);
	const reals = realVendorsForClientVendor(vendor, aliases);
	if (!reals.length) return [id];
	return reals.map((real) => (leaf ? `${real}/${leaf}` : real));
}

/**
 * Real upstream vendors that client vendor segment V may resolve to.
 * - Natural V if V is not aliased away
 * - Every real R with aliases[R] === V
 */
export function realVendorsForClientVendor(
	clientVendor: string,
	aliases: VendorAliasMap,
): string[] {
	const v = String(clientVendor || "").trim();
	if (!v) return [];
	const vLower = v.toLowerCase();
	const out: string[] = [];

	const aliasedAway = Object.entries(aliases || {}).find(
		([real, pub]) =>
			real.toLowerCase() === vLower &&
			pub &&
			pub.toLowerCase() !== vLower,
	);
	if (!aliasedAway) out.push(v);

	for (const [real, pub] of Object.entries(aliases || {})) {
		if (
			pub &&
			pub.toLowerCase() === vLower &&
			real.toLowerCase() !== vLower
		) {
			if (!out.some((x) => x.toLowerCase() === real.toLowerCase())) {
				out.push(real);
			}
		}
	}
	return out;
}

/**
 * Strip log-only collision disambiguator (` · {realVendor}`) before resolve.
 * OpenCode / clients sometimes echo the annotated log id back as `model`.
 */
export function stripModelCollisionTag(modelId: string): string {
	const trimmed = String(modelId ?? "").trim();
	const via = /^(.+?)\s+·\s+(\S+)$/.exec(trimmed);
	return via ? via[1].trim() : trimmed;
}

/**
 * True when vendor is only a public alias target (never a real upstream key).
 * Example: aliases `{ amanai: "vibecode" }` → vibecode is public-only.
 * Chain `{ ikan: "amanai", tokito: "ikan" }` → amanai public-only; ikan is still a real key.
 */
export function isPublicAliasOnlyVendor(
	vendor: string,
	aliases: VendorAliasMap,
): boolean {
	const vLower = String(vendor || "")
		.trim()
		.toLowerCase();
	if (!vLower || !aliases || !Object.keys(aliases).length) return false;
	const isRealKey = Object.keys(aliases).some(
		(r) => r.toLowerCase() === vLower,
	);
	const isPubTarget = Object.values(aliases).some(
		(p) => p && String(p).toLowerCase() === vLower,
	);
	return Boolean(isPubTarget && !isRealKey);
}

/** Drop public-only alias ids (e.g. vibecode/…) — must never be forwarded upstream. */
export function filterForwardableUpstreamIds(
	ids: string[],
	aliases: VendorAliasMap,
): string[] {
	if (!Array.isArray(ids) || !ids.length) return [];
	if (!aliases || !Object.keys(aliases).length) return [...ids];
	return ids.filter((id) => {
		const v = vendorOf(id);
		return !v || !isPublicAliasOnlyVendor(v, aliases);
	});
}

/**
 * Prefer ids whose vendor is a real alias key. True multi-real collisions may
 * still leave multiple hits (caller may pick among reals only).
 */
export function preferRealVendorHits(
	ids: string[],
	aliases: VendorAliasMap,
): string[] {
	if (!Array.isArray(ids) || ids.length <= 1) return ids ? [...ids] : [];
	if (!aliases || !Object.keys(aliases).length) return [...ids];
	const reals = ids.filter((id) => {
		const v = vendorOf(id);
		if (!v) return false;
		return Object.keys(aliases).some(
			(r) => r.toLowerCase() === v.toLowerCase(),
		);
	});
	return reals.length ? reals : [...ids];
}

/** Public log id; when collision resolved, append ` · {realVendor}`. */
export function toPublicLogModelId(
	providerName: string,
	upstreamId: string,
	aliases: VendorAliasMap,
	matchCount = 1,
): string {
	const publicId = toPublicModelId(providerName, upstreamId, aliases);
	if (matchCount <= 1) return publicId;
	const realVendor = vendorOf(upstreamId);
	if (!realVendor) return publicId;
	return `${publicId} · ${realVendor}`;
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

/**
 * Client-facing owned_by / catalog provider label.
 * Prefer public vendor segment of the publicized model id; else map raw owned_by
 * when it equals an aliased upstream vendor.
 */
export function toPublicOwnedBy(
	ownedBy: string | null | undefined,
	publicUpstreamId: string,
	aliases: VendorAliasMap,
): string {
	const fromId = vendorOf(String(publicUpstreamId || "").trim());
	if (fromId) return fromId;
	const raw = String(ownedBy || "").trim();
	if (!raw) return raw;
	for (const [real, pub] of Object.entries(aliases || {})) {
		if (
			real.toLowerCase() === raw.toLowerCase() &&
			pub &&
			pub.toLowerCase() !== real.toLowerCase()
		) {
			return pub;
		}
	}
	return raw;
}

/** Rewrite a bare vendor label across any provider alias map. */
export function publicizeOwnedByLabel(
	label: string | null | undefined,
	index: VendorAliasIndex,
): string {
	const raw = String(label ?? "").trim();
	if (!raw) return String(label ?? "");
	if (raw.includes("/")) return publicizeModelString(raw, index);
	for (const aliases of index.byProviderName.values()) {
		const mapped = toPublicOwnedBy(raw, "", aliases);
		if (mapped !== raw) return mapped;
	}
	return raw;
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
	// Collision disambiguator from logs: "phantom/amanai/x · ikan"
	const via = /^(.+?)\s+·\s+(\S+)$/.exec(trimmed);
	if (via) {
		return `${publicizeModelString(via[1], index)} · ${via[2]}`;
	}

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
		// Dates and other class instances are already safely serializable. Treating
		// them as records turns Date into `{}` and blanks client-facing timestamps.
		if (value instanceof Date) return value;
		const proto = Object.getPrototypeOf(value);
		if (proto !== Object.prototype && proto !== null) return value;
		const obj = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(obj)) {
			if (
				(k === "model" || k === "modelId" || k === "topModel") &&
				typeof v === "string"
			) {
				out[k] = publicizeModelString(v, index);
			} else if (k === "owned_by" && typeof v === "string") {
				// Catalog vendor label only — do not touch log `provider` (proxy name).
				out[k] = publicizeOwnedByLabel(v, index);
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

/** Expand candidate upstream ids with all real+public vendor forms (incl. collisions). */
export function expandUpstreamIdCandidates(
	rest: string,
	aliases: VendorAliasMap,
): string[] {
	const out: string[] = [];
	const add = (s: string) => {
		if (s && !out.includes(s)) out.push(s);
	};
	add(rest);
	for (const c of toRealUpstreamIdCandidates(rest, aliases)) add(c);
	add(toPublicUpstreamId(rest, aliases));
	return out;
}

/**
 * Raw upstream vendor is forbidden only when it was aliased away AND is not
 * also someone else's public name (chain/collision cases like tokito→ikan).
 * Error responses must stay generic (no alias leak).
 */
export function findForbiddenRawVendor(
	clientModel: string,
	providerName: string | null | undefined,
	aliases: VendorAliasMap,
): { rawVendor: string; publicVendor: string } | null {
	if (!aliases || !Object.keys(aliases).length) return null;
	let rest = String(clientModel || "").trim();
	if (!rest) return null;

	const prov = String(providerName || "").trim();
	if (prov) {
		const prefix = prov.toLowerCase() + "/";
		while (rest.toLowerCase().startsWith(prefix)) {
			rest = rest.slice(prov.length + 1);
		}
	}

	const vendor = vendorOf(rest);
	if (!vendor) return null;
	const vLower = vendor.toLowerCase();

	let publicVendor: string | null = null;
	for (const [real, pub] of Object.entries(aliases)) {
		if (
			real.toLowerCase() === vLower &&
			pub &&
			pub.toLowerCase() !== vLower
		) {
			publicVendor = pub;
			break;
		}
	}
	if (!publicVendor) return null;

	// Still a valid public name for another real vendor — allow.
	for (const [real, pub] of Object.entries(aliases)) {
		if (
			pub &&
			pub.toLowerCase() === vLower &&
			real.toLowerCase() !== vLower
		) {
			return null;
		}
	}

	return { rawVendor: vendor, publicVendor };
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
