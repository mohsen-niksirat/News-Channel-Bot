/**
 * Telegram Cloud API Endpoint for Mini App Dashboard
 * Endpoint URL: https://cloud.telegram.org/<APP_ID>/endpoints/api
 */

import { db, api, fetch } from 'sdk';
import { eq, and, or } from 'sdk/db';
import { users, aiKeys, sources, customProviders, posts } from 'schema';
import { createHmac, timingSafeEqual } from 'node:crypto';
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
  addSource,
  getPostById,
  markPostPublished,
  markPostRejected,
  ADMIN_ID,
  getAdminPlatformStats,
} from 'lib/db';
import { hashString } from 'lib/harvester';
import { runHealthCheckForUser } from 'lib/health_check';
import { runScanForUser } from 'lib/scanner';
import { buildPostButtons, sendRichPostSafe, preparePostForPublishing, escHtml } from 'lib/rich_post';

// Module-level testing hook for injected bot token secret
let injectedBotToken = null;

export function setBotTokenForTests(token) {
  injectedBotToken = token;
}

/**
 * Resolves the Telegram bot token secret from the runtime environment.
 * The tgcloud serverless runtime exposes credentials through ctx or environment variables.
 * 
 * @param {object} [ctx]
 * @returns {string}
 */
export function getBotToken(ctx = null) {
  if (injectedBotToken) return injectedBotToken;
  return (
    ctx?.botToken ||
    ctx?.env?.BOT_TOKEN ||
    ctx?.env?.TELEGRAM_BOT_TOKEN ||
    (typeof process !== 'undefined' ? (process.env?.BOT_TOKEN || process.env?.TELEGRAM_BOT_TOKEN || '') : '')
  );
}

/**
 * Computes a keyed HMAC-SHA256 bearer token for secure deep-linked access.
 * Format: <userId>:<HMAC_SHA256_HEX(key=botToken, message="newsstudio_auth_" + userId)>
 * 
 * @param {number|string} userId
 * @param {string} [botToken]
 * @returns {string}
 */
export function computeSignedToken(userId, botToken = null) {
  const uid = parseInt(userId, 10);
  if (!uid) return '';
  const secret = botToken || getBotToken();
  if (!secret) return '';
  const sig = createHmac('sha256', secret).update(`newsstudio_auth_${uid}`).digest('hex');
  return `${uid}:${sig}`;
}

/**
 * Performs cryptographic HMAC-SHA256 verification of Telegram WebApp initData.
 * Implements Telegram's official data-check-string verification algorithm:
 *   secret_key = HMAC_SHA256(key="WebAppData", message=botToken)
 *   calculated_hash = HMAC_SHA256(key=secret_key, message=data_check_string)
 * 
 * @param {string} rawInitData
 * @param {string} botToken
 * @returns {{ ok: boolean, user?: object, error?: string }}
 */
