import { db } from 'sdk';
import { users } from 'schema';
import { runScanForUser } from 'lib/scanner';

export default async function (input, ctx) {
  console.log('cron: started with input', JSON.stringify(input));
  try {
    const targetUserId = input?.userId ? parseInt(input.userId, 10) : null;
    const allUsers = await db.select().from(users).all();
    console.log('cron: found users count =', allUsers.length);
    const results = [];

    for (const u of allUsers) {
      if (targetUserId && u.tgId !== targetUserId) continue;

      console.log('cron: checking user', u.tgId, 'channel:', u.channelId, 'autoPublish:', u.autoPublish);
      if (u.channelId && u.autoPublish) {
        try {
          console.log('cron: calling runScanForUser for', u.tgId);
          await runScanForUser(u.tgId, null);
          console.log('cron: finished runScanForUser for', u.tgId);
          results.push({ tgId: u.tgId, channel: u.channelId, auto: true, status: 'scanned' });
        } catch (err) {
          console.error('cron: scan error for', u.tgId, err.message);
          results.push({ tgId: u.tgId, channel: u.channelId, error: err.message });
        }
      } else {
        results.push({ tgId: u.tgId, status: u.channelId ? 'auto_disabled' : 'no_channel' });
      }
    }

    return { ok: true, results };
  } catch (fatal) {
    console.error('cron: fatal error', fatal.message);
    return { ok: false, error: fatal.message, stack: fatal.stack };
  }
}
