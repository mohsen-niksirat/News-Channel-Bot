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
  getPostById,
  markPostPublished,
  markPostRejected,
} from 'lib/db';
import { runHealthCheckForUser } from 'lib/health_check';
import { runScanForUser } from 'lib/scanner';
import { buildPostButtons, sendRichPostSafe, escHtml } from 'lib/rich_post';

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
        publishMode: user.publishMode || 'smart',
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
    if (input.publishMode !== undefined) updates.publishMode = input.publishMode;
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

  // 9. Publish Draft Post
  if (action === 'publish_draft' || action === 'publish_post') {
    const postId = parseInt(input.postId || input.id, 10);
    if (!postId) {
      return { ok: false, error: 'شناسه پست الزامی است.' };
    }

    const post = await getPostById(postId);
    if (!post) {
      return { ok: false, error: 'پست یافت نشد.' };
    }
    if (post.userId && post.userId !== userId) {
      return { ok: false, error: 'شما دسترسی به این پست ندارید.' };
    }
    if (post.status === 'published') {
      return { ok: false, error: 'این پست قبلاً در کانال منتشر شده است.' };
    }

    if (!user.channelId) {
      return { ok: false, error: 'کانال مقصد ست نشده است. لطفاً ابتدا از تب داشبورد آیدی کانال را تنظیم کنید.' };
    }

    // Prepare HTML content with updated footer if needed
    let postHtml = post.formattedHtml;
    if (user.footerText && postHtml && postHtml.includes('──────────────\n')) {
      postHtml = postHtml.split('──────────────\n')[0] + '──────────────\n' + user.footerText;
    }

    const buttons = buildPostButtons({
      sourceUrl: post.sourceUrl,
      sourceName: post.sourceName,
      summaryToCopy: post.aiSummary,
      channelUsername: user.channelId,
    });

    try {
      const sent = await sendRichPostSafe({
        chatId: user.channelId,
        postHtml: postHtml,
        imageUrl: post.imageUrl,
        buttons,
      });

      if (sent && sent.message_id) {
        await markPostPublished(postId, sent.message_id);
        await updateUser(userId, { postsPublishedCount: (user.postsPublishedCount || 0) + 1 });
        return { ok: true, messageId: sent.message_id };
      } else {
        return {
          ok: false,
          error: `خطا در ارسال پست به کانال ${user.channelId}! لطفاً مطمئن شوید ربات در کانال عضو و ادمین با دسترسی ارسال پیام است.`,
        };
      }
    } catch (sendErr) {
      console.error('Publish draft failed:', sendErr);
      return {
        ok: false,
        error: `خطا در انتشار: ${sendErr.message || 'نامشخص'}`,
      };
    }
  }

  // 10. Reject Draft Post
  if (action === 'reject_draft' || action === 'reject_post') {
    const postId = parseInt(input.postId || input.id, 10);
    if (!postId) {
      return { ok: false, error: 'شناسه پست الزامی است.' };
    }
    await markPostRejected(postId);
    return { ok: true, message: 'Draft rejected' };
  }

  // 11. Delete Source
  if (action === 'delete_source') {
    const sourceId = parseInt(input.sourceId, 10);
    if (sourceId) {
      await deleteSource(sourceId, userId);
      return { ok: true, message: 'Source deleted' };
    }
    return { ok: false, error: 'شناسه منبع نامعتبر است.' };
  }

  return { ok: false, error: 'Unknown action' };
}
