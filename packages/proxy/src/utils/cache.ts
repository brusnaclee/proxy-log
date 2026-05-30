/**
 * Simple in-memory TTL cache for frequently-read, rarely-written data.
 *
 * Usage:
 *   const cache = new MemoryCache<MyType>(60_000); // 60s TTL
 *   const value = await cache.getOrFetch("key", () => expensiveQuery());
 *   cache.invalidate("key"); // after a write
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class MemoryCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number) {
    this.defaultTtlMs = defaultTtlMs;
  }

  /** Get a value if it exists and hasn't expired. */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Set a value with optional custom TTL. */
  set(key: string, value: T, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  /**
   * Get from cache or fetch using the provided function.
   * Only one concurrent fetch per key (coalescing).
   */
  private pending = new Map<string, Promise<T>>();

  async getOrFetch(key: string, fetcher: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    // Coalesce concurrent requests for the same key
    const inflight = this.pending.get(key);
    if (inflight) return inflight;

    const promise = fetcher().then((value) => {
      this.set(key, value, ttlMs);
      this.pending.delete(key);
      return value;
    }).catch((err) => {
      this.pending.delete(key);
      throw err;
    });

    this.pending.set(key, promise);
    return promise;
  }

  /** Remove a specific key from cache. */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Remove all entries. */
  clear(): void {
    this.store.clear();
  }

  /** Number of entries currently in cache. */
  get size(): number {
    return this.store.size;
  }
}

// ─── Shared cache instances ─────────────────────────────────────────────────
// Admin config changes infrequently; 30s TTL is safe.
export const configCache = new MemoryCache<any>(30_000);

// Provider list changes infrequently; 30s TTL.
export const providerCache = new MemoryCache<any>(30_000);

// API key lookup by key string; 10s TTL (short because keys can be rotated/disabled).
export const apiKeyCache = new MemoryCache<any>(10_000);

// Stats aggregate cache; 60s TTL (dashboard doesn't need real-time accuracy).
export const statsCache = new MemoryCache<any>(60_000);
