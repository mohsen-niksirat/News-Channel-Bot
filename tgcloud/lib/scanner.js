/**
 * Scanner Service:
 * Orchestrates fetching news from active sources,
 * rewriting them with AI Router (Gemini / Groq), deduplicating with hashes,
 * and queuing for review or auto-publishing to Telegram channel.
 *
 * Smart Aggregation:
 * - If 1-2 news items: Publishes as individual detailed rich posts.
 * - If 3+ news items: Aggregates them into a single high-impact "Hourly News Bulletin" (بولتن تجمیعی خبری)
 *   with headline, concise summary, and source link for each story to prevent channel spam!
 */

import { api } from 'sdk';
import {
  getUser,
  getUserSources,
  getAiKeys,
  isPostAlreadyHarvested,
  saveDraftPost,
  markPostPublished,
} from 'lib/db';
import { harvestTelegramChannel, harvestRssFeed } from 'lib/harvester';
import { generateNewsRewrite } from 'lib/ai_router';
import { buildEditorialPost, buildBulletinPost, buildPostButtons, sendRichPostSafe, preparePostForPublishing, escHtml } from 'lib/rich_post';
import { mainMenuKeyboard, reviewPostKeyboard } from 'lib/keyboards';
import { getToneSystemPrompt, parseAiNewsJson } from 'lib/tones';
import { parseSourceCategories } from 'lib/categories';

