/**
 * Multi-Provider AI Router with Intelligent Key Rotation, Custom Providers & Policies
 * Supports: Gemini, Groq, DeepSeek, OpenAI, OpenRouter, and Unlimited Custom Providers
 * Policies: Fallback (Priority) | Round-Robin | Smart Router | Fusion
 */

import { db, fetch } from 'sdk';
import { eq, and, sql, asc } from 'sdk/db';
import { aiKeys } from 'schema';
import { getCustomProviderBySlug, recordTokenUsage } from 'lib/db';

export const DEFAULT_MODELS = {
  gemini: 'gemini-3.1-flash-lite',
  groq: 'llama-3.3-70b-versatile',
  deepseek: 'deepseek-chat',
  openai: 'gpt-4o-mini',
  openrouter: 'google/gemini-2.0-flash-lite-001',
};

export const ROUTING_POLICIES = {
  fallback: { name: '🛡️ فالبک اولویتی (Fallback)', desc: 'استفاده بر اساس ترتیب اولویت و سوئیچ خودکار هنگام خطا' },
  round_robin: { name: '🔄 راند رابین (Round-Robin)', desc: 'توزیع چرخشی و مساوی درخواست‌ها بین کلیدها' },
  smart_router: { name: '🧠 اسمارت روتر (Smart Router)', desc: 'انتخاب هوشمند سالم‌ترین کلید با کمترین نرخ خطا' },
  fusion: { name: '⚡ فیوژن پیشرفته (Fusion)', desc: 'ترکیب بالاترین کیفیت با مدل‌های برتر' },
};

/**
 * Retrieves the best available API key for a provider with policy support
 */
export async function getNextAvailableKey(provider, userId = null, policy = 'fallback') {
  const now = Math.floor(Date.now() / 1000);

  const baseConds = [
    eq(aiKeys.provider, provider),
    eq(aiKeys.status, 'active'),
  ];
  if (userId) baseConds.push(eq(aiKeys.userId, userId));

  let query = db
    .select()
    .from(aiKeys)
    .where(and(...baseConds));

  if (policy === 'round_robin') {
    query = query.orderBy(asc(aiKeys.lastUsedAt));
  } else if (policy === 'smart_router') {
    query = query.orderBy(asc(aiKeys.failureCount), asc(aiKeys.lastUsedAt));
  } else {
    // fallback & fusion: strictly by sort_order
    query = query.orderBy(asc(aiKeys.sortOrder), asc(aiKeys.id));
  }

  let keyRow = await query.get();

  // 2. If no active key, check if any key in cooldown has expired its timer
  if (!keyRow) {
    const cdConds = [
      eq(aiKeys.provider, provider),
      eq(aiKeys.status, 'cooldown'),
      sql`cooldown_until <= ${now}`,
    ];
    if (userId) cdConds.push(eq(aiKeys.userId, userId));

    const recovered = await db
      .select()
      .from(aiKeys)
      .where(and(...cdConds))
      .orderBy(asc(aiKeys.sortOrder), asc(aiKeys.id))
      .get();

    if (recovered) {
      await db.update(aiKeys).set({ status: 'active', failureCount: 0 }).where(eq(aiKeys.id, recovered.id)).run();
      keyRow = recovered;
    }
  }

  // 3. Fallback: if all keys are currently marked cooldown, reactivate the oldest key so bot never hangs
  if (!keyRow) {
    const fbConds = [eq(aiKeys.provider, provider)];
    if (userId) fbConds.push(eq(aiKeys.userId, userId));

    const fallbackKey = await db
      .select()
      .from(aiKeys)
      .where(and(...fbConds))
      .orderBy(asc(aiKeys.lastUsedAt))
      .get();

    if (fallbackKey) {
      await db.update(aiKeys).set({ status: 'active', failureCount: 0, cooldownUntil: 0 }).where(eq(aiKeys.id, fallbackKey.id)).run();
      keyRow = fallbackKey;
    }
  }

  return keyRow;
}

/**
 * Marks a key with temporary cooldown (on 429) or dead (on 401/403)
 */
export async function markKeyResult(keyId, success, statusCode = 200) {
  const now = Math.floor(Date.now() / 1000);
  if (success) {
    await db
      .update(aiKeys)
      .set({
        lastUsedAt: now,
        failureCount: 0,
        status: 'active',
      })
      .where(eq(aiKeys.id, keyId))
      .run();
    return;
  }

  // Handle Rate Limit (429) -> 60-second cooldown
  if (statusCode === 429) {
    await db
      .update(aiKeys)
      .set({
        status: 'cooldown',
        cooldownUntil: now + 60,
        lastUsedAt: now,
        failureCount: sql`failure_count + 1`,
      })
      .where(eq(aiKeys.id, keyId))
      .run();
    return;
  }

  // Handle Authentication failure (401/403) -> mark dead
  if (statusCode === 401 || statusCode === 402 || statusCode === 403) {
    await db
      .update(aiKeys)
      .set({
        status: 'dead',
        lastUsedAt: now,
        failureCount: sql`failure_count + 1`,
      })
      .where(eq(aiKeys.id, keyId))
      .run();
    return;
  }

  // Generic network error -> short backoff
  await db
    .update(aiKeys)
    .set({
      lastUsedAt: now,
      failureCount: sql`failure_count + 1`,
    })
    .where(eq(aiKeys.id, keyId))
    .run();
}

