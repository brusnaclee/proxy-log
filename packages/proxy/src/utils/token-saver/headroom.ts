// Headroom — optional external compression service.
//
// POSTs the OpenAI-format body to a configured `/v1/compress` endpoint that
// returns a shortened messages array. Best-effort with a short timeout;
// on any failure we return the body unchanged (fail-open).

const HEADROOM_TIMEOUT_MS = 3000;

export interface HeadroomStats {
	invoked: boolean;
	ok: boolean;
	error?: string;
	beforeChars?: number;
	afterChars?: number;
}

function measureBodyChars(body: any): number {
	try {
		return JSON.stringify(body?.messages ?? []).length;
	} catch {
		return 0;
	}
}

export async function applyHeadroom(
	body: any,
	url: string,
): Promise<HeadroomStats> {
	const stats: HeadroomStats = { invoked: false, ok: false };
	if (!url || typeof url !== 'string') return stats;
	if (!body || !Array.isArray(body.messages)) return stats;

	stats.invoked = true;
	stats.beforeChars = measureBodyChars(body);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), HEADROOM_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messages: body.messages, model: body.model }),
			signal: controller.signal,
		});
		if (!res.ok) {
			stats.error = `HTTP ${res.status}`;
			return stats;
		}
		const data = await res.json().catch(() => null);
		if (data && Array.isArray((data as any).messages) && (data as any).messages.length > 0) {
			body.messages = (data as any).messages;
			stats.ok = true;
			stats.afterChars = measureBodyChars(body);
		} else {
			stats.error = 'invalid_response';
		}
	} catch (err: any) {
		stats.error = err?.name === 'AbortError' ? 'timeout' : String(err?.message || 'error');
	} finally {
		clearTimeout(timer);
	}
	return stats;
}
