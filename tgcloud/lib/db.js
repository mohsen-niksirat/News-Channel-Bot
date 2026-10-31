import { db } from 'sdk';
import { eq, and, or, desc, asc, sql } from 'sdk/db';
import { users, sources, customProviders, aiKeys, tokenUsage, posts } from 'schema';

export const ADMIN_ID = 65807806; // Mohsen Niksirat

export const DEFAULT_GLOBAL_SOURCES = [
  { name: 'Zoomit', type: 'rss', urlOrHandle: 'https://zoomit.ir/feed/', lang: 'fa', category: 'tech' },
  { name: 'TechCrunch', type: 'rss', urlOrHandle: 'https://techcrunch.com/feed/', lang: 'en', category: 'tech' },
  { name: 'The Verge', type: 'rss', urlOrHandle: 'https://www.theverge.com/rss/index.xml', lang: 'en', category: 'tech' },
  { name: 'GadgetNews', type: 'rss', urlOrHandle: 'https://gadgetnews.net/feed/', lang: 'fa', category: 'tech' },
];

export async function getOrCreateUser(tgUser) {
  let user = await db.select().from(users).where(eq(users.tgId, tgUser.id)).get();
  if (user) {
    return { user, isNew: false };
  }

  const [created] = await db
    .insert(users)
    .values({
      tgId: tgUser.id,
      name: tgUser.first_name || '',
      username: tgUser.username || '',
      state: 'idle',
      channelId: null,
      footerText: null,
      routingPolicy: 'fallback',
    })
    .returning()
    .run();

  // Populate default sources for new user
  for (const s of DEFAULT_GLOBAL_SOURCES) {
    await db.insert(sources).values({
      userId: created.id,
      name: s.name,
      type: s.type,
      urlOrHandle: s.urlOrHandle,
      lang: s.lang,
      category: s.category,
      enabled: true,
    }).run();
  }

  return { user: created, isNew: true };
}

export async function getUser(tgId) {
  return await db.select().from(users).where(eq(users.tgId, tgId)).get();
}

export async function updateUser(tgId, patch) {
  await db.update(users).set(patch).where(eq(users.tgId, tgId)).run();
  return getUser(tgId);
}

export async function setUserState(tgId, state, stateData = null) {
  const patch = { state };
  if (stateData !== undefined) {
    patch.stateData = stateData ? JSON.stringify(stateData) : null;
  }
  await db.update(users).set(patch).where(eq(users.tgId, tgId)).run();
}

// ---------------- Sources ----------------
export async function getUserSources(userId) {
  const u = await getUser(userId);
  const targetId = u ? u.id : userId;
  return await db
    .select()
    .from(sources)
    .where(or(eq(sources.userId, userId), eq(sources.userId, targetId)))
    .orderBy(sources.id)
    .all();
}

export async function addSource(userId, { name, type, urlOrHandle, lang = 'fa', category = 'general' }) {
  const u = await getUser(userId);
  const targetId = u ? u.id : userId;
  const [created] = await db
    .insert(sources)
    .values({
      userId: targetId,
      name,
      type,
      urlOrHandle,
      lang,
      category,
      enabled: true,
    })
    .returning()
    .run();
  return created;
}

export async function toggleSource(sourceId, userId) {
  const u = await getUser(userId);
  const targetId = u ? u.id : userId;
  const row = await db.select().from(sources).where(and(eq(sources.id, sourceId), or(eq(sources.userId, userId), eq(sources.userId, targetId)))).get();
  if (!row) return null;
  const newEnabled = !row.enabled;
  await db.update(sources).set({ enabled: newEnabled }).where(eq(sources.id, sourceId)).run();
  return newEnabled;
}

export async function deleteSource(sourceId, userId) {
  const u = await getUser(userId);
  const targetId = u ? u.id : userId;
  await db.delete(sources).where(and(eq(sources.id, sourceId), or(eq(sources.userId, userId), eq(sources.userId, targetId)))).run();
}

// ---------------- Custom Providers ----------------
export async function getCustomProviders(userId) {
  if (!userId) return [];
  return await db
    .select()
    .from(customProviders)
    .where(eq(customProviders.userId, userId))
    .orderBy(customProviders.id)
    .all();
}

