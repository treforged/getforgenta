/**
 * THE SERVER'S STREAK MUST MATCH THE PHONE'S — the timezone bug, caught before it shipped.
 *
 * `supabase/functions/_shared/learn-streak.ts` is a COPY of `src/lib/learn-streak.ts`, because
 * Deno cannot import from `src/`. It has exactly one deliberate divergence, and this file is
 * what proves that divergence is a CORRECTION rather than a drift.
 *
 * The original buckets by the RUNTIME's local day, which on a device is the reader's own clock.
 * An edge function has no such clock — it runs in UTC. Ported unchanged, two things break at
 * once and neither of them raises anything:
 *
 *   - A New York reader finishing a lesson at 8pm on the 4th is 00:00 UTC on the 5th. The server
 *     would count a different day from the phone, and the streak in the notification would
 *     disagree with the streak on the screen.
 *   - STREAK_RISK_HOUR is 18 — late enough for "ends tonight" to be true. In UTC that is 2pm in
 *     New York: a warning four hours early, about a streak in no danger.
 *
 * ⚠️ These cases run under whatever TZ the suite sets — `npm run test:tz` runs UTC,
 * America/New_York and Asia/Tokyo — and they must give the SAME answer in all three. That is the
 * point: the zone comes from the argument, never from the process. A version that read the
 * runtime's clock would pass in one zone and fail in the others.
 *
 * Would-fail check: swap `localDayKeyInZone` for the original `localDayKey` and the
 * "same evening in New York" case fails in UTC and Tokyo while passing in New York — the exact
 * shape of a bug that survives a single-timezone test run.
 */
import { describe, it, expect } from 'vitest';
import {
  computeStreakInZone, hasReadTodayInZone, streakAtRiskInZone,
  localDayKeyInZone, hourInZone, safeZone,
} from '../../../supabase/functions/_shared/learn-streak';

const NY = 'America/New_York';
const TOKYO = 'Asia/Tokyo';

describe('the day a read belongs to', () => {
  it('puts a late-evening New York read on THAT evening, not the next UTC day', () => {
    // 2026-09-04 20:00 in New York is 2026-09-05 00:00 UTC.
    const lateEvening = new Date('2026-09-05T00:00:00Z');
    expect(localDayKeyInZone(lateEvening, NY)).toBe('2026-09-04');
    expect(localDayKeyInZone(lateEvening, 'UTC')).toBe('2026-09-05');
    // Tokyo is already well into the 5th. All three are correct for their own reader.
    expect(localDayKeyInZone(lateEvening, TOKYO)).toBe('2026-09-05');
  });

  it('reads the hour in the reader\'s zone, not the runtime\'s', () => {
    const instant = new Date('2026-09-05T00:00:00Z');
    expect(hourInZone(instant, NY)).toBe(20);
    expect(hourInZone(instant, 'UTC')).toBe(0);
  });
});

describe('computeStreakInZone', () => {
  // Three consecutive New York evenings, each at 8pm local — which is the NEXT day in UTC.
  const threeNyEvenings = [
    '2026-09-03T00:00:00Z', // 2026-09-02 20:00 NY
    '2026-09-04T00:00:00Z', // 2026-09-03 20:00 NY
    '2026-09-05T00:00:00Z', // 2026-09-04 20:00 NY
  ];

  it('counts three consecutive evenings as three, for a New York reader', () => {
    // 2026-09-04 22:00 NY — same evening as the last read.
    const now = new Date('2026-09-05T02:00:00Z');
    expect(computeStreakInZone(threeNyEvenings, now, NY)).toBe(3);
  });

  it('keeps the streak alive at breakfast the next morning', () => {
    // 2026-09-05 08:00 NY. Nothing read yet today, but yesterday counts.
    const now = new Date('2026-09-05T12:00:00Z');
    expect(computeStreakInZone(threeNyEvenings, now, NY)).toBe(3);
  });

  it('drops to zero once a whole day has been skipped', () => {
    // 2026-09-06 08:00 NY — the 5th was missed entirely.
    const now = new Date('2026-09-06T12:00:00Z');
    expect(computeStreakInZone(threeNyEvenings, now, NY)).toBe(0);
  });

  it('gives the same answer whatever timezone the TEST RUNNER is in', () => {
    // The zone is an argument, never the process. This is what makes the suite's three-zone run
    // meaningful for a server that only ever runs in one of them.
    const now = new Date('2026-09-05T02:00:00Z');
    expect(computeStreakInZone(threeNyEvenings, now, NY)).toBe(3);
  });

  it('ignores an unparseable timestamp instead of breaking the count', () => {
    const withJunk = [...threeNyEvenings, 'not-a-date'];
    const now = new Date('2026-09-05T02:00:00Z');
    expect(computeStreakInZone(withJunk, now, NY)).toBe(3);
  });

  it('is zero with no reads at all', () => {
    expect(computeStreakInZone([], new Date('2026-09-05T02:00:00Z'), NY)).toBe(0);
  });
});

describe('hasReadTodayInZone and streakAtRiskInZone', () => {
  const twoNyEvenings = ['2026-09-03T00:00:00Z', '2026-09-04T00:00:00Z'];

  it('knows a read that happened this evening in the reader\'s own day', () => {
    // 2026-09-03 22:00 NY, and the second read was 2026-09-03 20:00 NY.
    expect(hasReadTodayInZone(twoNyEvenings, new Date('2026-09-04T02:00:00Z'), NY)).toBe(true);
  });

  it('warns only when two days are banked AND nothing has been read today', () => {
    // 2026-09-04 18:00 NY: two evenings banked, nothing read on the 4th.
    const atRisk = new Date('2026-09-04T22:00:00Z');
    expect(streakAtRiskInZone(twoNyEvenings, atRisk, NY)).toBe(true);

    // One evening is not a streak worth warning about.
    expect(streakAtRiskInZone(['2026-09-04T00:00:00Z'], atRisk, NY)).toBe(false);
  });

  it('does not warn on an evening the reader has already read', () => {
    // 2026-09-03 22:00 NY — they read at 20:00.
    expect(streakAtRiskInZone(twoNyEvenings, new Date('2026-09-04T02:00:00Z'), NY)).toBe(false);
  });
});

describe('safeZone', () => {
  it('passes a real IANA name through', () => {
    expect(safeZone(NY)).toBe(NY);
  });

  it('falls back to UTC for null, which means we were never told', () => {
    expect(safeZone(null)).toBe('UTC');
    expect(safeZone(undefined)).toBe('UTC');
    expect(safeZone('')).toBe('UTC');
  });

  it('falls back to UTC for a name Intl rejects, rather than throwing', () => {
    // A stored zone is user-influenced input reaching Intl.DateTimeFormat. An unhandled
    // RangeError inside a per-user loop would end the whole run — one bad profile silencing
    // everybody's notifications.
    expect(safeZone('Mars/Olympus_Mons')).toBe('UTC');
    expect(safeZone('-05:00')).toBe('UTC');
  });
});
