// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { Tables } from '@/integrations/supabase/types';

// RANKED AUTOMATIC EXTRA PAYMENTS — the month-0 reserve, inside the converged engine.
//
// Every user-facing debt surface reads `useCardProjection`'s month0 (Dashboard, Budget Control and
// Savings Goals through useMonth0DebtBreakdown; /debt through this hook directly), so this is the
// integration point that makes the feature real. The properties pinned here are the ones that can
// quietly cost a user money:
//
//  1. Opted OUT is byte-identical. `auto_extra` defaults false, so this is every existing user.
//  2. A card's MINIMUM is never starved to fund a goal — the worst bug this product can ship.
//  3. `endCash` does NOT rise. The reserve is a chain term, not a shave off `availableForRevolving`;
//     the latter would drop `safeToPayTotal` while raising `endCash` by the same dollars, telling
//     the user the money is both still in checking and already in the goal.
//  4. The chain identity still balances to the cent with the new term in it.
//  5. A FULL goal reserves nothing, so surplus never evaporates against a target needing nothing.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

const CHECKING_ID = 'checking-1';
const CARD_ID = 'card-1';
const CARD_MIN = 200;

type GoalOver = Partial<Tables<'savings_goals'>>;

/** One goal row, contributing NOTHING manually — `monthly_contribution` 0 keeps `goalContributions`
 *  out of the comparison so the only variable between runs is the `auto_extra` flag itself. */
const goal = (over: GoalOver = {}): Partial<Tables<'savings_goals'>> => ({
  id: 'goal-1',
  name: 'Emergency fund',
  target_amount: 10000,
  current_amount: 0,
  monthly_contribution: 0,
  linked_account: null,
  sort_order: 0,
  auto_extra: false,
  ...over,
});

function run(goals: Partial<Tables<'savings_goals'>>[], checkingBalance = 8000) {
  const accounts = [
    { id: CHECKING_ID, name: 'Checking', account_type: 'checking', balance: checkingBalance, active: true },
    { id: CARD_ID, name: 'Card', account_type: 'credit_card', balance: 6000, credit_limit: 15000, apr: 22, payment_due_day: 11, active: true, min_payment: CARD_MIN, payment_preference: 'revolving' },
  ];
  const debts = [
    { id: CARD_ID, name: 'Card', balance: 6000, apr: 22, min_payment: CARD_MIN, target_payment: CARD_MIN, credit_limit: 15000 },
  ];
  const rules = [
    { id: 'income-1', name: 'Paycheck', amount: 4000, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: CHECKING_ID, active: true, category: 'Other' },
    { id: 'bill-1', name: 'Rent', amount: 1200, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: CHECKING_ID, deposit_account: null, active: true, category: 'Bills' },
  ];
  const profile: Partial<Tables<'profiles'>> = { weekly_gross_income: 0.01 };

  const payConfig = buildPayConfig(profile);
  const scheduledEvents = generateScheduledEvents(rules as unknown as RuleRow[], accounts as unknown as AccountRow[], 36);
  const now = new Date();
  const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  return renderHook(() => useCardProjection({
    accounts, transactions: [], rules, debts, goals, carFunds: [], profile,
    debtPayoffOptions: { cashFloor: 1000 },
    payConfig,
    scheduledEvents,
    pauseSavings: false,
    forecastFundingAccountId: CHECKING_ID,
    debtStrategy: 'avalanche',
    persistedDebtFundingId: null,
    assumptions: DEFAULT_ASSUMPTIONS,
    syncCutoffDate,
    paymentPlans: [],
  } as unknown as UseCardProjectionParams)).result.current!;
}

/** The written-out Month0CashChain identity, term for term. */
const chainSum = (c: import('@/lib/debt-model-types').Month0CashChain) =>
  c.fundingBalance + c.income - c.expenses - c.planExpenses - c.goalContributions
  - c.autoExtraReserve - c.carSavedEarmark - c.carReserve - c.carLoanPayment
  - c.vehicleInsurance - c.mortgagePayment - c.transfers + c.oneTimeNet;

