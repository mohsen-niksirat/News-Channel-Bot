import test from 'node:test';
import assert from 'node:assert/strict';
import { db, resetMockDb } from 'sdk';
import { users, posts } from 'schema';
import {
  getTopDigestPostsForUser,
  buildDailyDigestBulletin,
  shouldPublishDailyDigestNow,
} from '../tgcloud/lib/digest.js';

test('digest.js: getTopDigestPostsForUser selects top 8 posts ordered by importance DESC, then recency DESC', async () => {
  resetMockDb();

  const now = Math.floor(Date.now() / 1000);

  // Setup user
  await db.insert(users).values({
    id: 10,
    tgId: 1000,
    name: 'DigestTester',
    channelId: '@my_digest_chan',
  }).run();

  // Create 10 posts with varying importance and timestamps
  // P1: importance 5, older (now - 3000)
  // P2: importance 5, newer (now - 1000) -> should be first!
  // P3: importance 4, now - 500
  // P4: importance 3, now - 200
  // P5: importance 2, now - 100
  // P6: importance 1, now - 50
  // P7: importance 4, now - 600
  // P8: importance 5, now - 2000
  // P9: importance 1, now - 10
  // P10: older than 24h (now - 100000) -> must be excluded!
  // P11: status 'rejected' -> must be excluded!

  const testPosts = [
    { id: 1, userId: 10, originalTitle: 'Post 1', originalHash: 'h1', importance: 5, createdAt: now - 3000, status: 'published' },
    { id: 2, userId: 10, originalTitle: 'Post 2 (Top)', originalHash: 'h2', importance: 5, createdAt: now - 1000, status: 'published' },
    { id: 3, userId: 10, originalTitle: 'Post 3', originalHash: 'h3', importance: 4, createdAt: now - 500, status: 'published' },
    { id: 4, userId: 10, originalTitle: 'Post 4', originalHash: 'h4', importance: 3, createdAt: now - 200, status: 'draft' },
    { id: 5, userId: 10, originalTitle: 'Post 5', originalHash: 'h5', importance: 2, createdAt: now - 100, status: 'published' },
    { id: 6, userId: 10, originalTitle: 'Post 6', originalHash: 'h6', importance: 1, createdAt: now - 50, status: 'draft' },
    { id: 7, userId: 10, originalTitle: 'Post 7', originalHash: 'h7', importance: 4, createdAt: now - 600, status: 'published' },
    { id: 8, userId: 10, originalTitle: 'Post 8', originalHash: 'h8', importance: 5, createdAt: now - 2000, status: 'published' },
    { id: 9, userId: 10, originalTitle: 'Post 9', originalHash: 'h9', importance: 1, createdAt: now - 10, status: 'published' },
    { id: 10, userId: 10, originalTitle: 'Post 10 (Too Old)', originalHash: 'h10', importance: 5, createdAt: now - 100000, status: 'published' },
    { id: 11, userId: 10, originalTitle: 'Post 11 (Rejected)', originalHash: 'h11', importance: 5, createdAt: now - 100, status: 'rejected' },
  ];

  for (const p of testPosts) {
    await db.insert(posts).values(p).run();
  }

  const selected = await getTopDigestPostsForUser(10, 8);

  // Maximum 8 posts returned
  assert.strictEqual(selected.length, 8);

  // Too old and rejected posts must not be in selected
  assert.strictEqual(selected.some((p) => p.id === 10), false);
  assert.strictEqual(selected.some((p) => p.id === 11), false);

  // Ordering check: All importance 5 posts must come before importance 4
  const imp5Posts = selected.filter((p) => p.importance === 5);
  assert.strictEqual(imp5Posts.length, 3);
  // Among importance 5: Post 2 (now - 1000) > Post 8 (now - 2000) > Post 1 (now - 3000)
  assert.strictEqual(selected[0].id, 2);
  assert.strictEqual(selected[1].id, 8);
  assert.strictEqual(selected[2].id, 1);

  // Next: importance 4: Post 3 (now - 500) > Post 7 (now - 600)
  assert.strictEqual(selected[3].id, 3);
  assert.strictEqual(selected[4].id, 7);
});

test('digest.js: buildDailyDigestBulletin returns graceful empty message when no posts exist', () => {
  const user = { channelId: '@test_channel', footerText: '📢 @MyLeitner' };
  const emptyDigest = buildDailyDigestBulletin({ user, posts: [] });

  assert.strictEqual(emptyDigest.empty, true);
  assert.strictEqual(emptyDigest.count, 0);
  assert.ok(emptyDigest.html.includes('روزنامه صبحگاهی'));
  assert.ok(emptyDigest.html.includes('خبر مهمی برای چاپ روزنامه ثبت نشده است'));
});

test('digest.js: buildDailyDigestBulletin builds formatted morning newspaper bulletin with date', () => {
  const user = { channelId: '@tech_today', footerText: '📢 کانال خبر: @tech_today' };
  const fakePosts = [
    { aiTitle: 'رونمایی از محصول فضایی', aiSummary: 'یک شرکت فضایی نسل جدید راکت خود را پرتاب کرد.', sourceName: 'Zoomit', sourceUrl: 'https://zoomit.ir/space' },
    { aiTitle: 'رشد چشمگیر اقتصاد دیجیتال', aiSummary: 'گزارش سالانه اقتصاد دیجیتال منتشر شد.', sourceName: 'Digiato', sourceUrl: 'https://digiato.com/fintech' },
  ];

  const fixedDate = new Date('2026-10-31T06:30:00Z');
  const digest = buildDailyDigestBulletin({ user, posts: fakePosts, date: fixedDate });

  assert.strictEqual(digest.empty, false);
  assert.strictEqual(digest.count, 2);
  assert.ok(digest.html.includes('روزنامه صبحگاهی'));
  assert.ok(digest.html.includes('رونمایی از محصول فضایی'));
  assert.ok(digest.html.includes('رشد چشمگیر اقتصاد دیجیتال'));
  assert.ok(digest.html.includes('📢 کانال خبر: @tech_today'));
});

test('digest.js: shouldPublishDailyDigestNow respects first window of scheduleWindows', () => {
  // Case 1: No scheduleWindows -> unrestricted (always true)
  const userNoSchedule = { scheduleWindows: null };
  assert.strictEqual(shouldPublishDailyDigestNow(userNoSchedule), true);

  // Case 2: User with multiple scheduleWindows (e.g. 09:00 and 18:00)
  // Simplest correct rule: daily digest publishes at the FIRST window of the day (09:00 Tehran)
  const userWithSchedule = { scheduleWindows: JSON.stringify(['09:00', '18:00']) };

  // 09:00 Tehran is 05:30 UTC
  const atFirstWindow = new Date('2026-06-15T05:30:00Z');
  assert.strictEqual(shouldPublishDailyDigestNow(userWithSchedule, atFirstWindow), true);

  // Outside first window (e.g. at 14:00 Tehran = 10:30 UTC)
  const outsideFirstWindow = new Date('2026-06-15T10:30:00Z');
  assert.strictEqual(shouldPublishDailyDigestNow(userWithSchedule, outsideFirstWindow), false);
});