export async function getCustomProviderById(id) {
  return await db.select().from(customProviders).where(eq(customProviders.id, id)).get();
}

export async function getCustomProviderBySlug(slug, userId = null) {
  if (userId) {
    return await db.select().from(customProviders).where(and(eq(customProviders.slug, slug), eq(customProviders.userId, userId))).get();
  }
  return await db.select().from(customProviders).where(eq(customProviders.slug, slug)).get();
}

export async function addCustomProvider(userId, { name, baseUrl, defaultModel = null, models = [] }) {
  const slug = `c_${Date.now()}`;
  const [created] = await db
    .insert(customProviders)
    .values({
      userId,
      name,
      slug,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      defaultModel: defaultModel || (models[0] || 'default'),
      models: JSON.stringify(models),
    })
    .returning()
    .run();
  return created;
}

export async function updateCustomProviderModels(id, models, userId = null) {
  const conditions = [eq(customProviders.id, id)];
  if (userId) conditions.push(eq(customProviders.userId, userId));
  await db.update(customProviders).set({
    models: JSON.stringify(models),
    defaultModel: models[0] || null,
  }).where(and(...conditions)).run();
}

export async function deleteCustomProvider(id, userId) {
  const p = await db.select().from(customProviders).where(and(eq(customProviders.id, id), eq(customProviders.userId, userId))).get();
  if (p) {
    await db.delete(aiKeys).where(and(eq(aiKeys.provider, p.slug), eq(aiKeys.userId, userId))).run();
    await db.delete(customProviders).where(and(eq(customProviders.id, id), eq(customProviders.userId, userId))).run();
  }
}

// ---------------- AI Keys & Priority ----------------
export async function addAiKey({ userId = null, provider, apiKey, label, baseUrl = null }) {
  const query = db
    .select({ sortOrder: aiKeys.sortOrder })
    .from(aiKeys);

  const lastKey = userId
    ? await query.where(eq(aiKeys.userId, userId)).orderBy(desc(aiKeys.sortOrder)).limit(1).get()
    : await query.orderBy(desc(aiKeys.sortOrder)).limit(1).get();

  const nextOrder = (lastKey?.sortOrder || 0) + 1;

  const [created] = await db
    .insert(aiKeys)
    .values({
      userId,
      provider,
      apiKey,
      label: label || `${provider.toUpperCase()} Key`,
      baseUrl,
      status: 'active',
      sortOrder: nextOrder,
    })
    .returning()
    .run();
  return created;
}

export async function getAiKeys(userId) {
  if (!userId) return [];
  return await db
    .select()
    .from(aiKeys)
    .where(eq(aiKeys.userId, userId))
    .orderBy(asc(aiKeys.sortOrder), asc(aiKeys.id))
    .all();
}

export async function deleteAiKey(keyId, userId) {
  if (!userId || !keyId) return;
  await db.delete(aiKeys).where(and(eq(aiKeys.id, keyId), eq(aiKeys.userId, userId))).run();
}

export async function moveAiKeyPriority(keyId, direction, userId) {
  if (!userId || !keyId) return;
  const all = await getAiKeys(userId);
  const idx = all.findIndex((k) => k.id === keyId);
  if (idx === -1) return;

  if (direction === 'up' && idx > 0) {
    const prev = all[idx - 1];
    const curr = all[idx];
    const prevOrder = prev.sortOrder !== undefined ? prev.sortOrder : (idx - 1);
    const currOrder = curr.sortOrder !== undefined ? curr.sortOrder : idx;
    const targetOrder = prevOrder <= currOrder ? prevOrder - 1 : prevOrder;
    await db.update(aiKeys).set({ sortOrder: targetOrder }).where(and(eq(aiKeys.id, curr.id), eq(aiKeys.userId, userId))).run();
    await db.update(aiKeys).set({ sortOrder: currOrder + 1 }).where(and(eq(aiKeys.id, prev.id), eq(aiKeys.userId, userId))).run();
  } else if (direction === 'down' && idx < all.length - 1) {
    const next = all[idx + 1];
    const curr = all[idx];
    const nextOrder = next.sortOrder !== undefined ? next.sortOrder : (idx + 1);
    const currOrder = curr.sortOrder !== undefined ? curr.sortOrder : idx;
    const targetOrder = nextOrder >= currOrder ? nextOrder + 1 : nextOrder;
    await db.update(aiKeys).set({ sortOrder: targetOrder }).where(and(eq(aiKeys.id, curr.id), eq(aiKeys.userId, userId))).run();
    await db.update(aiKeys).set({ sortOrder: currOrder - 1 }).where(and(eq(aiKeys.id, next.id), eq(aiKeys.userId, userId))).run();
  }
}

