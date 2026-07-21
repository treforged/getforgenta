// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { Tables } from '@/integrations/supabase/types';

// Regression test for the month-0 debt-cap under-counting bug: the hook's month-0 cashPreDebt
// (useCardProjection.ts, the `availableForRevolving` cap) must mirror forecast-engine.ts's PASS-3
// month-0 cashPreDebt (forecast-engine.ts:1106), which subtracts transfer/investment RULE
// outflows (monthTransfers) — e.g. Tre's real $25/mo Roth IRA investment rule. Before the fix the
// cap omitted these, so it thought there was more cash above the floor than reality and authorized
// too much revolving (Discover) paydown, landing the current-month Forecast row below the
// augmented cash floor. A transfer/investment rule firing after the sync cutoff this month must
// therefore reduce the authorized month-0 revolving payment, dollar-for-dollar, when the floor cap
// (not the card's own desired payment) is the binding constraint.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

describe('useCardProjection month-0 transfer/investment rule reduces the floor-capped debt payment', () => {
  it('subtracts a post-cutoff month-0 transfer rule from the revolving payment the cap authorizes', () => {
    const now = new Date();
    const checkingId = 'checking-1';
    const cardId = 'card-1';
    const rothId = 'roth-1';

    // Sync cutoff on the 1st so a rule due on the 28th fires strictly after it (counts in
    // m0Transfers), matching how Tre's Roth IRA rule (due day 28) is treated this month.
    const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const transferAmount = 300;

    const accounts = [
      { id: checkingId, name: 'Checking', account_type: 'checking', balance: 5000, active: true },
      { id: rothId, name: 'Roth IRA', account_type: 'roth_ira', balance: 0, active: true },
      // Aggressive-payoff card so the sim WANTS to pay far more than cash allows — this forces the
      // cash-floor cap (cashPreDebt − floor) to be the binding constraint, not simRevolvingTotal.
      { id: cardId, name: 'Card', account_type: 'credit_card', balance: 8000, credit_limit: 15000, apr: 20, payment_due_day: 1, active: true, min_payment: 200, payment_preference: 'revolving' },
    ];
    const debts = [
      { id: cardId, name: 'Card', balance: 8000, apr: 20, min_payment: 200, target_payment: 8000, credit_limit: 15000 },
    ];
    const baseRules = [
      { id: 'income-1', name: 'Paycheck', amount: 2000, rule_type: 'income', frequency: 'monthly', due_day: 28, payment_source: null, deposit_account: checkingId, active: true, category: 'Other' },
      { id: 'bill-1', name: 'Rent', amount: 1000, rule_type: 'expense', frequency: 'monthly', due_day: 28, payment_source: checkingId, deposit_account: null, active: true, category: 'Bills' },
    ];
    // The month-0 outflow under test: a monthly INVESTMENT rule (payment_source = checking, a cash
    // account, so it really debits checking) due on the 28th → after the cutoff → counts this month.
    const transferRule = { id: 'roth-rule', name: 'Roth IRA', amount: transferAmount, rule_type: 'investment', frequency: 'monthly', due_day: 28, payment_source: checkingId, deposit_account: rothId, active: true, category: 'Other' };

    const transactions: Partial<Tables<'transactions'>>[] = [];
    const carFunds: Partial<Tables<'car_funds'>>[] = [];
    const goals: Partial<Tables<'savings_goals'>>[] = [];
    const profile: Partial<Tables<'profiles'>> = { weekly_gross_income: 0.01 };
    const payConfig = buildPayConfig(profile);

    const run = (rules: unknown[]) => {
      const scheduledEvents = generateScheduledEvents(rules as unknown as RuleRow[], accounts as unknown as AccountRow[], 36);
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
      return result.current!;
    };

    const withoutTransfer = run(baseRules);
    const withTransfer = run([...baseRules, transferRule]);

    expect(withoutTransfer).not.toBeNull();
    expect(withTransfer).not.toBeNull();

    // Sanity: the floor cap is actually binding (payment > the card's minimum), so the transfer
    // has room to reduce it rather than the min-payment floor absorbing the change.
    expect(withoutTransfer.month0.safeToPayTotal).toBeGreaterThan(200);

    // The transfer must reduce the authorized month-0 payment by (approximately) its full amount.
    const reduction = withoutTransfer.month0.safeToPayTotal - withTransfer.month0.safeToPayTotal;
    expect(reduction).toBeGreaterThan(transferAmount - 5);
    expect(reduction).toBeLessThan(transferAmount + 5);
  });
});
