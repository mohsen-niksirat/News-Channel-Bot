// NewsStudio 2026 — Daily Digest Cron Endpoint
// Runs once daily (e.g. 06:30 UTC via daily_digest.yml) to generate and publish the morning newspaper

import { db } from 'sdk';
import { users } from 'schema';
import { shouldPublishDailyDigestNow, sendDailyDigestForUser, hasDailyDigestPublishedToday } from 'lib/digest';

export default async function (input, ctx) {
  console.log('digest_cron: started with input', JSON.stringify(input));
  try {
    const targetUserId = input?.userId ? parseInt(input.userId, 10) : null;
    const allUsers = await db.select().from(users).all();
    console.log('digest_cron: found users count =', allUsers.length);
    const results = [];

    const candidateUsers = allUsers.filter((u) => !targetUserId || u.tgId === targetUserId);

    // Process users in bounded batches of 2
    const BATCH_SIZE = 2;
    for (let i = 0; i < candidateUsers.length; i += BATCH_SIZE) {
      const batch = candidateUsers.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (u) => {
        if (!u.channelId) {
          return { tgId: u.tgId, status: 'no_channel' };
        }

        const canPublish = shouldPublishDailyDigestNow(u);
        if (!canPublish) {
          console.log(`digest_cron: user ${u.tgId} outside morning schedule window. Skipping.`);
          return { tgId: u.tgId, status: 'outside_morning_window' };
        }

        const alreadyPublished = await hasDailyDigestPublishedToday(u.tgId);
        if (alreadyPublished) {
          console.log(`digest_cron: user ${u.tgId} already received today's daily digest. Skipping.`);
          return { tgId: u.tgId, status: 'already_published_today' };
        }

        try {
          console.log(`digest_cron: generating and publishing daily digest for ${u.tgId}`);
          const res = await sendDailyDigestForUser(u.tgId, null, true);
          return {
            tgId: u.tgId,
            channel: u.channelId,
            published: res.published,
            count: res.count,
            empty: res.empty,
            status: 'completed',
          };
        } catch (err) {
          console.error(`digest_cron: error for user ${u.tgId}:`, err.message);
          return { tgId: u.tgId, channel: u.channelId, error: err.message };
        }
      });

      const settled = await Promise.allSettled(promises);
      for (const res of settled) {
        if (res.status === 'fulfilled') {
          results.push(res.value);
        } else {
          results.push({ error: res.reason?.message || 'Unknown batch error' });
        }
      }
    }

    return { ok: true, results };
  } catch (fatal) {
    console.error('digest_cron: fatal error', fatal.message);
    return { ok: false, error: fatal.message, stack: fatal.stack };
  }
}
