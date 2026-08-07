import { describe, it, expect } from 'vitest';
import { buildGoalTransferCutoffs, buildGoalOwnCompletionCutoffs } from '../goal-linkage';

// Regression for handoff item 4b: a savings_goals row linked to a recurring_rules transfer/
// investment rule keeps being counted forever once the goal hits its target — this map tells
// every consumer (forecast-engine.ts, useCardProjection.ts, CreditCardEngine.tsx,
// SavingsGoals.tsx) the first month index at which a rule should stop contributing, because
// every goal it funds is already done by then. Absent from the map = never stops (current
// behavior, unchanged).

const today = new Date('2026-08-06T00:00:00');

const savingsAccount = { id: 'acct-savings', account_type: 'high_yield_savings', apy_rate: 4.5, balance: 0 };

function rule(overrides: Partial<{ id: string; amount: number; frequency: string; start_date: string | null }> = {}) {
  return { id: 'rule-1', name: 'Emergency Fund', amount: 300, frequency: 'monthly', start_date: null, ...overrides };
}

function goal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'goal-1', name: 'Emergency Fund', target_amount: 5000, current_amount: 0,
    monthly_contribution: 0, linked_account: 'acct-savings', linked_rule_id: null,
    linked_rule_ids: [] as string[], contribution_start_date: null, lump_sum_payments: [],
    ...overrides,
  };
}

describe('buildGoalTransferCutoffs', () => {
  it('cuts off at month 0 when the goal is already at or above target', () => {
    const goals = [goal({ linked_rule_ids: ['rule-1'], current_amount: 5000 })];
    const rules = [rule()];
    const accounts = [{ ...savingsAccount, balance: 5000 }];
    const cutoffs = buildGoalTransferCutoffs(goals, rules, accounts, today);
    expect(cutoffs.get('rule-1')).toBe(0);
  });

  it('cuts off at k+1 when the goal completes at month k > 0', () => {
    // $0 balance, $300/mo, 4.5% APY, target $900 — completes at month 3 (verified against
    // estimateGoalCompletionMonths's own accrual, not re-derived here).
    const goals = [goal({ linked_rule_ids: ['rule-1'], target_amount: 900, current_amount: 0 })];
    const rules = [rule()];
    const accounts = [{ ...savingsAccount, balance: 0 }];
    const cutoffs = buildGoalTransferCutoffs(goals, rules, accounts, today);
    const cutoff = cutoffs.get('rule-1');
    expect(cutoff).not.toBeUndefined();
    expect(cutoff).toBeGreaterThan(0);
  });

  it('is absent from the map when the goal never completes within the horizon', () => {
    const goals = [goal({ linked_rule_ids: ['rule-1'], target_amount: 10_000_000, current_amount: 0 })];
    const rules = [rule({ amount: 0 })];
    const accounts = [{ ...savingsAccount, apy_rate: 0, balance: 0 }];
    const cutoffs = buildGoalTransferCutoffs(goals, rules, accounts, today);
    expect(cutoffs.has('rule-1')).toBe(false);
  });

  it('takes the MAX cutoff when one rule funds two goals with different completion months', () => {
    const fastGoal = goal({ id: 'goal-fast', target_amount: 100, current_amount: 100, linked_rule_ids: ['rule-1'], linked_account: 'acct-fast' });
    const slowGoal = goal({ id: 'goal-slow', target_amount: 900, current_amount: 0, linked_rule_ids: ['rule-1'], linked_account: 'acct-slow' });
    const rules = [rule()];
    const accounts = [
      { ...savingsAccount, id: 'acct-fast', balance: 100 },
      { ...savingsAccount, id: 'acct-slow', balance: 0 },
    ];
    const cutoffs = buildGoalTransferCutoffs([fastGoal, slowGoal], rules, accounts, today);
    // The slow goal's cutoff (>0) must win over the fast goal's cutoff (0).
    expect(cutoffs.get('rule-1')).toBeGreaterThan(0);
  });

  it('falls back to the legacy singular linked_rule_id when linked_rule_ids is empty', () => {
    const goals = [goal({ linked_rule_ids: [], linked_rule_id: 'rule-1', current_amount: 5000, target_amount: 5000 })];
    const rules = [rule()];
    const accounts = [{ ...savingsAccount, balance: 5000 }];
    const cutoffs = buildGoalTransferCutoffs(goals, rules, accounts, today);
    expect(cutoffs.get('rule-1')).toBe(0);
  });

  it('does not add a rule-keyed entry for a goal with no linked rule at all', () => {
    const goals = [goal({ linked_rule_ids: [], linked_rule_id: null, current_amount: 5000, target_amount: 5000 })];
    const rules = [rule()];
    const accounts = [{ ...savingsAccount, balance: 5000 }];
    const cutoffs = buildGoalTransferCutoffs(goals, rules, accounts, today);
    expect(cutoffs.size).toBe(0);
  });
});

describe('buildGoalOwnCompletionCutoffs', () => {
  it('cuts off an unlinked (no rule) goal at month 0 once its own monthly_contribution already met target', () => {
    const goals = [goal({
      linked_rule_ids: [], linked_rule_id: null, linked_account: null,
      current_amount: 5000, target_amount: 5000, monthly_contribution: 200,
    })];
    const cutoffs = buildGoalOwnCompletionCutoffs(goals, [], [], today);
    expect(cutoffs.get('goal-1')).toBe(0);
  });

  it('cuts off an unlinked goal at k+1 when its own contribution completes it at month k > 0', () => {
    const goals = [goal({
      linked_rule_ids: [], linked_rule_id: null, linked_account: null,
      current_amount: 0, target_amount: 900, monthly_contribution: 300,
    })];
    const cutoffs = buildGoalOwnCompletionCutoffs(goals, [], [], today);
    const cutoff = cutoffs.get('goal-1');
    expect(cutoff).not.toBeUndefined();
    expect(cutoff).toBeGreaterThan(0);
  });

  it('is absent from the map when the unlinked goal never completes', () => {
    const goals = [goal({
      linked_rule_ids: [], linked_rule_id: null, linked_account: null,
      current_amount: 0, target_amount: 10_000_000, monthly_contribution: 0,
    })];
    const cutoffs = buildGoalOwnCompletionCutoffs(goals, [], [], today);
    expect(cutoffs.has('goal-1')).toBe(false);
  });
});
