// NewsStudio 2026 — Daily Digest / Newspaper Engine
// Selects top 8 posts from last 24h by importance DESC, then recency
// Formats via buildBulletinPost and publishes according to scheduleWindows

import { db, api } from 'sdk';
import { eq, and, or } from 'sdk/db';
import { posts } from 'schema';
import { getUser } from 'lib/db';
import { buildBulletinPost, sendRichPostSafe, escHtml } from 'lib/rich_post';
import { getTehranTime, isInsideScheduleWindow, parseScheduleWindows } from 'lib/schedule';
import { mainMenuKeyboard } from 'lib/keyboards';

/**
 * Returns YYYY-MM-DD formatted date string in Asia/Tehran timezone.
 * @param {Date} [date]
 * @returns {string}
 */
export function getTehranDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date); // YYYY-MM-DD
}

/**
 * Checks whether today's daily morning digest has already been published to the channel.
 * @param {number} userId
 * @param {Date} [date]
 * @returns {Promise<boolean>}
 */
export async function hasDailyDigestPublishedToday(userId, date = new Date()) {
  const u = await getUser(userId);
  const targetId = u ? u.id : userId;
  const dateStr = getTehranDateString(date);
  const digestHash = `digest_${targetId}_${dateStr}`;

  const existing = await db
    .select()
    .from(posts)
    .where(and(
      or(eq(posts.userId, userId), eq(posts.userId, targetId)),
      eq(posts.originalHash, digestHash),
      eq(posts.status, 'published')
    ))
    .get();

  return Boolean(existing);
}

/**
 * Selects the top N posts from the last 24 hours for a user,
 * ordered by importance DESC, then by createdAt DESC (recency).
 * Excludes rejected posts.
 * 
 * @param {number} userId
 * @param {number} [limit=8]
 * @param {number|null} [sinceTimestamp]
 * @returns {Promise<Array>}
 */
