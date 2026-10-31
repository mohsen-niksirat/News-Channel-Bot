import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseJinaTelegramMarkdown, hashString, cleanText, harvestRssFeed } from 'lib/harvester';
import { setMockFetch } from 'sdk';

test('hashString stability: produces consistent and deterministic hex hashes', () => {
  const input = 'sample_news_title_12345';
  const h1 = hashString(input);
  const h2 = hashString(input);
  assert.equal(typeof h1, 'string');
  assert.equal(h1.length > 4, true);
  assert.equal(h1, h2, 'Hashes of the same string must be identical');

  const hDiff = hashString('sample_news_title_12346');
  assert.notEqual(h1, hDiff, 'Different inputs should produce different hashes');
});

test('cleanText: strips tags and decodes entities properly', () => {
  const html = '<p>تست <b>عنوان</b> &amp; جزئیات<br/>خط دوم</p>';
  const cleaned = cleanText(html);
  assert.equal(cleaned.includes('<p>'), false);
  assert.equal(cleaned.includes('<b>'), false);
  assert.equal(cleaned.includes('&amp;'), false);
  assert.equal(cleaned.includes('&'), true);
  assert.equal(cleaned.includes('خط دوم'), true);
});

test('parseJinaTelegramMarkdown: parses real-shape Jina markdown fixture correctly', () => {
  const fixturePath = path.resolve('tests/fixtures/jina_sample.md');
  const md = fs.readFileSync(fixturePath, 'utf-8');
  const items = parseJinaTelegramMarkdown(md, 'digiato');

  assert.equal(Array.isArray(items), true);
  assert.equal(items.length >= 2, true, 'Must parse at least 2 messages from fixture');

  const first = items[0];
  assert.equal(first.sourceName, '@digiato');
  assert.equal(first.sourceType, 'telegram');
  assert.equal(first.url, 'https://t.me/digiato/114866');
  assert.equal(first.title.includes('ایلان ماسک'), true);
  assert.equal(first.content.includes('امنیت بدون شفافیت'), true);
  assert.equal(typeof first.hash, 'string');
});

test('harvestRssFeed: extracts items from RSS feed XML via mock fetch', async () => {
  const fixturePath = path.resolve('tests/fixtures/rss_sample.xml');
  const xmlContent = fs.readFileSync(fixturePath, 'utf-8');

  setMockFetch(async (url) => {
    return {
      ok: true,
      status: 200,
      async text() {
        return xmlContent;
      },
    };
  });

  const items = await harvestRssFeed('https://example.com/rss', 'Zoomit', 5);
  setMockFetch(null); // Reset

  assert.equal(Array.isArray(items), true);
  assert.equal(items.length, 2);
  assert.equal(items[0].sourceName, 'Zoomit');
  assert.equal(items[0].title.includes('نوکیا ۲۳۶۰'), true);
  assert.equal(items[0].imageUrl, 'https://api2.zoomit.ir/media/nokia.jpg');
  assert.equal(items[1].title.includes('تایمکس'), true);
});
