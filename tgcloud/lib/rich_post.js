/**
 * Rich Post Studio Engine (Inspired by RasaRichBot & Telegram Bot API 10.3)
 * Produces editorial-grade channel posts with expandable quotes, spoiler tags, and fail-safe publishing.
 */

import { api } from 'sdk';
import { isValidNewsImageUrl } from 'lib/harvester';

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
    const safeFooter = (footerText.includes('<') && footerText.includes('>'))
      ? footerText
      : escHtml(footerText);
    post += `${safeFooter}`;
  }

  return post.trim();
}

/**
 * Normalizes URLs for inline buttons.
 * Accepts full https?:// URLs, @handles (converted to t.me/handle), or t.me paths.
 * Rejects invalid strings to prevent Telegram BUTTON_URL_INVALID errors.
 */
export function normalizeButtonUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) return trimmed;
  if (trimmed.startsWith('@')) return `https://t.me/${trimmed.replace('@', '')}`;
  if (trimmed.startsWith('t.me/')) return `https://${trimmed}`;
  return null;
}

/**
 * Safely truncates HTML text to a target length while guaranteeing:
 * 1. Tags are never sliced in half.
 * 2. All open tags are closed in proper reverse order (LIFO).
 * 3. Resulting string length is strictly <= maxLen.
 */
export function truncateHtmlPreservingTags(html, maxLen = 1024) {
  if (!html || typeof html !== 'string') return '';
  if (html.length <= maxLen) return html;

  const tagRegex = /<(\/?)([a-zA-Z0-9_\-]+)(?:\s+[^>]*)?>/g;
  const tokens = [];
  let lastIdx = 0;
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    if (match.index > lastIdx) {
      tokens.push({ type: 'text', content: html.slice(lastIdx, match.index) });
    }
    tokens.push({
      type: 'tag',
      raw: match[0],
      isClose: match[1] === '/',
      tag: match[2].toLowerCase(),
    });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < html.length) {
    tokens.push({ type: 'text', content: html.slice(lastIdx) });
  }

  let result = '';
  const stack = [];
  const reserveEllipsis = '...';

  for (const token of tokens) {
    if (token.type === 'tag') {
      if (token.isClose) {
        const idx = stack.lastIndexOf(token.tag);
        if (idx !== -1) {
          stack.splice(idx, 1);
        }
        result += token.raw;
      } else {
        const closingTagsLen = stack.reduce((acc, t) => acc + t.length + 3, 0) + (token.tag.length + 3);
        if (result.length + token.raw.length + closingTagsLen + reserveEllipsis.length > maxLen) {
          result += reserveEllipsis;
          break;
        }
        stack.push(token.tag);
        result += token.raw;
      }
    } else {
      const closingTagsLen = stack.reduce((acc, t) => acc + t.length + 3, 0);
      const remainingBudget = maxLen - result.length - closingTagsLen - reserveEllipsis.length;

      if (remainingBudget <= 0) {
        result += reserveEllipsis;
        break;
      }

      if (token.content.length > remainingBudget) {
        let sliceIdx = remainingBudget;
        const lastSpace = token.content.lastIndexOf(' ', remainingBudget);
        if (lastSpace > remainingBudget * 0.7) {
          sliceIdx = lastSpace;
        }
        result += token.content.slice(0, sliceIdx) + reserveEllipsis;
        break;
      } else {
        result += token.content;
      }
    }
  }

  // Close all unclosed tags in reverse order
  while (stack.length > 0) {
    const t = stack.pop();
    result += `</${t}>`;
  }

  return result;
}

/**
 * Creates inline buttons for the post (original source link, fast-copy, channel)
 */
