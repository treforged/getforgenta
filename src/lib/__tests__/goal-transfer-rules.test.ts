import { describe, it, expect } from 'vitest';
import { buildGoalTransferRules, buildDatedGoalTransferRules, isGoalTransferRuleId, GOAL_RULE_PREFIX } from '../goal-transfer-rules';
import { mergeWithGeneratedTransactionsForHorizon, type EnrichedTransaction } from '../pay-schedule';
import type { RuleRow, AccountRow } from '@/hooks/useSupabaseData';

// Tre: transfer RULES and anything generated from a GOAL must show in Transactions.
//
// Transfer rules already did — `pay-schedule.ts` marks them `isTransfer` and Transactions renders
// the destination. A savings goal's `monthly_contribution` is NOT a `recurring_rules` row, so
// nothing generated it on that page: Budget Control listed it, the forecast priced the cash leaving
// checking, and the ledger showed nothing at all.
//
// The synthesis was inline in `useBudgetMonthTotals` and is now shared, because a second copy of
// the precedence filter below is a double-count waiting to happen.

function goal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'goal-1',
    name: 'Emergency Fund',
    monthly_contribution: 300,
    contribution_start_date: null,
    linked_account: 'acct-savings',
    linked_rule_id: null,
    linked_rule_ids: [] as string[],
    ...overrides,
  };
}

describe('buildGoalTransferRules', () => {
  it('synthesises a transfer rule for a goal that no recurring rule funds', () => {
    const [r] = buildGoalTransferRules([goal()], []);
    expect(r.id).toBe('goal:goal-1');
    expect(r.name).toBe('Emergency Fund Contribution');
    expect(r.amount).toBe(300);
    expect(r.rule_type).toBe('transfer');
    expect(r.deposit_account).toBe('acct-savings');
    expect(r.active).toBe(true);
  });

  // The double-count guard. A goal funded by a real rule is ALREADY on screen as that rule, so
  // synthesising a second row would double both the total and the money shown.
  it('skips a goal already funded by a real rule, via linked_rule_ids', () => {
    expect(buildGoalTransferRules([goal({ linked_rule_ids: ['rule-1'] })], [{ id: 'rule-1' }])).toHaveLength(0);
  });

  it('skips a goal already funded by a real rule, via the legacy single linked_rule_id', () => {
    expect(buildGoalTransferRules([goal({ linked_rule_id: 'rule-1' })], [{ id: 'rule-1' }])).toHaveLength(0);
  });

  // A link pointing at a rule that no longer exists must NOT silence the contribution — the money
  // still leaves, and a dangling id is exactly when the user most needs to see it.
  it('still synthesises when the linked rule no longer exists', () => {
    expect(buildGoalTransferRules([goal({ linked_rule_ids: ['deleted-rule'] })], [{ id: 'rule-1' }])).toHaveLength(1);
  });

  it('skips a goal contributing nothing', () => {
    expect(buildGoalTransferRules([goal({ monthly_contribution: 0 })], [])).toHaveLength(0);
    expect(buildGoalTransferRules([goal({ monthly_contribution: null })], [])).toHaveLength(0);
  });

  // Budget Control prints "no day of the month" for these on purpose. Only a caller that needs a
  // ledger DATE derives one, and it derives it from a date the user actually set.
  it('leaves due_day null so no caller inherits an invented day', () => {
    expect(buildGoalTransferRules([goal()], [])[0].due_day).toBeNull();
  });

  it('carries contribution_start_date through as start_date', () => {
    expect(buildGoalTransferRules([goal({ contribution_start_date: '2026-03-14' })], [])[0].start_date)
      .toBe('2026-03-14');
  });
});

describe('isGoalTransferRuleId', () => {
  it('tells a synthetic goal id from a real rule id', () => {
    expect(isGoalTransferRuleId(`${GOAL_RULE_PREFIX}abc`)).toBe(true);
    expect(isGoalTransferRuleId('abc')).toBe(false);
    expect(isGoalTransferRuleId(null)).toBe(false);
    expect(isGoalTransferRuleId(undefined)).toBe(false);
  });
});

// ── THE ACCEPTANCE ──────────────────────────────────────────────────────────────────────────────
// The unit tests above prove the shape. This proves the ASK: that a goal contribution actually
// reaches the stream the Transactions page renders. It runs the page's own merge, with the same
// due_day derivation the page applies, so a wiring change that drops the goal rules fails here.
describe('goal contributions reach the Transactions stream', () => {
  const accounts = [
    { id: 'acct-checking', name: 'Checking', account_type: 'checking', active: true },
    { id: 'acct-savings', name: 'Savings', account_type: 'high_yield_savings', active: true },
  ] as unknown as AccountRow[];

  // The page's OWN derivation, imported rather than copied. A check aimed at a copy passes while
  // the shipped code is wrong, which is why this is not re-implemented here.
  const asRuleRows = (goals: Record<string, unknown>[], rules: { id: string }[]): RuleRow[] =>
    buildDatedGoalTransferRules(goals, rules) as unknown as RuleRow[];

  it('generates an occurrence the ledger can show, marked as a transfer to the goal account', () => {
    const merged = mergeWithGeneratedTransactionsForHorizon(
      [] as EnrichedTransaction[],
      asRuleRows([goal()], []),
      accounts,
      3,
    );
    const goalRows = merged.filter(t => t.ruleId === 'goal:goal-1');

    expect(goalRows.length).toBeGreaterThan(0);
    const row = goalRows[0];
    expect(row.note).toBe('Emergency Fund Contribution');
    expect(row.amount).toBe(300);
    expect(row.isGenerated).toBe(true);
    // Without this the row reads as an ordinary expense and the destination cannot be rendered —
    // a person cannot tell money moved to savings from money spent.
    expect(row.isTransfer).toBe(true);
    expect(row.transferDestination).toBe('acct-savings');
    expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('adds nothing when the goal is already funded by a real rule', () => {
    const merged = mergeWithGeneratedTransactionsForHorizon(
      [] as EnrichedTransaction[],
      asRuleRows([goal({ linked_rule_ids: ['rule-1'] })], [{ id: 'rule-1' }]),
      accounts,
      3,
    );
    expect(merged.filter(t => t.ruleId === 'goal:goal-1')).toHaveLength(0);
  });
});
