import test from 'node:test';
import assert from 'node:assert/strict';
import { db, resetMockDb, setMockFetch } from 'sdk';
import { aiKeys, users } from 'schema';
import { markKeyResult, getNextAvailableKey, generateNewsRewrite } from 'lib/ai_router';

test('markKeyResult: transitions status to cooldown on 429 and dead on 401', async () => {
  resetMockDb();

  // Insert test keys
  await db.insert(aiKeys).values({
    id: 1,
    userId: 100,
    provider: 'gemini',
    apiKey: 'key_1',
    status: 'active',
    failureCount: 0,
  }).run();

  await db.insert(aiKeys).values({
    id: 2,
    userId: 100,
    provider: 'gemini',
    apiKey: 'key_2',
    status: 'active',
    failureCount: 0,
  }).run();

  // Test 429 cooldown
  await markKeyResult(1, false, 429);
  const k1 = await db.select().from(aiKeys).where((r) => r.id === 1).get();
  assert.equal(k1.status, 'cooldown');
  assert.equal(k1.cooldownUntil > Math.floor(Date.now() / 1000), true);

  // Test 401 dead
  await markKeyResult(2, false, 401);
  const k2 = await db.select().from(aiKeys).where((r) => r.id === 2).get();
  assert.equal(k2.status, 'dead');

  // Test recovery on success
  await markKeyResult(1, true, 200);
  const k1Rev = await db.select().from(aiKeys).where((r) => r.id === 1).get();
  assert.equal(k1Rev.status, 'active');
  assert.equal(k1Rev.failureCount, 0);
});

test('getNextAvailableKey: policy ordering behaves according to fallback, round_robin, and smart_router', async () => {
  resetMockDb();

  // Insert 3 keys with different attributes
  // Key A: sortOrder 1, lastUsedAt 1000, failureCount 2
  await db.insert(aiKeys).values({
    id: 10,
    userId: 200,
    provider: 'groq',
    apiKey: 'key_a',
    status: 'active',
    sortOrder: 1,
    lastUsedAt: 1000,
    failureCount: 2,
  }).run();

  // Key B: sortOrder 2, lastUsedAt 500, failureCount 0
  await db.insert(aiKeys).values({
    id: 20,
    userId: 200,
    provider: 'groq',
    apiKey: 'key_b',
    status: 'active',
    sortOrder: 2,
    lastUsedAt: 500,
    failureCount: 0,
  }).run();

  // 1. Fallback policy -> should pick lowest sortOrder (Key A, id 10)
  const keyFallback = await getNextAvailableKey('groq', 200, 'fallback');
  assert.equal(keyFallback.id, 10);

  // 2. Round-robin policy -> should pick oldest lastUsedAt (Key B, id 20)
  const keyRR = await getNextAvailableKey('groq', 200, 'round_robin');
  assert.equal(keyRR.id, 20);

  // 3. Smart-router policy -> should pick lowest failureCount (Key B, id 20)
  const keySmart = await getNextAvailableKey('groq', 200, 'smart_router');
  assert.equal(keySmart.id, 20);
});

test('generateNewsRewrite: fails over to next key when first key encounters 429', async () => {
  resetMockDb();

  // Setup user
  await db.insert(users).values({
    id: 1,
    tgId: 300,
    name: 'TestUser',
  }).run();

  // Insert 2 keys for gemini: Key 1 and Key 2
  await db.insert(aiKeys).values({
    id: 101,
    userId: 300,
    provider: 'gemini',
    apiKey: 'failing_key_429',
    status: 'active',
    sortOrder: 1,
  }).run();

  await db.insert(aiKeys).values({
    id: 102,
    userId: 300,
    provider: 'gemini',
    apiKey: 'working_key',
    status: 'active',
    sortOrder: 2,
  }).run();

  let callCount = 0;
  setMockFetch(async (url, opts) => {
    callCount++;
    const authHeader = opts?.headers?.Authorization || '';
    if (authHeader.includes('failing_key_429')) {
      return {
        ok: false,
        status: 429,
        async text() { return 'Rate limit exceeded'; },
      };
    }
    // Working key
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [
            { message: { content: '[TITLE]: تیتر موفق\n[SUMMARY]: خلاصه متن خبر' } }
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        };
      },
    };
  });

  const res = await generateNewsRewrite({
    systemPrompt: 'System',
    userPrompt: 'News Content',
    preferredProvider: 'gemini',
    userId: 300,
  });

  setMockFetch(null);

  assert.equal(res.text.includes('تیتر موفق'), true);
  assert.equal(callCount >= 2, true, 'Must have attempted first key and then failed over to second key');

  // Verify first key was placed in cooldown
  const k1 = await db.select().from(aiKeys).where((r) => r.id === 101).get();
  assert.equal(k1.status, 'cooldown');

  // Verify second key remained active
  const k2 = await db.select().from(aiKeys).where((r) => r.id === 102).get();
  assert.equal(k2.status, 'active');
});
