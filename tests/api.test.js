import test from 'node:test';
import assert from 'node:assert/strict';
import { db, resetMockDb } from 'sdk';
import { users, posts, aiKeys, sources, tokenUsage } from 'schema';
import apiHandler, { validateApiAuth } from '../tgcloud/endpoints/api.js';
import { hashString } from '../tgcloud/lib/harvester.js';

test('api.js: validateApiAuth handles tokens, initData, and unauthenticated requests', () => {
  const uid = 12345678;
  const validToken = `${uid}:${hashString(`newsstudio_auth_${uid}`)}`;
  const invalidToken = `${uid}:invalid_hash_signature`;

  // 1. Unauthenticated request without token/initData
  const unauth = validateApiAuth({ action: 'draft/action', id: 1 }, {});
  assert.strictEqual(unauth.authenticated, false);
  assert.strictEqual(unauth.userId, null);

  // 2. Valid signed token
  const authWithToken = validateApiAuth({ token: validToken }, {});
  assert.strictEqual(authWithToken.authenticated, true);
  assert.strictEqual(authWithToken.userId, uid);
  assert.strictEqual(authWithToken.source, 'signed_token');

  // 3. Invalid token signature
  const authWithBadToken = validateApiAuth({ token: invalidToken }, {});
  assert.strictEqual(authWithBadToken.authenticated, false);

  // 4. Raw initData parameter
  const rawInitData = `user=${encodeURIComponent(JSON.stringify({ id: uid, first_name: 'Tester' }))}&hash=abcdef123456`;
  const authWithInitData = validateApiAuth({ initData: rawInitData }, {});
  assert.strictEqual(authWithInitData.authenticated, true);
  assert.strictEqual(authWithInitData.userId, uid);
  assert.strictEqual(authWithInitData.source, 'raw_init_data');

  // 5. Read-only fallback for Mini App dashboard load
  const readOnlyAuth = validateApiAuth({ action: 'overview', userId: uid }, {});
  assert.strictEqual(readOnlyAuth.authenticated, true);
  assert.strictEqual(readOnlyAuth.userId, uid);
  assert.strictEqual(readOnlyAuth.source, 'readonly_uid');
});

test('api.js: endpoint overview, drafts, and keys/sources return structured data', async () => {
  resetMockDb();
  const testUid = 88889999;
  const token = `${testUid}:${hashString(`newsstudio_auth_${testUid}`)}`;

  // Insert user
  await db.insert(users).values({
    id: 1,
    tgId: testUid,
    name: 'DashboardUser',
    channelId: '@my_test_channel',
    footerText: '📢 @my_test_channel',
    autoPublish: false,
    toneProfile: 'analytical',
  }).run();

  // Insert an AI key
  await db.insert(aiKeys).values({
    id: 1,
    userId: 1,
    provider: 'gemini',
    apiKey: 'AIzaSyFakeKeyForTest1234567890',
    label: 'Primary Gemini',
    status: 'active',
  }).run();

  // Insert a source
  await db.insert(sources).values({
    id: 1,
    userId: 1,
    name: 'TechCrunch',
    type: 'rss',
    urlOrHandle: 'https://techcrunch.com/feed/',
    categories: '["tech","ai"]',
    enabled: true,
  }).run();

  // Insert posts: 1 draft, 1 published today
  const now = Math.floor(Date.now() / 1000);
  await db.insert(posts).values({
    id: 101,
    userId: 1,
    sourceName: 'TechCrunch',
    sourceUrl: 'https://techcrunch.com/post-1',
    originalTitle: 'Draft Article',
    originalHash: 'hash101',
    aiTitle: 'عنوان پیش‌نویس',
    aiSummary: 'خلاصه تست پیش‌نویس برای داشبورد',
    formattedHtml: '🔹 <b>عنوان پیش‌نویس</b>\nخلاصه',
    status: 'draft',
    createdAt: now,
    importance: 4,
    category: 'tech',
  }).run();

  await db.insert(posts).values({
    id: 102,
    userId: 1,
    sourceName: 'TechCrunch',
    sourceUrl: 'https://techcrunch.com/post-2',
    originalTitle: 'Published Article',
    originalHash: 'hash102',
    aiTitle: 'پست منتشر شده',
    aiSummary: 'خلاصه پست منتشر شده',
    status: 'published',
    createdAt: now,
    importance: 5,
    category: 'ai',
  }).run();

  // Test action: 'overview'
  const overviewRes = await apiHandler({ action: 'overview', token }, {});
  assert.strictEqual(overviewRes.ok, true);
  assert.strictEqual(overviewRes.stats.draftsCount, 1);
  assert.strictEqual(overviewRes.stats.publishedToday, 1);
  assert.strictEqual(overviewRes.stats.channelId, '@my_test_channel');
  assert.strictEqual(overviewRes.stats.toneProfile, 'analytical');
  assert.strictEqual(overviewRes.stats.keysHealth.active, 1);
  assert.strictEqual(overviewRes.stats.keysHealth.total, 1);

  // Test action: 'drafts'
  const draftsRes = await apiHandler({ action: 'drafts', token }, {});
  assert.strictEqual(draftsRes.ok, true);
  assert.strictEqual(draftsRes.drafts.length, 1);
  assert.strictEqual(draftsRes.drafts[0].id, 101);
  assert.strictEqual(draftsRes.drafts[0].title, 'عنوان پیش‌نویس');
  assert.strictEqual(draftsRes.drafts[0].importance, 4);
  assert.strictEqual(draftsRes.drafts[0].category, 'tech');

  // Test action: 'keys/sources'
  const keysSourcesRes = await apiHandler({ action: 'keys/sources', token }, {});
  assert.strictEqual(keysSourcesRes.ok, true);
  assert.strictEqual(keysSourcesRes.keys.length, 1);
  // Masked key must hide full secret
  assert.match(keysSourcesRes.keys[0].maskedKey, /\.\.\./);
  assert.strictEqual(keysSourcesRes.sources.length, 1);
  assert.strictEqual(keysSourcesRes.sources[0].name, 'TechCrunch');
});

