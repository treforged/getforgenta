import { describe, it, expect } from 'vitest';
import {
  pacedContributionSchedule, buildPacedContributionSchedules, goalContributionForMonth,
  scheduledAfter, accountOutflowsFrom, hasCardDebt, type PacedGoal,
} from '@/lib/paced-goal-contribution';

// Shaped like Tre's move goal on the real fixture (585ec24a).
const ACCT = '36997c1c-0de7-45a5-8806-655bdcc78893';
const asOf = new Date(2026, 7, 31); // 31 Aug 2026, local
const move: PacedGoal = {
  id: 'g1', monthly_contribution: 510, current_amount: 106.44, target_amount: 5730,
  target_date: '2027-07-03', surplus_share: 50, auto_extra: true, linked_account: ACCT,
  stages: [{ name: 'First target', amount: 5730, target_date: '2027-07-03', auto_extra: true, sort_order: 1 }],
};
const need = 5730 - 106.44;
const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

describe('pacedContributionSchedule', () => {
  it('pays exactly the need over months+1 payments, ending in the target month, back-loaded', () => {
    const s = pacedContributionSchedule(move, asOf, 36)!;
    expect(s).toHaveLength(36);
    // Aug 2026 .. Jul 2027 is 12 payments (the target month counts - 447d57ad finding 1).
    expect(s.slice(0, 12).every(x => x > 0)).toBe(true);
    expect(s.slice(12).every(x => x === 0)).toBe(true);
    expect(sum(s)).toBeCloseTo(need, 2);
    for (let i = 1; i < 12; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1]);
    expect(s[0]).toBeLessThan(510);
  });

  it('ends the month BEFORE the first planned outflow from the goal account', () => {
    const outflows = accountOutflowsFrom([
      { type: 'expense', date: '2027-06-01', payment_source: `account:${ACCT}`, amount: 3830 },
      { type: 'expense', date: '2027-07-01', payment_source: `account:${ACCT}`, amount: 1900 },
    ]);
    const s = pacedContributionSchedule(move, asOf, 36, outflows)!;
    // Aug 2026 .. May 2027 = 10 payments; nothing in June.
    expect(s.slice(0, 10).every(x => x > 0)).toBe(true);
    expect(s[10]).toBe(0);
    expect(sum(s)).toBeCloseTo(need, 2);
    expect(Math.max(...s)).toBeCloseTo(2249.42, 2); // the largest month, the one to surface
  });

  it('ignores outflows from other accounts, this month, generated rows, and after the date', () => {
    const outflows = accountOutflowsFrom([
      { type: 'expense', date: '2027-01-01', payment_source: 'account:other', amount: 100 },
      { type: 'expense', date: '2026-08-31', payment_source: ACCT, amount: 100 },
      { type: 'expense', date: '2027-01-01', payment_source: ACCT, amount: 100, isGenerated: true },
      { type: 'expense', date: '2027-09-01', payment_source: ACCT, amount: 100 },
      { type: 'income', date: '2027-01-01', payment_source: ACCT, amount: 100 },
    ]);
    expect(pacedContributionSchedule(move, asOf, 36, outflows)).toEqual(pacedContributionSchedule(move, asOf, 36));
  });

  it.each([
    ['no split weight on stop 1', { surplus_share: null }],
    ['no date', { target_date: null, stages: [{ name: 'x', amount: 5730, sort_order: 1 }] }],
    ['a date already past', { target_date: '2026-07-01', stages: [{ name: 'x', amount: 5730, target_date: '2026-07-01', sort_order: 1 }] }],
    ['a linked rule (a real bank transfer)', { linked_rule_id: 'r1' }],
    ['linked rule ids', { linked_rule_ids: ['r1'] }],
    ['a start date in a later month', { contribution_start_date: '2026-10-01' }],
    ['no monthly contribution', { monthly_contribution: 0 }],
    ['already fully saved', { current_amount: 5730 }],
  ])('does not qualify with %s', (_, patch) => {
    expect(pacedContributionSchedule({ ...move, ...patch } as PacedGoal, asOf, 36)).toBeNull();
  });
});

describe('goalContributionForMonth / scheduledAfter', () => {
  const schedules = buildPacedContributionSchedules([move, { ...move, id: 'flat', surplus_share: null }], asOf, 36);

  it('reads the schedule for a paced goal, and 0 after it ends (never the flat 510)', () => {
    expect(schedules.has('g1')).toBe(true);
    expect(schedules.has('flat')).toBe(false);
    expect(goalContributionForMonth(move, 0, schedules)).toBe(schedules.get('g1')![0]);
    expect(goalContributionForMonth(move, 20, schedules)).toBe(0);
    expect(goalContributionForMonth(move, 400, schedules)).toBe(0);
  });

  it('falls back to monthly_contribution for a goal with no schedule', () => {
    expect(goalContributionForMonth({ ...move, id: 'flat', surplus_share: null }, 3, schedules)).toBe(510);
  });

  it('scheduledAfter sums strictly later months', () => {
    const s = schedules.get('g1')!;
    expect(scheduledAfter(schedules, 'g1', 0)).toBeCloseTo(need - s[0], 2);
    expect(scheduledAfter(schedules, 'g1', 11)).toBe(0);
    expect(scheduledAfter(schedules, 'flat', 0)).toBe(0);
  });
});

describe('hasCardDebt gates the whole feature', () => {
  it('reads an active card with a balance, and nothing else', () => {
    expect(hasCardDebt([{ account_type: 'credit_card', active: true, balance: 120 }])).toBe(true);
    expect(hasCardDebt([{ account_type: 'credit_card', active: true, balance: 0 }])).toBe(false);
    expect(hasCardDebt([{ account_type: 'credit_card', active: false, balance: 500 }])).toBe(false);
    expect(hasCardDebt([{ account_type: 'checking', active: true, balance: 500 }])).toBe(false);
    expect(hasCardDebt(null)).toBe(false);
  });

  it('with no card debt, no goal is paced (the flat contribution is better)', () => {
    expect(buildPacedContributionSchedules([move], asOf, 36, [], false).size).toBe(0);
    expect(buildPacedContributionSchedules([move], asOf, 36, [], true).size).toBe(1);
  });
});
