// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';

// Regression test for a real user-reported bug: the Forecast page showed several real months
// below the cash floor that the Debt Payoff tab (sourced from this hook) never protected
// against. Root cause: a saving-phase car fund's lump_sum_payments — extra payments the user
// plans to make once the car is financed, landing in the projected-loan window after the
// purchase month — were already included in Forecast.tsx's own getMonthProjLoan, but
// useCardProjection.ts's getVehicleExtrasForMonth had no equivalent at all. The hook's
// reserve calculation never knew about that recurring outflow, so it never saved up for it,
// even though Forecast's own (independently computed) numbers showed the resulting shortfall.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

describe('useCardProjection vehicle projected-loan lump-sum payments', () => {
  it('saves up for a saving-phase car\'s planned post-purchase lump-sum payments', () => {
    const now = new Date();
    const checkingId = 'checking-1';
    const cardId = 'card-1';

    // Car already purchased as of "today" (planned_purchase_date in the past) so the projected
    // loan window (purchaseMonthIdx=0) covers the whole 36-month horizon.
    const carFunds = [
      {
        id: 'car-1', vehicle_name: 'Test Car', phase: 'saving', down_payment_goal: 5000, current_saved: 5000,
        gift_contribution: 0, planned_purchase_date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
        linked_account: null, linked_rule_id: null, target_price: 20000, tax_fees: 1000, expected_apr: 8,
        loan_term_months: 60, monthly_insurance: 0,
        // A real, recurring $600/month extra payment the user plans to make every month from
        // month 6 onward — large relative to normal cash flow, with nothing else flagging a
        // "large event" anywhere (no one-time transactions, no car down payment landing later).
        lump_sum_payments: Array.from({ length: 12 }, (_, k) => {
          const d = new Date(now.getFullYear(), now.getMonth() + 6 + k, 15);
          return { id: `lump-${k}`, date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`, amount: 600 };
        }),
      },
    ];

    const accounts = [
      { id: checkingId, name: 'Checking', account_type: 'checking', balance: 3000, active: true },
      { id: cardId, name: 'Card', account_type: 'credit_card', balance: 5000, credit_limit: 15000, apr: 20, payment_due_day: 1, active: true, min_payment: 150, payment_preference: 'statement' },
    ];
    const debts = [
      { id: cardId, name: 'Card', balance: 5000, apr: 20, min_payment: 150, target_payment: 500, credit_limit: 15000 },
    ];
    const rules = [
      { id: 'income-1', name: 'Paycheck', amount: 2200, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: checkingId, active: true, category: 'Other' },
      { id: 'bill-1', name: 'Rent', amount: 1200, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: checkingId, deposit_account: null, active: true, category: 'Bills' },
    ];
    const profile: any = { weekly_gross_income: 0.01 };

    const payConfig = buildPayConfig(profile);
    const scheduledEvents = generateScheduledEvents(rules as any[], accounts as any[], 36);
    const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const { result } = renderHook(() => useCardProjection({
      accounts, transactions: [], rules, debts, goals: [], carFunds, profile,
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
    } as any));

    const r = result.current!;
    expect(r).not.toBeNull();

    // Without accounting for the $600/month lump-sum payments, the look-ahead would never
    // realize cash gets tight starting month 6 and would never engage save-up at all.
    expect(r.saveUpMonths.size).toBeGreaterThan(0);

    // No card payment should ever push cash below the floor: confirmed indirectly by checking
    // the minimum-payment invariant still holds throughout (a real floor breach would otherwise
    // force the simulation to violate this to keep paying down debt).
    const series = r.perCardPaymentsScaled.find(p => p.id === cardId)!;
    const card = r.simCards.find(c => c.id === cardId)!;
    const violations: string[] = [];
    for (let m = 0; m < 36; m++) {
      const revBal = r.monthlyRevolvingBalances.get(cardId)?.[m] ?? 0;
      const pay = series.payments[m];
      if (revBal > 0 && pay > 0 && pay < card.minPayment - 1 && pay < revBal - 1) {
        violations.push(`month ${m}: paid ${pay}, min ${card.minPayment}, revBal ${revBal}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
