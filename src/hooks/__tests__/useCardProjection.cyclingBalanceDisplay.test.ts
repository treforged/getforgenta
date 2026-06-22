// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { Tables } from '@/integrations/supabase/types';

// Regression test for a real user-reported bug: Forecast's monthly popup showed a cycling
// card's balance as missing/zero for a month with a real, large one-time purchase, even though
// the Debt Payoff tab correctly showed the card paying its full statement balance the following
// month. Root cause: useCardProjection.ts built `data` (the array Forecast's popup reads
// per-card balances from) by calling projectCardVariable with purchasesPerMonth hardcoded to
// undefined. For a card with no revolving balance (cycling from day one), that made
// projectCardVariable fall back to card.monthlyNewPurchases - a static average baseline with no
// knowledge of one-time transactions or payment-plan charges - instead of the real per-month
// purchase amount. The simulation/Debt Payoff tab were never affected (they get real per-month
// purchases through a different path), only this specific display array.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

describe('useCardProjection cycling-card balance display', () => {
  it('reflects real one-time purchases in data[month][cardName], not a static baseline', () => {
    const checkingId = 'checking-1';
    const cyclingCardId = 'cycling-card-1';

    const accounts = [
      { id: checkingId, name: 'Checking', account_type: 'checking', balance: 3000, active: true },
      // No revolving balance and no recurring rule routed to it — monthlyNewPurchases (the
      // static baseline projectCardVariable used to fall back to) is 0 for this card.
      { id: cyclingCardId, name: 'Cycling Card', account_type: 'credit_card', balance: 0, credit_limit: 10000, apr: 18, payment_due_day: 7, active: true, min_payment: 0, payment_preference: 'statement' },
    ];
    const debts: Partial<Tables<'debts'>>[] = [];
    const rules = [
      { id: 'income-1', name: 'Paycheck', amount: 3500, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: checkingId, active: true, category: 'Other' },
    ];
    // A real one-time purchase in month 2, paid in full the following month per the card's
    // statement-preference cycling behavior.
    const transactions = [
      { date: '', type: 'expense', amount: 850, category: 'Car', payment_source: `account:${cyclingCardId}`, note: 'Wheels' },
    ];
    const now = new Date();
    const purchaseDate = new Date(now.getFullYear(), now.getMonth() + 2, 15);
    transactions[0].date = `${purchaseDate.getFullYear()}-${String(purchaseDate.getMonth() + 1).padStart(2, '0')}-15`;
    const profile: Partial<Tables<'profiles'>> = { weekly_gross_income: 0.01 };

    const payConfig = buildPayConfig(profile);
    const scheduledEvents = generateScheduledEvents(rules as unknown as RuleRow[], accounts as unknown as AccountRow[], 36);
    const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const { result } = renderHook(() => useCardProjection({
      accounts, transactions, rules, debts, goals: [], carFunds: [], profile,
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

    // Month 2 (the purchase month) should show the $850 as that month's ending cycling balance.
    expect(r.data[2]['Cycling Card']).toBe(850);
    // Month 3 (the following month) the card has paid it off and made no new purchases.
    expect(r.data[3]['Cycling Card']).toBe(0);
  });
});
