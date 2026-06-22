// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { Tables } from '@/integrations/supabase/types';

// Regression test for a bug where the floor-breach look-ahead only ran (and only capped a
// month's debt payment) when a month was flagged as a "large event" — a recorded one-time DB
// expense, a car down payment, or a cycling-card statement spike. Any floor breach NOT traceable
// to one of those three triggers was invisible to maxDebtPaymentByMonth, so the simulation kept
// paying as much as it liked toward debt with no protection at all. This surfaced for real when
// a comprehensive, general-purpose look-ahead in Forecast.tsx (which protects against ANY
// breach) was removed in favor of trusting this hook's narrower one — several real future
// months dropped below the cash floor. Fixed by removing the "large event" gate entirely and by
// folding mortgage/vehicle-insurance/lump-transfer/car-loan-lump costs (previously invisible to
// this look-ahead, only added to the hook in this round) into its per-month expense figure.
//
// Scenario here: a recurring annual insurance bill (a scheduled RULE, not a one-time transaction
// — so it never sets the old hasLargeEvent flags) lands every 12 months, combined with a
// mortgage payment the underlying CC engine doesn't otherwise know about. Without the fix, the
// look-ahead never runs at all for this account, so months before the annual bill pay far more
// than the minimum toward the card; with the fix, those months are scaled back to the minimum to
// protect cash for the bill.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

describe('useCardProjection floor-breach protection (no flagged large event)', () => {
  it('reduces earlier months\' card payments toward the minimum to protect cash for a recurring annual bill, with no flagged large event', () => {
    const now = new Date();
    const checkingId = 'checking-1';
    const cardId = 'card-1';
    const mortgageAccountId = 'mortgage-account';

    // Annual insurance premium due ~4 months out — a scheduled RULE (frequency 'yearly'), not a
    // one-time DB transaction, car down payment, or cycling-card spike, so hasLargeEvent (the
    // removed gate) would never have flagged it.
    const annualTarget = new Date(now.getFullYear(), now.getMonth() + 4, 15);
    const dueMonth = annualTarget.getMonth() + 1;

    const accounts = [
      { id: checkingId, name: 'Checking', account_type: 'checking', balance: 5000, active: true },
      { id: mortgageAccountId, name: 'Mortgage', account_type: 'mortgage', balance: 250000, active: true },
      { id: cardId, name: 'Card', account_type: 'credit_card', balance: 8000, credit_limit: 15000, apr: 20, payment_due_day: 1, active: true, min_payment: 200, payment_preference: 'statement' },
    ];
    const debts = [
      { id: cardId, name: 'Card', balance: 8000, apr: 20, min_payment: 200, target_payment: 600, credit_limit: 15000 },
      { id: 'mortgage-debt', name: 'Mortgage', balance: 250000, apr: 6, min_payment: 2500, target_payment: 2500, credit_limit: 0 },
    ];
    const rules = [
      { id: 'income-1', name: 'Paycheck', amount: 4000, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: checkingId, active: true, category: 'Other' },
      { id: 'bill-1', name: 'Rent', amount: 1200, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: checkingId, deposit_account: null, active: true, category: 'Bills' },
      { id: 'bill-2', name: 'Annual Insurance Premium', amount: 1800, rule_type: 'expense', frequency: 'yearly', due_month: dueMonth, due_day: 15, payment_source: checkingId, deposit_account: null, active: true, category: 'Insurance' },
    ];
    const transactions: Partial<Tables<'transactions'>>[] = [];
    const carFunds: Partial<Tables<'car_funds'>>[] = [];
    const goals: Partial<Tables<'savings_goals'>>[] = [];
    // weekly_gross_income set to a negligible non-zero value (not 0 — Number(0) || 1875 would
    // fall back to the 1875 default) so the profile-based default paycheck doesn't drown out the
    // rules-based $4000/month income this test relies on for predictable cash-flow math.
    const profile: Partial<Tables<'profiles'>> = { weekly_gross_income: 0.01 };

    const payConfig = buildPayConfig(profile);
    const scheduledEvents = generateScheduledEvents(rules as unknown as RuleRow[], accounts as unknown as AccountRow[], 36);
    const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const { result } = renderHook(() => useCardProjection({
      accounts, transactions, rules, debts, goals, carFunds, profile,
      debtPayoffOptions: { cashFloor: 2000 },
      payConfig,
      scheduledEvents,
      pauseSavings: false,
      forecastFundingAccountId: checkingId,
      debtStrategy: 'avalanche',
      persistedDebtFundingId: null,
      assumptions: DEFAULT_ASSUMPTIONS,
      syncCutoffDate,
      paymentPlans: [],
    } as unknown as UseCardProjectionParams));

    const r = result.current!;
    expect(r).not.toBeNull();

    // The general-purpose loop must have found and protected against the breach even though no
    // one-time transaction, car down payment, or cycling spike ever occurred.
    expect(r.saveUpMonths.size).toBeGreaterThan(0);

    // Months 1-3 (immediately before the first annual-bill month) must be scaled back to at most
    // the card's own minimum payment — not the unconstrained, cash-rich amount the simulation
    // would otherwise pay when it doesn't yet know a large bill is coming.
    const series = r.perCardPaymentsScaled.find(p => p.id === cardId)!;
    const card = r.simCards.find(c => c.id === cardId)!;
    for (let m = 1; m <= 3; m++) {
      expect(series.payments[m]).toBeLessThanOrEqual(card.minPayment + 1);
    }
  });
});
