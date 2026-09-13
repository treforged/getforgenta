// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { Tables } from '@/integrations/supabase/types';

/**
 * THE TOGGLE REACHES THE SCREEN — or it did not, for as long as it existed.
 *
 * `payment_unconditional` shipped in three parts and every one of them landed on the ONE-SHOT
 * path (`getPayoffRecommendations`). /debt, the Dashboard debt widget and Forecast all render
 * `month0.perCardAdjusted`, produced HERE, and this file contained no occurrence of
 * `paymentUnconditional` at all — measured 2026-09-13. So the setting a user turned on changed a
 * number no surface displayed, with three green gates over it.
 *
 * These tests are therefore aimed at `perCardAdjusted` specifically, because that is the object
 * the user actually sees. A green assertion against the engine's own recommendation array would
 * have passed throughout the entire period the feature was dead.
 */

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

const CHECKING = 'checking-1';
const CARD = 'card-1';

/**
 * A month where the cash genuinely does not fit. The cash floor holds nearly the whole checking
 * balance, so the pool left for revolving cards is small against the card's $2,000 balance —
 * which is the only condition under which a clamp and a non-clamp are distinguishable at all.
 */
function run({ unconditional }: { unconditional: boolean }) {
  const accounts = [
    { id: CHECKING, name: 'Checking', account_type: 'checking', balance: 2600, active: true },
    {
      id: CARD, name: 'Tight Card', account_type: 'credit_card', balance: 2000, credit_limit: 10000,
      apr: 22, payment_due_day: 20, active: true, min_payment: 40,
      payment_preference: 'statement',
      payment_unconditional: unconditional,
    },
  ];
  const rules = [
    { id: 'income-1', name: 'Paycheck', amount: 200, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: CHECKING, active: true, category: 'Other' },
  ];
  const profile: Partial<Tables<'profiles'>> = { weekly_gross_income: 0.01 };
  const now = new Date();
  const payConfig = buildPayConfig(profile);
  const scheduledEvents = generateScheduledEvents(rules as unknown as RuleRow[], accounts as unknown as AccountRow[], 36);

  const { result } = renderHook(() => useCardProjection({
    accounts, transactions: [], rules, debts: [] as Partial<Tables<'debts'>>[], goals: [], carFunds: [], profile,
    // Holds almost all of the $2,600 back, so the revolving pool cannot reach $2,000.
    debtPayoffOptions: { cashFloor: 2400 },
    payConfig,
    scheduledEvents,
    pauseSavings: false,
    forecastFundingAccountId: CHECKING,
    debtStrategy: 'avalanche',
    persistedDebtFundingId: null,
    assumptions: DEFAULT_ASSUMPTIONS,
    syncCutoffDate: null,
    paymentPlans: [],
  } as unknown as UseCardProjectionParams));

  const r = result.current!;
  expect(r).not.toBeNull();
  const row = r.month0!.perCardAdjusted.find(p => p.id === CARD);
  expect(row, 'the card must appear in perCardAdjusted at all').toBeDefined();
  return row!;
}

describe('useCardProjection — an unconditional card is not scaled down to fit the month', () => {
  it('pays the FULL balance even though the pool cannot cover it', () => {
    const row = run({ unconditional: true });
    // The whole point: 2000, not whatever the month could afford.
    expect(row.payment).toBe(2000);
  });

  it('reports the gap as a NUMBER on the very array both screens render', () => {
    const row = run({ unconditional: true });
    expect(typeof row.unconditionalShortfall).toBe('number');
    expect(Number.isFinite(row.unconditionalShortfall)).toBe(true);
    // Sam's ruling: show both, show the gap, never resolve it silently. A shortfall of zero here
    // would mean the month covered $2,000 out of $2,600 while holding $2,400 on the floor.
    expect(row.unconditionalShortfall!).toBeGreaterThan(0);
    // And it is the real distance between what is sent and what was available, so it can never
    // exceed the payment itself.
    expect(row.unconditionalShortfall!).toBeLessThanOrEqual(row.payment);
  });

  it('THE DISCRIMINATING PAIR — the same month, the setting off, is scaled down and carries no gap', () => {
    // Without this control the test above proves only that the number is large, not that the
    // setting caused it. The ordinary path is clamped to the pool by design.
    const off = run({ unconditional: false });
    expect(off.payment).toBeLessThan(2000);
    expect(off.unconditionalShortfall).toBeUndefined();
  });

  it('an ordinary card carries NO shortfall field at all — absent and zero mean different things', () => {
    const off = run({ unconditional: false });
    expect('unconditionalShortfall' in off).toBe(false);
  });
});
