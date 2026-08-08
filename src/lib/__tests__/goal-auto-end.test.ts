import { describe, it, expect } from 'vitest';
import {
  projectedAutoEndDate,
  planAutoEndWrites,
  planAutoEndReconcile,
  toStampedMap,
  type AutoEndGoalRow,
} from '../goal-auto-end';

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

describe('toStampedMap', () => {
  it('narrows a jsonb value to the ruleId -> date map, dropping non-string entries', () => {
    expect(toStampedMap({ r1: '2026-10-31', r2: 7, r3: null })).toEqual({ r1: '2026-10-31' });
  });

  it('returns an empty map for null, arrays and scalars', () => {
    expect(toStampedMap(null)).toEqual({});
    expect(toStampedMap(['2026-10-31'])).toEqual({});
    expect(toStampedMap('2026-10-31')).toEqual({});
  });
});

/**
 * 97.3 (widened) — re-stamping used to fire on GOAL save only, so any input that moves the
 * projection WITHOUT a goal save left the stamp stale. The dangerous direction is stale-EARLY:
 * the stamp is a real `recurring_rules.end_date` and forecast-engine.ts:785 hard-skips a
 * transfer past it, while goal-linkage.ts (4b) can only ever stop a rule EARLIER, never resume
 * one. So a stamp that is too early starves the goal in the forecast and nothing rescues it.
 *
 * `planAutoEndReconcile` is the shared re-plan the two new trigger sites call: a linked rule
 * being saved in Budget Control, and freshly synced balances landing.
 */
describe('planAutoEndReconcile', () => {
  const stamped = { ...rule, end_date: '2026-10-31' };
  const enabledGoal = {
    ...goal,
    auto_end_contributions: true,
    auto_end_stamped_rules: { r1: '2026-10-31' },
  };
  const reconcile = (
    rules: typeof stamped[],
    accounts: typeof account[],
    goals: AutoEndGoalRow[] = [enabledGoal],
  ) => planAutoEndReconcile({ goals, rules, accounts, today });

  it('issues nothing at steady state — the guard that keeps the effect from looping', () => {
    const plan = reconcile([stamped], [account]);
    expect(plan.ruleWrites).toEqual([]);
    expect(plan.goalWrites).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('pushes a stale-EARLY stamp later when the linked rule amount was cut', () => {
    // $250/mo needs 4 contributions to cover the $1,000 gap, not 2.
    const cut = { ...stamped, amount: 250 };
    const plan = reconcile([cut], [account]);
    expect(plan.ruleWrites).toEqual([{ id: 'r1', end_date: '2026-12-31' }]);
    expect(plan.goalWrites).toEqual([{ id: 'g1', auto_end_stamped_rules: { r1: '2026-12-31' } }]);
  });

  it('pulls the stamp earlier when the linked rule amount was raised', () => {
    const raised = { ...stamped, amount: 1000 };
    const plan = reconcile([raised], [account]);
    expect(plan.ruleWrites).toEqual([{ id: 'r1', end_date: '2026-09-30' }]);
    expect(plan.goalWrites).toEqual([{ id: 'g1', auto_end_stamped_rules: { r1: '2026-09-30' } }]);
  });

  it('re-stamps when a synced balance lands below the projection', () => {
    // The balance-sync trigger: $18,000 leaves a $2,000 gap -> 4 months, not 2.
    const plan = reconcile([stamped], [{ ...account, balance: 18000 }]);
    expect(plan.ruleWrites).toEqual([{ id: 'r1', end_date: '2026-12-31' }]);
  });

  it('leaves goals with the toggle OFF completely alone — reconcile never clears', () => {
    const off = { ...enabledGoal, auto_end_contributions: false };
    const plan = reconcile([stamped], [account], [off]);
    expect(plan.ruleWrites).toEqual([]);
    expect(plan.goalWrites).toEqual([]);
  });

  it('reports a hand-set end_date as a conflict instead of overwriting it', () => {
    const manual = { ...rule, end_date: '2027-06-30' };
    const plan = reconcile([manual], [account]);
    expect(plan.ruleWrites).toEqual([]);
    expect(plan.conflicts).toEqual([{ goalId: 'g1', ruleId: 'r1', end_date: '2027-06-30' }]);
  });

  it('skips goals with no id — a goal write needs one to target', () => {
    const noId = { ...enabledGoal, id: undefined };
    const plan = reconcile([{ ...stamped, amount: 250 }], [account], [noId]);
    expect(plan.ruleWrites).toEqual([]);
    expect(plan.goalWrites).toEqual([]);
  });
});
