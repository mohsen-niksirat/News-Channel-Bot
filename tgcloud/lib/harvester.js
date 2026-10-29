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
 * Parses markdown output from Jina reader proxy for Telegram channels
 */
export function parseJinaTelegramMarkdown(md, cleanHandle) {
  if (!md) return [];
  const items = [];

  const pattern = /\[\]\((https:\/\/t\.me\/[^\/]+\/(\d+))\)/gi;
  const matches = [];
  let m;
  while ((m = pattern.exec(md)) !== null) {
    matches.push({
      postUrl: m[1],
      msgId: m[2],
      index: m.index,
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextIdx = matches[i + 1] ? matches[i + 1].index : md.length;
    const chunk = md.substring(cur.index, nextIdx);

    // Image URL extraction (checks nearby text)
    const preText = md.substring(Math.max(0, cur.index - 350), cur.index);
    let imageUrl = null;
    const imgMatch = (preText + chunk).match(/!\[.*?\]\((https:\/\/[^\)]+\.(?:jpg|jpeg|png|webp)[^\)]*)\)/i);
    if (imgMatch) {
      imageUrl = imgMatch[1];
    }

    let plain = chunk
      .replace(/\[\]\(https:\/\/t\.me\/[^\)]+\)/g, '')
      .replace(/\[_!\[.*?\]\([^\)]+\)_\]\([^\)]+\)/g, '')
      .replace(/!\[.*?\]\([^\)]+\)/g, '')
      .replace(/_\*\*.*?\*\*_/g, '')
      .replace(/_+\s*\d+\s*_+/g, '')
      .replace(/\*\*/g, '')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      .replace(/(?:October|November|December|January|February|March|April|May|June|July|August|September)\s+\d+/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    plain = plain.replace(/@\w+\s*$/g, '').trim();
    if (!plain || plain.length < 25) continue;

    const firstLine = plain.split('\n')[0].trim();
    const title = firstLine.length > 5 ? firstLine.slice(0, 80) : plain.slice(0, 80);
    const hash = hashString(`${cleanHandle}_${cur.msgId}_${plain.slice(0, 50)}`);

    items.push({
      sourceType: 'telegram',
      sourceName: `@${cleanHandle}`,
      url: cur.postUrl,
      title,
      content: plain,
      imageUrl,
      hash,
    });
  }

  return items;
}

/**
 * Extracts posts from a public Telegram channel (Jina reader + t.me fallback)
 */
export async function harvestTelegramChannel(channelHandle, maxPosts = 2) {
  const cleanHandle = channelHandle.replace(/^@/, '').replace(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?/i, '').trim();

  // Method 1: Jina Reader Proxy (Bypasses Telegram Serverless egress restrictions on t.me)
  try {
    const jinaUrl = `https://r.jina.ai/https://t.me/s/${cleanHandle}`;
    const res = await fetch(jinaUrl, {
      headers: {
        'Accept': 'text/plain',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NewsStudio/1.0',
      },
    });

    if (res.ok) {
      const text = await res.text();
      const items = parseJinaTelegramMarkdown(text, cleanHandle);
      if (items.length > 0) {
        return items.slice(-maxPosts);
      }
    }
  } catch (jinaErr) {
    console.warn(`Jina proxy harvest failed for @${cleanHandle}:`, jinaErr.message);
  }

  // Method 2: Direct t.me/s web preview (Fallback for non-serverless environments)
  const url = `https://t.me/s/${cleanHandle}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) {
      console.warn(`harvestTelegramChannel: direct fetch ${url} returned HTTP ${res.status}`);
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
  } catch (err) {
    console.error(`harvestTelegramChannel: direct exception for ${url}:`, err.message);
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
