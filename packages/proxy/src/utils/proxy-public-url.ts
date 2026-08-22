/** Production default when PROXY_PUBLIC_BASE_URL is unset (matches portal). */
const DEFAULT_PUBLIC_BASE = "https://api.tokito.xyz";

/** Base URL without trailing slash or `/v1` suffix. */
export function getProxyPublicBaseUrl(): string {
	const raw = String(process.env.PROXY_PUBLIC_BASE_URL || "").trim();
	const base = raw || DEFAULT_PUBLIC_BASE;
	return base.replace(/\/v1\/?$/i, "").replace(/\/$/, "");
}

/** OpenAI-compatible API root, e.g. https://api.tokito.xyz/v1 */
export function getProxyPublicEndpoint(): string {
	return `${getProxyPublicBaseUrl()}/v1`;
}