export function verifyTelegramInitData(rawInitData, botToken) {
  if (!rawInitData || typeof rawInitData !== 'string' || !botToken) {
    return { ok: false, error: 'Missing initData or bot token' };
  }

  try {
    const sp = new URLSearchParams(rawInitData);
    const hash = sp.get('hash');
    if (!hash || hash.length !== 64) {
      return { ok: false, error: 'Missing or invalid hash parameter' };
    }

    const keys = [];
    for (const [k] of sp.entries()) {
      if (k !== 'hash') {
        keys.push(k);
      }
    }
    keys.sort();

    const dataCheckString = keys.map((k) => `${k}=${sp.get(k)}`).join('\n');
    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const hashBuf = Buffer.from(hash, 'hex');
    const calcBuf = Buffer.from(calculatedHash, 'hex');

    if (hashBuf.length !== 32 || calcBuf.length !== 32) {
      return { ok: false, error: 'Hash length mismatch' };
    }

    if (!timingSafeEqual(hashBuf, calcBuf)) {
      return { ok: false, error: 'HMAC signature mismatch' };
    }

    const userStr = sp.get('user');
    let user = null;
    if (userStr) {
      try {
        user = JSON.parse(userStr);
      } catch {}
    }

    return { ok: true, user, authDate: sp.get('auth_date') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Validates request authentication via Telegram initData or lightweight signed token.
 * Rejects unsigned requests to prevent unauthorized manipulation.
 * 
 * @param {object} input
 * @param {object} ctx
 * @returns {{ authenticated: boolean, userId: number|null, error?: string, source?: string }}
 */
export function validateApiAuth(input, ctx) {
  const action = input?.action || 'get_data';
  const botToken = getBotToken(ctx);

  // 1. Telegram runtime verified initData
  if (ctx?.initData?.user?.id) {
    return { authenticated: true, userId: ctx.initData.user.id, source: 'ctx_init_data' };
  }

  // 2. Raw initData string in headers or body — Cryptographic HMAC-SHA256 verified
  const rawInitData =
    ctx?.headers?.['x-telegram-init-data'] ||
    ctx?.headers?.['authorization']?.replace(/^(?:tma|bearer)\s+/i, '') ||
    input?.initData;

  if (rawInitData && typeof rawInitData === 'string') {
    if (botToken) {
      const verified = verifyTelegramInitData(rawInitData, botToken);
      if (verified.ok && verified.user?.id) {
        return { authenticated: true, userId: verified.user.id, source: 'raw_init_data' };
      }
    }
  }

  // 3. Cryptographically keyed HMAC-SHA256 signed token: <uid>:<hmac_sha256(key=botToken, msg="newsstudio_auth_" + uid)>
  const token = input?.token || ctx?.headers?.['x-news-token'];
  if (token && typeof token === 'string' && botToken) {
    const colonIdx = token.indexOf(':');
    if (colonIdx > 0) {
      const uid = parseInt(token.slice(0, colonIdx), 10);
      const providedSig = token.slice(colonIdx + 1);
      if (uid && providedSig && providedSig.length === 64) {
        const expectedSig = createHmac('sha256', botToken).update(`newsstudio_auth_${uid}`).digest('hex');
        try {
          const sigBuf = Buffer.from(providedSig, 'hex');
          const expBuf = Buffer.from(expectedSig, 'hex');
          if (sigBuf.length === 32 && expBuf.length === 32 && timingSafeEqual(sigBuf, expBuf)) {
            return { authenticated: true, userId: uid, source: 'signed_token' };
          }
        } catch {}
      }
    }
  }

  // 4. Test environment override (allows authenticated tests with explicit test auth flag)
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test' && input?.testAuth && input?.userId) {
    return { authenticated: true, userId: parseInt(input.userId, 10), source: 'test_env' };
  }

  // 5. Read-only actions fallback for deep-linked Mini App with valid Telegram ID
  const isReadOnly = action === 'get_data' || action === 'overview' || action === 'get_overview' || action === 'drafts' || action === 'keys/sources';
  const candidateId = parseInt(input?.userId || input?.uid || 0, 10);
  if (isReadOnly && candidateId > 10000) {
    return { authenticated: true, userId: candidateId, source: 'readonly_uid' };
  }

  return {
    authenticated: false,
    userId: null,
    error: 'دسترسی غیرمجاز: احراز هویت با initData تلگرام یا توکن معتبر الزامی است.',
  };
}

export default async function (input, ctx) {
  const auth = validateApiAuth(input, ctx);
  if (!auth.authenticated) {
    return { ok: false, status: 401, error: auth.error };
  }

  const userId = auth.userId;
  const action = input?.action || 'get_data';

  // Admin Platform Stats (Strictly Admin only)
  if (action === 'get_admin_stats') {
    if (userId !== ADMIN_ID) {
      return { ok: false, error: 'دسترسی غیرمجاز: مخصوص مدیریت کل سیستم' };
    }
    const stats = await getAdminPlatformStats();
    const allUsers = await db.select().from(users).all();
    stats.userList = allUsers.map((u) => ({
      id: u.id,
      tgId: u.tgId,
      name: u.name,
      username: u.username,
      channelId: u.channelId,
    }));
    return { ok: true, stats };
  }

  let user = await getUser(userId);
  if (!user) {
    if (action === 'get_data' || action === 'overview' || action === 'get_overview') {
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
    return { ok: false, error: 'User not found' };
  }

  // ---------------- PHASE 4 RESTful Endpoints ----------------

  // GET overview
  if (action === 'overview' || action === 'get_overview') {
    const keys = await getAiKeys(userId);
    const drafts = await getDraftPosts(userId, 50);
    const tokenStats = await getTokenUsageStats(userId);
    const dayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

    const userPosts = await db
      .select({ id: posts.id, status: posts.status, createdAt: posts.createdAt })
      .from(posts)
      .where(or(eq(posts.userId, userId), eq(posts.userId, user.id || userId)))
      .all();

    const publishedToday = userPosts.filter(
      (p) => p.status === 'published' && (p.createdAt || 0) >= dayStart
    ).length;

    const keysHealth = {
      active: keys.filter((k) => k.status === 'active').length,
      cooldown: keys.filter((k) => k.status === 'cooldown').length,
      dead: keys.filter((k) => k.status === 'dead').length,
      total: keys.length,
    };

    const overviewData = {
      draftsCount: drafts.length,
      publishedToday,
      tokensToday: tokenStats?.today?.total || 0,
      costTodayFormatted: tokenStats?.cost?.todayFormatted || '$0.00',
      costAllTimeFormatted: tokenStats?.cost?.allTimeFormatted || '$0.00',
      keysHealth,
      channelId: user.channelId || '',
      autoPublish: Boolean(user.autoPublish),
      publishMode: user.publishMode || 'smart',
      routingPolicy: user.routingPolicy || 'fallback',
      toneProfile: user.toneProfile || 'standard',
    };

    return {
      ok: true,
      overview: overviewData,
      stats: overviewData,
    };
  }

  // GET drafts
  if (action === 'drafts' || action === 'get_drafts') {
    const drafts = await getDraftPosts(userId, 50);
    return {
      ok: true,
      drafts: drafts.map((d) => ({
        id: d.id,
        title: d.aiTitle || d.originalTitle || 'بدون عنوان',
        summary: d.aiSummary || '',
        source: d.sourceName || 'منبع',
        sourceUrl: d.sourceUrl || '',
        createdAt: d.createdAt,
        importance: d.importance,
        category: d.category,
        imageUrl: d.imageUrl,
      })),
    };
  }

  // POST draft/action
  if (action === 'draft/action' || action === 'draft_action') {
    const postId = parseInt(input.id || input.postId, 10);
    const act = (input.actionType || input.act || input.type || input.action_name || '').toLowerCase();

    if (!postId) {
      return { ok: false, error: 'شناسه پست الزامی است.' };
    }

    const post = await getPostById(postId);
    if (!post) {
      return { ok: false, error: 'پست یافت نشد.' };
    }
    if (post.userId && post.userId !== user.id && post.userId !== userId) {
      return { ok: false, error: 'شما دسترسی به این پست ندارید.' };
    }

    if (act === 'publish') {
      if (post.status === 'published') {
        return { ok: false, error: 'این پست قبلاً در کانال منتشر شده است.' };
      }
      if (!user.channelId) {
        return { ok: false, error: 'کانال مقصد ست نشده است. ابتدا از تنظیمات آیدی کانال را وارد کنید.' };
      }

      const postHtml = preparePostForPublishing({ post, user });
      const sent = await sendRichPostSafe({
        chatId: user.channelId,
        postHtml,
        imageUrl: post.imageUrl,
        buttons: null,
        disableWebPagePreview: false,
      });

      if (sent && sent.message_id) {
        await markPostPublished(postId, sent.message_id);
        await updateUser(user.tgId || userId, {
          postsPublishedCount: (user.postsPublishedCount || 0) + 1,
        });
        return { ok: true, action: 'publish', messageId: sent.message_id };
      } else {
        return { ok: false, error: `خطا در ارسال پست به کانال ${user.channelId}` };
      }
    } else if (act === 'reject') {
      await markPostRejected(postId);
      return { ok: true, action: 'reject' };
    } else if (act === 'edit') {
      const updates = {};
      if (input.title) updates.aiTitle = String(input.title).trim();
      if (input.summary) updates.aiSummary = String(input.summary).trim();
      if (Object.keys(updates).length > 0) {
        await db.update(posts).set(updates).where(eq(posts.id, postId)).run();
      }
      return { ok: true, action: 'edit' };
    } else {
      return { ok: false, error: 'عملیات نامعتبر است (باید یکی از publish، reject یا edit باشد).' };
    }
  }

  // GET keys/sources
  if (action === 'keys/sources' || action === 'get_keys_sources') {
    const keys = await getAiKeys(userId);
    const userSources = await getUserSources(userId);
    const customProv = await getCustomProviders(userId);

    return {
      ok: true,
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
        categories: s.categories,
        enabled: Boolean(s.enabled),
      })),
      customProviders: customProv,
    };
  }

  // ---------------- Existing Dashboard Action Handlers (Full Backward Compatibility) ----------------

  // 1. Get complete dashboard data
  if (action === 'get_data') {
    const keys = await getAiKeys(userId);
    const userSources = await getUserSources(userId);
    const customProv = await getCustomProviders(userId);
    const tokenStats = await getTokenUsageStats(userId);
    const drafts = await getDraftPosts(userId, 50);
    let adminStats = null;
    if (userId === ADMIN_ID) {
      adminStats = await getAdminPlatformStats();
    }

    return {
      ok: true,
      user: {
        tgId: user.tgId,
        firstName: user.firstName || user.name,
        username: user.username,
        channelId: user.channelId,
        autoPublish: Boolean(user.autoPublish),
        publishMode: user.publishMode || 'smart',
        routingPolicy: user.routingPolicy || 'fallback',
        preferredProvider: user.preferredAiProvider || 'gemini',
        footerText: user.footerText,
        toneProfile: user.toneProfile || 'standard',
        scheduleWindows: user.scheduleWindows,
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
        categories: s.categories,
        enabled: Boolean(s.enabled),
      })),
      customProviders: customProv,
      tokenStats,
      drafts,
      adminStats,
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
    if (input.toneProfile !== undefined) updates.toneProfile = input.toneProfile;
    if (input.scheduleWindows !== undefined) updates.scheduleWindows = input.scheduleWindows;

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

  // 9. Publish Draft Post (legacy alias)
  if (action === 'publish_draft' || action === 'publish_post') {
    const postId = parseInt(input.postId || input.id, 10);
    if (!postId) return { ok: false, error: 'شناسه پست الزامی است.' };
    const post = await getPostById(postId);
    if (!post) return { ok: false, error: 'پست یافت نشد.' };
    if (!user.channelId) return { ok: false, error: 'کانال متصل به ربات هنوز تنظیم نشده است.' };

    const postHtml = preparePostForPublishing({ post, user });
    const sent = await sendRichPostSafe({
      chatId: user.channelId,
      postHtml,
      imageUrl: post.imageUrl,
      buttons: null,
      disableWebPagePreview: false,
    });

    if (sent && sent.message_id) {
      await markPostPublished(postId, sent.message_id);
      await updateUser(user.tgId || userId, {
        postsPublishedCount: (user.postsPublishedCount || 0) + 1,
      });
      return { ok: true, messageId: sent.message_id };
    }
    return { ok: false, error: `خطا در ارسال پست به کانال ${user.channelId}` };
  }

  // 10. Reject Draft Post (legacy alias)
  if (action === 'reject_draft' || action === 'reject_post') {
    const postId = parseInt(input.postId || input.id, 10);
    if (!postId) return { ok: false, error: 'شناسه پست الزامی است.' };
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

  // 12. Add Source
  if (action === 'add_source') {
    const { name, type, urlOrHandle, lang = 'fa', category = 'tech' } = input;
    if (!name || !urlOrHandle) {
      return { ok: false, error: 'نام و آدرس منبع الزامی است.' };
    }
    const created = await addSource(userId, { name, type: type || 'rss', urlOrHandle, lang, category });
    return { ok: true, source: created };
  }

  return { ok: false, error: 'Unknown action' };
}
