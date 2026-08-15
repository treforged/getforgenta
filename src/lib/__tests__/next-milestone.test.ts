// Slice 5 — which milestone the Forecast hero is allowed to lead with.
//
// The hero is the only thing most people will read on this page, so the selector is where
// the honesty rule is enforced: the SOONEST milestone wins, full stop. A negative milestone
// is never stepped over in favour of a happier one further out, and an empty list produces
// nothing rather than a fabricated month.
import { describe, it, expect } from 'vitest';
import {
  selectNextMilestone,
  classifyMilestoneTone,
  type ForecastMilestone,
} from '@/lib/next-milestone';

const CC_FREE: ForecastMilestone = { month: 'Jul 2028', event: 'CC Debt Free! 🎉' };
const GOAL: ForecastMilestone = { month: 'Mar 2027', event: 'Emergency Fund Complete! 🎯' };
const NEGATIVE: ForecastMilestone = { month: 'Sep 2026', event: '⚠️ Cash below safe minimum' };
const CASH_NEG: ForecastMilestone = { month: 'Oct 2026', event: '⚠️ Cash goes negative!' };
const FLOOR_BREACH: ForecastMilestone = { month: 'Nov 2026', event: '💸 One-time expense caused floor breach' };

describe('classifyMilestoneTone', () => {
  it('reads the engine\'s three bad-news events as negative', () => {
    expect(classifyMilestoneTone(NEGATIVE.event)).toBe('negative');
    expect(classifyMilestoneTone(CASH_NEG.event)).toBe('negative');
    expect(classifyMilestoneTone(FLOOR_BREACH.event)).toBe('negative');
  });

  it('reads the engine\'s two good-news events as positive', () => {
    expect(classifyMilestoneTone(CC_FREE.event)).toBe('positive');
    expect(classifyMilestoneTone(GOAL.event)).toBe('positive');
  });

  it('calls an unrecognised event neutral rather than guessing it is good news', () => {
    // A future engine milestone this file has never seen must not be dressed up as a win.
    expect(classifyMilestoneTone('Something new happened')).toBe('neutral');
  });
});

describe('selectNextMilestone', () => {
  it('picks the soonest milestone — the first the engine emitted', () => {
    const sel = selectNextMilestone([GOAL, CC_FREE]);
    expect(sel?.milestone).toEqual(GOAL);
    expect(sel?.tone).toBe('positive');
  });

  it('leads with BAD news when the bad news comes first — never skips to a later win', () => {
    const sel = selectNextMilestone([NEGATIVE, GOAL, CC_FREE]);
    expect(sel?.milestone).toEqual(NEGATIVE);
    expect(sel?.tone).toBe('negative');
  });

  it('leads with bad news even when every other milestone is a win', () => {
    const sel = selectNextMilestone([FLOOR_BREACH, GOAL, CC_FREE]);
    expect(sel?.milestone).toEqual(FLOOR_BREACH);
    expect(sel?.tone).toBe('negative');
  });

  it('prefers the bad news when good and bad land in the SAME month', () => {
    const sameMonthWin: ForecastMilestone = { month: 'Sep 2026', event: 'CC Debt Free! 🎉' };
    const sel = selectNextMilestone([sameMonthWin, NEGATIVE, CC_FREE]);
    expect(sel?.milestone).toEqual(NEGATIVE);
    expect(sel?.tone).toBe('negative');
  });

  it('does not reach into a LATER month for bad news', () => {
    const sel = selectNextMilestone([GOAL, CASH_NEG]);
    expect(sel?.milestone).toEqual(GOAL);
  });

  it('returns every other milestone, in order, so nothing is lost from the list', () => {
    const sel = selectNextMilestone([NEGATIVE, GOAL, CC_FREE]);
    expect(sel?.rest).toEqual([GOAL, CC_FREE]);
  });

  it('keeps the same-month sibling in the rest list when bad news is promoted', () => {
    const sameMonthWin: ForecastMilestone = { month: 'Sep 2026', event: 'CC Debt Free! 🎉' };
    const sel = selectNextMilestone([sameMonthWin, NEGATIVE, CC_FREE]);
    expect(sel?.rest).toEqual([sameMonthWin, CC_FREE]);
  });

  it('returns null for an empty list — no fabricated month', () => {
    expect(selectNextMilestone([])).toBeNull();
  });

  it('returns null when the milestones array is missing entirely', () => {
    expect(selectNextMilestone(undefined)).toBeNull();
  });

  it('does not mutate the array it was given', () => {
    const input = [NEGATIVE, GOAL, CC_FREE];
    const copy = [...input];
    selectNextMilestone(input);
    expect(input).toEqual(copy);
  });
});
