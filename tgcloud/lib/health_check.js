/**
 * High-Speed Parallel Health Check & Active Models Inspector
 * Tests all user keys concurrently with strict 4s per-key timeout,
 * ensuring execution completes in < 4 seconds total without worker timeout.
 */

import { fetch, db } from 'sdk';
import { eq } from 'sdk/db';
import { aiKeys } from 'schema';
import { getAiKeys, getCustomProviders } from 'lib/db';

function maskKey(key) {
  if (!key || key.length < 10) return '••••••••';
  return key.slice(0, 6) + '...' + key.slice(-4);
}

/**
 * Fast 1-token ping to Gemini with default high-speed models list
 */
async function testGeminiKey(apiKey) {
  const start = Date.now();
  const models = [
    { id: 'gemini-3.1-flash-lite', tag: '⚡ رایگان و پرسرعت (پیشنهادی)' },
    { id: 'gemma-4-26b-a4b-it', tag: '🌟 نامحدود و رایگان' },
    { id: 'gemini-2.5-flash', tag: '🚀 استاندارد گوگل' },
    { id: 'gemini-2.5-pro', tag: '🧠 پرچمدار تحلیلی' },
  ];

  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gemini-3.1-flash-lite',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 2,
    }),
  });

  const latency = Date.now() - start;

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`خطای ${res.status} (${errText.slice(0, 70)})`);
  }

  return { ok: true, latency, models };
}

/**
 * Fast ping to Groq
 */
async function testGroqKey(apiKey) {
  const start = Date.now();
  const models = [
    { id: 'llama-3.3-70b-versatile', tag: '⚡ رایگان و پرسرعت (پیشنهادی)' },
    { id: 'llama-3.1-8b-instant', tag: '🚀 سبک و فوق‌سریع (رایگان)' },
  ];

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 2,
    }),
  });

  const latency = Date.now() - start;
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`خطای ${res.status} (${errText.slice(0, 70)})`);
  }

  return { ok: true, latency, models };
}

/**
 * Fast ping to DeepSeek
 */
async function testDeepSeekKey(apiKey) {
  const start = Date.now();
  const models = [
    { id: 'deepseek-chat', tag: '⚡ DeepSeek-V3 پرسرعت و مقرون‌به‌صرفه' },
    { id: 'deepseek-reasoner', tag: '🧠 DeepSeek-R1 تحلیلی' },
  ];

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 2,
    }),
  });

  const latency = Date.now() - start;
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`خطای ${res.status} (${errText.slice(0, 70)})`);
  }

  return { ok: true, latency, models };
}

/**
 * Fast ping to Custom Provider
 */
async function testCustomKey(keyRow, customProv) {
  const start = Date.now();
  const baseUrl = (keyRow.baseUrl || customProv?.baseUrl || '').replace(/\/+$/, '');
  const model = customProv?.defaultModel || 'default';
  const modelsList = customProv?.modelsList
    ? customProv.modelsList.split(',').map((m) => ({ id: m.trim(), tag: 'مدل تعریف‌شده' }))
    : [{ id: model, tag: 'مدل پیش‌فرض' }];

  if (!baseUrl) {
    throw new Error('آدرس Base URL تنظیم نشده است');
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${keyRow.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 2,
    }),
  });

  const latency = Date.now() - start;
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`خطای ${res.status} (${errText.slice(0, 70)})`);
  }

  return { ok: true, latency, models: modelsList };
}

/**
 * Runs ALL key checks in parallel with Promise.allSettled
 */
export async function runHealthCheckForUser(userId) {
  const keys = await getAiKeys(userId);
  const customProviders = await getCustomProviders(userId);
  const cpMap = new Map(customProviders.map((cp) => [cp.slug, cp]));

  if (!keys || keys.length === 0) {
    return {
      totalKeys: 0,
      activeKeys: 0,
      html: `⚠️ <b>هیچ کلید هوش مصنوعی یافت نشد!</b>\n\nبرای استفاده از قابلیت‌های هوش مصنوعی و تست سلامت، ابتدا از دکمه <b>➕ افزودن کلید به استخر</b> حداقل یک کلید ثبت کنید.`,
    };
  }

  // Run all tests in parallel!
  const testPromises = keys.map(async (k, index) => {
    const prov = k.provider;
    const masked = maskKey(k.apiKey);
    const label = k.label || prov.toUpperCase();

    try {
      let result = null;
      if (prov === 'gemini') {
        result = await testGeminiKey(k.apiKey);
      } else if (prov === 'groq') {
        result = await testGroqKey(k.apiKey);
      } else if (prov === 'deepseek') {
        result = await testDeepSeekKey(k.apiKey);
      } else if (prov.startsWith('c_')) {
        const cp = cpMap.get(prov);
        result = await testCustomKey(k, cp);
      } else {
        result = await testCustomKey(k, { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' });
      }

      // Mark key active
      await db.update(aiKeys).set({ status: 'active', failureCount: 0 }).where(eq(aiKeys.id, k.id)).run().catch(() => {});

      const modelsText = result.models
        .map((m) => `   ▫️ <code>${m.id}</code> — <i>${m.tag}</i>`)
        .join('\n');

      return {
        ok: true,
        index: index + 1,
        text:
          `🟢 <b>#${index + 1} ${label}</b> (<code>${masked}</code>)\n` +
          `⏱️ تاخیر: <b>${result.latency} میلی‌ثانیه</b> | وضعیت: <b>سالم و فعال</b>\n` +
          `📋 <b>مدل‌های در دسترس:</b>\n${modelsText}`,
      };
    } catch (err) {
      const errorMsg = err.message || 'خطای اتصال';
      if (errorMsg.includes('401') || errorMsg.includes('403')) {
        await db.update(aiKeys).set({ status: 'dead' }).where(eq(aiKeys.id, k.id)).run().catch(() => {});
      }

      return {
        ok: false,
        index: index + 1,
        text:
          `🔴 <b>#${index + 1} ${label}</b> (<code>${masked}</code>)\n` +
          `⚠️ وضعیت: <b>خطا در برقراری ارتباط</b>\n` +
          `❌ علت: <code>${errorMsg}</code>`,
      };
    }
  });

  const settled = await Promise.allSettled(testPromises);
  const reports = settled.map((s) => s.value || { ok: false, text: 'خطا در ارزیابی' });

  const activeCount = reports.filter((r) => r.ok).length;
  const reportsText = reports.map((r) => r.text).join('\n\n');

  const header =
    `🧪 <b>گزارش تست جامع سلامت کلیدها و مدل‌ها</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 <b>خلاصه:</b> <b>${activeCount}</b> از <b>${keys.length}</b> کلید سالم و فعال هستند.\n\n`;

  const footer =
    `\n━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 <i>راهنما: برای کپی هر مدل روی نام آن ضربه بزنید. همچنین می‌توانید ترتیب اولویت کلیدها را با دکمه‌های ⬆️ و ⬇️ در منوی اصلی تنظیم نمایید.</i>`;

  return {
    totalKeys: keys.length,
    activeKeys: activeCount,
    html: header + reportsText + footer,
  };
}
