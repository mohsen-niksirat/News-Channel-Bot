import { db } from 'sdk';
import { users } from 'schema';
import { runScanForUser } from 'lib/scanner';
import { isInsideScheduleWindow } from 'lib/schedule';

export default async function (input, ctx) {
  console.log('cron: started with input', JSON.stringify(input));
  try {
    const targetUserId = input?.userId ? parseInt(input.userId, 10) : null;
    const allUsers = await db.select().from(users).all();
    console.log('cron: found users count =', allUsers.length);
    const results = [];

    // Filter candidate users
    const filteredUsers = allUsers.filter(u => !targetUserId || u.tgId === targetUserId);

    // Run users in bounded concurrency batches of 2
    const BATCH_SIZE = 2;
    for (let i = 0; i < filteredUsers.length; i += BATCH_SIZE) {
      const batch = filteredUsers.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async (u) => {
        console.log('cron: checking user', u.tgId, 'channel:', u.channelId, 'autoPublish:', u.autoPublish, 'scheduleWindows:', u.scheduleWindows);

        // Schedule window calculation (Asia/Tehran)
        const insideWindow = isInsideScheduleWindow(u.scheduleWindows);
        const draftOnly = !insideWindow;

        if (u.channelId && (u.autoPublish || u.scheduleWindows)) {
          try {
            console.log(`cron: calling runScanForUser for ${u.tgId} (insideWindow=${insideWindow}, draftOnly=${draftOnly})`);
            await runScanForUser(u.tgId, null, { draftOnly });
            console.log('cron: finished runScanForUser for', u.tgId);
            return {
              tgId: u.tgId,
              channel: u.channelId,
              auto: Boolean(u.autoPublish),
              insideWindow,
              draftOnly,
              status: 'scanned',
            };
          } catch (err) {
            console.error('cron: scan error for', u.tgId, err.message);
            return { tgId: u.tgId, channel: u.channelId, error: err.message };
          }
        } else {
          return { tgId: u.tgId, status: u.channelId ? 'auto_disabled' : 'no_channel' };
        }
      });

      const settled = await Promise.allSettled(batchPromises);
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
    console.error('cron: fatal error', fatal.message);
    return { ok: false, error: fatal.message, stack: fatal.stack };
  }
}