// ---------------- Token Usage Analytics ----------------
export async function recordTokenUsage({
  userId,
  keyId = null,
  provider,
  model = null,
  promptTokens = 0,
  completionTokens = 0,
  action = 'news_rewrite',
}) {
  const total = (promptTokens || 0) + (completionTokens || 0);
  await db.insert(tokenUsage).values({
    userId,
    keyId,
    provider,
    model,
    promptTokens,
    completionTokens,
    totalTokens: total,
    action,
  }).run();

  if (keyId && total > 0) {
    await db.update(aiKeys).set({
      totalTokens: sql`COALESCE(total_tokens, 0) + ${total}`,
    }).where(eq(aiKeys.id, keyId)).run();
  }
}

export async function getTokenUsageStats(userId) {
  if (!userId) {
    return {
      today: { total: 0, prompt: 0, completion: 0 },
      week: 0,
      month: 0,
      allTime: 0,
      byProvider: {},
    };
  }
  const now = Math.floor(Date.now() / 1000);
  const dayStart = now - (now % 86400); // Today midnight
  const weekAgo = now - 7 * 86400;
  const monthAgo = now - 30 * 86400;

  const all = await db
    .select()
    .from(tokenUsage)
    .where(eq(tokenUsage.userId, userId))
    .all();

  let todayTokens = 0;
  let todayPrompt = 0;
  let todayComp = 0;
  let weekTokens = 0;
  let monthTokens = 0;
  let allTimeTokens = 0;
  const providerStats = {};

  for (const row of all) {
    const t = row.totalTokens || 0;
    const p = row.promptTokens || 0;
    const c = row.completionTokens || 0;
    const created = row.createdAt || 0;

    allTimeTokens += t;
    if (created >= monthAgo) monthTokens += t;
    if (created >= weekAgo) weekTokens += t;
    if (created >= dayStart) {
      todayTokens += t;
      todayPrompt += p;
      todayComp += c;
    }

    const prov = (row.provider || 'other').toUpperCase();
    providerStats[prov] = (providerStats[prov] || 0) + t;
  }

  return {
    today: { total: todayTokens, prompt: todayPrompt, completion: todayComp },
    week: weekTokens,
    month: monthTokens,
    allTime: allTimeTokens,
    byProvider: providerStats,
  };
}

// ---------------- Posts & Queue ----------------
export async function isPostAlreadyHarvested(userId, originalHash) {
  const existing = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.userId, userId), eq(posts.originalHash, originalHash)))
    .get();
  return Boolean(existing);
}

export async function saveDraftPost({
  userId,
  sourceName,
  sourceUrl,
  originalTitle,
  originalHash,
  aiTitle,
  aiSummary,
  formattedHtml,
  imageUrl,
  category = 'tech',
  importance = null,
}) {
  const [created] = await db
    .insert(posts)
    .values({
      userId,
      sourceName,
      sourceUrl,
      originalTitle,
      originalHash,
      aiTitle,
      aiSummary,
      formattedHtml,
      imageUrl,
      category,
      importance,
      status: 'draft',
    })
    .returning()
    .run();
  return created;
}

export async function getDraftPosts(userId, limit = 10) {
  return await db
    .select()
    .from(posts)
    .where(and(eq(posts.userId, userId), eq(posts.status, 'draft')))
    .orderBy(desc(posts.id))
    .limit(limit)
    .all();
}

export async function getPostById(postId) {
  return await db.select().from(posts).where(eq(posts.id, postId)).get();
}

