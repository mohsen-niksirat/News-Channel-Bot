import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VALID_CATEGORIES,
  CATEGORY_LABELS,
  parseSourceCategories,
  toggleCategoryInList,
} from '../tgcloud/lib/categories.js';
import { parseAiNewsJson } from '../tgcloud/lib/tones.js';

test('categories.js: completeness of valid categories and labels', () => {
  assert.strictEqual(VALID_CATEGORIES.length, 8);
  for (const cat of VALID_CATEGORIES) {
    assert.ok(CATEGORY_LABELS[cat], `Missing Persian label for ${cat}`);
  }
});

test('categories.js: parseSourceCategories handles null, arrays, strings and corrupt input', () => {
  // Default fallback to all categories
  assert.deepStrictEqual(parseSourceCategories(null), VALID_CATEGORIES);
  assert.deepStrictEqual(parseSourceCategories(''), VALID_CATEGORIES);
  assert.deepStrictEqual(parseSourceCategories('invalid json'), VALID_CATEGORIES);

  // Valid JSON string
  const subset = ['tech', 'economy'];
  assert.deepStrictEqual(parseSourceCategories(JSON.stringify(subset)), subset);

  // Raw array
  assert.deepStrictEqual(parseSourceCategories(['sport', 'science']), ['sport', 'science']);

  // Filters out invalid keys
  assert.deepStrictEqual(parseSourceCategories('["tech", "invalid_cat"]'), ['tech']);
});

test('categories.js: toggleCategoryInList toggles categories and prevents empty list', () => {
  const initial = ['tech', 'economy'];
  // Toggle off 'economy'
  const afterRemove = toggleCategoryInList(initial, 'economy');
  assert.deepStrictEqual(afterRemove, ['tech']);

  // Prevent removing last remaining category
  const cannotRemoveLast = toggleCategoryInList(afterRemove, 'tech');
  assert.deepStrictEqual(cannotRemoveLast, ['tech']);

  // Toggle on 'sport'
  const afterAdd = toggleCategoryInList(afterRemove, 'sport');
  assert.deepStrictEqual(afterAdd, ['tech', 'sport']);
});

test('tones.js: parseAiNewsJson extracts category field correctly', () => {
  const jsonWithCategory = JSON.stringify({
    title: 'توسعه تراشه‌های هوش مصنوعی جدید',
    summary: 'شرکت انویدیا از نسل جدید پردازنده‌های گرافیکی رونمایی کرد.',
    importance: 5,
    category: 'tech',
  });

  const parsed = parseAiNewsJson(jsonWithCategory);
  assert.strictEqual(parsed.success, true);
  assert.strictEqual(parsed.title, 'توسعه تراشه‌های هوش مصنوعی جدید');
  assert.strictEqual(parsed.importance, 5);
  assert.strictEqual(parsed.category, 'tech');

  // Case normalization
  const jsonUpper = JSON.stringify({
    title: 'پیروزی تیم ملی در بازی‌های المپیک',
    summary: 'ورزشکاران موفق به کسب مدال طلا شدند.',
    category: 'SPORT',
  });
  const parsedUpper = parseAiNewsJson(jsonUpper);
  assert.strictEqual(parsedUpper.category, 'sport');

  // Invalid category -> null
  const jsonInvalid = JSON.stringify({
    title: 'تیتر نامعلوم',
    summary: 'خلاصه خبر',
    category: 'unknown_category',
  });
  const parsedInvalid = parseAiNewsJson(jsonInvalid);
  assert.strictEqual(parsedInvalid.category, null);
});
