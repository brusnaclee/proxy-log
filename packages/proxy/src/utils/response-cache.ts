/**
 * Response Cache for Deduplicating Upstream Requests
 *
 * When an IDE sends the same request multiple times (retries, fan-out),
 * this cache returns the cached response instead of hitting upstream again.
 *
 * Cache key: SHA256(model + ":" + messageHash + ":" + sessionId)
 * TTL: 120 seconds
 * Max entries: 1000 (LRU eviction)
 */

import { sha256 } from "./crypto.js";

interface CacheEntry {
  key: string;
  statusCode: number;
  headers: Record<string, string>;
  body: Uint8Array;        // Non-streaming response body
  streamChunks: Uint8Array[];  // Streaming SSE chunks
  isStreaming: boolean;
  createdAt: number;
  model: string;
  messageHash: string;
}

const CACHE_TTL_MS = 120_000; // 120 seconds
const MAX_ENTRIES = 1000;
const cache = new Map<string, CacheEntry>();

/**
 * Generate a cache key from request parameters.
 * Returns null if the request shouldn't be cached.
 */
export function getCacheKey(
  model: string,
  messageHash: string | null,
  sessionId: string,
): string | null {
  if (!messageHash || !model || !sessionId) return null;
  return sha256(`${model}:${messageHash}:${sessionId}`);
}

/**
 * Look up a cached response.
 * Returns the entry if found and not expired, otherwise null.
 */
export function getCachedResponse(cacheKey: string): CacheEntry | null {
  const entry = cache.get(cacheKey);
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    cache.delete(cacheKey);
    return null;
  }

  return entry;
}

/**
 * Store a non-streaming response in the cache.
 */
export function cacheResponse(
  cacheKey: string,
  model: string,
  messageHash: string,
  statusCode: number,
  headers: Record<string, string>,
  body: Uint8Array,
): void {
  evictIfNeeded();

  cache.set(cacheKey, {
    key: cacheKey,
    statusCode,
    headers,
    body,
    streamChunks: [],
    isStreaming: false,
    createdAt: Date.now(),
    model,
    messageHash,
  });
}

/**
 * Store a streaming response in the cache.
 * Call this after the stream is fully consumed.
 */
export function cacheStreamResponse(
  cacheKey: string,
  model: string,
  messageHash: string,
  statusCode: number,
  headers: Record<string, string>,
  chunks: Uint8Array[],
): void {
  evictIfNeeded();

  cache.set(cacheKey, {
    key: cacheKey,
    statusCode,
    headers,
    body: new Uint8Array(0),
    streamChunks: chunks,
    isStreaming: true,
    createdAt: Date.now(),
    model,
    messageHash,
  });
}

/**
 * Invalidate a cache entry (e.g., when a new/different request comes in for the same session).
 */
export function invalidateCache(cacheKey: string): void {
  cache.delete(cacheKey);
}

/**
 * Invalidate all cache entries for a specific session.
 */
export function invalidateSessionCache(sessionId: string): void {
  for (const [key, entry] of cache.entries()) {
    // The cache key includes sessionId, but we can't easily extract it.
    // Instead, we rely on TTL expiration for session-level cleanup.
    // This function is for explicit invalidation if needed.
  }
}

/**
 * Evict oldest entries if cache is full.
 */
function evictIfNeeded(): void {
  if (cache.size >= MAX_ENTRIES) {
    // Find and delete the oldest entry
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }
}

/**
 * Get cache stats for monitoring.
 */
export function getCacheStats(): { size: number; hitRate: number } {
  return {
    size: cache.size,
    hitRate: 0, // TODO: track hits/misses
  };
}

/**
 * Clear all cache entries.
 */
export function clearCache(): void {
  cache.clear();
}
