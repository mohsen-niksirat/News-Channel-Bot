import { api, db } from 'sdk';
import { users } from 'schema';
import { runScanForUser } from 'lib/scanner';
import { isInsideScheduleWindow } from 'lib/schedule';
import { shouldPublishDailyDigestNow, sendDailyDigestForUser } from 'lib/digest';
import { runNightlyKeyHealthCheck } from 'lib/health_check';

export default async function (input, ctx) {
  console.log('cron: started with input', JSON.stringify(input));
  if (input?.mode === 'nightly_health' || input?.mode === 'health_check') {
    const targetUserId = input?.userId ? parseInt(input.userId, 10) : null;
    const allUsers = await db.select().from(users).all();
    const candidateUsers = allUsers.filter((u) => !targetUserId || u.tgId === targetUserId);
    const results = [];
    for (const u of candidateUsers) {
      try {
        const checkRes = await runNightlyKeyHealthCheck(u.tgId);
        if (checkRes.changed && checkRes.report) {
          await api.sendMessage({
            chat_id: u.tgId,
            text: checkRes.report,
            parse_mode: 'HTML',
          }).catch((err) => console.warn(`cron: failed to send health alert to ${u.tgId}:`, err.message));
        }
        results.push({ tgId: u.tgId, changed: checkRes.changed, totalKeys: checkRes.totalKeys });
      } catch (err) {
        results.push({ tgId: u.tgId, error: err.message });
      }
    }
    return { ok: true, mode: 'nightly_health', results };
  }
  if (input?.mode === 'digest') {
    const targetUserId = input?.userId ? parseInt(input.userId, 10) : null;
    const allUsers = await db.select().from(users).all();
    const candidateUsers = allUsers.filter((u) => !targetUserId || u.tgId === targetUserId);
    const results = [];
    for (const u of candidateUsers) {
      if (!u.channelId) continue;
      if (!shouldPublishDailyDigestNow(u)) continue;
      try {
        const res = await sendDailyDigestForUser(u.tgId, null, true);
        results.push({ tgId: u.tgId, ...res });
      } catch (err) {
        results.push({ tgId: u.tgId, error: err.message });
      }
    }
    return { ok: true, results };
  }
  try {
    const targetUserId = input?.userId ? parseInt(input.userId, 10) : null;
    const allUsers = await db.select().from(users).all();
    console.log('cron: found users count =', allUsers.length);
    const results = [];

    // Filter candidate users who actually have a channel and automated publishing/schedule enabled
    const candidateUsers = allUsers.filter(u => 
      (!targetUserId || u.tgId === targetUserId) &&
      u.channelId && 
      (u.autoPublish || u.scheduleWindows)
    );

    console.log('cron: active candidate users =', candidateUsers.length);
    if (candidateUsers.length === 0) {
      return { ok: true, results: [], message: 'No active candidate users with auto-publish or schedules' };
    }

    // Run candidate users sequentially to preserve serverless bandwidth & avoid gateway timeouts
    for (const u of candidateUsers) {
      console.log('cron: checking user', u.tgId, 'channel:', u.channelId, 'autoPublish:', u.autoPublish, 'scheduleWindows:', u.scheduleWindows);

      // Schedule window calculation (Asia/Tehran) with 20-min tolerance
      const insideWindow = isInsideScheduleWindow(u.scheduleWindows, new Date(), 20);
      const draftOnly = !insideWindow;

      try {
        console.log(`cron: calling runScanForUser for ${u.tgId} (insideWindow=${insideWindow}, draftOnly=${draftOnly})`);
        await runScanForUser(u.tgId, null, { draftOnly, maxSources: 3, maxItems: 2 });
        console.log('cron: finished runScanForUser for', u.tgId);
        results.push({
          tgId: u.tgId,
          channel: u.channelId,
          auto: Boolean(u.autoPublish),
          insideWindow,
          draftOnly,
          status: 'scanned',
        });
      } catch (err) {
        console.error('cron: scan error for', u.tgId, err.message);
        results.push({ tgId: u.tgId, channel: u.channelId, error: err.message });
      }
    }

    return { ok: true, results };
  } catch (fatal) {
    console.error('cron: fatal error', fatal.message);
    return { ok: false, error: fatal.message, stack: fatal.stack };
  }
}
