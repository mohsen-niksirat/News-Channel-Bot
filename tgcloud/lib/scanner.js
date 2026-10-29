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
import { buildEditorialPost, buildBulletinPost, buildPostButtons, sendRichPostSafe, escHtml } from 'lib/rich_post';
import { mainMenuKeyboard, reviewPostKeyboard } from 'lib/keyboards';

export async function runScanForUser(userId, chatId = null) {
  const user = await getUser(userId);
  if (!user) return;

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

  const candidateItems = [];

  // Harvest unseen items (collect up to 5 items)
  for (const src of balancedSources) {
    if (candidateItems.length >= 5) break;

    try {
      let harvested = [];
      if (src.type === 'rss') {
        harvested = await harvestRssFeed(src.urlOrHandle, src.name, 3);
      } else {
        harvested = await harvestTelegramChannel(src.urlOrHandle, 2);
      }

      for (const item of harvested) {
        if (candidateItems.length >= 5) break;
        const exists = await isPostAlreadyHarvested(userId, item.hash);
        if (!exists && !candidateItems.some((c) => c.hash === item.hash)) {
          candidateItems.push({ ...item, category: src.category });
        }
      }
    } catch (srcErr) {
      console.warn(`Source harvest failed for ${src.name}:`, srcErr.message);
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

    for (const item of candidateItems) {
      const prompt = `شما سردبیر حرفه‌ای کانال تلگرام هستید. خبر زیر را به یک پست جذاب ژورنالی تلگرام تبدیل کن:
منبع: ${item.sourceName}
عنوان: ${item.title}
متن: ${item.content}

فرمت خروجی دقیقاً به این شکل باشد:
[TITLE]: یک تیتر کوتاه، جذاب و ترغیب‌کننده
[SUMMARY]: خلاصه ۲ تا ۳ خطی لید خبر
[DETAILS]: ۲ تا ۳ نکته کلیدی تکمیلی خبر`;

      try {
        const aiRes = await generateNewsRewrite({
          systemPrompt: 'تو یک روزنامه‌نگار و نویسنده خلاق اخبار هستی. متن را روان، شیوا، فارسی و جذاب بنویس.',
          userPrompt: prompt,
          preferredProvider: user.preferredAiProvider || 'gemini',
          preferredModel: user.preferredModel || 'gemini-3.1-flash-lite',
          userId: userId,
          routingPolicy: user.routingPolicy || 'fallback',
        });

        const fullText = aiRes.text;
        const tMatch = fullText.match(/\[TITLE\]:?\s*([^\n]+)/i);
        const sMatch = fullText.match(/\[SUMMARY\]:?\s*([\s\S]*?)(?=\[DETAILS\]|$)/i);
        const dMatch = fullText.match(/\[DETAILS\]:?\s*([\s\S]*?)$/i);

        const aiTitle = tMatch ? tMatch[1].trim() : item.title;
        const aiSummary = sMatch ? sMatch[1].trim() : fullText.slice(0, 180);
        const aiDetails = dMatch ? dMatch[1].trim() : '';

        const formattedHtml = buildEditorialPost({
          title: aiTitle,
          summary: aiSummary,
          deepDive: aiDetails,
          sourceName: item.sourceName,
          sourceUrl: item.url,
          footerText: user.footerText || `📢 ${user.channelId || '@MyLeitner'}`,
          useExpandable: Boolean(user.expandableQuotes !== 0),
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
          category: item.category,
        });

        publishedCount++;

        // Auto-Publish
        if (user.autoPublish && user.channelId) {
          const buttons = buildPostButtons({
            sourceUrl: item.url,
            sourceName: item.sourceName,
            summaryToCopy: aiSummary,
            channelUsername: user.channelId,
          });
          const sent = await sendRichPostSafe({
            chatId: user.channelId,
            postHtml: formattedHtml,
            imageUrl: item.imageUrl,
            buttons,
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
      if (user.autoPublish && user.channelId) {
        await api.sendMessage({
          chat_id: notifyChat,
          text: `🚀 <b>پایش ساعتی تکمیل شد!</b> تعداد <b>${publishedCount}</b> خبر به طور مستقیم در کانال <code>${escHtml(user.channelId)}</code> منتشر شد.`,
          parse_mode: 'HTML',
          reply_markup: mainMenuKeyboard(user),
        });
      } else {
        await api.sendMessage({
          chat_id: notifyChat,
          text: `📨 <b>پایش ساعتی تکمیل شد!</b> تعداد <b>${publishedCount}</b> خبر جدید با هوش مصنوعی آماده و به صف پیش‌نویس اضافه شد.\n\n👇 برای مشاهده و انتشار: /review`,
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

  for (const item of candidateItems.slice(0, 4)) {
    const prompt = `این خبر را در ۱ تیتر جذاب فارسی و حداکثر ۲ خط چکیده روان بازنویسی کن:
منبع: ${item.sourceName}
عنوان: ${item.title}
متن: ${item.content}

فرمت خروجی:
[TITLE]: تیتر جذاب
[SUMMARY]: خلاصه ۲ خطی`;

    try {
      const aiRes = await generateNewsRewrite({
        systemPrompt: 'تو سردبیر خبر هستی. کوتاه، پرانرژی و روان بنویس.',
        userPrompt: prompt,
        preferredProvider: user.preferredAiProvider || 'gemini',
        preferredModel: user.preferredModel || 'gemini-3.1-flash-lite',
        userId: userId,
        routingPolicy: user.routingPolicy || 'fallback',
      });

      const fullText = aiRes.text;
      const tMatch = fullText.match(/\[TITLE\]:?\s*([^\n]+)/i);
      const sMatch = fullText.match(/\[SUMMARY\]:?\s*([\s\S]*?)$/i);

      const aiTitle = tMatch ? tMatch[1].trim() : item.title;
      const aiSummary = sMatch ? sMatch[1].trim() : fullText.slice(0, 150);

      processedItems.push({
        aiTitle,
        aiSummary,
        sourceName: item.sourceName,
        sourceUrl: item.url,
      });

      const saved = await saveDraftPost({
        userId: userId,
        sourceName: item.sourceName,
        sourceUrl: item.url,
        originalTitle: item.title,
        originalHash: item.hash,
        aiTitle,
        aiSummary,
        formattedHtml: `<b>${escHtml(aiTitle)}</b>\n${escHtml(aiSummary)}`,
        imageUrl: item.imageUrl,
        category: item.category,
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
    footerText: user.footerText || `📢 ${user.channelId || '@MyLeitner'}`,
  });

  // If autoPublish is ON, publish this single bulletin post directly to the channel!
  if (user.autoPublish && user.channelId) {
    const sent = await sendRichPostSafe({
      chatId: user.channelId,
      postHtml: bulletinHtml,
      buttons: null, // No inline button: full links are already inside the bulletin text
      disableWebPagePreview: true, // No web page preview card or preview photo
    });

    if (sent && sent.message_id) {
      for (const pid of savedPostIds) {
        await markPostPublished(pid, sent.message_id);
      }
    }
  }

  if (chatId) {
    if (user.autoPublish && user.channelId) {
      await api.sendMessage({
        chat_id: notifyChat,
        text: `🗞️ <b>بولتن خبری ساعتی منتشر شد!</b>\nتعداد <b>${processedItems.length}</b> خبر در قالب یک پست تجمیعی واحد در کانال <code>${escHtml(user.channelId)}</code> منتشر شد.`,
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(user),
      });
    } else {
      await api.sendMessage({
        chat_id: notifyChat,
        text: `🗞️ <b>بولتن ساعتی در انتظار تایید (${processedItems.length} خبر):</b>\n\n${bulletinHtml}`,
        parse_mode: 'HTML',
        reply_markup: reviewPostKeyboard(savedPostIds[0] || 0),
      });
    }
  }
}
