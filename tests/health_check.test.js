import test from 'node:test';
import assert from 'node:assert/strict';
import { db, resetMockDb, setMockFetch } from 'sdk';
import { users, sources, customProviders, aiKeys, tokenUsage, posts } from 'schema';
import { wipeUserData } from 'lib/db';
import { runNightlyKeyHealthCheck } from 'lib/health_check';

test('runNightlyKeyHealthCheck: transitions key status on 401, 429 and 200', async () => {
  resetMockDb();

  // Create user
  await db.insert(users).values({ id: 1, tgId: 1001, name: 'Alice' }).run();

  // Add keys: key 1 (active), key 2 (active)
  await db.insert(aiKeys).values({
    id: 1,
    userId: 1,
    provider: 'gemini',
    apiKey: 'AIzaSy_fake_gemini_key_1',
    status: 'active',
  }).run();

  await db.insert(aiKeys).values({
    id: 2,
    userId: 1,
    provider: 'groq',
    apiKey: 'gsk_fake_groq_key_2',
    status: 'active',
  }).run();

  // Mock fetch: key 1 -> 429 Rate limit, key 2 -> 401 Unauthorized
  setMockFetch(async (url, opts) => {
    const auth = opts?.headers?.Authorization || '';
    if (auth.includes('AIzaSy_fake_gemini_key_1')) {
      return {
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      };
    }
    if (auth.includes('gsk_fake_groq_key_2')) {
      return {
        ok: false,
        status: 401,
        text: async () => 'Invalid API key',
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    };
  });

  const res = await runNightlyKeyHealthCheck(1001);
  assert.equal(res.changed, true);
  assert.equal(res.changes.length, 2);

  const k1 = await db.select().from(aiKeys).where((r) => r.id === 1).get();
  const k2 = await db.select().from(aiKeys).where((r) => r.id === 2).get();

  assert.equal(k1.status, 'cooldown');
  assert.equal(k2.status, 'dead');
  assert.ok(res.report.includes('گزارش شبانه'));

  // Run again with fetch returning 200: status should recover to active
  setMockFetch(async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'recovered' } }] }),
    };
  });

  const res2 = await runNightlyKeyHealthCheck(1001);
  assert.equal(res2.changed, true);
  const k1Recovered = await db.select().from(aiKeys).where((r) => r.id === 1).get();
  assert.equal(k1Recovered.status, 'active');

  // Run a third time while still 200: no status change -> changed: false
  const res3 = await runNightlyKeyHealthCheck(1001);
  assert.equal(res3.changed, false);
});

test('wipeUserData: deletes all user records across all tables', async () => {
  resetMockDb();

  // Setup user and related rows
  await db.insert(users).values({ id: 1, tgId: 9999, name: 'Bob' }).run();
  await db.insert(sources).values({ id: 10, userId: 1, name: 'Source A', type: 'rss' }).run();
  await db.insert(customProviders).values({ id: 20, userId: 1, name: 'Provider X', slug: 'c_test' }).run();
  await db.insert(aiKeys).values({ id: 30, userId: 1, provider: 'gemini', apiKey: 'key123', status: 'active' }).run();
  await db.insert(tokenUsage).values({ id: 40, userId: 1, provider: 'gemini', totalTokens: 500 }).run();
  await db.insert(posts).values({ id: 50, userId: 1, status: 'draft', aiTitle: 'Test Post' }).run();

  // Also setup another user that must NOT be deleted
  await db.insert(users).values({ id: 2, tgId: 8888, name: 'Other' }).run();
  await db.insert(sources).values({ id: 11, userId: 2, name: 'Source B', type: 'rss' }).run();

  // Wipe Bob
  const success = await wipeUserData(9999);
  assert.equal(success, true);

  // Assert Bob is completely gone
  const bob = await db.select().from(users).where((r) => r.tgId === 9999).get();
  assert.equal(bob, null);

  const bobSources = await db.select().from(sources).where((r) => r.userId === 1 || r.userId === 9999).all();
  assert.equal(bobSources.length, 0);

  const bobProviders = await db.select().from(customProviders).where((r) => r.userId === 1).all();
  assert.equal(bobProviders.length, 0);

  const bobKeys = await db.select().from(aiKeys).where((r) => r.userId === 1).all();
  assert.equal(bobKeys.length, 0);

  const bobTokens = await db.select().from(tokenUsage).where((r) => r.userId === 1).all();
  assert.equal(bobTokens.length, 0);

  const bobPosts = await db.select().from(posts).where((r) => r.userId === 1).all();
  assert.equal(bobPosts.length, 0);

  // Assert Other user is intact
  const other = await db.select().from(users).where((r) => r.tgId === 8888).get();
  assert.notEqual(other, null);
  const otherSources = await db.select().from(sources).where((r) => r.userId === 2).all();
  assert.equal(otherSources.length, 1);
});
