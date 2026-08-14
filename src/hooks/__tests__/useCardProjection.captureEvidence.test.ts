// @vitest-environment jsdom
//
// §1A Stage C part 2 — the month-0 car gates consult settled transactions.
//
// Before Stage C these gates answered "is this charge already in the stored balance?" purely from
// dates: a due date more than SETTLEMENT_LAG_DAYS behind the sync cutoff was ASSUMED settled and
// the charge was dropped from month 0. That is a guess, and it is wrong in the expensive direction
// for anyone whose loan simply has not been debited yet.
//
// The three cases below are the whole contract:
//   - no transactions        → byte-identical to the old behavior (the number-neutrality guard)
//   - covered but unmatched  → charge STAYS in month 0, overriding the date heuristic  ← moves a number
//   - matched                → charge is dropped, now on evidence rather than arithmetic
//
// Dates are pinned to a cutoff late in the CURRENT month with the charge due on the 1st, rather
// than to "today", so the heuristic's verdict is the same whether the suite runs on the 2nd or the
// 30th. A test whose baseline depends on the day it executes would pass all month and then fail.

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import { getTotalCarLoanMonthly } from '@/lib/vehicle-loan-engine';
import type { MatchableTransaction } from '@/lib/transaction-matching';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { CarFund } from '@/lib/types';
import type { Tables } from '@/integrations/supabase/types';

const CHECKING_ID = 'checking-1';
const CARD_ID = 'card-1';
/** Deliberately NOT the funding account — proves `loan_payment_account` is the id consulted. */
const LOAN_ACCT_ID = 'loan-acct-1';
const INSURANCE = 150;

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

const now = new Date();
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Both the loan payment and the premium are due on the 1st of the current month. */
const DUE_DATE = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
/**
 * Late enough in the month that the DATE HEURISTIC alone calls the 1st "captured" (1 < 28 − 3),
 * which is what makes the baseline below a real drop rather than a no-op.
 */
const SYNC_CUTOFF = ymd(new Date(now.getFullYear(), now.getMonth(), 28));

const CAR_FUND = {
  id: 'car-1', vehicle_name: 'Test Car', phase: 'loan',
  target_price: 0, tax_fees: 0, down_payment_goal: 0, current_saved: 0, gift_contribution: 0,
  loan_amount: 20000, expected_apr: 6, loan_term_months: 60,
  loan_start_date: DUE_DATE, payment_start_date: DUE_DATE, interest_start_date: DUE_DATE,
  actual_monthly_payment: 0, monthly_insurance: INSURANCE,
  linked_account: null, linked_rule_id: null, loan_payment_account: LOAN_ACCT_ID,
  insurance_start_date: null, planned_purchase_date: null,
  lump_sum_payments: [],
};

/** The exact figure the gate decides whether to charge — the same call the production gate makes. */
const LOAN_PAYMENT = getTotalCarLoanMonthly([CAR_FUND as unknown as CarFund]);

let txnSeq = 0;
function txn(over: Partial<MatchableTransaction>): MatchableTransaction {
  return { id: `t${txnSeq++}`, account_id: LOAN_ACCT_ID, amount: 0, date: DUE_DATE, pending: false, ...over };
}

/**
 * Settled rows spanning the whole ±DATE_WINDOW_DAYS (5) match window, both ends — what
 * `hasCoverage` requires before an ABSENT match is allowed to mean anything. Amounts are junk
 * values far from either charge so they cannot accidentally match one.
 */
function coverageRows(): MatchableTransaction[] {
  const shift = (days: number) => ymd(new Date(now.getFullYear(), now.getMonth(), 1 + days));
  return [
    txn({ date: shift(-6), amount: 12.34 }),
    txn({ date: shift(6), amount: 56.78 }),
  ];
}

function render(syncedTransactions?: readonly MatchableTransaction[]) {
  const accounts = [
    { id: CHECKING_ID, name: 'Checking', account_type: 'checking', balance: 5000, active: true },
    { id: CARD_ID, name: 'Card', account_type: 'credit_card', balance: 500, credit_limit: 15000, apr: 20, payment_due_day: 1, active: true, min_payment: 25, payment_preference: 'statement' },
  ];
  const debts = [
    { id: CARD_ID, name: 'Card', balance: 500, apr: 20, min_payment: 25, target_payment: 25, credit_limit: 15000 },
  ];
  const rules = [
    { id: 'income-1', name: 'Paycheck', amount: 4000, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: CHECKING_ID, active: true, category: 'Other' },
    { id: 'bill-1', name: 'Rent', amount: 1200, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: CHECKING_ID, deposit_account: null, active: true, category: 'Bills' },
  ];
  const profile: Partial<Tables<'profiles'>> = { weekly_gross_income: 0.01 };

  return renderHook(() => useCardProjection({
    accounts, transactions: [], rules, debts, goals: [], carFunds: [CAR_FUND], profile,
    debtPayoffOptions: { cashFloor: 1000 },
    payConfig: buildPayConfig(profile),
    scheduledEvents: generateScheduledEvents(rules as unknown as RuleRow[], accounts as unknown as AccountRow[], 36),
    pauseSavings: false,
    forecastFundingAccountId: CHECKING_ID,
    debtStrategy: 'avalanche',
    persistedDebtFundingId: null,
    assumptions: DEFAULT_ASSUMPTIONS,
    syncCutoffDate: SYNC_CUTOFF,
    paymentPlans: [],
    syncedTransactions,
  } as unknown as UseCardProjectionParams)).result.current!;
}

