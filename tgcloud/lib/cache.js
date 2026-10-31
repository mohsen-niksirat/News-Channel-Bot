// NewsStudio 2026 — LRU + TTL Cache (10-minute TTL, max 50 entries)
// Caches Jina Reader and HTTP fetches to avoid redundant network calls

export class LruTtlCache {
  /**
   * @param {object} [options]
   * @param {number} [options.maxEntries=50]
   * @param {number} [options.ttlMs=600000] 10 minutes in ms
   * @param {() => number} [options.getTime]
   */
  constructor(options = {}) {
    this.maxEntries = options.maxEntries || 50;
    this.ttlMs = options.ttlMs !== undefined ? options.ttlMs : 10 * 60 * 1000;
    this.getTime = typeof options.getTime === 'function' ? options.getTime : () => Date.now();
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return null;
    const entry = this.map.get(key);
    const now = this.getTime();
    if (now - entry.createdAt > this.ttlMs) {
      this.map.delete(key);
      return null;
    }
    // Refresh LRU ordering
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      // Evict oldest (first inserted / least recently accessed)
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }

    this.map.set(key, {
      value,
      createdAt: this.getTime(),
    });
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

export const globalJinaCache = new LruTtlCache({
  maxEntries: 50,
  ttlMs: 10 * 60 * 1000,
});

/**
 * Pure wrapper around fetch that caches HTTP GET response text for TTL ms
 * @param {string} url
 * @param {object} [options]
 * @param {Function} [fetchFn]
 * @param {LruTtlCache} [cache]
 * @returns {Promise<string>}
 */
export async function cachedFetchText(url, options = {}, fetchFn = fetch, cache = globalJinaCache) {
  if (cache) {
    const cached = cache.get(url);
    if (cached !== null) {
      return cached;
    }
  }

  const res = await fetchFn(url, options);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const text = await res.text();
  if (cache) {
    cache.set(url, text);
  }
  return text;
}
