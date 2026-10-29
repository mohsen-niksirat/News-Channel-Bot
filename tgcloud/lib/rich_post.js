/**
 * Rich Post Studio Engine (Inspired by RasaRichBot & Telegram Bot API 10.3)
 * Produces editorial-grade channel posts with expandable quotes, spoiler tags, and fail-safe publishing.
 */

import { api } from 'sdk';

/**
 * Escapes characters for Telegram HTML parse mode
 */
export function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Strips HTML tags down to safe basic tags or plain text for fallback retry
 */
export function stripToBasicHtml(html) {
  return String(html || '')
    .replace(/<blockquote expandable>/gi, '<blockquote>')
    .replace(/<\/?(tg-spoiler|tg-emoji|tg-button|tg-button-row|mark|figure|figcaption)[^>]*>/gi, '');
}

export function stripAllHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/**
 * Builds an editorial magazine-style post from AI summary
 */
export function buildEditorialPost({
  title,
  summary,
  deepDive = '',
  sourceName = '',
  sourceUrl = '',
  footerText = '📢 @MyLeitner',
  useExpandable = true,
}) {
  const safeTitle = escHtml(title);
  const safeSummary = escHtml(summary);
  const safeDeepDive = escHtml(deepDive);
  const safeSource = escHtml(sourceName || 'منبع');
  const safeFooter = escHtml(footerText);

  let post = `⚡ <b>${safeTitle}</b>\n\n`;
  post += `${safeSummary}\n\n`;

  if (safeDeepDive) {
    if (useExpandable) {
      post += `<blockquote expandable><b>🔍 جزئیات تکمیلی:</b>\n${safeDeepDive}</blockquote>\n\n`;
    } else {
      post += `<blockquote><b>🔍 جزئیات تکمیلی:</b>\n${safeDeepDive}</blockquote>\n\n`;
    }
  }

  if (safeFooter) {
    post += `──────────────\n${safeFooter}`;
  }

  return post.trim();
}

/**
 * Builds an aggregated hourly news bulletin when multiple news items arrive
 */
export function buildBulletinPost({
  bulletinTitle = '',
  items = [],
  footerText = '📢 @MyLeitner',
  useExpandable = true,
}) {
  const nowStr = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = new Date().toLocaleDateString('fa-IR');
  const safeTitle = escHtml(bulletinTitle || `🗞️ گزیده مهم‌ترین رویدادها (ساعت ${nowStr})`);

  let post = `<b>${safeTitle}</b>\n`;
  post += `📅 <i>${dateStr}</i>\n`;
  post += `──────────────────\n\n`;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const safeItemTitle = escHtml(item.aiTitle || item.originalTitle || item.title);
    const safeSummary = escHtml(item.aiSummary || item.summary || '');
    const safeSrc = escHtml(item.sourceName || 'منبع خبر');
    const link = item.sourceUrl || item.url || '';

    post += `🔹 <b>${safeItemTitle}</b>\n`;
    if (safeSummary) {
      post += `${safeSummary}\n`;
    }
    if (link) {
      post += `🔗 <a href="${link}">مطالعه متن کامل در ${safeSrc}</a>\n\n`;
    } else {
      post += `\n`;
    }
  }

  post += `──────────────────\n`;
  if (footerText) {
    post += `${escHtml(footerText)}`;
  }

  return post.trim();
}

/**
 * Creates inline buttons for the post (original source link, fast-copy, channel)
 */
export function buildPostButtons({ sourceUrl, sourceName, summaryToCopy, channelUsername = 'MyLeitner' }) {
  const buttons = [];

  const row1 = [];
  if (sourceUrl) {
    row1.push({
      text: `🌐 منبع: ${sourceName || 'لینک خبر'}`,
      url: sourceUrl,
    });
  }
  if (summaryToCopy) {
    // Bot API 10.3 copy_text button
    row1.push({
      text: '📋 کپی خلاصه',
      copy_text: { text: summaryToCopy },
    });
  }
  if (row1.length > 0) buttons.push(row1);

  if (channelUsername) {
    const cleanCh = channelUsername.replace('@', '');
    buttons.push([
      { text: `📢 عضویت در کانال @${cleanCh}`, url: `https://t.me/${cleanCh}` },
    ]);
  }

  return { inline_keyboard: buttons };
}

/**
 * Fail-Safe publisher to channel or private chat.
 * Retries with simplified markup if Telegram rejects advanced tags.
 */
export async function sendRichPostSafe({
  chatId,
  postHtml,
  imageUrl = null,
  buttons = null,
}) {
  // Telegram caption limit is 1024 chars for photos, message text is 4096 chars
  const isPhoto = Boolean(imageUrl);
  const maxLen = isPhoto ? 1020 : 4090;

  let safeContent = postHtml;
  if (safeContent.length > maxLen) {
    safeContent = safeContent.slice(0, maxLen - 15) + '...';
  }

  // Attempt 1: Full Rich HTML
  try {
    if (isPhoto) {
      return await api.sendPhoto({
        chat_id: chatId,
        photo: imageUrl,
        caption: safeContent,
        parse_mode: 'HTML',
        reply_markup: buttons || undefined,
      });
    } else {
      return await api.sendMessage({
        chat_id: chatId,
        text: safeContent,
        parse_mode: 'HTML',
        reply_markup: buttons || undefined,
        disable_web_page_preview: false,
      });
    }
  } catch (err1) {
    console.warn(`sendRichPostSafe: First attempt failed (${err1.message}), retrying with basic HTML...`);

    // Attempt 2: Basic HTML (strip expandable blockquote / complex tags)
    try {
      const basicHtml = stripToBasicHtml(safeContent);
      if (isPhoto) {
        return await api.sendPhoto({
          chat_id: chatId,
          photo: imageUrl,
          caption: basicHtml,
          parse_mode: 'HTML',
          reply_markup: buttons || undefined,
        });
      } else {
        return await api.sendMessage({
          chat_id: chatId,
          text: basicHtml,
          parse_mode: 'HTML',
          reply_markup: buttons || undefined,
        });
      }
    } catch (err2) {
      console.warn(`sendRichPostSafe: Second attempt failed (${err2.message}), retrying with plain text...`);

      // Attempt 3: Plain text guaranteed delivery
      const plain = stripAllHtml(safeContent);
      if (isPhoto) {
        try {
          return await api.sendPhoto({
            chat_id: chatId,
            photo: imageUrl,
            caption: plain,
            reply_markup: buttons || undefined,
          });
        } catch {}
      }
      return await api.sendMessage({
        chat_id: chatId,
        text: plain,
        reply_markup: buttons || undefined,
      });
    }
  }
}
