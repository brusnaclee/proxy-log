/**
 * Tokito grok-cli (gcli/grok-*) often returns flaky 400s:
 *   grep_search: tool parameter root must be an object type (reset after Ns)
 * even with no client tools. Treat as transient and retest before surfacing 502.
 */

export const GROK_TRANSIENT_MAX_ATTEMPTS = 5;
export const GROK_RESET_AFTER_CAP_MS = 15_000;

/** Model ids routed through Tokito grok-cli / xAI grok farm. */
export function isGrokCliModel(modelId: string | null | undefined): boolean {
	const m = String(modelId || "").toLowerCase();
	if (!m) return false;
	if (m.includes("gcli/") || m.includes("grok-cli/")) return true;
	// Nested: tokito/gcli/grok-4.5, gcli/grok-4.5, tokito/grok-4.5
	if (/(^|\/)grok-/.test(m)) return true;
	return false;
}

/** Body text from upstream 400 that should be retried. */
export function isGrokTransientErrorBody(body: string | null | undefined): boolean {
	const t = String(body || "").toLowerCase();
	if (!t) return false;
	if (t.includes("grep_search") && (t.includes("invalid-argument") || t.includes("must be an object"))) {
		return true;
	}
	if (t.includes("reset after") && (t.includes("grok") || t.includes("grep_search"))) {
		return true;
	}
	return false;
}

/** Parse `(reset after 11s)` → ms; 0 if missing. */
export function parseGrokResetAfterMs(body: string | null | undefined): number {
	const m = String(body || "").match(/reset\s+after\s+(\d+)\s*s/i);
	if (!m) return 0;
	const sec = Number(m[1]);
	if (!Number.isFinite(sec) || sec <= 0) return 0;
	return Math.min(sec * 1000, GROK_RESET_AFTER_CAP_MS);
}

export function grokTransientBackoffMs(attempt: number, body?: string | null): number {
	const fromMsg = parseGrokResetAfterMs(body);
	if (fromMsg > 0) return fromMsg;
	// 1s, 2s, 4s, 8s, 15s capped
	return Math.min(1000 * 2 ** Math.max(0, attempt - 1), GROK_RESET_AFTER_CAP_MS);
}