/**
 * Calls Gemini via Google's official OpenAI-compatible endpoint
 */
async function callGemini(apiKey, model, systemPrompt, userPrompt) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  const candidateModels = [
    model && !model.includes('1.5') && !model.includes('2.0') && !model.includes('2.5') ? model : 'gemini-3.1-flash-lite',
    'gemini-3.1-flash-lite',
    'gemma-4-26b-a4b-it',
  ].filter((m, i, arr) => m && arr.indexOf(m) === i);

  let lastErr = null;
  for (const m of candidateModels) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userPrompt });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: m,
          messages,
          temperature: 0.3,
          max_tokens: 800,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        const err = new Error(`Gemini (${m}) Error ${res.status}: ${errText.slice(0, 200)}`);
        err.status = res.status;
        lastErr = err;
        if (res.status === 404) continue;
        throw err;
      }

      const data = await res.json();
      let text = data?.choices?.[0]?.message?.content || '';
      text = text.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
      if (!text) throw new Error('Gemini returned empty response text');

      const usage = data?.usage || {};
      return {
        text,
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
      };
    } catch (err) {
      lastErr = err;
      if (err.status !== 404) throw err;
    }
  }

  throw lastErr || new Error('All Gemini candidate models failed');
}

/**
 * Calls any OpenAI-compatible endpoint (Groq, DeepSeek, OpenAI, OpenRouter, Custom Providers)
 */
async function callOpenAICompatible(baseUrl, apiKey, model, systemPrompt, userPrompt) {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(`AI Provider Error ${res.status}: ${errText.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  let content = data?.choices?.[0]?.message?.content || '';
  content = content.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();

  const usage = data?.usage || {};
  return {
    text: content,
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
  };
}

/**
 * Universal Generate Function with Automatic Failover Chain & Policy Support
 */
export async function generateNewsRewrite({
  systemPrompt,
  userPrompt,
  preferredProvider = 'gemini',
  preferredModel = null,
  userId = null,
  routingPolicy = 'fallback',
}) {
  const providerChain = [
    preferredProvider,
    ...['gemini', 'groq', 'deepseek', 'openai', 'openrouter'].filter((p) => p !== preferredProvider),
  ];

  let lastError = null;

  for (const provider of providerChain) {
    // Check if custom provider
    let customProv = null;
    if (provider.startsWith('c_')) {
      customProv = await getCustomProviderBySlug(provider);
    }

    // Try up to 3 keys per provider in the pool
    for (let attempt = 0; attempt < 3; attempt++) {
      const keyRow = await getNextAvailableKey(provider, userId, routingPolicy);
      if (!keyRow) break; // No keys available for this provider, try next in chain

      let model = preferredModel;
      if (customProv) {
        model = model || customProv.defaultModel || 'default';
      } else if (!model || model.includes('1.5') || model.includes('2.0') || model.includes('2.5')) {
        model = DEFAULT_MODELS[provider] || 'gemini-3.1-flash-lite';
      }

      try {
        let result = null;
        if (provider === 'gemini') {
          result = await callGemini(keyRow.apiKey, model, systemPrompt, userPrompt);
        } else {
          let baseUrl = keyRow.baseUrl;
          if (!baseUrl) {
            if (customProv) baseUrl = customProv.baseUrl;
            else if (provider === 'groq') baseUrl = 'https://api.groq.com/openai/v1';
            else if (provider === 'deepseek') baseUrl = 'https://api.deepseek.com';
            else if (provider === 'openrouter') baseUrl = 'https://openrouter.ai/api/v1';
            else baseUrl = 'https://api.openai.com/v1';
          }
          result = await callOpenAICompatible(baseUrl, keyRow.apiKey, model, systemPrompt, userPrompt);
        }

        if (result && result.text) {
          await markKeyResult(keyRow.id, true);

          // Record token analytics
          if (userId) {
            await recordTokenUsage({
              userId,
              keyId: keyRow.id,
              provider,
              model,
              promptTokens: result.promptTokens,
              completionTokens: result.completionTokens,
              action: 'news_rewrite',
            }).catch(() => {});
          }

          return { text: result.text, provider, model, usage: result };
        }
      } catch (err) {
        lastError = err;
        await markKeyResult(keyRow.id, false, err.status || 500);
        console.warn(`AI Router error for ${provider} key #${keyRow.id}:`, err.message);
      }
    }
  }

  throw new Error(`All AI providers and keys in the router failed. Last error: ${lastError?.message || 'Unknown'}`);
}
