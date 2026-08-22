// @vitest-environment jsdom
//
// REGRESSION for 6d39ea51 — the save-up reserve must be sized on a PINNED STATEMENT, not on the
// card's contract minimum.
//
// `computeFloorProtection` banks next month's reserve out of `ccMinByMonth`, the caller's model of
// what unavoidably leaves for debt each month. There were two callers and they disagreed:
// forecast-engine.ts added the manual-ISB pin term, this hook did not. This hook is what produces
// the live /debt recommendation, so a pinned card's next-month obligation was modelled at its
// contract minimum instead of its statement balance. Real case 2026-08-22: Prime Visa's September
// obligation modelled at $559.40 against a $2,845.14 statement, freeing ~$2,286 that the panel then
// recommended paying to a 16.6% card while the 27.49% card silently lost its grace period.
//
// The pin SUPERSEDES the contract minimum (revolvingMinDue is ALREADY that card's contribution, so
// adding would double-count) and is capped by the card's own modelled revolving balance.
//
// What is asserted here is the MECHANISM, not a number that happens to fall out of it:
//   1. the pin exists and lands in month 1, so the test cannot silently stop covering this path;
//   2. with the pin, month 0's cap collapses to month 0's OWN combined contract minimum —
//      recomputed in the test from the hook's own sim via the exported `revolvingMinDue`, i.e. the
//      `Math.max(mCcMin, availableForDebt)` clamp with nothing left available;
//   3. it is the STATEMENT AMOUNT that drives it, not the mere presence of a pin: an identical run
//      whose statement equals the contract minimum leaves the cap uncapped, which is arithmetically
//      the pre-fix behaviour.
//
// Synthetic on purpose — no gitignored fixture, so this runs in CI.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '../useCardProjection';
import { revolvingMinDue } from '@/lib/credit-card-engine';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import type { CardProjectionResult } from '@/lib/debt-model-types';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { Tables } from '@/integrations/supabase/types';

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

const CHECKING_ID = 'checking-1';
const PINNED_ID = 'card-pinned';
const PLAIN_ID = 'card-plain';
const PINNED_MIN = 559.4;
const PLAIN_MIN = 150;
const STATEMENT = 2845.14;

/** Clock pinned: `deriveIsbPins` branches on `dueDay >= now.getDate()`, so on the ambient clock this
 *  test would exercise a month-0 pin for a week of every month and a month-1 pin for the rest. Day
 *  20 puts the pinned card's day-7 statement in month 1 — the case the reserve exists for, because
 *  month 1's obligation is what month 0 has to bank cash against. */
const NOW = new Date(2026, 8, 20);

