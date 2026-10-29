/**
 * Dual Harvester Engine:
 * 1. Telegram Public Channel Webview Extractor (t.me/s/...)
 * 2. Web & News RSS XML Parser
 */

import { fetch } from 'sdk';

/**
 * Pure JS fast 64-bit hash (no WebCrypto / no crypto.subtle dependency)
 */
export function hashString(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c64e6d;
  const s = str || '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * Strips HTML tags and unescapes standard entities
 */
export function cleanText(rawHtml) {
  if (!rawHtml) return '';
  return rawHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extracts posts from a public Telegram channel via web preview
 */
export async function harvestTelegramChannel(channelHandle, maxPosts = 2) {
  const cleanHandle = channelHandle.replace(/^@/, '').replace(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?/i, '').trim();
  const url = `https://t.me/s/${cleanHandle}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) {
      return [];
    }

    const html = await res.text();
    const items = [];

    const rawWidgets = html.split('<div class="tgme_widget_message_wrap');
    for (let i = 1; i < rawWidgets.length; i++) {
      const chunk = rawWidgets[i];

      const linkMatch = chunk.match(/href="(https:\/\/t\.me\/[^"]+\/(\d+))"/);
      const postUrl = linkMatch ? linkMatch[1] : '';
      const msgId = linkMatch ? linkMatch[2] : '';
      if (!postUrl || !msgId) continue;

      const textMatch = chunk.match(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
      const rawContent = textMatch ? textMatch[1] : '';
      const plain = cleanText(rawContent);
      if (!plain || plain.length < 20) continue;

      let imageUrl = null;
      const imgMatch = chunk.match(/background-image:\s*url\('([^']+)'\)/);
      if (imgMatch) {
        imageUrl = imgMatch[1];
      }

      const dateMatch = chunk.match(/datetime="([^"]+)"/);
      const dateStr = dateMatch ? dateMatch[1] : null;

      const hash = hashString(`${cleanHandle}_${msgId}_${plain.slice(0, 50)}`);

      items.push({
        sourceType: 'telegram',
        sourceName: `@${cleanHandle}`,
        url: postUrl,
        title: plain.slice(0, 75).split('\n')[0],
        content: plain,
        imageUrl,
        date: dateStr,
        hash,
      });
    }

    return items.slice(-maxPosts);
  } catch {
    return [];
  }
}

/**
 * Extracts items from standard RSS feeds (Zoomit, TechCrunch, Verge, Euronews, etc.)
 */
export async function harvestRssFeed(feedUrl, sourceName = 'RSS', maxItems = 2) {
  try {
    const res = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NewsStudio/1.0',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    });

    if (!res.ok) {
      return [];
    }

    const xml = await res.text();
    const items = [];

    const itemBlocks = xml.split(/<item[\s>]/i);
    for (let i = 1; i < itemBlocks.length; i++) {
      const chunk = itemBlocks[i].split(/<\/item>/i)[0];

      const titleMatch = chunk.match(/<title(?:\s+[^>]*)?>([\s\S]*?)<\/title>/i);
      const linkMatch = chunk.match(/<link(?:\s+[^>]*)?>([\s\S]*?)<\/link>/i);
      const descMatch = chunk.match(/<description(?:\s+[^>]*)?>([\s\S]*?)<\/description>/i) || chunk.match(/<content:encoded(?:\s+[^>]*)?>([\s\S]*?)<\/content:encoded>/i);

      const title = cleanText(titleMatch ? titleMatch[1] : '');
      const link = (linkMatch ? linkMatch[1] : '').replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim();
      const desc = cleanText(descMatch ? descMatch[1] : '');

      if (!title || !link) continue;

      let imageUrl = null;
      const encMatch = chunk.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image/i) ||
                       chunk.match(/<media:content[^>]+url=["']([^"']+)["'][^>]*medium=["']image/i);
      if (encMatch) {
        imageUrl = encMatch[1];
      }

      const hash = hashString(`${link}_${title}`);

      items.push({
        sourceType: 'rss',
        sourceName,
        url: link,
        title,
        content: desc || title,
        imageUrl,
        hash,
      });
    }

    return items.slice(0, maxItems);
  } catch {
    return [];
  }
}
