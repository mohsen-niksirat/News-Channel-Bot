import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRICE_TABLE,
  PRICING_DISCLAIMER,
  calculateTokenCost,
  formatCostUsd,
  calculateUsageBreakdown,
} from 'lib/pricing';

test('pricing.js: calculates accurate token costs per provider', () => {
  // Gemini: prompt $0.075 / 1M, completion $0.30 / 1M
  // 1,000,000 prompt + 1,000,000 completion = $0.375
  const costGemini = calculateTokenCost('gemini', 1_000_000, 1_000_000);
  assert.equal(costGemini, 0.375);

  // 10,000 prompt tokens with Gemini
  const cost10k = calculateTokenCost('gemini', 10_000, 0);
  assert.equal(cost10k, 0.00075);

  // Custom provider fallback
  const costCustom = calculateTokenCost('c_1793239312288', 1_000_000, 0);
  assert.equal(costCustom, PRICE_TABLE.custom.promptPerMillion);

  // Zero tokens
  assert.equal(calculateTokenCost('gemini', 0, 0), 0);
});

test('pricing.js: formats USD display strings gracefully', () => {
  assert.equal(formatCostUsd(0), '$0.00');
  assert.equal(formatCostUsd(0.00002), '< $0.0001');
  assert.equal(formatCostUsd(0.01234), '$0.0123');
  assert.equal(formatCostUsd(1.5), '$1.5000');
});

test('pricing.js: calculateUsageBreakdown aggregates correctly', () => {
  const rows = [
    { provider: 'gemini', promptTokens: 500_000, completionTokens: 100_000 },
    { provider: 'deepseek', promptTokens: 200_000, completionTokens: 50_000 },
  ];

  const breakdown = calculateUsageBreakdown(rows);
  assert.equal(typeof breakdown.totalCostUsd, 'number');
  assert.equal(breakdown.totalCostUsd > 0, true);
  assert.equal(typeof breakdown.formattedTotal, 'string');
  assert.equal(typeof breakdown.byProvider.gemini, 'number');
  assert.equal(typeof breakdown.byProvider.deepseek, 'number');
  assert.equal(breakdown.disclaimer, PRICING_DISCLAIMER);
});