describe('useCardProjection — ranked automatic extra payments (month-0 reserve)', () => {
  it('reserves nothing, and changes nothing, when the goal is opted out', () => {
    const base = run([]);
    const optedOut = run([goal({ auto_extra: false })]);

    expect(optedOut.month0!.chain.autoExtraReserve).toBe(0);
    expect(optedOut.month0).toEqual(base.month0);
  });

  it('treats a MISSING auto_extra column as opted out, not opted in', () => {
    // `useSavingsGoals` hands back partial rows; a row predating the migration has no column at all.
    // The allocator reads an OMITTED `autoExtra` as opted IN, so this boundary must compare to true.
    const row = goal();
    delete (row as Record<string, unknown>).auto_extra;

    expect(run([row]).month0!.chain.autoExtraReserve).toBe(0);
    expect(run([row]).month0).toEqual(run([]).month0);
  });

  it('accounts for every reserved dollar — it comes out of card paydown, idle surplus, or both', () => {
    // The reserve lands in exactly one of two places depending on the cash position, and the test
    // has to allow both or it pins an accident rather than the rule:
    //   • cash-tight  — the cards were absorbing everything, so paydown falls by the reserve;
    //   • cash-loose  — the cards were already capped by their own payoff schedule, so the reserve
    //                   comes out of the surplus that would otherwise have sat idle in checking.
    // What is true in EVERY case is that the two drops add up to the reserve. Nothing appears from
    // nowhere, and nothing evaporates.
    for (const balance of [3000, 4000, 6000, 8000, 12000, 20000]) {
      const base = run([goal({ auto_extra: false, sort_order: -1 })], balance);
      const optedIn = run([goal({ auto_extra: true, sort_order: -1 })], balance);
      const reserved = optedIn.month0!.chain.autoExtraReserve;

      expect(base.month0!.chain.cashPreDebt - optedIn.month0!.chain.cashPreDebt).toBeCloseTo(reserved, 6);
      const paydownDrop = base.month0!.safeToPayTotal - optedIn.month0!.safeToPayTotal;
      const cashDrop = base.month0!.endCash - optedIn.month0!.endCash;
      expect(paydownDrop + cashDrop).toBeCloseTo(reserved, 0);
      // ⚠️ THE TRAP THIS DESIGN EXISTS TO AVOID: shaving the reserve off `availableForRevolving`
      // alone drops safeToPayTotal while RAISING endCash by the same dollars, so the app would
      // claim the cash is both still in checking and already in the goal.
      expect(cashDrop).toBeGreaterThanOrEqual(-0.5);
      expect(paydownDrop).toBeGreaterThanOrEqual(-0.5);
    }
  });

  it('a goal ranked ABOVE the cards takes the paydown surplus, and the card keeps its minimum', () => {
    // Cash-tight: at this balance the cards were absorbing the whole pool, so the diversion is
    // visible directly in safeToPayTotal.
    const base = run([goal({ auto_extra: false, sort_order: -1 })], 4000);
    const optedIn = run([goal({ auto_extra: true, sort_order: -1 })], 4000);

    const reserved = optedIn.month0!.chain.autoExtraReserve;
    expect(reserved).toBeGreaterThan(0);
    expect(base.month0!.safeToPayTotal - optedIn.month0!.safeToPayTotal).toBeCloseTo(reserved, 0);
    // The minimum is settled inside the allocator before any rank is read, so the card cannot be
    // pushed below it however greedy the goal is.
    expect(optedIn.month0!.safeToPayTotal).toBeGreaterThanOrEqual(CARD_MIN);
    // And the cash floor is not dipped into to feed the goal.
    expect(optedIn.month0!.endCash).toBeGreaterThanOrEqual(base.month0!.m0SafeFloor - 0.5);
  });

  it('never starves the card minimum, across the whole range of cash positions', () => {
    for (const balance of [0, 500, 1200, 2000, 3500, 5000, 8000, 15000]) {
      const base = run([goal({ auto_extra: false, sort_order: -1 })], balance);
      const optedIn = run([goal({ auto_extra: true, sort_order: -1 })], balance);
      // Opting in can never take a card below its minimum — nor below whatever it was already at
      // when the floor itself could not cover that minimum.
      expect(optedIn.month0!.safeToPayTotal)
        .toBeGreaterThanOrEqual(Math.min(CARD_MIN, base.month0!.safeToPayTotal) - 0.5);
      // `Month0Result` carries no `cashWarning` flag — that lives on the recommendation summary
      // (`credit-card-engine.ts`), not on the converged month 0 this hook returns. The engine-side
      // equivalents are that the floor the plan is held to is untouched by opting in, and that the
      // reserve can only ever move cash OUT of checking, never conjure it.
      expect(optedIn.month0!.m0SafeFloor).toBe(base.month0!.m0SafeFloor);
      expect(optedIn.month0!.endCash).toBeLessThanOrEqual(base.month0!.endCash + 0.5);
    }
  });

  it('reserves nothing for a goal that is already full', () => {
    const full = run([goal({ auto_extra: true, sort_order: -1, target_amount: 4000, current_amount: 4000 })]);
    expect(full.month0!.chain.autoExtraReserve).toBe(0);
    expect(full.month0).toEqual(run([]).month0);
  });

  it('caps the reserve at the goal\'s remaining need, handing the rest straight back to the cards', () => {
    const need = 300;
    const capped = run([goal({ auto_extra: true, sort_order: -1, target_amount: need, current_amount: 0 })]);
    expect(capped.month0!.chain.autoExtraReserve).toBeCloseTo(need, 2);
  });

  it('keeps the cash-chain identity exact with the new term in it', () => {
    const c = run([goal({ auto_extra: true, sort_order: -1 })]).month0!.chain;
    expect(c.autoExtraReserve).toBeGreaterThan(0);
    expect(chainSum(c)).toBeCloseTo(c.cashPreDebt, 6);
  });
});
