/**
 * Sanitize headers before forwarding to upstream providers.
 * Some gateways (e.g. amanai) WAF-block OpenAI Python SDK User-Agents
 * (`OpenAI/Python …`) and stainless fingerprint headers → 403 → proxy 502.
 * Original client UA is kept for local IDE/device logging; only the
 * forwarded copy is rewritten.
 *
 * Keys are normalized to lowercase so we never send duplicate headers like
 * `Content-Type` + `content-type` (1inference returns HTTP 500 on that).
 */
const STRIP_HEADER_PREFIXES = [
  "x-stainless-",
  "openai-client-",
  "x-openai-",
  "cf-",
];

const STRIP_EXACT = new Set([
  "user-agent",
  "x-stainless-lang",
  "x-stainless-package-version",
  "x-stainless-runtime",
  "x-stainless-runtime-version",
  "x-stainless-arch",
  "x-stainless-os",
  "x-stainless-async",
  "x-stainless-helper-method",
  "x-stainless-retry-count",
  "x-stainless-timeout",
  "cdn-loop",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cf-warp-tag-id",
  "sec-gpc",
  "x-forwarded-proto",
]);

export const UPSTREAM_USER_AGENT = "TokitoProxy/1.0";

export function sanitizeUpstreamHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (STRIP_EXACT.has(lower)) continue;
    if (STRIP_HEADER_PREFIXES.some((p) => lower.startsWith(p))) continue;
    // Lowercase keys prevent undici from emitting duplicate Content-Type lines.
    out[lower] = value;
  }
  out["user-agent"] = UPSTREAM_USER_AGENT;
  return out;
}
