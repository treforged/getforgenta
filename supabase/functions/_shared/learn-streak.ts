/**
 * Streak arithmetic for the Learn track — the SERVER copy.
 *
 * ⚠️ THIS IS A COPY OF `src/lib/learn-streak.ts` AND IT CAN DRIFT SILENTLY.
 * Deno cannot import from `src/`, so there is no way to share the original. If the streak rules
 * change over there and not here, the number in a push notification stops matching the number on
 * the user's own screen, and nothing fails — it just quietly lies. The same standing risk as
 * `demo-forecast-harness.ts`, handled the same way: the copy is kept as small as possible and
 * the divergence is LISTED rather than left to be discovered.
 *
 * KNOWN AND DELIBERATE DIVERGENCE FROM THE ORIGINAL — exactly one, and it is a correction:
 *
 *   The original buckets by the RUNTIME's local day, which on a device is the reader's own
 *   clock. **This runtime has no such clock — an edge function runs in UTC.** Porting that
 *   unchanged breaks the streak in two ways at once. A New York reader finishing a lesson at 8pm
 *   on the 4th is 00:00 UTC on the 5th, so the server would count a different day from the phone
 *   and the notification would disagree with the screen. And `STREAK_RISK_HOUR = 18` evaluated
 *   in UTC is 2pm in New York, so "your streak ends tonight" would arrive four hours early about
 *   a streak in no danger.
 *
 *   So every function here takes an explicit IANA `timeZone`, read from `profiles.timezone`.
 *   Null there means unknown, and the caller passes 'UTC' — which must be treated as a GUESS,
 *   not a fact.
 *
 * Pure: no database, no network. The clock and the zone both arrive as arguments.
 */

/**
 * `YYYY-MM-DD` for the calendar day a timestamp falls in, IN THE GIVEN ZONE.
 *
 * `en-CA` because its short date format IS `YYYY-MM-DD`, which makes the parts line up without
 * assembling them by hand from `formatToParts`. An invalid zone throws, so the caller validates
 * once rather than per-timestamp.
 */
export function localDayKeyInZone(when: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(when);
}

/** The hour of day (0-23) in the given zone. Used for the "late enough to be true" gate. */
export function hourInZone(when: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', hour12: false,
  }).format(when));
}

/**
 * A zone we can actually use, or 'UTC'.
 *
 * A stored zone comes from a browser and is therefore user-influenced input reaching
 * `Intl.DateTimeFormat`. An unknown name throws a RangeError, and an unhandled throw inside a
 * per-user loop would end the whole run — one bad profile silencing everybody's notifications.
 */
export function safeZone(stored: string | null | undefined): string {
  if (!stored) return 'UTC';

  // ⚠️ REJECT AN OFFSET EVEN THOUGH Intl ACCEPTS ONE. Modern V8 happily takes '-05:00' as a
  // timeZone, which makes it look valid and behave wrongly: a fixed offset does not observe
  // daylight saving, so a streak computed against it is an hour out for roughly half the year
  // and silently moves a reader's midnight. The column stores IANA names for exactly this
  // reason, and this is the guard that keeps a well-meaning offset out of the arithmetic.
  // An IANA name always starts with a letter; an offset starts with a sign or a digit.
  if (!/^[A-Za-z]/.test(stored)) return 'UTC';

  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: stored }).format(new Date());
    return stored;
  } catch {
    return 'UTC';
  }
}

function addDaysKey(dayKey: string, delta: number): string {
  // Arithmetic on the KEY, not on a Date, so no zone conversion happens twice. Noon avoids
  // every daylight-saving edge: no zone shifts by twelve hours.
  const [y, m, d] = dayKey.split('-').map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() + delta);
  return anchor.toISOString().slice(0, 10);
}

/**
 * Consecutive days ending today, or ending yesterday when nothing has been read today.
 *
 * The "ending yesterday" half is what stops a five-day streak reading as zero at breakfast. It is
 * still a live streak until the day is over; `streakAtRiskInZone` is what says so.
 */
export function computeStreakInZone(
  readTimestamps: readonly string[],
  now: Date,
  timeZone: string,
): number {
  const days = new Set<string>();
  for (const iso of readTimestamps) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) days.add(localDayKeyInZone(d, timeZone));
  }
  if (days.size === 0) return 0;

  const todayKey = localDayKeyInZone(now, timeZone);
  // Anchor on today when today counts, otherwise on yesterday. Anchoring anywhere else would
  // count a streak that ended a week ago as if it were still running.
  let cursor = days.has(todayKey) ? todayKey : addDaysKey(todayKey, -1);
  if (!days.has(cursor)) return 0;

  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDaysKey(cursor, -1);
  }
  return streak;
}

/** True when a lesson has already been read on the user's own day that `now` falls in. */
export function hasReadTodayInZone(
  readTimestamps: readonly string[],
  now: Date,
  timeZone: string,
): boolean {
  const todayKey = localDayKeyInZone(now, timeZone);
  return readTimestamps.some(iso => {
    const d = new Date(iso);
    return !Number.isNaN(d.getTime()) && localDayKeyInZone(d, timeZone) === todayKey;
  });
}

/**
 * A streak worth warning about: at least two days banked and nothing read today.
 *
 * One day is not a streak. Telling someone their one-day streak is in danger is a guilt-trip
 * about something they have not built yet, and it is how a notification permission gets revoked.
 */
export function streakAtRiskInZone(
  readTimestamps: readonly string[],
  now: Date,
  timeZone: string,
): boolean {
  return !hasReadTodayInZone(readTimestamps, now, timeZone)
    && computeStreakInZone(readTimestamps, now, timeZone) >= 2;
}
