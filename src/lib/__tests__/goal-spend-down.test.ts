// A SAVINGS GOAL THAT ACTUALLY GETS SPENT.
//
// Tre, 2026-08-27: "on the goals tab why dont i see the savings go up to the first goal then drop
// to 0 after the payments? is there a bigger issue" — there was. Nothing in the app ever spent a
// plain savings goal. A car fund is spent at its purchase month; a goal only ever grew. So his
// move fund filled to $5,730 and sat there for ever, and net worth counted money that leaves in
// Jul 2027.
//
// Two halves are pinned here, and the SECOND is the one that is easy to get wrong: once the money
// is gone the plan must not decide stop 1 is unfilled and start saving for the move all over again.

import { describe, it, expect } from 'vitest';
import {
  goalStages, goalWithdrawals, goalSavedIncludingSpent, type RankableGoal,
} from '../ranked-extra-payment-targets';
import { buildSavingsGrowthData } from '../savings-growth';

const MONTHLY = 1_000;

const movePlan = (over: Partial<RankableGoal> = {}): RankableGoal => ({
  id: 'g-1', current_amount: 0, auto_extra: true, sort_order: 0,
  target_amount: 0,
  stages: [
    { id: 'a', name: 'Move fund', amount: 5_730, target_date: '2027-07-03', spends: true },
    { id: 'b', name: 'Runway', months: 3 },
  ],
  ...over,
});

describe('goalWithdrawals', () => {
  it('reports the money a spent stop takes out, on that stop\'s own date', () => {
    expect(goalWithdrawals(movePlan(), MONTHLY))
      .toEqual([{ stopId: 'a', date: '2027-07-03', amount: 5_730 }]);
  });

  it('is EMPTY for every ordinary plan — the feature is opt-in per stop', () => {
    expect(goalWithdrawals(movePlan({
      stages: [{ id: 'a', amount: 5_730, target_date: '2027-07-03' }, { id: 'b', months: 3 }],
    }), MONTHLY)).toEqual([]);
    expect(goalWithdrawals({ id: 'g', target_amount: 5_000, current_amount: 0 }, MONTHLY)).toEqual([]);
  });

  it('ignores a spent stop with NO date — "it gets spent" is not actionable without a when, and a '
    + 'withdrawal with no month would have to be invented', () => {
    expect(goalWithdrawals(movePlan({
      stages: [{ id: 'a', amount: 5_730, spends: true }],
    }), MONTHLY)).toEqual([]);
    expect(goalStages(movePlan({ stages: [{ id: 'a', amount: 100, spends: true }] }), MONTHLY)
      .stops[0].spends).toBe(false);
  });

  it('sizes a MONTHS stop the same way as any other, so the withdrawal tracks real spending', () => {
    expect(goalWithdrawals(movePlan({
      stages: [{ id: 'a', months: 2, target_date: '2027-07-03', spends: true }],
    }), MONTHLY)).toEqual([{ stopId: 'a', date: '2027-07-03', amount: 2_000 }]);
  });
});

describe('goalSavedIncludingSpent — a spent stop must not re-open', () => {
  it('counts money already spent as still achieved, so the plan does not restart', () => {
    // The move happened; the account is back to almost nothing.
    const after = movePlan({ current_amount: 120 });
    expect(goalSavedIncludingSpent(after, MONTHLY, new Date('2027-08-01T12:00:00')))
      .toBe(120 + 5_730);
  });

  it('does NOT count a spend that has not happened yet', () => {
    const before = movePlan({ current_amount: 5_730 });
    expect(goalSavedIncludingSpent(before, MONTHLY, new Date('2027-01-01T12:00:00'))).toBe(5_730);
  });

  it('is just the balance for a plan with nothing marked as spent', () => {
    const plain = movePlan({
      current_amount: 900,
      stages: [{ id: 'a', amount: 5_730, target_date: '2027-07-03' }],
    });
    expect(goalSavedIncludingSpent(plain, MONTHLY, new Date('2030-01-01T12:00:00'))).toBe(900);
  });

  it('keeps stop 1 complete and stop 2 the current one AFTER the spend — the whole point', () => {
    const after = movePlan({ current_amount: 120 });
    const saved = goalSavedIncludingSpent(after, MONTHLY, new Date('2027-08-01T12:00:00'));
    const stops = goalStages(after, MONTHLY).stops;
    expect(saved >= stops[0].threshold).toBe(true);
    expect(saved < stops[1].threshold).toBe(true);
  });
});

describe('buildSavingsGrowthData — the line goes DOWN when the money is spent', () => {
  const TODAY = new Date('2026-08-01T12:00:00');

  const run = (withdrawals: { date: string; amount: number }[]) => buildSavingsGrowthData([{
    id: 'g-1', name: 'Move fund', currentAmount: 0, monthlyContribution: 1_000,
    annualApyPercent: 0, contributionStartDate: null, lumpSums: [], withdrawals,
  }], { months: 24, today: TODAY });

  it('drops the balance in the withdrawal month and keeps growing after', () => {
    const rows = run([{ date: '2027-02-10', amount: 5_000 }]).rows;
    // 2026-08 is index 0, so 2027-02 is index 6: six contributions in, minus the spend.
    expect(rows[5].s0).toBeCloseTo(5_000, 2);
    expect(rows[6].s0).toBeCloseTo(6_000 - 5_000, 2);
    expect(rows[7].s0).toBeCloseTo(2_000, 2);
  });

  it('is UNCHANGED with no withdrawals — every existing goal', () => {
    const withNone = run([]).rows.map(r => r.s0);
    const withUndef = buildSavingsGrowthData([{
      id: 'g-1', name: 'Move fund', currentAmount: 0, monthlyContribution: 1_000,
      annualApyPercent: 0, contributionStartDate: null, lumpSums: [],
    }], { months: 24, today: TODAY }).rows.map(r => r.s0);
    expect(withNone).toEqual(withUndef);
  });

  it('never goes negative — if the plan under-saved, what is there is what gets spent', () => {
    const rows = run([{ date: '2026-10-10', amount: 99_999 }]).rows;
    expect(rows.every(r => Number(r.s0) >= 0)).toBe(true);
    expect(rows[2].s0).toBe(0);
  });

  it('ignores a withdrawal dated this month or earlier — already in the opening balance, the same '
    + 'rule the lump sums use', () => {
    const past = run([{ date: '2026-08-01', amount: 5_000 }]).rows.map(r => r.s0);
    expect(past).toEqual(run([]).rows.map(r => r.s0));
  });
});
