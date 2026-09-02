// Streak arithmetic. A streak that breaks because of a timezone, or survives a day the reader
// actually skipped, costs the same trust — so both directions are asserted here.
//
// Would-fail check: bucket by UTC date instead of local and "two reads either side of UTC
// midnight are one evening" fails for any negative-offset timezone, which is every US user.

import { describe, it, expect } from 'vitest';
import { computeStreak, hasReadToday, streakAtRisk, localDayKey } from '@/lib/learn-streak';

const at = (local: string) => new Date(local).toISOString();

describe('computeStreak', () => {
  const NOW = new Date('2026-09-02T10:00:00');

  it('is zero with nothing read', () => {
    expect(computeStreak([], NOW)).toBe(0);
  });

  it('counts consecutive local days ending today', () => {
    const reads = [at('2026-09-02T09:00:00'), at('2026-09-01T20:00:00'), at('2026-08-31T08:00:00')];
    expect(computeStreak(reads, NOW)).toBe(3);
  });

  it('stays alive on a morning where nothing has been read YET', () => {
    // Anchoring on today alone would report 0 at breakfast and hand the reader a broken streak
    // they have all day to save.
    const reads = [at('2026-09-01T20:00:00'), at('2026-08-31T08:00:00')];
    expect(computeStreak(reads, NOW)).toBe(2);
  });

  it('does not resurrect a streak that ended days ago', () => {
    const reads = [at('2026-08-28T20:00:00'), at('2026-08-27T20:00:00')];
    expect(computeStreak(reads, NOW)).toBe(0);
  });

  it('stops at the gap rather than counting every read', () => {
    const reads = [
      at('2026-09-02T09:00:00'), at('2026-09-01T09:00:00'),
      // 31st skipped
      at('2026-08-30T09:00:00'), at('2026-08-29T09:00:00'),
    ];
    expect(computeStreak(reads, NOW)).toBe(2);
  });

  it('counts two reads on one local day once', () => {
    const reads = [at('2026-09-02T09:00:00'), at('2026-09-02T18:00:00'), at('2026-09-01T09:00:00')];
    expect(computeStreak(reads, NOW)).toBe(2);
  });

  it('treats one local evening as one day even across UTC midnight', () => {
    // 20:00 and 22:00 on the same local evening. In a negative UTC offset the second is the next
    // day in UTC; bucketing by UTC would invent a day the reader did not earn.
    const reads = [at('2026-09-01T20:00:00'), at('2026-09-01T22:00:00')];
    expect(localDayKey(new Date(reads[0]))).toBe(localDayKey(new Date(reads[1])));
    expect(computeStreak(reads, NOW)).toBe(1);
  });

  it('ignores unparseable timestamps rather than throwing', () => {
    expect(computeStreak(['not-a-date', at('2026-09-02T09:00:00')], NOW)).toBe(1);
  });
});

describe('hasReadToday / streakAtRisk', () => {
  const NOW = new Date('2026-09-02T19:00:00');

  it('knows whether today is already covered', () => {
    expect(hasReadToday([at('2026-09-02T09:00:00')], NOW)).toBe(true);
    expect(hasReadToday([at('2026-09-01T09:00:00')], NOW)).toBe(false);
  });

  it('is at risk only with two or more days banked and nothing read today', () => {
    const twoDays = [at('2026-09-01T09:00:00'), at('2026-08-31T09:00:00')];
    expect(streakAtRisk(twoDays, NOW)).toBe(true);

    // One day is not a streak; warning about it is a guilt-trip about nothing.
    expect(streakAtRisk([at('2026-09-01T09:00:00')], NOW)).toBe(false);

    // Already read today — nothing to save.
    expect(streakAtRisk([...twoDays, at('2026-09-02T08:00:00')], NOW)).toBe(false);
  });
});
