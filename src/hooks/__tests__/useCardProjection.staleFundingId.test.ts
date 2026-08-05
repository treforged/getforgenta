// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { Tables } from '@/integrations/supabase/types';

// Finding §2.8 (2026-08-05). `persistedDebtFundingId` comes from localStorage
// (`tre:debt:fundingAccount`), so it outlives the account it names — the account can be deleted or
// disconnected, and demo mode reads the same key and finds a real account's UUID.
//
// The engine used it raw. Every "is this expense paid from the funding account?" test then answered
// no, so EVERY cash expense rule was excluded: month-0 expenses read $0 and the cash floor collapsed
// to its base value, while the balance fell back to total liquid cash and looked perfectly fine.
// Observed live in the demo: a $55 Gas bill due in 7 days, and `chain.expenses` rendered nothing.
//
// An id that resolves to nothing must resolve to `null` (no exclusion), never to "exclude
// everything" — see `src/lib/funding-account.ts`.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

const CHECKING = 'checking-1';
const CASH = 'cash-1';
const CARD = 'card-1';
const SAVINGS = 'savings-1';
/** Shape of a real Supabase account id — the exact kind of value found in demo localStorage. */
const STALE_ID = '933cbc10-bceb-4c20-8227-4a02e6db728a';

const accounts = [
  { id: CHECKING, name: 'Chase Checking', account_type: 'checking', balance: 3000, active: true },
  { id: CASH, name: 'Cash', account_type: 'cash', balance: 500, active: true },
  { id: SAVINGS, name: 'Marcus HYS', account_type: 'high_yield_savings', balance: 5800, active: true, apr: 4.5 },
  { id: CARD, name: 'Card', account_type: 'credit_card', balance: 6000, credit_limit: 20000, apr: 22, payment_due_day: 11, active: true, min_payment: 200, payment_preference: 'revolving' },
];

const debts = [
  { id: CARD, name: 'Card', balance: 6000, apr: 22, min_payment: 200, target_payment: 200, credit_limit: 20000 },
];

// A bill on the LAST day of the month so it is always still ahead of the sync cutoff, whatever
// day the suite runs — month-0 expenses must include it.
const rules = [
  { id: 'income-1', name: 'Paycheck', amount: 4500, rule_type: 'income', frequency: 'monthly', due_day: 28, payment_source: null, deposit_account: CHECKING, active: true, category: 'Other' },
  { id: 'bill-1', name: 'Rent', amount: 1800, rule_type: 'expense', frequency: 'monthly', due_day: 28, payment_source: CHECKING, deposit_account: null, active: true, category: 'Bills' },
];

function run(persistedDebtFundingId: string | null) {
  const profile: Partial<Tables<'profiles'>> = { weekly_gross_income: 0.01 };
  const payConfig = buildPayConfig(profile);
  const scheduledEvents = generateScheduledEvents(rules as unknown as RuleRow[], accounts as unknown as AccountRow[], 36);
  const now = new Date();
  const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  return renderHook(() => useCardProjection({
    accounts, transactions: [], rules, debts, goals: [], carFunds: [], profile,
    debtPayoffOptions: { cashFloor: 1000 },
    payConfig, scheduledEvents, pauseSavings: false,
    forecastFundingAccountId: CHECKING, debtStrategy: 'avalanche', persistedDebtFundingId,
    assumptions: DEFAULT_ASSUMPTIONS, syncCutoffDate, paymentPlans: [],
  } as unknown as UseCardProjectionParams)).result.current!;
}

describe('useCardProjection — stale persisted funding account id (§2.8)', () => {
  it('counts month-0 bills when no id is persisted (control)', () => {
    expect(run(null).month0.chain.expenses).toBeGreaterThan(0);
  });

  it('a persisted id that names no account does not silently drop every cash expense', () => {
    const stale = run(STALE_ID);
    const control = run(null);
    expect(stale.month0.chain.expenses).toBeGreaterThan(0);
    expect(stale.month0.chain.expenses).toBeCloseTo(control.month0.chain.expenses, 2);
  });

  it('a persisted id naming a non-fundable account (savings) is rejected the same way', () => {
    const viaSavings = run(SAVINGS);
    const control = run(null);
    expect(viaSavings.month0.chain.expenses).toBeCloseTo(control.month0.chain.expenses, 2);
  });

  it('the whole month-0 chain is unaffected by a stale id, not just the expense term', () => {
    const stale = run(STALE_ID);
    const control = run(null);
    expect(stale.month0.chain).toEqual(control.month0.chain);
    expect(stale.month0.safeToPayTotal).toBeCloseTo(control.month0.safeToPayTotal, 2);
  });

  it('a VALID persisted id still wins over the profile default — the fix does not ignore the setting', () => {
    // Cash account holds $500 vs checking's $3,000, and the Rent rule is paid from checking, so
    // choosing it must change the engine's starting balance AND drop that bill from month 0.
    const viaCash = run(CASH);
    const control = run(null);
    expect(viaCash.month0.chain.fundingBalance).not.toBeCloseTo(control.month0.chain.fundingBalance, 2);
    expect(viaCash.month0.chain.expenses).toBe(0);
  });
});
