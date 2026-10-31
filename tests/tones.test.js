import test from 'node:test';
import assert from 'node:assert/strict';
import { db, resetMockDb } from 'sdk';
import { users } from 'schema';
import { getOrCreateUser, getUser, updateUser } from 'lib/db';
import { TONE_PROFILES, getToneSystemPrompt, parseAiNewsJson } from 'lib/tones';

test('tones.js: completeness of built-in profile definitions', () => {
  const expectedProfiles = ['standard', 'formal', 'energetic', 'concise', 'custom'];
  for (const p of expectedProfiles) {
    assert.equal(Boolean(TONE_PROFILES[p]), true, `Profile ${p} must exist in TONE_PROFILES`);
    assert.equal(typeof TONE_PROFILES[p].name, 'string');
    assert.equal(typeof TONE_PROFILES[p].desc, 'string');
    if (p !== 'custom') {
      assert.equal(typeof TONE_PROFILES[p].promptInstruction, 'string');
      assert.equal(TONE_PROFILES[p].promptInstruction.length > 20, true);
    }
  }
});

test('getToneSystemPrompt: constructs proper style directives for all modes', () => {
  // 1. Standard / Default
  const stdPrompt = getToneSystemPrompt({ toneProfile: 'standard' });
  assert.equal(stdPrompt.includes('Style and Tone Directive:'), true);
  assert.equal(stdPrompt.includes('fluent, journalistic, and clear'), true);

  // 2. Formal
  const formalPrompt = getToneSystemPrompt({ toneProfile: 'formal' });
  assert.equal(formalPrompt.includes('formal, highly authoritative, and analytical'), true);

  // 3. Energetic
  const energeticPrompt = getToneSystemPrompt({ toneProfile: 'energetic' });
  assert.equal(energeticPrompt.includes('energetic, exciting, and highly engaging'), true);

  // 4. Concise
  const concisePrompt = getToneSystemPrompt({ toneProfile: 'concise' });
  assert.equal(concisePrompt.includes('ultra-concise, rapid-fire bullet-point'), true);

  // 5. Custom tone provided by user
  const customUser = {
    toneProfile: 'custom',
    toneCustom: 'اخبار را با لحن محاوره‌ای تهرانی و استفاده از اصطلاحات فناوری جذاب بنویس.',
  };
  const customPrompt = getToneSystemPrompt(customUser);
  assert.equal(customPrompt.includes('Style and Tone Directive:'), true);
  assert.equal(customPrompt.includes('اخبار را با لحن محاوره‌ای تهرانی'), true);

  // 6. Custom tone profile selected but toneCustom empty -> falls back to standard safely
  const emptyCustom = getToneSystemPrompt({ toneProfile: 'custom', toneCustom: '' });
  assert.equal(emptyCustom.includes('fluent, journalistic, and clear'), true);
});

test('tone profile db persistence: saving and loading toneProfile & toneCustom', async () => {
  resetMockDb();

  const { user } = await getOrCreateUser({ id: 8888, first_name: 'ToneUser' });
  assert.equal(user.toneProfile || 'standard', 'standard');

  // Update to energetic
  await updateUser(8888, { toneProfile: 'energetic' });
  let fetched = await getUser(8888);
  assert.equal(fetched.toneProfile, 'energetic');

  // Update to custom with text
  await updateUser(8888, {
    toneProfile: 'custom',
    toneCustom: 'سبک اختصاصی برای پایش رویدادهای فین‌تک',
  });
  fetched = await getUser(8888);
  assert.equal(fetched.toneProfile, 'custom');
  assert.equal(fetched.toneCustom, 'سبک اختصاصی برای پایش رویدادهای فین‌تک');
});

test('parseAiNewsJson: handles raw JSON, fenced markdown JSON, legacy format, and malformed text', () => {
  // 1. Raw JSON
  const rawJson = '{"title":"تیتر تستی","summary":"خلاصه خبر تستی","details":["نکته یک","نکته دو"],"importance":5}';
  const res1 = parseAiNewsJson(rawJson);
  assert.equal(res1.success, true);
  assert.equal(res1.title, 'تیتر تستی');
  assert.equal(res1.summary, 'خلاصه خبر تستی');
  assert.equal(res1.details.includes('• نکته یک'), true);
  assert.equal(res1.importance, 5);
  assert.equal(res1.mode, 'json');

  // 2. Fenced Markdown JSON
  const fencedJson = '```json\n{\n  "title": "تیتر کدبلاک",\n  "summary": "خلاصه در کدبلاک",\n  "details": ["جزئیات الف"],\n  "importance": 3\n}\n```';
  const res2 = parseAiNewsJson(fencedJson);
  assert.equal(res2.success, true);
  assert.equal(res2.title, 'تیتر کدبلاک');
  assert.equal(res2.importance, 3);
  assert.equal(res2.mode, 'json');

  // 3. Legacy format fallback
  const legacyText = '[TITLE]: تیتر لگاسی قدیمی\n[SUMMARY]: خلاصه به روش لگاسی\n[DETAILS]: نکات تکمیلی';
  const res3 = parseAiNewsJson(legacyText);
  assert.equal(res3.success, true);
  assert.equal(res3.title, 'تیتر لگاسی قدیمی');
  assert.equal(res3.summary, 'خلاصه به روش لگاسی');
  assert.equal(res3.mode, 'legacy');

  // 4. Malformed JSON with fallback to legacy or raw
  const malformed = 'این یک متن آزاد است بدون فرمت ساختاریافته.';
  const res4 = parseAiNewsJson(malformed);
  assert.equal(res4.success, false);
  assert.equal(res4.mode, 'raw');
  assert.equal(res4.title.length > 0, true);
});
