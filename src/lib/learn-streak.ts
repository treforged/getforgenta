/**
 * Streak arithmetic for the Learn track, kept pure so it can be tested without a database.
 *
 * A streak is the thing that makes someone open the app on a day nothing is wrong, so it has to
 * be honest in both directions: it must not break because of a timezone, and it must not survive
 * a day the reader actually skipped. Both failures cost the same trust.
 *
 * DAYS ARE LOCAL DAYS. `read_at` is a timestamptz; two reads either side of midnight UTC are the
 * same evening for a reader in New York, and counting them as two days would hand out a streak
 * nobody earned. Everything below buckets by the LOCAL calendar date first.
 */

/** `YYYY-MM-DD` for the local calendar day a timestamp falls in. */
export function localDayKey(when: Date): string {
  return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
}

function addDays(day: Date, delta: number): Date {
  const next = new Date(day);
  next.setDate(next.getDate() + delta);
  return next;
}

/**
 * Consecutive days ending today, or ending yesterday when nothing has been read today.
 *
 * The "ending yesterday" half is what stops a five-day streak reading as zero at breakfast. It is
 * still a live streak until the day is over; `streakAtRisk` is what says so.
 */
export function computeStreak(readTimestamps: readonly string[], now: Date): number {
  const days = new Set(
    readTimestamps
      .map(iso => new Date(iso))
      .filter(d => !Number.isNaN(d.getTime()))
      .map(localDayKey),
  );
  if (days.size === 0) return 0;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  // Anchor on today when today counts, otherwise on yesterday. Anchoring anywhere else would
  // count a streak that ended a week ago as if it were still running.
  let cursor = days.has(localDayKey(today)) ? today : addDays(today, -1);
  if (!days.has(localDayKey(cursor))) return 0;

  let streak = 0;
  while (days.has(localDayKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** True when a lesson has already been read on the local day `now` falls in. */
export function hasReadToday(readTimestamps: readonly string[], now: Date): boolean {
  const todayKey = localDayKey(now);
  return readTimestamps.some(iso => {
    const d = new Date(iso);
    return !Number.isNaN(d.getTime()) && localDayKey(d) === todayKey;
  });
}

/**
 * A streak worth warning about: at least two days banked and nothing read today.
 *
 * One day is not a streak. Telling someone their one-day streak is in danger is a guilt-trip
 * about something they have not built yet, and it is how a notification permission gets revoked.
 */
export function streakAtRisk(readTimestamps: readonly string[], now: Date): boolean {
  return !hasReadToday(readTimestamps, now) && computeStreak(readTimestamps, now) >= 2;
}
