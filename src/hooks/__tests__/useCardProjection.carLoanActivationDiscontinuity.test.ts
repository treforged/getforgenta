// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection } from '../useCardProjection';
import { getLoanPrincipal } from '@/lib/vehicle-loan-engine';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';

// The end-to-end "no-op at activation" proof for Bug 2: simulationMonthEvents (the array that
// actually drives the real per-card payment simulation, sim/activeSim) previously had no idea a
// saving-phase car's projected future loan payment + insurance was coming — only the secondary
// look-ahead cap (comprehensiveMExp) saw it. So sim's own cash trajectory swung hard the instant
// phase flipped to 'loan', even with identical numbers (the real account's reported 14mo -> 89mo
// payoff-ETA jump). getVehicleExtrasForMonth/carLoanInsuranceByMonth/carLoanLumpByMonth are now
// folded directly into simulationMonthEvents, so this must be a true no-op now, across the real
// simulation engine — not just the schedule math already proven in vehicle-loan-engine tests.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

function run(carFunds: any[]) {
  const checkingId = 'checking-1';
  const primeId = 'card-1';
  const discoverId = 'card-2';

  // Tight cash, two revolving cards with enough combined balance that payoff takes several
  // months rather than 1-2 — long enough to compare a month where both scenarios still have
  // outstanding debt (a too-fast payoff makes allPaymentTotals drop to 0 in one scenario but not
  // the other, which isn't a meaningful comparison either way).
  const accounts = [
    { id: checkingId, name: 'Checking', account_type: 'checking', balance: 6000, active: true },
    { id: primeId, name: 'Prime Visa', account_type: 'credit_card', balance: 12000, credit_limit: 25000, apr: 24, payment_due_day: 11, active: true, min_payment: 350, payment_preference: 'revolving' },
    { id: discoverId, name: 'Discover', account_type: 'credit_card', balance: 6000, credit_limit: 18000, apr: 18, payment_due_day: 11, active: true, min_payment: 180, payment_preference: 'revolving' },
  ];
  const debts = [
    { id: primeId, name: 'Prime Visa', balance: 12000, apr: 24, min_payment: 350, target_payment: 350, credit_limit: 25000 },
    { id: discoverId, name: 'Discover', balance: 6000, apr: 18, min_payment: 180, target_payment: 180, credit_limit: 18000 },
  ];
  const rules = [
    { id: 'income-1', name: 'Paycheck', amount: 4500, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: checkingId, active: true, category: 'Other' },
    { id: 'bill-1', name: 'Rent', amount: 1800, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: checkingId, deposit_account: null, active: true, category: 'Bills' },
  ];
  const profile: any = { weekly_gross_income: 0.01 };

  const payConfig = buildPayConfig(profile);
  const scheduledEvents = generateScheduledEvents(rules as any[], accounts as any[], 36);
  const now = new Date();
  const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  return renderHook(() => useCardProjection({
    accounts, transactions: [], rules, debts, goals: [], carFunds, profile,
    debtPayoffOptions: { cashFloor: 2500 },
    payConfig,
    scheduledEvents,
    pauseSavings: false,
    forecastFundingAccountId: checkingId,
    debtStrategy: 'avalanche',
    persistedDebtFundingId: null,
    assumptions: DEFAULT_ASSUMPTIONS,
    syncCutoffDate,
    paymentPlans: [],
  } as any)).result.current!;
}

function makeSavingPhaseCarFund() {
  return {
    id: 'car-1', vehicle_name: 'Real Account Car', phase: 'saving' as const,
    // down payment is fully gift-funded (current_saved: 0) — isolating this test to Bug 2 (the
    // loan-payment/insurance dimension) by construction: getCarFundEarmark = min(current_saved=0,
    // down_payment_goal-gift_contribution=0) = 0 regardless of linked_account, so Bug 1's earmark
    // (covered separately in useCardProjection.carEarmark.test.ts) cannot interact with this test.
    target_price: 21070, tax_fees: 3000, down_payment_goal: 7700, current_saved: 0, gift_contribution: 7700,
    loan_amount: 0, expected_apr: 10.18, loan_term_months: 48,
    loan_start_date: null, payment_start_date: '2026-08-07', interest_start_date: null,
    actual_monthly_payment: 0, monthly_insurance: 77,
    linked_account: null, linked_rule_id: null, loan_payment_account: null,
    planned_purchase_date: '2026-06-21', lump_sum_payments: [],
  };
}

describe('useCardProjection — car-loan activation, end-to-end no-op proof', () => {
  it('month0.safeToPayTotal and perCardAdjusted are identical whether the car fund is saving-phase or loan-phase with frozen-equal numbers', () => {
    const saving = makeSavingPhaseCarFund();
    const principal = getLoanPrincipal(saving as any);
    const loan = {
      ...saving, phase: 'loan' as const, loan_amount: principal,
      loan_start_date: saving.planned_purchase_date, interest_start_date: saving.payment_start_date,
    };

    const savingResult = run([saving]);
    const loanResult = run([loan]);

    expect(savingResult.month0.safeToPayTotal).toBe(loanResult.month0.safeToPayTotal);
    expect(savingResult.month0.perCardAdjusted).toEqual(loanResult.month0.perCardAdjusted);
  });

  it('sim itself (not just the look-ahead cap) reflects the projected payment+insurance before activation — a future-month car cost measurably reduces allPaymentTotals starting at paymentStartMonthIdx', () => {
    const withCar = run([makeSavingPhaseCarFund()]);
    const withoutCar = run([]);

    // payment_start_date 2026-08-07 is ~2 months out from "now" — month index 2. By index 3,
    // both scenarios still have outstanding debt (neither has paid off yet, so allPaymentTotals
    // isn't artificially 0 in either), and the gap should be exactly the projected payment
    // ($416.60, from calculateScheduledPayment(16370, 10.18, 48)) + insurance ($77) = $493.60 —
    // proving sim's own rollforward (not just a secondary cap) now carries this cost, not just
    // some other incidental difference.
    const idx = 3;
    expect(withoutCar.allPaymentTotals[idx] - withCar.allPaymentTotals[idx]).toBeCloseTo(493.6, 1);
  });
});