export async function markPostPublished(postId, publishedMessageId) {
  await db
    .update(posts)
    .set({
      status: 'published',
      publishedMessageId,
      publishedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(posts.id, postId))
    .run();
}

export async function markPostRejected(postId) {
  await db.update(posts).set({ status: 'rejected' }).where(eq(posts.id, postId)).run();
}

// ---------------- Platform Admin Statistics ----------------
export async function getAdminPlatformStats() {
  const now = Math.floor(Date.now() / 1000);
  const dayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const weekAgo = now - 7 * 86400;

  // 1. Users
  const allUsers = await db.select().from(users).all();
  const totalUsers = allUsers.length;
  const connectedChannels = allUsers.filter((u) => u.channelId && u.channelId.trim().length > 0).length;
  const autoPublishCount = allUsers.filter((u) => Boolean(u.autoPublish)).length;
  const joinedToday = allUsers.filter((u) => (u.createdAt || 0) >= dayStart).length;
  const totalPublishedPosts = allUsers.reduce((sum, u) => sum + (u.postsPublishedCount || 0), 0);

  // 2. Posts
  const allPosts = await db.select({ id: posts.id, status: posts.status, createdAt: posts.createdAt }).from(posts).all();
  const totalPosts = allPosts.length;
  const publishedPosts = allPosts.filter((p) => p.status === 'published').length;
  const draftPosts = allPosts.filter((p) => p.status === 'draft').length;
  const rejectedPosts = allPosts.filter((p) => p.status === 'rejected').length;
  const postsToday = allPosts.filter((p) => (p.createdAt || 0) >= dayStart).length;

  // 3. Sources
  const allSources = await db.select().from(sources).all();
  const totalSources = allSources.length;
  const enabledSources = allSources.filter((s) => Boolean(s.enabled)).length;
  const rssSources = allSources.filter((s) => s.type === 'rss').length;
  const telegramSources = allSources.filter((s) => s.type === 'telegram').length;

  // 4. AI Keys
  const allKeys = await db.select().from(aiKeys).all();
  const totalKeys = allKeys.length;
  const activeKeys = allKeys.filter((k) => k.status === 'active').length;
  const cooldownKeys = allKeys.filter((k) => k.status === 'cooldown').length;
  const deadKeys = allKeys.filter((k) => k.status === 'dead').length;
  const keysByProvider = {};
  for (const k of allKeys) {
    const p = (k.provider || 'other').toUpperCase();
    keysByProvider[p] = (keysByProvider[p] || 0) + 1;
  }

  // 5. Tokens
  const allTokens = await db.select().from(tokenUsage).all();
  let tokensToday = 0;
  let promptToday = 0;
  let completionToday = 0;
  let tokensWeek = 0;
  let tokensAllTime = 0;
  const tokensByProvider = {};

  for (const row of allTokens) {
    const t = row.totalTokens || 0;
    const p = row.promptTokens || 0;
    const c = row.completionTokens || 0;
    const created = row.createdAt || 0;
    tokensAllTime += t;
    if (created >= weekAgo) tokensWeek += t;
    if (created >= dayStart) {
      tokensToday += t;
      promptToday += p;
      completionToday += c;
    }
    const prov = (row.provider || 'other').toUpperCase();
    tokensByProvider[prov] = (tokensByProvider[prov] || 0) + t;
  }

  return {
    users: {
      total: totalUsers,
      connectedChannels,
      autoPublishCount,
      joinedToday,
      totalPublishedPosts,
    },
    posts: {
      total: totalPosts,
      published: publishedPosts,
      drafts: draftPosts,
      rejected: rejectedPosts,
      today: postsToday,
    },
    sources: {
      total: totalSources,
      enabled: enabledSources,
      rss: rssSources,
      telegram: telegramSources,
    },
    keys: {
      total: totalKeys,
      active: activeKeys,
      cooldown: cooldownKeys,
      dead: deadKeys,
      byProvider: keysByProvider,
    },
    tokens: {
      today: tokensToday,
      promptToday,
      completionToday,
      week: tokensWeek,
      allTime: tokensAllTime,
      byProvider: tokensByProvider,
    },
  };
}

export function formatAdminStatsMessage(stats) {
  const fNum = (n) => Number(n || 0).toLocaleString('fa-IR');
  const nowStr = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = new Date().toLocaleDateString('fa-IR');

  const provEntries = Object.entries(stats.tokens.byProvider);
  const provLines = provEntries.length > 0
    ? provEntries.map(([p, c]) => `  ├ <b>${p}</b>: <code>${fNum(c)}</code> توکن`).join('\n')
    : '  └ <i>هنوز مصرفی ثبت نشده است</i>';

  const keyEntries = Object.entries(stats.keys.byProvider);
  const keyLines = keyEntries.length > 0
    ? keyEntries.map(([p, c]) => `  ├ <b>${p}</b>: <code>${fNum(c)}</code> کلید`).join('\n')
    : '  └ <i>کلیدی ثبت نشده است</i>';

  return (
    `👑 <b>مرکز کنترل و آمار جامع پلتفرم (Admin Panel)</b>\n` +
    `📅 <i>تاریخ: ${dateStr} | ساعت: ${nowStr}</i>\n` +
    `──────────────────────────\n\n` +
    `👥 <b>وضعیت کاربران و شبکه:</b>\n` +
    `• کل کاربران پلتفرم: <b>${fNum(stats.users.total)} نفر</b>\n` +
    `• کانال‌های متصل فعال: <b>${fNum(stats.users.connectedChannels)} کانال</b>\n` +
    `• انتشار خودکار روشن: <b>${fNum(stats.users.autoPublishCount)} کاربر</b>\n` +
    `• کاربران ملحق‌شده امروز: <b>${fNum(stats.users.joinedToday)} نفر</b>\n\n` +
    `📰 <b>مدیریت محتوا و انتشارات:</b>\n` +
    `• کل اخبار پردازش‌شده: <b>${fNum(stats.posts.total)} خبر</b>\n` +
    `• پست‌های منتشرشده در کانال‌ها: <b>${fNum(stats.posts.published)} پست</b>\n` +
    `• پیش‌نویس‌های در صف بررسی: <b>${fNum(stats.posts.drafts)} مورد</b>\n` +
    `• خبرهای رد شده: <b>${fNum(stats.posts.rejected)} مورد</b>\n` +
    `• اخبار تولیدی امروز: <b>${fNum(stats.posts.today)} خبر</b>\n\n` +
    `🤖 <b>مصرف توکن‌های هوش مصنوعی (کل سیستم):</b>\n` +
    `• مصرف امروز: <b>${fNum(stats.tokens.today)}</b> (ورودی: ${fNum(stats.tokens.promptToday)} | خروجی: ${fNum(stats.tokens.completionToday)})\n` +
    `• مصرف ۷ روز اخیر: <b>${fNum(stats.tokens.week)}</b> توکن\n` +
    `• مجموع مصرف از ابتدا: <b>${fNum(stats.tokens.allTime)}</b> توکن\n` +
    `تفکیک مصرف به ازای سرویس‌دهنده‌ها:\n${provLines}\n\n` +
    `📡 <b>پایش و منابع خبری فعال:</b>\n` +
    `• کل منابع: <b>${fNum(stats.sources.enabled)} از ${fNum(stats.sources.total)} منبع فعال</b>\n` +
    `• فیدهای RSS وب: <b>${fNum(stats.sources.rss)}</b> | کانال‌های تلگرام: <b>${fNum(stats.sources.telegram)}</b>\n\n` +
    `🔑 <b>استخر کلیدهای هوش مصنوعی:</b>\n` +
    `• کلیدهای فعال و آماده: <b>${fNum(stats.keys.active)} از ${fNum(stats.keys.total)} کلید</b>\n` +
    (stats.keys.cooldown > 0 ? `• در حال خنک‌سازی (Cooldown): <b>${fNum(stats.keys.cooldown)}</b>\n` : '') +
    (stats.keys.dead > 0 ? `• کلیدهای منقضی/غیرفعال: <b>${fNum(stats.keys.dead)}</b>\n` : '') +
    `توزیع کلیدها:\n${keyLines}\n` +
    `──────────────────────────\n` +
    `🛡️ <i>دسترسی انحصاری شناسه مدیریت: <code>${ADMIN_ID}</code></i>`
  );
}
