import test from 'node:test';
import assert from 'node:assert/strict';
import { db, resetMockDb, setMockFetch, sentMessages } from 'sdk';
import { users, sources, aiKeys, posts } from 'schema';
import { runScanForUser } from 'lib/scanner';
import { buildBulletinPost, preparePostForPublishing } from 'lib/rich_post';

test('[TITLE]/[SUMMARY]/[DETAILS] parsing logic in preparePostForPublishing and editorial format', () => {
  const fullText = `[TITLE]: رونمایی از محصول انقلابی
[SUMMARY]: این محصول با کارایی بالا و مصرف انرژی بهینه معرفی شد.
[DETAILS]: نکات کلیدی:
- باتری با دوام ۴۸ ساعت
- طراحی سبک و مقاوم`;

  const tMatch = fullText.match(/\[TITLE\]:?\s*([^\n]+)/i);
  const sMatch = fullText.match(/\[SUMMARY\]:?\s*([\s\S]*?)(?=\[DETAILS\]|$)/i);
  const dMatch = fullText.match(/\[DETAILS\]:?\s*([\s\S]*?)$/i);

  assert.equal(Boolean(tMatch), true);
  assert.equal(tMatch[1].trim(), 'رونمایی از محصول انقلابی');
  assert.equal(sMatch[1].trim().includes('مصرف انرژی بهینه'), true);
  assert.equal(dMatch[1].trim().includes('باتری با دوام'), true);

  const formatted = preparePostForPublishing({
    post: {
      aiTitle: tMatch[1].trim(),
      aiSummary: sMatch[1].trim(),
      sourceName: 'Zoomit',
      sourceUrl: 'https://zoomit.ir/sample',
    },
    user: {
      channelId: '@theNews_Persian',
      footerText: '📢 کانال خبر : @theNews_Persian\n📢 کانال مرجع: @MyLeitner',
    },
  });

  assert.equal(formatted.includes('🔹 <b>رونمایی از محصول انقلابی</b>'), true);
  assert.equal(formatted.includes('🔗 <a href="https://zoomit.ir/sample">مطالعه متن کامل در Zoomit</a>'), true);
  assert.equal(formatted.includes('──────────────────'), true);
  assert.equal(formatted.includes('@theNews_Persian'), true);
});

test('smart aggregation threshold: 1-2 items vs 3+ items bulletin format', () => {
  // Bulletin formatting with 3 items
  const items = [
    { aiTitle: 'خبر یک', aiSummary: 'خلاصه یک', sourceName: 'منبع ۱', sourceUrl: 'https://ex.com/1' },
    { aiTitle: 'خبر دو', aiSummary: 'خلاصه دو', sourceName: 'منبع ۲', sourceUrl: 'https://ex.com/2' },
    { aiTitle: 'خبر سه', aiSummary: 'خلاصه سه', sourceName: 'منبع ۳', sourceUrl: 'https://ex.com/3' },
  ];

  const bulletin = buildBulletinPost({
    bulletinTitle: '🗞️ گزیده مهم‌ترین رویدادها',
    items,
    footerText: '📢 کانال خبر : @theNews_Persian',
  });

  assert.equal(bulletin.includes('<b>🗞️ گزیده مهم‌ترین رویدادها</b>'), true);
  assert.equal(bulletin.includes('🔹 <b>خبر یک</b>'), true);
  assert.equal(bulletin.includes('🔹 <b>خبر دو</b>'), true);
  assert.equal(bulletin.includes('🔹 <b>خبر سه</b>'), true);
  assert.equal(bulletin.includes('🔗 <a href="https://ex.com/1">مطالعه متن کامل در منبع ۱</a>'), true);
  assert.equal(bulletin.includes('──────────────────'), true);
});

test('runScanForUser: retries when format drift occurs without [TITLE]', async () => {
  resetMockDb();

  // Setup user with autoPublish and channel
  await db.insert(users).values({
    id: 1,
    tgId: 500,
    name: 'ScanTester',
    channelId: '@theNews_Persian',
    autoPublish: false,
  }).run();

  // Active key
  await db.insert(aiKeys).values({
    id: 1,
    userId: 500,
    provider: 'gemini',
    apiKey: 'gem_key_500',
    status: 'active',
  }).run();

  // Active source
  await db.insert(sources).values({
    id: 1,
    userId: 500,
    name: 'MockRss',
    type: 'rss',
    urlOrHandle: 'https://mock.com/rss',
    enabled: true,
  }).run();

  let aiCalls = 0;
  setMockFetch(async (url, opts) => {
    // RSS Feed Fetch
    if (url.includes('mock.com/rss')) {
      const xml = `<?xml version="1.0"?><rss><channel><item>
        <title>اخبار تستی شماره یک</title>
        <link>https://mock.com/news/1</link>
        <description>توضیحات خبر تستی</description>
      </item></channel></rss>`;
      return {
        ok: true,
        status: 200,
        async text() { return xml; },
      };
    }

    // AI rewrite calls
    aiCalls++;
    if (aiCalls === 1) {
      // First call has format drift (no [TITLE])
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [{ message: { content: 'این متن بدون تگ تایتل است و اشتباها ارسال شده.' } }],
            usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
          };
        },
      };
    }

    // Second call (retry) has proper format
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [{ message: { content: '```json\n{\n  "title": "تیتر تصحیح شده پس از ریترای JSON",\n  "summary": "خلاصه متن خبر",\n  "details": ["نکته یک"],\n  "importance": 4\n}\n```' } }],
          usage: { prompt_tokens: 60, completion_tokens: 30, total_tokens: 90 },
        };
      },
    };
  });

  await runScanForUser(500, 500);
  setMockFetch(null);

  assert.equal(aiCalls >= 2, true, 'AI rewrite must have been called twice due to format drift retry');

  // Verify post was saved with corrected title and importance from the retry
  const saved = await db.select().from(posts).where((r) => r.userId === 500).get();
  assert.equal(Boolean(saved), true);
  assert.equal(saved.aiTitle, 'تیتر تصحیح شده پس از ریترای JSON');
  assert.equal(saved.importance, 4);
});
