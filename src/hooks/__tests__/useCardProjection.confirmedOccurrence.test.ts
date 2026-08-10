// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '../useCardProjection';
import { buildConfirmedOccurrences, type ConfirmedOccurrences } from '@/lib/confirmed-capture';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { Tables } from '@/integrations/supabase/types';

// §1B Stage 4A — regression for the session-121 finding. `useCardProjection` builds its OWN
// `forecastMonthEvents`, and `month0.chain.expenses` / `month0.endCash` come from it whenever the
// user has any credit card — which is what Dashboard's "Projected remaining" actually renders.
// Session 119 gated the copy in `useForecastEngineInputs` and missed this one, so a confirmed link
// moved no number on screen. These tests pin both halves: the gate fires here, and omitting the
// parameter is byte-identical to pre-Stage-4.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

const CHECKING = 'checking-1';
const CARD = 'card-1';
const LATE_BILL = 'bill-late';
const LATE_BILL_AMOUNT = 300;

const now = new Date();
const CURRENT_MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
// Cutoff pinned to the 1st, so the day the suite runs never changes which events land in month 0:
// the month-0 filter is `e.date > syncCutoffDate`, and a due day of 28 is always after it.
const SYNC_CUTOFF = `${CURRENT_MONTH}-01`;

function run(confirmedOccurrences?: ConfirmedOccurrences) {
  const accounts = [
    { id: CHECKING, name: 'TOTAL CHECKING', account_type: 'checking', balance: 5000, active: true },
    { id: CARD, name: 'Card', account_type: 'credit_card', balance: 6000, credit_limit: 20000, apr: 22, payment_due_day: 11, active: true, min_payment: 200, payment_preference: 'revolving' },
  ];
  const debts = [
    { id: CARD, name: 'Card', balance: 6000, apr: 22, min_payment: 200, target_payment: 200, credit_limit: 20000 },
  ];
  const rules = [
    { id: 'income-1', name: 'Paycheck', amount: 4500, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: CHECKING, active: true, category: 'Other' },
    { id: LATE_BILL, name: 'Late Bill', amount: LATE_BILL_AMOUNT, rule_type: 'expense', frequency: 'monthly', due_day: 28, payment_source: CHECKING, deposit_account: null, active: true, category: 'Bills' },
  ];
  const profile: Partial<Tables<'profiles'>> = { weekly_gross_income: 0.01 };

  return renderHook(() => useCardProjection({
    accounts, transactions: [], rules, debts, goals: [], carFunds: [], profile,
    debtPayoffOptions: { cashFloor: 1000 },
    payConfig: buildPayConfig(profile),
    scheduledEvents: generateScheduledEvents(rules as unknown as RuleRow[], accounts as unknown as AccountRow[], 36),
    pauseSavings: false,
    forecastFundingAccountId: CHECKING, debtStrategy: 'avalanche', persistedDebtFundingId: null,
    assumptions: DEFAULT_ASSUMPTIONS, syncCutoffDate: SYNC_CUTOFF, paymentPlans: [],
    confirmedOccurrences,
  } as unknown as UseCardProjectionParams)).result.current!;
}

const confirming = (ruleId: string, month: string) =>
  buildConfirmedOccurrences([{ status: 'linked_rule', rule_id: ruleId, occurrence_month: month }]);

describe('useCardProjection — §1B Stage 4A confirmed rule occurrences', () => {
  it('omitting confirmedOccurrences is identical to an empty set (pre-Stage-4 behaviour)', () => {
    expect(run().month0.chain.expenses).toBeCloseTo(run(new Set<string>()).month0.chain.expenses, 2);
  });

  it('a confirmed occurrence drops that bill from month-0 expenses and raises end cash by its amount', () => {
    const baseline = run();
    const confirmed = run(confirming(LATE_BILL, CURRENT_MONTH));

    expect(baseline.month0.chain.expenses).toBeCloseTo(LATE_BILL_AMOUNT, 2);
    expect(confirmed.month0.chain.expenses).toBeCloseTo(0, 2);
    // 4A raises projected cash — the direction the module comment flags as the unsafe one, so the
    // magnitude is pinned, not just the sign.
    expect(confirmed.month0.chain.cashPreDebt - baseline.month0.chain.cashPreDebt)
      .toBeCloseTo(LATE_BILL_AMOUNT, 2);
  });

  it('a confirmation in a DIFFERENT month suppresses nothing — confirming one month must not pay another', () => {
    const otherMonth = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    expect(run(confirming(LATE_BILL, otherMonth)).month0.chain.expenses)
      .toBeCloseTo(run().month0.chain.expenses, 2);
  });

  it('a confirmation for a DIFFERENT rule suppresses nothing', () => {
    expect(run(confirming('some-other-rule', CURRENT_MONTH)).month0.chain.expenses)
      .toBeCloseTo(run().month0.chain.expenses, 2);
  });
});
