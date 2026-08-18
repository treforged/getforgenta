// What the milestone is allowed to draw.
//
// Every case here is a way the curve could lie: a run that starts at zero, a month no card
// published, a payoff that is already this month. Each must come back null so the hero
// drops the chart, because a flat line on the axis and a chart that failed to read look
// identical to the person holding the phone.
import { describe, it, expect } from 'vitest';
import { buildPayoffTrajectory, formatMonthsAway } from '../payoff-trajectory';

const map = (entries: Record<string, number[]>) => new Map(Object.entries(entries));

describe('buildPayoffTrajectory', () => {
  it('sums the cards month by month, from today to the month it clears', () => {
    const t = buildPayoffTrajectory({
      monthlyRevolvingBalances: map({ a: [600, 400, 200, 0], b: [400, 200, 0, 0] }),
      cardIds: ['a', 'b'],
      payoffMonth: 3,
    })!;
    expect(t.points).toEqual([
      { month: 1, balance: 1000 },
      { month: 2, balance: 600 },
      { month: 3, balance: 200 },
    ]);
    expect(t.startBalance).toBe(1000);
    expect(t.endMonth).toBe(3);
  });

  it('clamps a negative balance to zero rather than drawing below the axis', () => {
    const t = buildPayoffTrajectory({
      monthlyRevolvingBalances: map({ a: [500, -20] }),
      cardIds: ['a'],
      payoffMonth: 2,
    })!;
    expect(t.points[1].balance).toBe(0);
  });

  it('ignores a card the map has no series for, and still draws the rest', () => {
    const t = buildPayoffTrajectory({
      monthlyRevolvingBalances: map({ a: [500, 0] }),
      cardIds: ['a', 'ghost'],
      payoffMonth: 2,
    })!;
    expect(t.startBalance).toBe(500);
  });

  it('returns null when NO card published a figure for a month — a hole is not a zero', () => {
    expect(buildPayoffTrajectory({
      monthlyRevolvingBalances: map({ a: [500] }),
      cardIds: ['a'],
      payoffMonth: 3,
    })).toBeNull();
  });

  it('returns null when the balance is already zero today', () => {
    expect(buildPayoffTrajectory({
      monthlyRevolvingBalances: map({ a: [0, 0] }),
      cardIds: ['a'],
      payoffMonth: 2,
    })).toBeNull();
  });

  it('returns null when the payoff is this month — a single point is not a run', () => {
    expect(buildPayoffTrajectory({
      monthlyRevolvingBalances: map({ a: [500] }),
      cardIds: ['a'],
      payoffMonth: 1,
    })).toBeNull();
  });

  it('returns null with no trajectory published and with no cards', () => {
    expect(buildPayoffTrajectory({ monthlyRevolvingBalances: null, cardIds: ['a'], payoffMonth: 4 })).toBeNull();
    expect(buildPayoffTrajectory({ monthlyRevolvingBalances: map({ a: [5, 0] }), cardIds: [], payoffMonth: 2 })).toBeNull();
  });
});

describe('formatMonthsAway', () => {
  it('stays in months below a year, because "0 yr 7 mo" is worse than "7 months"', () => {
    expect(formatMonthsAway(1)).toBe('1 month away');
    expect(formatMonthsAway(7)).toBe('7 months away');
    expect(formatMonthsAway(11)).toBe('11 months away');
  });

  it('reads as a length of time from a year up', () => {
    expect(formatMonthsAway(12)).toBe('1 yr away');
    expect(formatMonthsAway(23)).toBe('1 yr 11 mo away');
    expect(formatMonthsAway(24)).toBe('2 yr away');
    expect(formatMonthsAway(37)).toBe('3 yr 1 mo away');
  });

  it('says "this month" rather than counting zero', () => {
    expect(formatMonthsAway(0)).toBe('This month');
    expect(formatMonthsAway(Number.NaN)).toBe('This month');
  });
});
