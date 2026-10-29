import { db } from 'sdk';
import { eq, and, desc, asc, sql } from 'sdk/db';
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
      channelId: '@MyLeitner',
      footerText: '📢 @MyLeitner',
      routingPolicy: 'fallback',
    })
    .returning()
    .run();

  // Populate default sources for new user
  for (const s of DEFAULT_GLOBAL_SOURCES) {
    await db.insert(sources).values({
      userId: tgUser.id,
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
  return await db
    .select()
    .from(sources)
    .where(eq(sources.userId, userId))
    .orderBy(sources.id)
    .all();
}

export async function addSource(userId, { name, type, urlOrHandle, lang = 'fa', category = 'general' }) {
  const [created] = await db
    .insert(sources)
    .values({
      userId,
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
  const row = await db.select().from(sources).where(and(eq(sources.id, sourceId), eq(sources.userId, userId))).get();
  if (!row) return null;
  const newEnabled = !row.enabled;
  await db.update(sources).set({ enabled: newEnabled }).where(eq(sources.id, sourceId)).run();
  return newEnabled;
}

export async function deleteSource(sourceId, userId) {
  await db.delete(sources).where(and(eq(sources.id, sourceId), eq(sources.userId, userId))).run();
}

// ---------------- Custom Providers ----------------
export async function getCustomProviders(userId = null) {
  if (!userId) {
    return await db
      .select()
      .from(customProviders)
      .orderBy(customProviders.id)
      .all();
  }
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

export async function getAiKeys(userId = null) {
  if (!userId) {
    return await db
      .select()
      .from(aiKeys)
      .orderBy(asc(aiKeys.sortOrder), asc(aiKeys.id))
      .all();
  }
  return await db
    .select()
    .from(aiKeys)
    .where(eq(aiKeys.userId, userId))
    .orderBy(asc(aiKeys.sortOrder), asc(aiKeys.id))
    .all();
}

export async function deleteAiKey(keyId, userId = null) {
  if (userId) {
    await db.delete(aiKeys).where(and(eq(aiKeys.id, keyId), eq(aiKeys.userId, userId))).run();
  } else {
    await db.delete(aiKeys).where(eq(aiKeys.id, keyId)).run();
  }
}

export async function moveAiKeyPriority(keyId, direction, userId = null) {
  const all = await getAiKeys(userId);
  const idx = all.findIndex((k) => k.id === keyId);
  if (idx === -1) return;

  if (direction === 'up' && idx > 0) {
    const prev = all[idx - 1];
    const curr = all[idx];
    const prevOrder = prev.sortOrder !== undefined ? prev.sortOrder : (idx - 1);
    const currOrder = curr.sortOrder !== undefined ? curr.sortOrder : idx;
    const targetOrder = prevOrder <= currOrder ? prevOrder - 1 : prevOrder;
    await db.update(aiKeys).set({ sortOrder: targetOrder }).where(eq(aiKeys.id, curr.id)).run();
    await db.update(aiKeys).set({ sortOrder: currOrder + 1 }).where(eq(aiKeys.id, prev.id)).run();
  } else if (direction === 'down' && idx < all.length - 1) {
    const next = all[idx + 1];
    const curr = all[idx];
    const nextOrder = next.sortOrder !== undefined ? next.sortOrder : (idx + 1);
    const currOrder = curr.sortOrder !== undefined ? curr.sortOrder : idx;
    const targetOrder = nextOrder >= currOrder ? nextOrder + 1 : nextOrder;
    await db.update(aiKeys).set({ sortOrder: targetOrder }).where(eq(aiKeys.id, curr.id)).run();
    await db.update(aiKeys).set({ sortOrder: currOrder - 1 }).where(eq(aiKeys.id, next.id)).run();
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