export function buildPostButtons({ sourceUrl, sourceName, summaryToCopy, channelUsername = 'MyLeitner' }) {
  const buttons = [];

  const row1 = [];
  const validUrl = normalizeButtonUrl(sourceUrl);
  if (validUrl) {
    row1.push({
      text: `🌐 منبع: ${sourceName || 'لینک خبر'}`,
      url: validUrl,
    });
  }
  if (summaryToCopy) {
    // Telegram Bot API limit: copy_text.text MUST be 1-256 characters!
    const cleanCopy = stripAllHtml(summaryToCopy).trim();
    if (cleanCopy.length > 0) {
      const truncated = cleanCopy.length > 250 ? cleanCopy.slice(0, 247) + '...' : cleanCopy;
      row1.push({
        text: '📋 کپی خلاصه',
        copy_text: { text: truncated },
      });
    }
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
 * Normalizes and secures image URLs for Telegram Bot API delivery.
 * Telegram Bot API download servers refuse direct downloads from telesco.pe CDN ('failed to get HTTP URL content').
 * Routing telesco.pe URLs through wsrv.nl image proxy delivers clean, optimized JPEGs reliably.
 */
export function normalizeSafeImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let clean = url.trim();
  if (clean.startsWith('//')) clean = 'https:' + clean;
  if (!isValidNewsImageUrl(clean)) return null;

  if (clean.includes('telesco.pe')) {
    return `https://wsrv.nl/?url=${encodeURIComponent(clean)}&output=jpg`;
  }
  return clean;
}

/**
 * Fail-Safe publisher to channel or private chat.
 * Retries with simplified markup if Telegram rejects advanced tags.
 * Preserves interactive inline buttons across all retry attempts.
 */
export async function sendRichPostSafe({
  chatId,
  postHtml,
  imageUrl = null,
  buttons = null,
  disableWebPagePreview = true,
}) {
  let safeImageUrl = normalizeSafeImageUrl(imageUrl);
  const isPhoto = Boolean(safeImageUrl);
  const maxLen = isPhoto ? 1024 : 4090;

  // Safe truncation that NEVER breaks tags and always closes open tags
  let safeContent = truncateHtmlPreservingTags(postHtml, maxLen);

  // Strictly disable web link previews so images never show as preview cards
  const linkPreviewOpt = { is_disabled: true };
  let currentButtons = buttons;

  // Attempt 1: Full Rich HTML
  try {
    if (isPhoto) {
      return await api.sendPhoto({
        chat_id: chatId,
        photo: safeImageUrl,
        caption: safeContent,
        parse_mode: 'HTML',
        reply_markup: currentButtons || undefined,
      });
    } else {
      return await api.sendMessage({
        chat_id: chatId,
        text: safeContent,
        parse_mode: 'HTML',
        reply_markup: currentButtons || undefined,
        disable_web_page_preview: true,
        link_preview_options: linkPreviewOpt,
      });
    }
  } catch (err1) {
    console.warn(`sendRichPostSafe: First attempt failed (${err1.message}), retrying...`);

    // If buttons caused failure (e.g. BUTTON_URL_INVALID), drop them on retry
    if (err1.message && err1.message.includes('BUTTON_')) {
      currentButtons = undefined;
    }

    // Attempt 2: Basic HTML (strip expandable blockquote / complex tags)
    try {
      const basicHtml = truncateHtmlPreservingTags(stripToBasicHtml(safeContent), maxLen);
      if (isPhoto) {
        return await api.sendPhoto({
          chat_id: chatId,
          photo: safeImageUrl,
          caption: basicHtml,
          parse_mode: 'HTML',
          reply_markup: currentButtons || undefined,
        });
      } else {
        return await api.sendMessage({
          chat_id: chatId,
          text: basicHtml,
          parse_mode: 'HTML',
          reply_markup: currentButtons || undefined,
          disable_web_page_preview: true,
          link_preview_options: linkPreviewOpt,
        });
      }
    } catch (err2) {
      console.warn(`sendRichPostSafe: Second attempt failed (${err2.message}), retrying with plain text...`);

      if (err2.message && err2.message.includes('BUTTON_')) {
        currentButtons = undefined;
      }

      // Attempt 3: Plain text without HTML tags, but PRESERVING BUTTONS!
      const plain = stripAllHtml(safeContent);
      if (isPhoto) {
        try {
          return await api.sendPhoto({
            chat_id: chatId,
            photo: safeImageUrl,
            caption: plain.slice(0, 1020),
            reply_markup: currentButtons || undefined,
          });
        } catch (photoErr) {
          console.warn(`sendRichPostSafe: Plain photo attempt failed (${photoErr.message}), falling back to text`);
        }
      }
      return await api.sendMessage({
        chat_id: chatId,
        text: plain.slice(0, 4090),
        reply_markup: currentButtons || undefined,
        disable_web_page_preview: true,
        link_preview_options: linkPreviewOpt,
      });
    }
  }
}

/**
 * Fully formats a single post for channel publication.
 * Guarantees headline, summary, source link, divider line,
 * and the user's custom channel footer tags.
 */
export function preparePostForPublishing({ post, user, details = null }) {
  let title = (post?.aiTitle || post?.originalTitle || post?.title || '').trim();
  let summary = (post?.aiSummary || post?.summary || '').trim();
  const rawDetails = details || post?.details || post?.deepDive || post?.aiDetails;
  const sourceName = (post?.sourceName || 'منبع').trim();
  const sourceUrl = (post?.sourceUrl || post?.url || '').trim();
  const defaultFooter = '📢 کانال خبر : @theNews_Persian\n📢 کانال مرجع: @MyLeitner';
  const footerText = (user?.footerText || (user?.channelId ? `📢 کانال خبر : ${user.channelId}\n📢 کانال مرجع: @MyLeitner` : defaultFooter)).trim();

  // If title or summary is missing, parse out of formattedHtml if possible
  if ((!title || !summary) && post?.formattedHtml) {
    let raw = post.formattedHtml;
    // Strip existing dividers and footer
    if (raw.includes('──────────────') || raw.includes('──────────────────')) {
      raw = raw.split(/──────────────|──────────────────/)[0].trim();
    }
    // Strip existing source link if present
    raw = raw.replace(/🔗\s*<a\s+href="[^"]*">[^<]*<\/a>/gi, '').trim();

    if (!title) {
      const bMatch = raw.match(/<b>(.*?)<\/b>/i);
      if (bMatch) {
        title = stripAllHtml(bMatch[1]).trim();
        raw = raw.replace(/<b>.*?<\/b>/i, '').trim();
      }
    }
    if (!summary) {
      summary = stripAllHtml(raw).replace(/^[⚡🔹]\s*/, '').trim();
    }
  }

  // 1. Guaranteed Bottom Section (Source Link + Divider + Footer)
  let bottom = '';
  if (sourceUrl) {
    const validLink = normalizeButtonUrl(sourceUrl) || sourceUrl;
    bottom += `🔗 <a href="${validLink}">مطالعه متن کامل در ${escHtml(sourceName)}</a>\n\n`;
  }
  const safeFooter = (footerText.includes('<') && footerText.includes('>'))
    ? footerText
    : escHtml(footerText);
  bottom += `──────────────────\n${safeFooter}`;

  // 2. Title Section
  const titlePart = title ? `🔹 <b>${escHtml(title)}</b>\n\n` : '';

  // 3. Middle Content Budgeting
  // Telegram photo caption maximum limit is 1024 characters.
  // We reserve budget so that title + summary + bullets + bottom is strictly <= 900 chars,
  // ensuring the footer, source link, and review queue headers never exceed 1024 chars.
  const hasPhoto = Boolean(post?.imageUrl);
  const targetMaxLen = hasPhoto ? 900 : 3800;
  const maxMiddleBudget = targetMaxLen - titlePart.length - bottom.length - 15;

  let bulletPart = '';
  if (rawDetails) {
    const detailList = (Array.isArray(rawDetails) ? rawDetails : [rawDetails])
      .map((d) => String(d).trim())
      .filter((d) => d.length > 0)
      .slice(0, hasPhoto ? 2 : 4);
    if (detailList.length > 0) {
      bulletPart = detailList
        .map((d) => `▫️ ${escHtml(d.replace(/^[▫️•\-\*]\s*/, ''))}`)
        .join('\n') + '\n\n';
    }
  }

  let cleanSummary = summary;
  if (!cleanSummary && post?.formattedHtml) {
    let clean = post.formattedHtml;
    if (clean.includes('──────────────') || clean.includes('──────────────────')) {
      clean = clean.split(/──────────────|──────────────────/)[0].trim();
    }
    clean = clean.replace(/🔗\s*<a\s+href="[^"]*">[^<]*<\/a>/gi, '').trim();
    clean = clean.replace(/^[⚡🔹]\s*/, '').trim();
    cleanSummary = clean;
  }

  const maxSummaryLen = maxMiddleBudget - bulletPart.length;
  if (cleanSummary && cleanSummary.length > maxSummaryLen) {
    const trimmed = cleanSummary.slice(0, Math.max(50, maxSummaryLen - 4));
    const lastSpace = trimmed.lastIndexOf(' ');
    cleanSummary = (lastSpace > 50 ? trimmed.slice(0, lastSpace) : trimmed) + '...';
  }

  const safeSummaryText = (cleanSummary && cleanSummary.includes('<') && cleanSummary.includes('>'))
    ? cleanSummary
    : escHtml(cleanSummary);
  const summaryPart = cleanSummary ? `${safeSummaryText}\n\n` : '';

  const body = `${titlePart}${summaryPart}${bulletPart}${bottom}`;
  return body.trim();
}