function run(statementBalance: number | null): CardProjectionResult {
  const accounts = [
    { id: CHECKING_ID, name: 'Checking', account_type: 'checking', balance: 4200, active: true },
    {
      id: PINNED_ID, name: 'Prime Visa', account_type: 'credit_card', balance: 8000,
      credit_limit: 15000, apr: 20, payment_due_day: 7, active: true, min_payment: PINNED_MIN,
      payment_preference: 'statement', statement_balance: statementBalance,
    },
    {
      id: PLAIN_ID, name: 'Discover', account_type: 'credit_card', balance: 4000,
      credit_limit: 10000, apr: 27.49, payment_due_day: 1, active: true, min_payment: PLAIN_MIN,
    },
  ];
  const debts = [
    { id: PINNED_ID, name: 'Prime Visa', balance: 8000, apr: 20, min_payment: PINNED_MIN, target_payment: 600, credit_limit: 15000 },
    { id: PLAIN_ID, name: 'Discover', balance: 4000, apr: 27.49, min_payment: PLAIN_MIN, target_payment: 200, credit_limit: 10000 },
  ];
  const rules = [
    { id: 'income-1', name: 'Paycheck', amount: 4000, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: CHECKING_ID, active: true, category: 'Other' },
    { id: 'bill-1', name: 'Rent', amount: 2600, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: CHECKING_ID, deposit_account: null, active: true, category: 'Bills' },
  ];
  const transactions: Partial<Tables<'transactions'>>[] = [];
  const carFunds: Partial<Tables<'car_funds'>>[] = [];
  const goals: Partial<Tables<'savings_goals'>>[] = [];
  // cash_floor_is_manual is load-bearing: without it auto-cash-floor folds card minimums into the
  // floor itself, so the pin would move floorByMonth as well and the delta between the runs would
  // no longer be attributable to the one term under test.
  const profile: Partial<Tables<'profiles'>> = { weekly_gross_income: 0.01, cash_floor_is_manual: true };

  const payConfig = buildPayConfig(profile);
  const scheduledEvents = generateScheduledEvents(rules as unknown as RuleRow[], accounts as unknown as AccountRow[], 36);
  const syncCutoffDate = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-01`;

  const { result } = renderHook(() => useCardProjection({
    accounts, transactions, rules, debts, goals, carFunds, profile,
    debtPayoffOptions: { cashFloor: 2500 },
    payConfig,
    scheduledEvents,
    pauseSavings: false,
    forecastFundingAccountId: CHECKING_ID,
    debtStrategy: 'avalanche',
    persistedDebtFundingId: null,
    assumptions: DEFAULT_ASSUMPTIONS,
    syncCutoffDate,
    paymentPlans: [],
  } as unknown as UseCardProjectionParams));

  return result.current!;
}

/** Month 0's own combined contract minimum — `ccMinByMonth[0]`, rebuilt term for term from the
 *  hook's own sim so the expectation tracks the engine rather than a copied literal. This is the
 *  floor of `Math.max(mCcMin, availableForDebt)`: the cap can never sit below it, and sits exactly
 *  on it when the reserve has consumed everything else. */
const month0ContractMinimum = (r: CardProjectionResult): number =>
  r.simCards.reduce((s, c) => {
    if (c.m0MinSettled) return s;
    const revBal = r.monthlyRevolvingBalances.get(c.id)?.[0] ?? 0;
    return s + revolvingMinDue(c, revBal);
  }, 0);

describe('useCardProjection — the save-up reserve is sized on the pinned statement', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('caps month 0 at its own contract minimum when next month owes a pinned statement', () => {
    const pinned = run(STATEMENT);

    // Fail loudly rather than quietly stop covering the ISB path.
    expect(pinned.manualIsbPins ?? []).toHaveLength(1);
    expect(pinned.manualIsbPins![0].month).toBe(1);
    expect(pinned.manualIsbPins![0].amount).toBeCloseTo(STATEMENT, 2);
    expect(pinned.manualIsbPins![0].minPayment).toBeCloseTo(PINNED_MIN, 2);

    // The statement is the mandatory outflow the reserve is banked against, and it is far above the
    // contract minimum the pre-fix model used — otherwise there is nothing here to regress.
    expect(STATEMENT).toBeGreaterThan(PINNED_MIN);

    const cap = pinned.maxDebtPaymentByMonth[0];
    expect(cap).toBeLessThan(Infinity);
    expect(pinned.saveUpMonths.has(0)).toBe(true);
    // Everything month 0 had is now banked for the statement: the cap has collapsed onto its own
    // combined contract minimum, the one term `computeFloorProtection` refuses to go below.
    expect(cap).toBeCloseTo(month0ContractMinimum(pinned), 2);
  });

  it('leaves month 0 uncapped when nothing is pinned (control)', () => {
    const control = run(null);

    expect(control.manualIsbPins ?? []).toHaveLength(0);
    expect(control.maxDebtPaymentByMonth[0]).toBe(Infinity);
    expect(control.saveUpMonths.has(0)).toBe(false);
  });

  it('tracks the statement AMOUNT, not the mere presence of a pin', () => {
    // A pinned statement equal to the contract minimum adds nothing over `revolvingMinDue`, so
    // `Math.max` leaves ccMinByMonth[1] untouched and month 0 stays uncapped. This run is the
    // arithmetic shape of the bug: the pinned card's next-month obligation modelled at its minimum.
    const atMinimum = run(PINNED_MIN);

    expect(atMinimum.manualIsbPins ?? []).toHaveLength(1);
    expect(atMinimum.manualIsbPins![0].amount).toBeCloseTo(PINNED_MIN, 2);
    expect(atMinimum.maxDebtPaymentByMonth[0]).toBe(Infinity);
    expect(atMinimum.saveUpMonths.has(0)).toBe(false);

    // And the same inputs with the real statement DO cap it — the two runs differ in one number.
    expect(run(STATEMENT).maxDebtPaymentByMonth[0]).toBeLessThan(Infinity);
  });
});
