/**
 * Tiny in-memory cache for the you.com agent tool-call round-trip.
 *
 * Flow:
 * 1. Client sends a request with `tools: [{name:"web_search",...}]` to `you/express`.
 * 2. Adapter calls you.com, gets an answer, and synthesizes a `tool_call` block
 *    with a generated `tool_call_id` (e.g. `call_<rand>`). The answer + sources
 *    are stored in this cache keyed by the `tool_call_id`.
 * 3. Client sends a follow-up turn with `role:"tool"` and `tool_call_id` matching
 *    the synthesized id. The adapter detects this and returns the cached answer
 *    directly without hitting you.com again.
 *
 * TTL is short (10 minutes) since the cache exists only to support the
 * immediate next-turn echo. Periodic prune runs on every `get` to keep the
 * map small.
 */

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 1024;

export interface CachedToolAnswer {
  answer: string;
  sources: Array<{ title: string; url: string }>;
  createdAt: number;
}

const cache = new Map<string, CachedToolAnswer>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [id, entry] of cache) {
    if (now - entry.createdAt > TTL_MS) {
      cache.delete(id);
    }
  }
  // Hard cap to avoid unbounded growth
  if (cache.size > MAX_ENTRIES) {
    const overflow = cache.size - MAX_ENTRIES;
    const it = cache.keys();
    for (let i = 0; i < overflow; i++) {
      const k = it.next().value;
      if (k) cache.delete(k);
    }
  }
}

export function putToolAnswer(id: string, answer: string, sources: Array<{ title: string; url: string }>): void {
  if (!id) return;
  cache.set(id, { answer, sources, createdAt: Date.now() });
  if (cache.size > MAX_ENTRIES) pruneExpired();
}

export function getToolAnswer(id: string): CachedToolAnswer | null {
  if (!id) return null;
  const entry = cache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(id);
    return null;
  }
  return entry;
}

export function _clearToolCache(): void {
  cache.clear();
}

export function _toolCacheSize(): number {
  return cache.size;
}