export async function getTopDigestPostsForUser(userId, limit = 8, sinceTimestamp = null) {
  const u = await getUser(userId);
  const targetId = u ? u.id : userId;
  const now = Math.floor(Date.now() / 1000);
  const since = sinceTimestamp !== null ? sinceTimestamp : now - 24 * 3600;

  const allPosts = await db
    .select()
    .from(posts)
    .where(or(eq(posts.userId, userId), eq(posts.userId, targetId)))
    .all();

  const candidates = allPosts.filter(
    (p) => (p.createdAt || 0) >= since && p.status !== 'rejected'
  );

  candidates.sort((a, b) => {
    const impA = a.importance !== null && a.importance !== undefined ? Number(a.importance) : 0;
    const impB = b.importance !== null && b.importance !== undefined ? Number(b.importance) : 0;
    if (impB !== impA) {
      return impB - impA;
    }
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  return candidates.slice(0, limit);
}

/**
 * Builds the daily digest post text.
 * If empty, returns an object with empty: true and friendly Persian text.
 * 
 * @param {object} params
 * @param {object} params.user
 * @param {Array} params.posts
 * @param {Date} [params.date]
 * @returns {{ html: string, empty: boolean, count: number }}
 */
export function buildDailyDigestBulletin({ user, posts = [], date = new Date() }) {
  if (!posts || posts.length === 0) {
    return {
      html: '🗞️ <b>روزنامه صبحگاهی:</b>\n\nامروز در ۲۴ ساعت گذشته خبر مهمی برای چاپ روزنامه ثبت نشده است.',
      empty: true,
      count: 0,
    };
  }

  const dateStr = date.toLocaleDateString('fa-IR');
  const bulletinTitle = `🗞️ روزنامه صبحگاهی (${dateStr})`;
  const footerText = user?.footerText || (user?.channelId ? `📢 کانال خبر : ${user.channelId}\n📢 کانال مرجع: @MyLeitner` : '📢 کانال خبر : @theNews_Persian\n📢 کانال مرجع: @MyLeitner');

  const html = buildBulletinPost({
    bulletinTitle,
    items: posts,
    footerText,
  });

  return {
    html,
    empty: false,
    count: posts.length,
  };
}

/**
 * Checks whether the daily digest should publish for this user based on scheduleWindows:
 * - If user has scheduleWindows: publishes at the FIRST window of the day (±15 min tolerance).
 * - If user does not have scheduleWindows: publishes at execution time (unrestricted).
 * 
 * @param {object} user
 * @param {Date} [now]
 * @returns {boolean}
 */
export function shouldPublishDailyDigestNow(user, now = new Date()) {
  const { totalMinutes } = getTehranTime(now);

  const windows = parseScheduleWindows(user?.scheduleWindows);
  if (windows && windows.length > 0) {
    // If user has specific schedule windows, publish at the first window of the day
    const firstWindow = windows[0];
    return isInsideScheduleWindow([firstWindow], now, 20);
  }

  // If no custom schedule is set, morning newspaper publishes ONLY during morning hours:
  // 07:30 to 11:30 AM Tehran time (450 to 690 totalMinutes).
  // Outside this morning range (e.g. afternoon or evening), NEVER publish!
  return totalMinutes >= 450 && totalMinutes <= 690;
}

/**
 * Orchestrates creating and optionally sending the daily digest.
 * Used by /newspaper command, act:digest callback, and endpoints/digest_cron.
 * 
 * @param {number} userId
 * @param {number|null} [chatId]
 * @param {boolean} [publishToChannel=false]
 * @returns {Promise<{ ok: boolean, html: string, count: number, empty: boolean, published: boolean }>}
 */
export async function sendDailyDigestForUser(userId, chatId = null, publishToChannel = false) {
  const user = await getUser(userId);
  if (!user) {
    return { ok: false, error: 'User not found' };
  }

  const postsList = await getTopDigestPostsForUser(userId, 8);
  const digest = buildDailyDigestBulletin({ user, posts: postsList });

  let published = false;

  // Publish to channel if requested and allowed
  if (publishToChannel && !digest.empty && user.channelId) {
    const alreadyPublished = await hasDailyDigestPublishedToday(userId);
    if (alreadyPublished) {
      console.log(`sendDailyDigestForUser: daily digest already published today for user ${userId}. Skipping channel publication.`);
      published = false;
    } else {
      const sent = await sendRichPostSafe({
        chatId: user.channelId,
        postHtml: digest.html,
        buttons: null,
        disableWebPagePreview: true,
      });
      if (sent && sent.message_id) {
        published = true;
        // Record published digest in posts table to prevent duplicate publications today
        try {
          const dateStr = getTehranDateString();
          await db.insert(posts).values({
            userId: user.id || userId,
            sourceName: 'newspaper',
            sourceUrl: user.channelId,
            originalTitle: `روزنامه صبحگاهی (${new Date().toLocaleDateString('fa-IR')})`,
            originalHash: `digest_${user.id || userId}_${dateStr}`,
            aiTitle: 'روزنامه صبحگاهی',
            aiSummary: `مجموعه ${digest.count} خبر برگزیده روز`,
            formattedHtml: digest.html,
            status: 'published',
            publishedMessageId: sent.message_id,
            publishedAt: Math.floor(Date.now() / 1000),
          }).run();
        } catch (dbErr) {
          console.warn('Failed to record digest in posts table:', dbErr.message);
        }
      }
    }
  }

  // If chatId is provided (e.g. on-demand PV call), send response to chat
  if (chatId) {
    if (digest.empty) {
      await api.sendMessage({
        chat_id: chatId,
        text: digest.html,
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(user),
      });
    } else {
      const pubNote = published
        ? `\n\n🚀 <b>این روزنامه به طور خودکار در کانال <code>${escHtml(user.channelId)}</code> منتشر شد.</b>`
        : '';
      await api.sendMessage({
        chat_id: chatId,
        text: `${digest.html}${pubNote}`,
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(user),
        disable_web_page_preview: true,
      });
    }
  }

  return {
    ok: true,
    html: digest.html,
    count: digest.count,
    empty: digest.empty,
    published,
  };
}
