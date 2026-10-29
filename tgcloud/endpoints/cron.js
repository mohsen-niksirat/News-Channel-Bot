import { db } from 'sdk';
import { users } from 'schema';
import { runScanForUser } from 'lib/scanner';

export default async function (input, ctx) {
  // Finds users with autoPublish = 1 and channelId set
  const allUsers = await db.select().from(users).all();
  const results = [];

  for (const u of allUsers) {
    if (u.channelId) {
      // Trigger scan for channel
      try {
        await runScanForUser(u.tgId, null);
        results.push({ tgId: u.tgId, channel: u.channelId, auto: u.autoPublish, status: 'scanned' });
      } catch (err) {
        results.push({ tgId: u.tgId, channel: u.channelId, error: err.message });
      }
    } else {
      results.push({ tgId: u.tgId, status: 'no_channel' });
    }
  }

  return { ok: true, results };
}
