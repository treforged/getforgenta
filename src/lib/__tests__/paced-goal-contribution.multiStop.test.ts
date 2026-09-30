import { describe, it, expect } from 'vitest';
import {
  pacedStopSchedules, pacedContributionSchedule, buildPacedStopSchedules, scheduledAfterForStop,
  accountOutflowsFrom, type PacedGoal,
} from '@/lib/paced-goal-contribution';
import { stopIndexOfRow, stopRowId } from '@/lib/ranked-extra-payment-targets';

// 66d3af19 - Tre's move fund split into two dated stops (2026-09-30). Before the fix only stop 1
// was paced and the Deposit stop drew $0.
const ACCT = '36997c1c-0de7-45a5-8806-655bdcc78893';
const asOf = new Date(2026, 8, 29); // 29 Sep 2026, local
const split: PacedGoal = {
  id: 'g1', monthly_contribution: 510, current_amount: 106.44, target_amount: 5730,
  target_date: '2027-07-03', surplus_share: 50, auto_extra: true, linked_account: ACCT,
  stages: [
    { name: 'Lease break', amount: 3830, spends: true, target_date: '2027-03-01', auto_extra: true, sort_order: 1 },
    { name: 'Deposit', amount: 1900, spends: true, target_date: '2027-07-03', auto_extra: true, sort_order: 2 },
    { name: 'Emergency runway', months: 3, auto_extra: true, sort_order: 5 },
  ],
};
const outflows = accountOutflowsFrom([
  { type: 'expense', date: '2027-03-01', payment_source: `account:${ACCT}`, amount: 3830 },
  { type: 'expense', date: '2027-07-01', payment_source: `account:${ACCT}`, amount: 1500 },
]);
const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

describe('pacing every dated stop in order (66d3af19)', () => {
  it('funds the Deposit stop after the Lease break stop, each before its own outflow', () => {
    const byStop = pacedStopSchedules(split, asOf, 36, outflows)!;
    expect([...byStop.keys()]).toEqual([1, 2]);
    const s1 = byStop.get(1)!;
    const s2 = byStop.get(2)!;
    // Stop 1: Sep 2026 .. Feb 2027 (6 payments), the month before the 1 Mar fee.
    expect(s1.slice(0, 6).every(x => x > 0)).toBe(true);
    expect(s1.slice(6).every(x => x === 0)).toBe(true);
    expect(sum(s1)).toBeCloseTo(3830 - 106.44, 2);
    // Stop 2: Mar .. Jun 2027 (4 payments), the month before the 1 Jul movers outflow.
    expect(s2.slice(0, 6).every(x => x === 0)).toBe(true);
    expect(s2.slice(6, 10).every(x => x > 0)).toBe(true);
    expect(s2.slice(10).every(x => x === 0)).toBe(true);
    expect(sum(s2)).toBeCloseTo(1900, 2);
  });

  it('the total schedule is the two stops summed, so the whole 5,730 is saved', () => {
    expect(sum(pacedContributionSchedule(split, asOf, 36, outflows)!)).toBeCloseTo(5730 - 106.44, 2);
  });

  it('a stop that is already met is skipped and the next one is paced from now', () => {
    const met = { ...split, current_amount: 4000 };
    const byStop = pacedStopSchedules(met, asOf, 36, outflows)!;
    expect([...byStop.keys()]).toEqual([2]);
    // 4,000 saved covers stop 1 and 170 of stop 2.
    expect(sum(byStop.get(2)!)).toBeCloseTo(5730 - 4000, 2);
  });

  it('credits each stop with its OWN deposits only', () => {
    const map = buildPacedStopSchedules([split], asOf, 36, outflows);
    expect(scheduledAfterForStop(map, 'g1', 1, 0) + (map.get('g1')!.get(1)![0])).toBeCloseTo(3830 - 106.44, 2);
    expect(scheduledAfterForStop(map, 'g1', 2, 0)).toBeCloseTo(1900, 2);
    expect(scheduledAfterForStop(map, 'g1', 3, 0)).toBe(0);
    expect(buildPacedStopSchedules([split], asOf, 36, outflows, false).size).toBe(0);
  });

  it('stopIndexOfRow inverts stopRowId and refuses another goal', () => {
    for (const i of [1, 2, 7]) expect(stopIndexOfRow(stopRowId('g1', i), 'g1')).toBe(i);
    expect(stopIndexOfRow('g2', 'g1')).toBeNull();
    expect(stopIndexOfRow('g1::stopX', 'g1')).toBeNull();
  });
});
