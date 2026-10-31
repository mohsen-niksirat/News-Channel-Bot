import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidTimeFormat,
  parseScheduleWindows,
  getTehranTime,
  isInsideScheduleWindow,
  formatScheduleWindowsPersian,
} from '../tgcloud/lib/schedule.js';

test('schedule.js: isValidTimeFormat validates HH:MM 24-hour strings', () => {
  assert.strictEqual(isValidTimeFormat('09:00'), true);
  assert.strictEqual(isValidTimeFormat('00:00'), true);
  assert.strictEqual(isValidTimeFormat('23:59'), true);
  assert.strictEqual(isValidTimeFormat('14:30'), true);

  assert.strictEqual(isValidTimeFormat('24:00'), false);
  assert.strictEqual(isValidTimeFormat('9:00'), false);
  assert.strictEqual(isValidTimeFormat('09:60'), false);
  assert.strictEqual(isValidTimeFormat('abc'), false);
  assert.strictEqual(isValidTimeFormat(null), false);
  assert.strictEqual(isValidTimeFormat(undefined), false);
});

test('schedule.js: parseScheduleWindows parses, dedupes and sorts windows', () => {
  assert.deepStrictEqual(parseScheduleWindows('["18:00", "09:00", "18:00"]'), ['09:00', '18:00']);
  assert.deepStrictEqual(parseScheduleWindows(['21:00', '08:30']), ['08:30', '21:00']);
  assert.strictEqual(parseScheduleWindows(null), null);
  assert.strictEqual(parseScheduleWindows(''), null);
  assert.strictEqual(parseScheduleWindows('[]'), null);
  assert.strictEqual(parseScheduleWindows('invalid json'), null);
});

test('schedule.js: getTehranTime returns correct Tehran time components', () => {
  // 05:30:00 UTC is exactly 09:00:00 Tehran time (UTC+3:30)
  const utcDate = new Date('2026-06-15T05:30:00Z');
  const tehran = getTehranTime(utcDate);
  assert.strictEqual(tehran.hour, 9);
  assert.strictEqual(tehran.minute, 0);
  assert.strictEqual(tehran.totalMinutes, 540);
  assert.strictEqual(tehran.timeStr, '09:00');
});

test('schedule.js: isInsideScheduleWindow tolerance ±10 min and midnight wrap-around', () => {
  const windows = ['09:00', '18:00'];

  // Null/empty windows -> always true (unrestricted publishing)
  assert.strictEqual(isInsideScheduleWindow(null), true);
  assert.strictEqual(isInsideScheduleWindow([]), true);

  // Exact match (09:00 Tehran -> 05:30 UTC)
  const exact9 = new Date('2026-06-15T05:30:00Z');
  assert.strictEqual(isInsideScheduleWindow(windows, exact9, 10), true);

  // +5 min (09:05 Tehran -> 05:35 UTC) -> inside window
  const at905 = new Date('2026-06-15T05:35:00Z');
  assert.strictEqual(isInsideScheduleWindow(windows, at905, 10), true);

  // +10 min (09:10 Tehran -> 05:40 UTC) -> edge of window, inside
  const at910 = new Date('2026-06-15T05:40:00Z');
  assert.strictEqual(isInsideScheduleWindow(windows, at910, 10), true);

  // -10 min (08:50 Tehran -> 05:20 UTC) -> edge of window, inside
  const at850 = new Date('2026-06-15T05:20:00Z');
  assert.strictEqual(isInsideScheduleWindow(windows, at850, 10), true);

  // +11 min (09:11 Tehran -> 05:41 UTC) -> outside window
  const at911 = new Date('2026-06-15T05:41:00Z');
  assert.strictEqual(isInsideScheduleWindow(windows, at911, 10), false);

  // -11 min (08:49 Tehran -> 05:19 UTC) -> outside window
  const at849 = new Date('2026-06-15T05:19:00Z');
  assert.strictEqual(isInsideScheduleWindow(windows, at849, 10), false);

  // Midnight wrap-around: window at 00:05, check at 23:58 (7 min before window)
  // 00:05 Tehran -> 20:35 UTC previous day
  // 23:58 Tehran -> 20:28 UTC previous day (diff is 7 min)
  const midnightWindows = ['00:05'];
  const at2358 = new Date('2026-06-14T20:28:00Z');
  assert.strictEqual(isInsideScheduleWindow(midnightWindows, at2358, 10), true);

  // 23:50 Tehran -> 20:20 UTC (diff is 15 min -> outside)
  const at2350 = new Date('2026-06-14T20:20:00Z');
  assert.strictEqual(isInsideScheduleWindow(midnightWindows, at2350, 10), false);
});

test('schedule.js: formatScheduleWindowsPersian outputs clear summaries', () => {
  assert.strictEqual(formatScheduleWindowsPersian(null), 'همیشه (بلافاصله پس از هر پایش)');
  assert.strictEqual(formatScheduleWindowsPersian(['09:00', '18:00']), 'ساعت 09:00 ، ساعت 18:00');
});
