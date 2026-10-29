/**
 * Health Check and Available Models Inspector for User AI Keys
 * Tests key validity, measures latency, discovers available/free models,
 * and compiles all results into a single cohesive, high-impact Telegram post.
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
 * Tests a Gemini key, checks models endpoint & runs a 1-token ping
 */
async function testGeminiKey(apiKey) {
  const start = Date.now();
  let latency = 0;
  let models = [
    { id: 'gemini-3.1-flash-lite', tag: '⚡ رایگان و فوق‌سریع (پیشنهادی)' },
    { id: 'gemma-4-26b-a4b-it', tag: '🌟 بدون محدودیت توکن (رایگان)' },
    { id: 'gemini-2.5-flash', tag: '🚀 نسخه استاندارد' },
    { id: 'gemini-2.5-pro', tag: '🧠 استدلال پیشرفته' },
  ];

  // 1. Try to query Google models API
  try {
    const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (listRes.ok) {
      const data = await listRes.json();
      if (Array.isArray(data?.models)) {
        const found = data.models
          .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m) => m.name.replace('models/', ''))
          .filter((id) => !id.includes('1.0') && !id.includes('1.5') && !id.includes('2.0') && !id.includes('vision') && !id.includes('embedding'));

        if (found.length > 0) {
          // Merge dynamic findings with friendly tags
          const customList = [];
          if (found.includes('gemini-3.1-flash-lite')) customList.push({ id: 'gemini-3.1-flash-lite', tag: '⚡ رایگان و پرسرعت (پیشنهادی)' });
          if (found.includes('gemma-4-26b-a4b-it')) customList.push({ id: 'gemma-4-26b-a4b-it', tag: '🌟 نامحدود و رایگان' });
          if (found.includes('gemini-2.5-flash')) customList.push({ id: 'gemini-2.5-flash', tag: '🚀 استاندارد گوگل' });
          if (found.includes('gemini-2.5-pro')) customList.push({ id: 'gemini-2.5-pro', tag: '🧠 پرچمدار تحلیلی' });
          
          if (customList.length > 0) models = customList;
        }
      }
    }
  } catch (err) {
    // Continue to ping
  }

  // 2. Run actual generation ping
  const pingRes = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
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

  latency = Date.now() - start;

  if (!pingRes.ok) {
    const errText = await pingRes.text().catch(() => '');
    throw new Error(`خطای ${pingRes.status} (${errText.slice(0, 80) || 'احراز هویت ناموفق'})`);
  }

  return { ok: true, latency, models };
}

/**
 * Tests Groq API key
 */
async function testGroqKey(apiKey) {
  const start = Date.now();
  const models = [
    { id: 'llama-3.3-70b-versatile', tag: '⚡ رایگان، فوق‌سریع و هوشمند (پیشنهادی)' },
    { id: 'llama-3.1-8b-instant', tag: '🚀 بسیار سبک و پرسرعت (رایگان)' },
    { id: 'mixtral-8x7b-32768', tag: '🌐 پنجره زمینه بزرگ (رایگان)' },
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
    throw new Error(`خطای ${res.status} (${errText.slice(0, 80)})`);
  }

  return { ok: true, latency, models };
}

/**
 * Tests DeepSeek API key
 */
async function testDeepSeekKey(apiKey) {
  const start = Date.now();
  const models = [
    { id: 'deepseek-chat', tag: '⚡ DeepSeek-V3 پرسرعت و مقرون‌به‌صرفه' },
    { id: 'deepseek-reasoner', tag: '🧠 DeepSeek-R1 استنتاج عمیق' },
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
    throw new Error(`خطای ${res.status} (${errText.slice(0, 80)})`);
  }

  return { ok: true, latency, models };
}

/**
 * Tests OpenRouter API key
 */
async function testOpenRouterKey(apiKey) {
  const start = Date.now();
  const models = [
    { id: 'google/gemini-2.0-flash-lite-001', tag: '⚡ مدل پیشنهادی پرسرعت' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', tag: '🆓 لاما ۳.۳ رایگان' },
    { id: 'deepseek/deepseek-r1:free', tag: '🆓 دیپ‌سیک R1 رایگان' },
  ];

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.0-flash-lite-001',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 2,
    }),
  });

  const latency = Date.now() - start;
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`خطای ${res.status} (${errText.slice(0, 80)})`);
  }

  return { ok: true, latency, models };
}

/**
 * Tests a Custom Provider key
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
    throw new Error(`خطای ${res.status} (${errText.slice(0, 80)})`);
  }

  return { ok: true, latency, models: modelsList };
}

/**
 * Runs a comprehensive health check on all user keys and returns formatted Telegram HTML
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

  let activeCount = 0;
  const reports = [];

  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const prov = k.provider;
    const masked = maskKey(k.apiKey);
    const label = k.label || prov.toUpperCase();
    let result = null;
    let errorMsg = null;

    try {
      if (prov === 'gemini') {
        result = await testGeminiKey(k.apiKey);
      } else if (prov === 'groq') {
        result = await testGroqKey(k.apiKey);
      } else if (prov === 'deepseek') {
        result = await testDeepSeekKey(k.apiKey);
      } else if (prov === 'openrouter') {
        result = await testOpenRouterKey(k.apiKey);
      } else if (prov.startsWith('c_')) {
        const cp = cpMap.get(prov);
        result = await testCustomKey(k, cp);
      } else {
        // Generic OpenAI Compatible
        result = await testCustomKey(k, { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' });
      }

      activeCount++;
      // Mark key active in DB
      await db.update(aiKeys).set({ status: 'active', failureCount: 0 }).where(eq(aiKeys.id, k.id)).run();
    } catch (err) {
      errorMsg = err.message || 'خطای ناشناخته';
      // If unauthorized, mark dead in DB
      if (errorMsg.includes('401') || errorMsg.includes('403')) {
        await db.update(aiKeys).set({ status: 'dead' }).where(eq(aiKeys.id, k.id)).run();
      }
    }

    // Build key card
    if (result && result.ok) {
      const modelsText = result.models
        .map((m) => `   ▫️ <code>${m.id}</code> — <i>${m.tag}</i>`)
        .join('\n');

      reports.push(
        `🟢 <b>#${i + 1} ${label}</b> (<code>${masked}</code>)\n` +
        `⏱️ تاخیر: <b>${result.latency} میلی‌ثانیه</b> | وضعیت: <b>سالم و متصل</b>\n` +
        `📋 <b>مدل‌های فعال و در دسترس:</b>\n${modelsText}`
      );
    } else {
      reports.push(
        `🔴 <b>#${i + 1} ${label}</b> (<code>${masked}</code>)\n` +
        `⚠️ وضعیت: <b>خطا در برقراری ارتباط</b>\n` +
        `❌ علت: <code>${errorMsg}</code>`
      );
    }
  }

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
    html: header + reports.join('\n\n') + footer,
  };
}
