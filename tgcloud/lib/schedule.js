// NewsStudio 2026 — Publishing Schedule Windows (Tehran Time)
// Schedule window tolerance logic and formatting

/**
 * Validates 24-hour time string in HH:MM format (00:00 - 23:59).
 * @param {string} str
 * @returns {boolean}
 */
export function isValidTimeFormat(str) {
  if (typeof str !== 'string') return false;
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(str.trim());
}

/**
 * Safely parses the user's schedule_windows column.
 * Returns a sorted array of unique valid "HH:MM" strings, or null if unset.
 * @param {string|string[]} raw
 * @returns {string[]|null}
 */
export function parseScheduleWindows(raw) {
  if (!raw) return null;
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(arr) && arr.length > 0) {
      const valid = Array.from(new Set(arr.filter((t) => isValidTimeFormat(t))))
        .sort((a, b) => {
          const [ha, ma] = a.split(':').map(Number);
          const [hb, mb] = b.split(':').map(Number);
          return ha * 60 + ma - (hb * 60 + mb);
        });
      return valid.length > 0 ? valid : null;
    }
  } catch {}
  return null;
}

/**
 * Computes hour and minute in Asia/Tehran timezone.
 * Pure function accepting an optional Date object.
 * @param {Date} [date]
 * @returns {{ hour: number, minute: number, totalMinutes: number, timeStr: string }}
 */
export function getTehranTime(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute').value, 10);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
    timeStr: `${pad(hour)}:${pad(minute)}`,
  };
}

/**
 * Checks whether the given date/time is within tolerance of any schedule window.
 * Default tolerance is 10 minutes (±10 min).
 * Handles midnight wrap-around (e.g. 23:55 to 00:05).
 * If windows is null or empty, returns true (every scan publishes).
 * 
 * @param {string|string[]|null} windows - JSON string or array of "HH:MM"
 * @param {Date} [date] - date to check against (defaults to now)
 * @param {number} [toleranceMinutes=10]
 * @returns {boolean}
 */
export function isInsideScheduleWindow(windows, date = new Date(), toleranceMinutes = 10) {
  const parsed = parseScheduleWindows(windows);
  if (!parsed || parsed.length === 0) {
    return true; // No window set -> unrestricted publishing
  }

  const { totalMinutes: currentMinutes } = getTehranTime(date);

  for (const windowStr of parsed) {
    const [hStr, mStr] = windowStr.split(':');
    const targetMinutes = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);

    let diff = Math.abs(currentMinutes - targetMinutes);
    if (diff > 720) {
      diff = 1440 - diff; // Wrap-around midnight
    }

    if (diff <= toleranceMinutes) {
      return true;
    }
  }

  return false;
}

/**
 * Generates a human-friendly Persian summary of schedule windows.
 * @param {string|string[]|null} windows
 * @returns {string}
 */
export function formatScheduleWindowsPersian(windows) {
  const parsed = parseScheduleWindows(windows);
  if (!parsed || parsed.length === 0) {
    return 'همیشه (بلافاصله پس از هر پایش)';
  }
  return parsed.map((t) => `ساعت ${t}`).join(' ، ');
}