export async function runScanForUser(userId, chatId = null, options = {}) {
  const user = await getUser(userId);
  if (!user) return;

  const draftOnly = Boolean(options?.draftOnly);
  const notifyChat = chatId || userId;

  // Check if user has added at least one AI key
  const userKeys = await getAiKeys(userId);
  if (!userKeys || userKeys.length === 0) {
    if (chatId) {
      await api.sendMessage({
        chat_id: notifyChat,
        text: '⚠️ <b>کلید هوش مصنوعی یافت نشد!</b>\n\nبرای پایش و بازنویسی اخبار، لطفاً ابتدا از منوی <b>🔑 مدیریت کلیدهای AI</b> حداقل یک کلید (جمینای، گروک، دیپ‌سیک و...) اضافه کنید.',
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(user),
      });
    }
    return;
  }

  if (chatId) {
    await api.sendMessage({
      chat_id: notifyChat,
      text: '⏳ <b>در حال پایش منابع خبری با هوش مصنوعی...</b>\nلطفاً چند ثانیه شکیبا باشید.',
      parse_mode: 'HTML',
    }).catch(() => {});
  }

  const sourcesList = await getUserSources(userId);
  const activeSources = sourcesList.filter((s) => s.enabled);

  // Balanced Interleaving: Alternate between Telegram channels and RSS sources
  // so Telegram sources get equal priority and are never starved!
  const tgSources = activeSources.filter((s) => s.type === 'telegram');
  const rssSources = activeSources.filter((s) => s.type === 'rss');
  const balancedSources = [];
  const maxLen = Math.max(tgSources.length, rssSources.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < tgSources.length) balancedSources.push(tgSources[i]);
    if (i < rssSources.length) balancedSources.push(rssSources[i]);
  }

  // Fetch sources in parallel (top 6-8 sources) to stay well under cloud execution timeout
  const sourcesToScan = balancedSources.slice(0, 8);
  const harvestPromises = sourcesToScan.map(async (src) => {
    try {
      let harvested = [];
      if (src.type === 'rss') {
        harvested = await harvestRssFeed(src.urlOrHandle, src.name, 3);
      } else {
        harvested = await harvestTelegramChannel(src.urlOrHandle, 2);
      }
      return { src, items: Array.isArray(harvested) ? harvested : [] };
    } catch (err) {
      console.warn(`Source harvest failed for ${src.name}:`, err.message);
      return { src, items: [] };
    }
  });

  const harvestResults = await Promise.all(harvestPromises);
  const candidateItems = [];

  for (const { src, items } of harvestResults) {
    if (candidateItems.length >= 5) break;
    for (const item of items) {
      if (candidateItems.length >= 5) break;
      const exists = await isPostAlreadyHarvested(userId, item.hash);
      if (!exists && !candidateItems.some((c) => c.hash === item.hash)) {
        candidateItems.push({
          ...item,
          category: src.category,
          sourceCategories: src.categories,
        });
      }
    }
  }

  if (candidateItems.length === 0) {
    if (chatId) {
      await api.sendMessage({
        chat_id: notifyChat,
        text: '✨ <b>پایش تکمیل شد.</b> خبر جدیدی نسبت به آخرین اسکن یافت نشد.',
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(user),
      });
    }
    return;
  }

  const publishMode = user.publishMode || 'smart';
  const shouldAggregate = publishMode === 'bulletin' || (publishMode === 'smart' && candidateItems.length >= 3);

  // ---------------- CASE A: Individual Rich Posts ----------------
  if (!shouldAggregate) {
    let publishedCount = 0;
    const toneAppendix = getToneSystemPrompt(user);
    const baseSystemPrompt = 'تو یک روزنامه‌نگار و نویسنده خلاق اخبار هستی. متن را روان، شیوا، فارسی و جذاب بنویس.' + toneAppendix;

    for (const item of candidateItems) {
      const prompt = `شما سردبیر حرفه‌ای کانال تلگرام هستید. خبر زیر را به یک پست جذاب ژورنالی تلگرام تبدیل کن:
منبع: ${item.sourceName}
عنوان: ${item.title}
متن: ${item.content}

پاسخ را الزاماً در قالب این شیء JSON معتبر بازگردان:
{
  "title": "یک تیتر کوتاه، جذاب و ترغیب‌کننده فارسی",
  "summary": "خلاصه ۲ تا ۳ خطی لید خبر",
  "details": ["۲ تا ۳ نکته کلیدی تکمیلی خبر"],
  "importance": 4,
  "category": "tech"
}
(importance یک عدد صحیح بین ۱ تا ۵ است. category دقیقاً یکی از مقادیر tech, economy, sport, world, social, culture, science, other است)`;

      try {
        const aiRes = await generateNewsRewrite({
          systemPrompt: baseSystemPrompt,
          userPrompt: prompt,
          preferredProvider: user.preferredAiProvider || 'gemini',
          preferredModel: user.preferredModel || 'gemini-3.1-flash-lite',
          userId: userId,
          routingPolicy: user.routingPolicy || 'fallback',
          maxTokens: 1200,
        });

        let parsed = parseAiNewsJson(aiRes.text);

        // One-time retry on format drift if parse failed
        if (!parsed.success) {
          try {
            const retryRes = await generateNewsRewrite({
              systemPrompt: baseSystemPrompt,
              userPrompt: prompt + '\n\nمهم: فقط یک شیء JSON معتبر بده، بدون هیچ متن اضافه. در صورت عدم توانایی، دقیقاً از فرمت [TITLE]: ... و [SUMMARY]: ... استفاده کن.',
              preferredProvider: user.preferredAiProvider || 'gemini',
              preferredModel: user.preferredModel || 'gemini-3.1-flash-lite',
              userId: userId,
              routingPolicy: user.routingPolicy || 'fallback',
              maxTokens: 1200,
            });
            parsed = parseAiNewsJson(retryRes.text);
          } catch {}
        }

        const aiTitle = parsed.title || item.title;
        const aiSummary = parsed.summary || item.title;
        const importance = parsed.importance;
        const itemCategory = parsed.category || item.category || 'tech';

        // Check if category is enabled for this source
        const allowedCategories = parseSourceCategories(item.sourceCategories);
        if (!allowedCategories.includes(itemCategory)) {
          console.log(`[Scanner] Item "${item.title}" categorized as "${itemCategory}", disabled for source "${item.sourceName}". Skipping.`);
          continue;
        }

        const formattedHtml = preparePostForPublishing({
          post: {
            aiTitle,
            aiSummary,
            sourceName: item.sourceName,
            sourceUrl: item.url,
          },
          user,
        });

        const saved = await saveDraftPost({
          userId: userId,
          sourceName: item.sourceName,
          sourceUrl: item.url,
          originalTitle: item.title,
          originalHash: item.hash,
          aiTitle,
          aiSummary,
          formattedHtml,
          imageUrl: item.imageUrl,
          category: itemCategory,
          importance,
        });

        publishedCount++;

        // Auto-Publish (only if enabled, channel is set, and NOT in draftOnly mode)
        const canAutoPublish = user.autoPublish && user.channelId && !draftOnly;
        if (canAutoPublish) {
          const sent = await sendRichPostSafe({
            chatId: user.channelId,
            postHtml: formattedHtml,
            imageUrl: item.imageUrl,
            buttons: null,
            disableWebPagePreview: true,
          });
          if (sent && sent.message_id) {
            await markPostPublished(saved.id, sent.message_id);
          }
        }
      } catch (aiErr) {
        console.error(`AI generation failed for item ${item.title}:`, aiErr.message);
      }
    }

    if (chatId) {
      const canAutoPublish = user.autoPublish && user.channelId && !draftOnly;
      if (canAutoPublish) {
        await api.sendMessage({
          chat_id: notifyChat,
          text: `🚀 <b>پایش ساعتی تکمیل شد!</b> تعداد <b>${publishedCount}</b> خبر به طور مستقیم در کانال <code>${escHtml(user.channelId)}</code> منتشر شد.`,
          parse_mode: 'HTML',
          reply_markup: mainMenuKeyboard(user),
        });
      } else {
        const reason = draftOnly ? ' (حالت زمان‌بندی انتشار)' : '';
        await api.sendMessage({
          chat_id: notifyChat,
          text: `📨 <b>پایش ساعتی تکمیل شد!</b> تعداد <b>${publishedCount}</b> خبر جدید آماده و به صف پیش‌نویس اضافه شد${reason}.\n\n👇 برای مشاهده و انتشار: /review`,
          parse_mode: 'HTML',
          reply_markup: reviewPostKeyboard(0),
        });
      }
    }
    return;
  }

  // ---------------- CASE B: 3+ News Items -> Aggregate into Hourly Bulletin (تجمیع در یک پست) ----------------
  const processedItems = [];
  const savedPostIds = [];
  const toneAppendix = getToneSystemPrompt(user);
  const bulletinSystemPrompt = 'تو سردبیر خبر هستی. کوتاه، پرانرژی و روان بنویس.' + toneAppendix;

  for (const item of candidateItems.slice(0, 4)) {
    const prompt = `این خبر را در ۱ تیتر جذاب فارسی و حداکثر ۲ خط چکیده روان بازنویسی کن:
منبع: ${item.sourceName}
عنوان: ${item.title}
متن: ${item.content}

پاسخ را الزاماً در این قالب JSON معتبر بده:
{
  "title": "تیتر جذاب",
  "summary": "خلاصه ۲ خطی",
  "importance": 3,
  "category": "tech"
}
(importance یک عدد صحیح بین ۱ تا ۵ است. category یکی از مقادیر tech, economy, sport, world, social, culture, science, other است)`;

    try {
      const aiRes = await generateNewsRewrite({
        systemPrompt: bulletinSystemPrompt,
        userPrompt: prompt,
        preferredProvider: user.preferredAiProvider || 'gemini',
        preferredModel: user.preferredModel || 'gemini-3.1-flash-lite',
        userId: userId,
        routingPolicy: user.routingPolicy || 'fallback',
      });

      let parsed = parseAiNewsJson(aiRes.text);
      if (!parsed.success) {
        try {
          const retryRes = await generateNewsRewrite({
            systemPrompt: bulletinSystemPrompt,
            userPrompt: prompt + '\n\nمهم: فقط خروجی معتبر JSON ارسال کن.',
            preferredProvider: user.preferredAiProvider || 'gemini',
            preferredModel: user.preferredModel || 'gemini-3.1-flash-lite',
            userId: userId,
            routingPolicy: user.routingPolicy || 'fallback',
          });
          parsed = parseAiNewsJson(retryRes.text);
        } catch {}
      }

      const aiTitle = parsed.title || item.title;
      const aiSummary = parsed.summary || item.title;
      const importance = parsed.importance;
      const itemCategory = parsed.category || item.category || 'tech';

      // Check if category is enabled for this source
      const allowedCategories = parseSourceCategories(item.sourceCategories);
      if (!allowedCategories.includes(itemCategory)) {
        console.log(`[Scanner] Item "${item.title}" categorized as "${itemCategory}", disabled for source "${item.sourceName}". Skipping.`);
        continue;
      }

      processedItems.push({
        aiTitle,
        aiSummary,
        sourceName: item.sourceName,
        sourceUrl: item.url,
      });

      const itemPostHtml = preparePostForPublishing({
        post: {
          aiTitle,
          aiSummary,
          sourceName: item.sourceName,
          sourceUrl: item.url,
        },
        user,
      });

      const saved = await saveDraftPost({
        userId: userId,
        sourceName: item.sourceName,
        sourceUrl: item.url,
        originalTitle: item.title,
        originalHash: item.hash,
        aiTitle,
        aiSummary,
        formattedHtml: itemPostHtml,
        imageUrl: item.imageUrl,
        category: itemCategory,
        importance,
      });

      savedPostIds.push(saved.id);
    } catch (aiErr) {
      console.error(`AI summary failed in bulletin for ${item.title}:`, aiErr.message);
    }
  }

  if (processedItems.length === 0) return;

  // Build the cohesive bulletin post
  const nowHour = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  const bulletinHtml = buildBulletinPost({
    bulletinTitle: `🗞️ گزیده مهم‌ترین رویدادها (ساعت ${nowHour})`,
    items: processedItems,
    footerText: user.footerText || (user.channelId ? `📢 کانال خبر : ${user.channelId}\n📢 کانال مرجع: @MyLeitner` : '📢 کانال خبر : @theNews_Persian\n📢 کانال مرجع: @MyLeitner'),
  });

  // If autoPublish is ON and not in draftOnly mode, publish bulletin post to the channel
  const canAutoPublish = user.autoPublish && user.channelId && !draftOnly;
  if (canAutoPublish) {
    const sent = await sendRichPostSafe({
      chatId: user.channelId,
      postHtml: bulletinHtml,
      buttons: null,
      disableWebPagePreview: true,
    });

    if (sent && sent.message_id) {
      for (const pid of savedPostIds) {
        await markPostPublished(pid, sent.message_id);
      }
    }
  }

  if (chatId) {
    if (canAutoPublish) {
      await api.sendMessage({
        chat_id: notifyChat,
        text: `🗞️ <b>بولتن خبری ساعتی منتشر شد!</b>\nتعداد <b>${processedItems.length}</b> خبر در قالب یک پست تجمیعی واحد در کانال <code>${escHtml(user.channelId)}</code> منتشر شد.`,
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(user),
      });
    } else {
      const reason = draftOnly ? ' (حالت زمان‌بندی انتشار)' : '';
      await api.sendMessage({
        chat_id: notifyChat,
        text: `🗞️ <b>بولتن ساعتی در انتظار تایید (${processedItems.length} خبر)${reason}:</b>\n\n${bulletinHtml}`,
        parse_mode: 'HTML',
        reply_markup: reviewPostKeyboard(savedPostIds[0] || 0),
      });
    }
  }
}