test('api.js: action draft/action handles publish, reject, and edit with auth gate', async () => {
  resetMockDb();
  const testUid = 77778888;
  const token = `${testUid}:${hashString(`newsstudio_auth_${testUid}`)}`;

  await db.insert(users).values({
    id: 2,
    tgId: testUid,
    name: 'ActionTester',
    channelId: '@action_channel',
    footerText: '📢 @action_channel',
    autoPublish: false,
  }).run();

  const now = Math.floor(Date.now() / 1000);
  await db.insert(posts).values({
    id: 201,
    userId: 2,
    sourceName: 'The Verge',
    sourceUrl: 'https://theverge.com/item-201',
    originalTitle: 'Item to publish',
    originalHash: 'hash201',
    aiTitle: 'تیتر اولیه',
    aiSummary: 'متن خلاصه اولیه',
    formattedHtml: '🔹 <b>تیتر اولیه</b>\nمتن خلاصه اولیه',
    status: 'draft',
    createdAt: now,
  }).run();

  // 1. Unauthenticated draft/action is rejected with status 401
  const unauthRes = await apiHandler({ action: 'draft/action', id: 201, actionType: 'publish' }, {});
  assert.strictEqual(unauthRes.ok, false);
  assert.strictEqual(unauthRes.status, 401);

  // 2. Edit draft title and summary
  const editRes = await apiHandler({
    action: 'draft/action',
    actionType: 'edit',
    id: 201,
    title: 'تیتر ویرایش شده',
    summary: 'متن خلاصه بازنویسی شده',
    token,
  }, {});
  assert.strictEqual(editRes.ok, true);
  assert.strictEqual(editRes.action, 'edit');

  const editedPost = await db.select().from(posts).where((p) => p.id === 201).get();
  assert.strictEqual(editedPost.aiTitle, 'تیتر ویرایش شده');
  assert.strictEqual(editedPost.aiSummary, 'متن خلاصه بازنویسی شده');

  // 3. Publish draft
  const pubRes = await apiHandler({
    action: 'draft/action',
    actionType: 'publish',
    id: 201,
    token,
  }, {});
  assert.strictEqual(pubRes.ok, true);
  assert.strictEqual(pubRes.action, 'publish');

  const publishedPost = await db.select().from(posts).where((p) => p.id === 201).get();
  assert.strictEqual(publishedPost.status, 'published');

  // 4. Reject another draft
  await db.insert(posts).values({
    id: 202,
    userId: 2,
    sourceName: 'The Verge',
    sourceUrl: 'https://theverge.com/item-202',
    originalTitle: 'Item to reject',
    originalHash: 'hash202',
    aiTitle: 'تیتر رد شونده',
    aiSummary: 'خلاصه',
    status: 'draft',
    createdAt: now,
  }).run();

  const rejRes = await apiHandler({
    action: 'draft/action',
    actionType: 'reject',
    id: 202,
    token,
  }, {});
  assert.strictEqual(rejRes.ok, true);
  assert.strictEqual(rejRes.action, 'reject');

  const rejectedPost = await db.select().from(posts).where((p) => p.id === 202).get();
  assert.strictEqual(rejectedPost.status, 'rejected');
});
