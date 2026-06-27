import { describe, it, expect } from 'vitest';
import { getLoanPrincipal } from '../vehicle-loan-engine';
import type { CarFund } from '../types';

// Regression test for the saving-phase/loan-phase payment-amount divergence: saving-phase
// recomputed target_price + tax_fees - down_payment_goal live, loan-phase used the separately
// stored loan_amount — nothing kept them in sync, so the displayed payment could change at
// activation even with "no other changes". getLoanPrincipal is the single shared formula both
// phases now go through.

function makeCarFund(overrides: Partial<CarFund>): CarFund {
  return {
    id: 'car-1', user_id: 'u1', vehicle_name: 'Test Car', target_price: 0, tax_fees: 0,
    down_payment_goal: 0, current_saved: 0, monthly_insurance: 0, expected_apr: 6,
    loan_term_months: 60, phase: 'saving', loan_amount: 0,
    loan_start_date: null, payment_start_date: null, interest_start_date: null,
    actual_monthly_payment: 0, linked_account: null, linked_rule_id: null, loan_payment_account: null,
    planned_purchase_date: null, gift_contribution: 0, lump_sum_payments: [], insurance_start_date: null, created_at: '2026-01-01',
    ...overrides,
  };
}

describe('getLoanPrincipal', () => {
  it('computes target_price + tax_fees - down_payment_goal for a saving-phase car fund', () => {
    const cf = makeCarFund({ phase: 'saving', target_price: 14000, tax_fees: 1000, down_payment_goal: 3000 });
    expect(getLoanPrincipal(cf)).toBe(12000);
  });

  it('uses the stored loan_amount for a loan-phase car fund, ignoring target_price/tax_fees/down_payment_goal', () => {
    const cf = makeCarFund({
      phase: 'loan', loan_amount: 11500,
      // Deliberately different from what the saving-phase formula would compute, to prove
      // loan-phase reads loan_amount directly rather than recomputing from these.
      target_price: 14000, tax_fees: 1000, down_payment_goal: 3000,
    });
    expect(getLoanPrincipal(cf)).toBe(11500);
  });

  it('never goes negative for a saving-phase car fund with down_payment_goal exceeding price+fees', () => {
    const cf = makeCarFund({ phase: 'saving', target_price: 5000, tax_fees: 0, down_payment_goal: 8000 });
    expect(getLoanPrincipal(cf)).toBe(0);
  });

  it('produces the same value for equivalent saving and loan phase records — the no-op-at-activation guarantee', () => {
    const saving = makeCarFund({ phase: 'saving', target_price: 14000, tax_fees: 1000, down_payment_goal: 3000 });
    // BuyItDialog's loan_amount default is exactly this formula's result, accepted with no edits.
    const loan = makeCarFund({ phase: 'loan', loan_amount: getLoanPrincipal(saving) });
    expect(getLoanPrincipal(loan)).toBe(getLoanPrincipal(saving));
  });
});
