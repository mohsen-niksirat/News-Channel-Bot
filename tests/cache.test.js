import test from 'node:test';
import assert from 'node:assert/strict';
import { LruTtlCache, cachedFetchText } from '../tgcloud/lib/cache.js';

test('cache.js: second call within TTL returns cached value without invoking fetch', async () => {
  let currentTime = 1000;
  const cache = new LruTtlCache({
    ttlMs: 10 * 60 * 1000, // 10 minutes
    getTime: () => currentTime,
  });

  let fetchCalls = 0;
  const mockFetch = async (url) => {
    fetchCalls++;
    return {
      ok: true,
      status: 200,
      async text() {
        return `response from ${url}`;
      },
    };
  };

  const testUrl = 'https://r.jina.ai/https://t.me/s/digiato';

  // First fetch
  const res1 = await cachedFetchText(testUrl, {}, mockFetch, cache);
  assert.strictEqual(res1, `response from ${testUrl}`);
  assert.strictEqual(fetchCalls, 1);

  // Advance time by 5 minutes (within 10-minute TTL)
  currentTime += 5 * 60 * 1000;

  // Second fetch - must be cached
  const res2 = await cachedFetchText(testUrl, {}, mockFetch, cache);
  assert.strictEqual(res2, `response from ${testUrl}`);
  assert.strictEqual(fetchCalls, 1, 'fetch must NOT be called again within TTL');
});

test('cache.js: TTL expiry causes refetch', async () => {
  let currentTime = 1000;
  const cache = new LruTtlCache({
    ttlMs: 600000, // 10 min
    getTime: () => currentTime,
  });

  let fetchCalls = 0;
  const mockFetch = async () => {
    fetchCalls++;
    return {
      ok: true,
      status: 200,
      async text() {
        return `fetch call #${fetchCalls}`;
      },
    };
  };

  const url = 'https://r.jina.ai/https://t.me/s/zoomit';

  const first = await cachedFetchText(url, {}, mockFetch, cache);
  assert.strictEqual(first, 'fetch call #1');
  assert.strictEqual(fetchCalls, 1);

  // Advance past 10 minutes (TTL expired)
  currentTime += 600001;

  const second = await cachedFetchText(url, {}, mockFetch, cache);
  assert.strictEqual(second, 'fetch call #2');
  assert.strictEqual(fetchCalls, 2, 'fetch must be called again after TTL expiry');
});

test('cache.js: LRU eviction at 51 entries (maxEntries = 50)', () => {
  let currentTime = 1000;
  const cache = new LruTtlCache({
    maxEntries: 50,
    ttlMs: 600000,
    getTime: () => currentTime,
  });

  // Insert 50 entries
  for (let i = 1; i <= 50; i++) {
    cache.set(`url_${i}`, `content_${i}`);
  }

  assert.strictEqual(cache.size, 50);
  assert.strictEqual(cache.get('url_1'), 'content_1');

  // Insert 51st entry
  cache.set('url_51', 'content_51');
  assert.strictEqual(cache.size, 50, 'Cache must not exceed maxEntries');

  // url_2 should be evicted because url_1 was accessed recently
  assert.strictEqual(cache.get('url_2'), null, 'Oldest unaccessed entry (url_2) should have been evicted');
  assert.strictEqual(cache.get('url_1'), 'content_1', 'Recently accessed url_1 must still exist');
  assert.strictEqual(cache.get('url_51'), 'content_51');
});
