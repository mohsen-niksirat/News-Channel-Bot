/**
 * Telegram Cloud API Endpoint for Mini App Dashboard
 * Endpoint URL: https://cloud.telegram.org/<APP_ID>/endpoints/api
 */

import { db, api } from 'sdk';
import { eq, and } from 'sdk/db';
import { users, aiKeys, sources, customProviders } from 'schema';
import {
  getUser,
  getUserSources,
  getAiKeys,
  getCustomProviders,
  deleteCustomProvider,
  getTokenUsageStats,
  getDraftPosts,
  updateUser,
  moveAiKeyPriority,
  deleteAiKey,
  toggleSource,
  deleteSource,
} from 'lib/db';
import { runHealthCheckForUser } from 'lib/health_check';
import { runScanForUser } from 'lib/scanner';

export default async function (input, ctx) {
  const action = input?.action || 'get_data';
  const userId =
    ctx?.initData?.user?.id ||
    parseInt(input?.userId || input?.uid || input?.id || 0, 10);

  if (!userId) {
    return { ok: false, error: 'User ID is required' };
  }

  let user = await getUser(userId);
  if (!user) {
    return {
      ok: true,
      user: {
        tgId: userId,
        channelId: '',
        autoPublish: false,
        routingPolicy: 'fallback',
        preferredProvider: 'gemini',
        footerText: '',
      },
      keys: [],
      sources: [],
      customProviders: [],
      tokenStats: { today: { total: 0 }, allTime: 0 },
      drafts: [],
    };
  }

  // 1. Get complete dashboard data
  if (action === 'get_data') {
    const keys = await getAiKeys(userId);
    const userSources = await getUserSources(userId);
    const customProv = await getCustomProviders(userId);
    const tokenStats = await getTokenUsageStats(userId);
    const drafts = await getDraftPosts(userId, 10);

    return {
      ok: true,
      user: {
        tgId: user.tgId,
        firstName: user.firstName,
        username: user.username,
        channelId: user.channelId,
        autoPublish: !!user.autoPublish,
        routingPolicy: user.routingPolicy || 'fallback',
        preferredProvider: user.preferredAiProvider || 'gemini',
        footerText: user.footerText,
      },
      keys: keys.map((k) => ({
        id: k.id,
        provider: k.provider,
        label: k.label,
        maskedKey: k.apiKey ? (k.apiKey.slice(0, 6) + '...' + k.apiKey.slice(-4)) : '••••••••',
        status: k.status,
        sortOrder: k.sortOrder,
        totalTokens: k.totalTokens || 0,
      })),
      sources: userSources.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        urlOrHandle: s.urlOrHandle,
        category: s.category,
        enabled: !!s.enabled,
      })),
      customProviders: customProv,
      tokenStats,
      drafts,
    };
  }

  // 2. Trigger Health Check
  if (action === 'test_keys') {
    const report = await runHealthCheckForUser(userId);
    if (userId) {
      await api.sendMessage({
        chat_id: userId,
        text: report.html,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 تست مجدد سلامت', callback_data: 'act:test_keys' }],
            [{ text: '🔙 بازگشت به تنظیمات', callback_data: 'm:ai_settings' }],
          ],
        },
      }).catch((err) => console.warn('Send health report error:', err.message));
    }
    return { ok: true, report };
  }

  // 3. Trigger Scan
  if (action === 'trigger_scan') {
    if (userId) {
      await api.sendMessage({
        chat_id: userId,
        text: '⏳ <b>درخواست پایش فوری از مینی‌اپ دریافت شد!</b>\nدر حال اسکن منابع و آماده‌سازی خبرها...',
        parse_mode: 'HTML',
      }).catch(() => {});
    }
    // Run scan in background
    runScanForUser(userId, userId).catch((err) => console.error('Scan error:', err));
    return { ok: true, message: 'Scan initiated' };
  }

  // 4. Update Settings
  if (action === 'update_settings') {
    const updates = {};
    if (input.channelId !== undefined) updates.channelId = input.channelId;
    if (input.autoPublish !== undefined) updates.autoPublish = input.autoPublish ? 1 : 0;
    if (input.routingPolicy !== undefined) updates.routingPolicy = input.routingPolicy;
    if (input.preferredAiProvider !== undefined) updates.preferredAiProvider = input.preferredAiProvider;
    if (input.footerText !== undefined) updates.footerText = input.footerText;

    await updateUser(userId, updates);
    return { ok: true, message: 'Settings saved' };
  }

  // 5. Reorder Key
  if (action === 'move_key') {
    const keyId = parseInt(input.keyId, 10);
    const direction = input.direction; // 'up' or 'down'
    if (keyId && (direction === 'up' || direction === 'down')) {
      await moveAiKeyPriority(keyId, direction, userId);
      return { ok: true, message: 'Priority updated' };
    }
  }

  // 6. Delete Key
  if (action === 'delete_key') {
    const keyId = parseInt(input.keyId, 10);
    if (keyId) {
      await deleteAiKey(keyId, userId);
      return { ok: true, message: 'Key deleted' };
    }
  }

  // 7. Toggle Source
  if (action === 'toggle_source') {
    const sourceId = parseInt(input.sourceId, 10);
    if (sourceId) {
      const toggled = await toggleSource(sourceId, userId);
      return { ok: true, enabled: toggled?.enabled };
    }
  }

  // 8. Delete Custom Provider
  if (action === 'delete_custom_provider' || action === 'delete_provider') {
    const provId = parseInt(input.providerId || input.id, 10);
    if (provId) {
      await deleteCustomProvider(provId, userId);
      return { ok: true, message: 'Custom provider deleted' };
    }
  }

  return { ok: false, error: 'Unknown action' };
}
