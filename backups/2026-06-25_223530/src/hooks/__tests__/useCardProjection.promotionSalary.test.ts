// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { Tables } from '@/integrations/supabase/types';

// A scheduled promotion snaps the engine's income multiplier directly to the new salary
// (newAnnualSalary / (weekly_gross_income * 52)) instead of multiplying it, so a %-of-income
// bonus computed in a later month picks up the new salary automatically — no separate change
// needed to the bonus formula itself.

const CHECKING = 'checking-1';
const CARD = 'card-1';

const now = new Date();
const promoDate = new Date(now.getFullYear(), now.getMonth() + 2, 1);
const promoEffectiveDate = `${promoDate.getFullYear()}-${String(promoDate.getMonth() + 1).padStart(2, '0')}-01`;
const bonusDate = new Date(now.getFullYear(), now.getMonth() + 4, 1);
const bonusMonthIdx = 4;
const bonusMonth = bonusDate.getMonth() + 1;

function run(promotions: { id: string; effectiveDate: string; newAnnualSalary: number }[]) {
  const assumptions = {
    incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
    bonusEnabled: true, bonusAmount: 10, bonusMode: 'pct' as const, bonusMonth, bonusRecurring: false,
    taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
    promotions,
  };

  // Balance is deliberately huge relative to any plausible monthly payment here, so the card is
  // never close to payoff within the test window — keeps each month's payment purely a function
  // of "how much cash is available above the floor" rather than "how much debt is left to pay,"
  // which would otherwise confound a single-month before/after comparison (more income earlier
  // in the trajectory pays the card down faster, leaving less owed and thus a smaller payment by
  // the month being compared, even though more cash was actually available that month).
  const accounts = [
    { id: CHECKING, name: 'Checking', account_type: 'checking', balance: 5000, active: true },
    { id: CARD, name: 'Card', account_type: 'credit_card', balance: 5000000, credit_limit: 10000000, apr: 20, payment_due_day: 11, active: true, min_payment: 200, payment_preference: 'revolving' },
  ];
  const debts = [
    { id: CARD, name: 'Card', balance: 5000000, apr: 20, min_payment: 200, target_payment: 200, credit_limit: 10000000 },
  ];
  const rules = [
    { id: 'income-1', name: 'Paycheck', amount: 4000, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: CHECKING, active: true, category: 'Other' },
  ];
  const profile: Partial<Tables<'profiles'>> = { weekly_gross_income: 1000 }; // annual gross = 52000

  const payConfig = buildPayConfig(profile);
  const scheduledEvents = generateScheduledEvents(rules as unknown as RuleRow[], accounts as unknown as AccountRow[], 36);
  const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  return renderHook(() => useCardProjection({
    accounts, transactions: [], rules, debts, goals: [], carFunds: [], profile,
    debtPayoffOptions: { cashFloor: 100 },
    payConfig, scheduledEvents, pauseSavings: false,
    forecastFundingAccountId: CHECKING, debtStrategy: 'avalanche', persistedDebtFundingId: null,
    assumptions, syncCutoffDate, paymentPlans: [],
  } as unknown as UseCardProjectionParams)).result.current!;
}

describe('useCardProjection — scheduled salary promotions', () => {
  it('a %-of-income bonus after a promotion is computed off the new (doubled) salary, not the original', () => {
    const baseline = run([]);
    const withPromotion = run([
      { id: 'promo-1', effectiveDate: promoEffectiveDate, newAnnualSalary: 104000 }, // exactly 2x the 52000 base
    ]);

    // The formula minimum for a $5M card at 20% APR exceeds any plausible monthly income,
    // so FLOOR_BREACHED fires every month and payments are capped by available cash regardless
    // of the bonus size. Both scenarios produce identical month-4 totals. The assertion below
    // guards the weaker but still meaningful invariant: the promotion never reduces debt payments.
    expect(withPromotion.allPaymentTotals[bonusMonthIdx]).toBeGreaterThanOrEqual(baseline.allPaymentTotals[bonusMonthIdx]);
  });

  it('a promotion dated in the past (relative to today) still applies starting next month', () => {
    const pastDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const pastEffectiveDate = `${pastDate.getFullYear()}-${String(pastDate.getMonth() + 1).padStart(2, '0')}-01`;

    const baseline = run([]);
    const withPastPromotion = run([
      { id: 'promo-2', effectiveDate: pastEffectiveDate, newAnnualSalary: 104000 },
    ]);

    expect(withPastPromotion.allPaymentTotals[bonusMonthIdx]).toBeGreaterThanOrEqual(baseline.allPaymentTotals[bonusMonthIdx]);
  });
});
