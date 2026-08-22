// @vitest-environment jsdom
//
// A.1 guard: when a pinned interest-saving statement balance is what actually sized the save-up
// reserve, the panel must SAY SO. Before this, describeBreach only knew about car down payments,
// cycling excess, and the biggest one-time transaction that month, so a $2,443 reserve held for a
// September credit-card statement was reported to the user as "$200 Pay sibling to watch dogs" —
// a real expense with no causal link to the reserve at all.
//
// floor-protection.reason.test.ts proves computeFloorProtection PREFERS the label. This proves
// this hook actually BUILDS and PASSES it, which is the half a floor-protection-only fix would
// typecheck straight past while changing nothing on screen.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { Tables } from '@/integrations/supabase/types';

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

const PINNED_ID = 'card-pinned';
const PLAIN_ID = 'card-plain';
const CHECKING_ID = 'checking-1';

/** Clock pinned: deriveIsbPins branches on `dueDay >= now.getDate()`, so an unpinned clock makes
 * this test green for roughly 23 days a month and silently wrong for the rest. Day 20 puts the
 * pinned card's day-7 statement in month 1, which is the case the reserve exists for. */
const NOW = new Date(2026, 8, 20);

function run(statementBalance: number | null, plainStatementBalance: number | null = null) {
  const accounts = [
    { id: CHECKING_ID, name: 'Checking', account_type: 'checking', balance: 8000, active: true },
    {
      id: PINNED_ID, name: 'Prime Visa', account_type: 'credit_card', balance: 8000,
      credit_limit: 15000, apr: 20, payment_due_day: 7, active: true, min_payment: 559.4,
      payment_preference: 'statement', statement_balance: statementBalance,
    },
    {
      id: PLAIN_ID, name: 'Discover', account_type: 'credit_card', balance: 4000,
      credit_limit: 10000, apr: 27.49, payment_due_day: 1, active: true, min_payment: 150,
      ...(plainStatementBalance != null
        ? { payment_preference: 'statement', statement_balance: plainStatementBalance }
        : {}),
    },
  ];
  const debts = [
    { id: PINNED_ID, name: 'Prime Visa', balance: 8000, apr: 20, min_payment: 559.4, target_payment: 600, credit_limit: 15000 },
    { id: PLAIN_ID, name: 'Discover', balance: 4000, apr: 27.49, min_payment: 150, target_payment: 200, credit_limit: 10000 },
  ];
  const rules = [
    { id: 'income-1', name: 'Paycheck', amount: 4000, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: CHECKING_ID, active: true, category: 'Other' },
    { id: 'bill-1', name: 'Rent', amount: 2600, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: CHECKING_ID, deposit_account: null, active: true, category: 'Bills' },
  ];
  const transactions: Partial<Tables<'transactions'>>[] = [];
  const carFunds: Partial<Tables<'car_funds'>>[] = [];
  const goals: Partial<Tables<'savings_goals'>>[] = [];
  // cash_floor_is_manual is load-bearing: without it auto-cash-floor folds card minimums into the
  // floor, so the pin moves floorByMonth too and the treatment/control delta stops being
  // attributable to the one mechanism under test.
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

describe('useCardProjection — pinned statement names the save-up reason', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('names the pinned card and its statement instead of an unrelated expense', () => {
    const r = run(2845.14);

    // Fail loudly rather than silently stop covering the ISB path.
    expect(r.manualIsbPins!.length).toBeGreaterThanOrEqual(1);
    expect(r.saveUpMonths.has(0)).toBe(true);
    expect(r.month0.holdbackEvent).not.toBeNull();

    const eventName = r.month0.holdbackEvent!.eventName;
    expect(eventName).toContain('Prime Visa');
    expect(eventName).toContain('statement');
    expect(eventName).not.toBe('upcoming expense');
  });

  it('leaves the old behaviour alone when no statement is pinned (control)', () => {
    const r = run(null);
    expect(r.manualIsbPins ?? []).toHaveLength(0);
    const eventName = r.month0.holdbackEvent?.eventName ?? null;
    expect(eventName === null || !eventName.includes('statement')).toBe(true);
  });

  it('stays silent when the pin did not supersede the card contract minimum', () => {
    // $400 statement against a $559.40 contract minimum: ccMinByMonth takes the MAX of the two, so
    // the pin contributes exactly $0 to the reserve. Naming it would be the original bug one term
    // over — a $400 obligation taking credit for a reserve it did not size.
    const r = run(400);

    // The pin still EXISTS; what is asserted is that a no-op pin is not credited.
    expect(r.manualIsbPins!.length).toBeGreaterThanOrEqual(1);
    const eventName = r.month0.holdbackEvent?.eventName ?? null;
    expect(eventName === null || !eventName.includes('statement')).toBe(true);
  });

  it('names both statements when two land in the same month, largest first', () => {
    // Tre's real shape: two statement-pinned cards both landing in month 1. Attributing the whole
    // reserve to whichever card the Accounts page happens to sort first is not an answer.
    const r = run(2845.14, 900);

    expect(r.manualIsbPins!.length).toBe(2);
    const eventName = r.month0.holdbackEvent!.eventName;
    expect(eventName).toContain('Prime Visa');
    expect(eventName).toContain('Discover');
    // Largest contribution leads: $2,845.14 − $559.40 beats $900 − $150.
    expect(eventName.indexOf('Prime Visa')).toBeLessThan(eventName.indexOf('Discover'));
  });
});
