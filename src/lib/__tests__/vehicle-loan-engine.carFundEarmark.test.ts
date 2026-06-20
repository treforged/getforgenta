import { describe, it, expect } from 'vitest';
import { getCarFundEarmark } from '../vehicle-loan-engine';
import type { CarFund } from '../types';

// Regression for a real user-reported bug: money already saved/gifted toward a saving-phase car's
// down payment, sitting in the same account used to fund credit-card payments, was never excluded
// from "available cash" anywhere — not incrementally, not at purchase. Confirmed against a real
// account where current_saved (1084.53) + gift_contribution (6700) already covers
// down_payment_goal (7700), with linked_account === the funding account ("TOTAL CHECKING").

function makeCarFund(overrides: Partial<CarFund>): CarFund {
  return {
    id: 'car-1', user_id: 'u1', vehicle_name: 'Test Car',
    target_price: 0, tax_fees: 0, down_payment_goal: 7700, current_saved: 1084.53,
    monthly_insurance: 77, expected_apr: 10.18, loan_term_months: 48,
    phase: 'saving', loan_amount: 0, loan_start_date: null,
    payment_start_date: '2026-08-07', interest_start_date: null, actual_monthly_payment: 0,
    linked_account: 'checking-1', linked_rule_id: null, loan_payment_account: null,
    planned_purchase_date: '2026-06-21', gift_contribution: 6700, lump_sum_payments: [],
    created_at: '2026-01-01',
    ...overrides,
  } as CarFund;
}

describe('getCarFundEarmark', () => {
  it('earmarks min(current_saved, down_payment_goal - gift_contribution) when linked_account equals the funding account', () => {
    const cf = makeCarFund({ linked_account: 'funding-acct' });
    expect(getCarFundEarmark([cf], 'funding-acct')).toBeCloseTo(1000, 2); // min(1084.53, 7700-6700)
  });

  it('earmarks the same amount when linked_account is null (no separate savings account at all)', () => {
    const cf = makeCarFund({ linked_account: null });
    expect(getCarFundEarmark([cf], 'funding-acct')).toBeCloseTo(1000, 2);
  });

  it('earmarks nothing when linked_account is a genuinely separate account — its balance already lives outside the funding account', () => {
    const cf = makeCarFund({ linked_account: 'separate-savings-acct' });
    expect(getCarFundEarmark([cf], 'funding-acct')).toBe(0);
  });

  it('caps the earmark at down_payment_goal - gift_contribution, never earmarking more than the buyer still needs to bring themselves', () => {
    const cf = makeCarFund({ linked_account: null, current_saved: 50000, down_payment_goal: 7700, gift_contribution: 6700 });
    expect(getCarFundEarmark([cf], null)).toBeCloseTo(1000, 2);
  });

  it('earmarks nothing once gift_contribution alone already covers the full goal', () => {
    const cf = makeCarFund({ linked_account: null, current_saved: 500, down_payment_goal: 7700, gift_contribution: 7700 });
    expect(getCarFundEarmark([cf], null)).toBe(0);
  });

  it('disappears the instant phase flips to loan — no separate release step needed', () => {
    const cf = makeCarFund({ linked_account: null, phase: 'loan' });
    expect(getCarFundEarmark([cf], null)).toBe(0);
  });

  it('sums across multiple saving-phase car funds sharing the same funding account', () => {
    const a = makeCarFund({ id: 'a', linked_account: null, current_saved: 500, down_payment_goal: 5000, gift_contribution: 0 });
    const b = makeCarFund({ id: 'b', linked_account: 'funding-acct', current_saved: 2000, down_payment_goal: 3000, gift_contribution: 1000 });
    // a: min(500, 5000-0)=500 ; b: min(2000, 3000-1000)=2000
    expect(getCarFundEarmark([a, b], 'funding-acct')).toBeCloseTo(2500, 2);
  });
});
