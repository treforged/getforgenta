// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { Tables } from '@/integrations/supabase/types';

// RANKED AUTOMATIC EXTRA PAYMENTS — the CARD BLOCK's rank, at month 0.
//
// `savings_goals.sort_order` ranks the goals against each other; nothing ranked the CARDS, so
// every call site passed a hardcoded 0 and a user could not say "this goal matters more than my
// debt" at all. `profiles.cards_sort_order` is where that answer is stored, and this pins that the
// month-0 reserve every user-facing debt surface reads actually honours it.
//
// The rank moves the SURPLUS and nothing else: the card's minimum is settled inside the allocator
// before any rank is consulted, so the cards-last case below must still pay it in full.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

const CHECKING_ID = 'checking-1';
const CARD_ID = 'card-1';
const CARD_MIN = 200;

/** One goal at rank 0, contributing nothing manually, so the only variable across runs is where
 *  the CARD block sits relative to it. */
const goal = (over: Partial<Tables<'savings_goals'>> = {}): Partial<Tables<'savings_goals'>> => ({
  id: 'goal-1',
  name: 'Emergency fund',
  target_amount: 10000,
  current_amount: 0,
  monthly_contribution: 0,
  linked_account: null,
  sort_order: 0,
  auto_extra: true,
  ...over,
});

/** `cardsSortOrder: undefined` stands for a profile row predating the column. */
function run(cardsSortOrder: number | undefined, goals = [goal()], checkingBalance = 4000) {
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
  // Pinned to a MANUAL floor: these fixtures predate the automatic floor, and automatic adds
  // card minimums and vehicle-loan payments to the floor (auto-cash-floor.ts), which is a
  // different thing from what this file is testing.
  const profile: Partial<Tables<'profiles'>> = { weekly_gross_income: 0.01, cash_floor_is_manual: true };
  if (cardsSortOrder !== undefined) profile.cards_sort_order = cardsSortOrder;

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

describe('useCardProjection — profiles.cards_sort_order ranks the card block', () => {
  it('cards FIRST (the stored default of 0) keeps the surplus on the debt', () => {
    // Goal and cards both at rank 0, and the card block is seated half a rank ahead precisely so
    // that tie resolves in favour of the debt. This is the pre-column behaviour, exactly.
    expect(run(0).month0!.chain.autoExtraReserve).toBe(0);
  });

  it('cards LAST lets a goal ranked above them take the surplus', () => {
    const cardsFirst = run(0);
    const cardsLast = run(5);

    const reserved = cardsLast.month0!.chain.autoExtraReserve;
    expect(reserved).toBeGreaterThan(0);
    // The dollars came out of card paydown — this run is cash-tight, so the diversion is visible
    // directly, and it is a diversion, not an invention.
    // The card is left with EXACTLY its contractual minimum — everything discretionary went to the
    // goal. That is the diversion, stated directly.
    expect(cardsLast.month0!.safeToPayTotal).toBeCloseTo(CARD_MIN, 0);
    // ⚠️ The drop is `reserved` MINUS the minimum, not `reserved`. Since 2026-08-21 the floor
    // includes each card's contractual minimum (auto-cash-floor.ts), so those dollars are protected
    // in BOTH runs and were never available to divert. Asserting equality with `reserved` here would
    // be asserting that a minimum payment can be diverted, which it cannot.
    expect(cardsFirst.month0!.safeToPayTotal - cardsLast.month0!.safeToPayTotal)
      .toBeCloseTo(reserved - CARD_MIN, 0);
    expect(cardsLast.month0!.endCash).toBeLessThanOrEqual(cardsFirst.month0!.endCash + 0.5);
  });

  it('ranking the cards last still pays their minimum in full', () => {
    // Rank orders the SURPLUS, never an obligation. `allocateRankedSurplus` settles every minimum
    // before it reads a single `sortOrder`, so no rank can starve this.
    for (const balance of [0, 500, 1200, 2000, 4000, 8000, 15000]) {
      const cardsFirst = run(0, [goal()], balance);
      const cardsLast = run(9, [goal()], balance);
      expect(cardsLast.month0!.safeToPayTotal)
        .toBeGreaterThanOrEqual(Math.min(CARD_MIN, cardsFirst.month0!.safeToPayTotal) - 0.5);
      expect(cardsLast.month0!.m0SafeFloor).toBe(cardsFirst.month0!.m0SafeFloor);
    }
  });

  it('a profile with no cards_sort_order column behaves exactly like an explicit 0', () => {
    expect(run(undefined).month0).toEqual(run(0).month0);
  });

  it('an opted-OUT goal is untouched by the card rank', () => {
    // Nothing is opted in, so there is no surplus to rank and the two runs cannot differ.
    const optedOut = [goal({ auto_extra: false })];
    expect(run(9, optedOut).month0).toEqual(run(0, optedOut).month0);
    expect(run(9, optedOut).month0!.chain.autoExtraReserve).toBe(0);
  });
});
