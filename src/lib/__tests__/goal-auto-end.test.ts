import { describe, it, expect } from 'vitest';
import { projectedAutoEndDate, planAutoEndWrites } from '../goal-auto-end';

/**
 * 97.3 — per-goal "auto-end contributions when the goal is hit".
 *
 * The pure layer: derive the projected completion date from the SAME projection 4b's
 * cutoff logic uses (goal-linkage.ts / estimateGoalCompletionMonths — never a second
 * hand-rolled projection), and plan the recurring_rules.end_date writes such that:
 *  - a manual end_date the user set by hand is NEVER overwritten (provenance = the
 *    auto_end_stamped map persisted on the goal),
 *  - toggling OFF clears exactly the end_date this feature wrote, nothing else,
 *  - a projection that moved re-stamps a date we previously wrote.
 */

const today = new Date('2026-08-07T12:00:00');

// Savings-style goal: linked account balance $19,000, target $20,000, one $500/mo
// linked rule, 0% APY -> month 2's contribution tips it over (19k + 2x500 = 20k).
const rule = { id: 'r1', amount: 500, frequency: 'monthly', start_date: '2026-01-05', end_date: null };
const account = { id: 'a1', account_type: 'savings', balance: 19000, apy: 0 };
const goal = {
  id: 'g1',
  target_amount: 20000,
  current_amount: 0,
  monthly_contribution: 0,
  linked_account: 'a1',
  linked_rule_ids: ['r1'],
};

describe('projectedAutoEndDate', () => {
  it('stamps the last day of the month whose contribution completes the goal', () => {
    // completes at month idx 2 (Oct 2026) -> rule keeps firing through Oct, ends 2026-10-31
    expect(projectedAutoEndDate(goal, [rule], [account], today)).toBe('2026-10-31');
  });

  it('returns null when the goal never completes within the horizon', () => {
    const never = { ...goal, target_amount: 10_000_000 };
    expect(projectedAutoEndDate(never, [rule], [account], today)).toBeNull();
  });

  it('stamps the end of the PREVIOUS month when the goal is already at target', () => {
    const done = { ...goal, target_amount: 15000 };
    expect(projectedAutoEndDate(done, [rule], [account], today)).toBe('2026-07-31');
  });
});

describe('planAutoEndWrites — toggle ON', () => {
  it('stamps the projected date onto a linked rule with no end_date', () => {
    const plan = planAutoEndWrites({ enabled: true, goal, previousStamped: {}, rules: [rule], accounts: [account], today });
    expect(plan.ruleWrites).toEqual([{ id: 'r1', end_date: '2026-10-31' }]);
    expect(plan.stamped).toEqual({ r1: '2026-10-31' });
    expect(plan.conflicts).toEqual([]);
  });

  it('never clobbers a manual end_date and reports it as a conflict', () => {
    const manual = { ...rule, end_date: '2027-01-15' };
    const plan = planAutoEndWrites({ enabled: true, goal, previousStamped: {}, rules: [manual], accounts: [account], today });
    expect(plan.ruleWrites).toEqual([]);
    expect(plan.stamped).toEqual({});
    expect(plan.conflicts).toEqual([{ ruleId: 'r1', end_date: '2027-01-15' }]);
  });

  it('re-stamps a moved projection over a date this feature previously wrote', () => {
    // Rule currently carries OUR old stamp; the projection has since moved.
    const stampedRule = { ...rule, end_date: '2026-09-30' };
    const plan = planAutoEndWrites({ enabled: true, goal, previousStamped: { r1: '2026-09-30' }, rules: [stampedRule], accounts: [account], today });
    expect(plan.ruleWrites).toEqual([{ id: 'r1', end_date: '2026-10-31' }]);
    expect(plan.stamped).toEqual({ r1: '2026-10-31' });
  });

  it('skips the write (but keeps the stamp) when the rule already carries the projected date', () => {
    const current = { ...rule, end_date: '2026-10-31' };
    const plan = planAutoEndWrites({ enabled: true, goal, previousStamped: { r1: '2026-10-31' }, rules: [current], accounts: [account], today });
    expect(plan.ruleWrites).toEqual([]);
    expect(plan.stamped).toEqual({ r1: '2026-10-31' });
  });

  it('clears a stale stamp when the goal no longer completes within the horizon', () => {
    const stampedRule = { ...rule, end_date: '2026-10-31' };
    const never = { ...goal, target_amount: 10_000_000 };
    const plan = planAutoEndWrites({ enabled: true, goal: never, previousStamped: { r1: '2026-10-31' }, rules: [stampedRule], accounts: [account], today });
    expect(plan.ruleWrites).toEqual([{ id: 'r1', end_date: null }]);
    expect(plan.stamped).toEqual({});
  });

  it('clears the stamp from a rule that is no longer linked to the goal', () => {
    const oldRule = { id: 'r0', amount: 100, frequency: 'monthly', start_date: '2026-01-05', end_date: '2026-12-31' };
    const plan = planAutoEndWrites({
      enabled: true,
      goal, // links r1 only
      previousStamped: { r0: '2026-12-31' },
      rules: [rule, oldRule],
      accounts: [account],
      today,
    });
    expect(plan.ruleWrites).toEqual(expect.arrayContaining([
      { id: 'r0', end_date: null },
      { id: 'r1', end_date: '2026-10-31' },
    ]));
    expect(plan.stamped).toEqual({ r1: '2026-10-31' });
  });
});

describe('planAutoEndWrites — toggle OFF', () => {
  it('clears exactly the end_date this feature wrote', () => {
    const stampedRule = { ...rule, end_date: '2026-10-31' };
    const plan = planAutoEndWrites({ enabled: false, goal, previousStamped: { r1: '2026-10-31' }, rules: [stampedRule], accounts: [account], today });
    expect(plan.ruleWrites).toEqual([{ id: 'r1', end_date: null }]);
    expect(plan.stamped).toEqual({});
  });

  it('leaves an end_date the user has since changed by hand', () => {
    const manual = { ...rule, end_date: '2027-06-30' };
    const plan = planAutoEndWrites({ enabled: false, goal, previousStamped: { r1: '2026-10-31' }, rules: [manual], accounts: [account], today });
    expect(plan.ruleWrites).toEqual([]);
    expect(plan.stamped).toEqual({});
  });

  it('is a no-op when nothing was ever stamped', () => {
    const plan = planAutoEndWrites({ enabled: false, goal, previousStamped: {}, rules: [rule], accounts: [account], today });
    expect(plan.ruleWrites).toEqual([]);
    expect(plan.stamped).toEqual({});
    expect(plan.conflicts).toEqual([]);
  });
});