describe('useCardProjection — §1A Stage C capture evidence', () => {
  it('the fixture is set up so the date heuristic alone DROPS both charges', () => {
    // Guard on the guard. Every assertion below is "different from this baseline", so if the
    // heuristic ever stopped dropping these the other tests would pass for the wrong reason.
    expect(LOAN_PAYMENT).toBeGreaterThan(0);
    const r = render(undefined);
    expect(r.month0.chain.carLoanPayment).toBe(0);
    expect(r.month0.vehicleInsurance).toBe(0);
  });

  it('no synced transactions ⇒ identical to pre-Stage-C', () => {
    // The number-neutrality guarantee that let part 2 ship: an empty array must behave exactly
    // like the absent one, since that is every user whose backfill has not landed.
    expect(render([]).month0).toEqual(render(undefined).month0);
  });

  it('rows on a DIFFERENT account leave both gates on the heuristic', () => {
    // Coverage is per-account. Transactions on the funding account say nothing about a loan
    // debited from `loan_payment_account`, and must not be read as if they did.
    const elsewhere = coverageRows().map(t => ({ ...t, account_id: CHECKING_ID }));
    expect(render(elsewhere).month0).toEqual(render(undefined).month0);
  });

  describe('covered but unmatched — the charge has genuinely not hit', () => {
    it('keeps the car loan payment in month 0, overriding the date heuristic', () => {
      const r = render(coverageRows());
      expect(r.month0.chain.carLoanPayment).toBeCloseTo(LOAN_PAYMENT, 2);
    });

    it('keeps the insurance premium in month 0', () => {
      expect(render(coverageRows()).month0.vehicleInsurance).toBe(INSURANCE);
    });
  });

  describe('matched — a settled transaction is the fact the heuristic approximated', () => {
    it('drops the car loan payment when its debit is on file', () => {
      const r = render([...coverageRows(), txn({ amount: LOAN_PAYMENT })]);
      expect(r.month0.chain.carLoanPayment).toBe(0);
      // The premium has no matching debit, so it is covered-and-unmatched and stays. The two
      // charges share a due date and an account; only the amount separates them.
      expect(r.month0.vehicleInsurance).toBe(INSURANCE);
    });

    it('drops the insurance premium when its debit is on file', () => {
      const r = render([...coverageRows(), txn({ amount: INSURANCE })]);
      expect(r.month0.vehicleInsurance).toBe(0);
      expect(r.month0.chain.carLoanPayment).toBeCloseTo(LOAN_PAYMENT, 2);
    });

    it('honours a match even with no coverage, and matches a few days off the due date', () => {
      // Coverage demands the whole window observed, so a real match can land just outside it — a
      // transaction that exists outranks a conservatism about window completeness.
      const late = ymd(new Date(now.getFullYear(), now.getMonth(), 4));
      expect(render([txn({ amount: LOAN_PAYMENT, date: late })]).month0.chain.carLoanPayment).toBe(0);
    });
  });

  it('a LIVE sync landing the debit updates the projection in place', () => {
    // The gates above read `syncedTransactions`, so the memo must recompute when a refetch hands
    // it a new array — every other test here mounts a fresh hook and would never catch the memo
    // going stale. This is the render-level path a real Plaid sync takes: same mounted hook, new
    // transactions prop, and the settled loan debit must drop out of month 0 without a remount.
    const stable = {
      accounts: [
        { id: CHECKING_ID, name: 'Checking', account_type: 'checking', balance: 5000, active: true },
        { id: CARD_ID, name: 'Card', account_type: 'credit_card', balance: 500, credit_limit: 15000, apr: 20, payment_due_day: 1, active: true, min_payment: 25, payment_preference: 'statement' },
      ],
      transactions: [], rules: [
        { id: 'income-1', name: 'Paycheck', amount: 4000, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: CHECKING_ID, active: true, category: 'Other' },
        { id: 'bill-1', name: 'Rent', amount: 1200, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: CHECKING_ID, deposit_account: null, active: true, category: 'Bills' },
      ],
      debts: [
        { id: CARD_ID, name: 'Card', balance: 500, apr: 20, min_payment: 25, target_payment: 25, credit_limit: 15000 },
      ],
      goals: [], carFunds: [CAR_FUND],
      profile: { weekly_gross_income: 0.01 } as Partial<Tables<'profiles'>>,
      debtPayoffOptions: { cashFloor: 1000 },
      payConfig: buildPayConfig({ weekly_gross_income: 0.01 }),
      pauseSavings: false,
      forecastFundingAccountId: CHECKING_ID,
      debtStrategy: 'avalanche',
      persistedDebtFundingId: null,
      assumptions: DEFAULT_ASSUMPTIONS,
      syncCutoffDate: SYNC_CUTOFF,
      paymentPlans: [],
    };
    const scheduledEvents = generateScheduledEvents(
      stable.rules as unknown as RuleRow[], stable.accounts as unknown as AccountRow[], 36,
    );
    const hook = renderHook(
      ({ synced }: { synced: readonly MatchableTransaction[] }) =>
        useCardProjection({ ...stable, scheduledEvents, syncedTransactions: synced } as unknown as UseCardProjectionParams),
      { initialProps: { synced: coverageRows() } },
    );
    expect(hook.result.current!.month0.chain.carLoanPayment).toBeCloseTo(LOAN_PAYMENT, 2);

    hook.rerender({ synced: [...coverageRows(), txn({ amount: LOAN_PAYMENT })] });
    expect(hook.result.current!.month0.chain.carLoanPayment).toBe(0);
  });

  it('a pending debit is not evidence — the charge stays in month 0', () => {
    // `balances.current` excludes pending debits, so a posted-but-unsettled payment is precisely
    // what must NOT be assumed gone. Pending rows also must not stretch the observed coverage range.
    const r = render([...coverageRows(), txn({ amount: LOAN_PAYMENT, pending: true })]);
    expect(r.month0.chain.carLoanPayment).toBeCloseTo(LOAN_PAYMENT, 2);
  });
});
