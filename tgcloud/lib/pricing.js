// NewsStudio 2026 — Token Pricing & Cost Transparency Engine
// Calculates approximate USD cost for token usage across all supported AI providers

export const PRICING_LAST_UPDATED = '2026-10-31';
export const PRICING_DISCLAIMER = 'قیمت‌ها بر اساس تعرفه رسمی هر ۱ میلیون توکن و به صورت تقریبی محاسبه شده‌اند.';

/**
 * Static price table: USD per 1,000,000 tokens (prompt / completion)
 */
export const PRICE_TABLE = {
  gemini: {
    promptPerMillion: 0.075,
    completionPerMillion: 0.30,
    label: 'Google Gemini (Flash Lite)',
  },
  groq: {
    promptPerMillion: 0.20,
    completionPerMillion: 0.40,
    label: 'Groq Cloud',
  },
  deepseek: {
    promptPerMillion: 0.14,
    completionPerMillion: 0.28,
    label: 'DeepSeek (V3)',
  },
  openai: {
    promptPerMillion: 0.15,
    completionPerMillion: 0.60,
    label: 'OpenAI (GPT-4o mini)',
  },
  openrouter: {
    promptPerMillion: 0.10,
    completionPerMillion: 0.40,
    label: 'OpenRouter',
  },
  custom: {
    promptPerMillion: 0.10,
    completionPerMillion: 0.30,
    label: 'ارائه‌دهنده اختصاصی',
  },
};

/**
 * Calculates USD cost for given prompt and completion token counts
 * @param {string} provider
 * @param {number} promptTokens
 * @param {number} completionTokens
 * @returns {number} Cost in USD rounded to 6 decimal places
 */
export function calculateTokenCost(provider, promptTokens = 0, completionTokens = 0) {
  const provKey = String(provider || '').toLowerCase();
  const rates = PRICE_TABLE[provKey] || (provKey.startsWith('c_') ? PRICE_TABLE.custom : PRICE_TABLE.gemini);

  const pTokens = Math.max(0, Number(promptTokens) || 0);
  const cTokens = Math.max(0, Number(completionTokens) || 0);

  const costPrompt = (pTokens / 1_000_000) * rates.promptPerMillion;
  const costCompletion = (cTokens / 1_000_000) * rates.completionPerMillion;

  const total = costPrompt + costCompletion;
  return Number(total.toFixed(6));
}

/**
 * Formats a USD cost for human display
 * @param {number} costUsd
 * @returns {string} e.g. "$0.0021" or "< $0.0001" or "$0.00"
 */
export function formatCostUsd(costUsd) {
  const num = Number(costUsd) || 0;
  if (num === 0) return '$0.00';
  if (num < 0.0001) return '< $0.0001';
  return `$${num.toFixed(4)}`;
}

/**
 * Aggregates cost across an array of usage entries or byProvider token map
 * @param {Array<{ provider: string, promptTokens: number, completionTokens: number }>} usageRows
 * @returns {{ totalCostUsd: number, formattedTotal: string, byProvider: Record<string, number>, disclaimer: string, lastUpdated: string }}
 */
export function calculateUsageBreakdown(usageRows = []) {
  let totalCost = 0;
  const byProvider = {};

  if (Array.isArray(usageRows)) {
    for (const row of usageRows) {
      const prov = String(row.provider || 'gemini').toLowerCase();
      const p = row.promptTokens || row.prompt_tokens || 0;
      const c = row.completionTokens || row.completion_tokens || 0;
      const cost = calculateTokenCost(prov, p, c);

      totalCost += cost;
      byProvider[prov] = Number(((byProvider[prov] || 0) + cost).toFixed(6));
    }
  }

  totalCost = Number(totalCost.toFixed(6));

  return {
    totalCostUsd: totalCost,
    formattedTotal: formatCostUsd(totalCost),
    byProvider,
    disclaimer: PRICING_DISCLAIMER,
    lastUpdated: PRICING_LAST_UPDATED,
  };
}
