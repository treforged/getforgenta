import { describe, it, expect } from 'vitest';
import { getCarFundEarmark, resolveCarFundEarmark } from '../vehicle-loan-engine';
import type { CarFund } from '../types';

// Finding §2.9: the earmark was subtracted from one account's balance with no check that the saved
// cash is actually IN that account, and every caller clamped the difference at 0 on its own. A user
// whose down-payment savings live somewhere other than `linked_account` therefore saw
// "Balance on hand $0" with no explanation — the shortfall was destroyed by the clamp.
//
// `resolveCarFundEarmark` keeps the clamp in ONE place and preserves the part that used to be
// thrown away, so a UI can say WHY the balance went to zero. Tre's decision (2026-08-08): surface
// the shortfall; do not silently absorb it.

function makeCarFund(overrides: Partial<CarFund>): CarFund {
  return {
    id: 'car-1', user_id: 'u1', vehicle_name: 'Test Car',
    target_price: 0, tax_fees: 0, down_payment_goal: 7700, current_saved: 1084.53,
    monthly_insurance: 77, expected_apr: 10.18, loan_term_months: 48,
    phase: 'saving', loan_amount: 0, loan_start_date: null,
    payment_start_date: '2026-08-07', interest_start_date: null, actual_monthly_payment: 0,
    linked_account: 'checking-1', linked_rule_id: null, loan_payment_account: null, linked_loan_account_id: null, insurance_start_date: null,
    planned_purchase_date: '2026-06-21', gift_contribution: 6700, lump_sum_payments: [],
    created_at: '2026-01-01',
    ...overrides,
  } as CarFund;
}

describe('resolveCarFundEarmark', () => {
  it('applies the whole earmark and reports no shortfall when the account covers it', () => {
    const cf = makeCarFund({ linked_account: 'funding-acct' }); // requests 1000
    expect(resolveCarFundEarmark([cf], 'funding-acct', 2800)).toEqual({
      requested: 1000, applied: 1000, shortfall: 0,
    });
  });

  it('caps the earmark at the account balance and reports the difference as a shortfall', () => {
    // The §2.9 demo case in miniature: $3,200 claimed against an account holding $2,800.
    const cf = makeCarFund({ linked_account: 'd1', current_saved: 3200, down_payment_goal: 5600, gift_contribution: 0 });
    expect(resolveCarFundEarmark([cf], 'd1', 2800)).toEqual({
      requested: 3200, applied: 2800, shortfall: 400,
    });
  });

  it('reports the full request as shortfall when the account is empty', () => {
    const cf = makeCarFund({ linked_account: null, current_saved: 3200, down_payment_goal: 5600, gift_contribution: 0 });
    expect(resolveCarFundEarmark([cf], null, 0)).toEqual({
      requested: 3200, applied: 0, shortfall: 3200,
    });
  });

  it('treats an overdrawn account as zero available rather than earmarking into the negative', () => {
    const cf = makeCarFund({ linked_account: null, current_saved: 500, down_payment_goal: 5000, gift_contribution: 0 });
    expect(resolveCarFundEarmark([cf], null, -120)).toEqual({
      requested: 500, applied: 0, shortfall: 500,
    });
  });

  it('resolves to nothing at all once phase flips to loan, whatever the balance', () => {
    const cf = makeCarFund({ linked_account: null, phase: 'loan' });
    expect(resolveCarFundEarmark([cf], null, 2800)).toEqual({
      requested: 0, applied: 0, shortfall: 0,
    });
  });

  it('keeps `requested` identical to getCarFundEarmark — the resolution only adds the cap', () => {
    const cf = makeCarFund({ linked_account: 'funding-acct' });
    const requested = getCarFundEarmark([cf], 'funding-acct');
    expect(resolveCarFundEarmark([cf], 'funding-acct', 50).requested).toBeCloseTo(requested, 6);
  });

  // The no-regression guard for §2.9's refactor. Callers used to compute
  // `Math.max(0, balance - requested)` inline; they now compute `Math.max(0, balance) - applied`.
  // These must agree for every balance, or the fix silently moves a cash figure the whole debt
  // engine is built on.
  it('leaves the resulting spendable balance byte-identical to the old inline clamp', () => {
    const cf = makeCarFund({ linked_account: null, current_saved: 3200, down_payment_goal: 5600, gift_contribution: 0 });
    for (const balance of [-500, -0.01, 0, 0.01, 1200, 2800, 3199.99, 3200, 3200.01, 99999]) {
      const requested = getCarFundEarmark([cf], null);
      const { applied } = resolveCarFundEarmark([cf], null, balance);
      expect(Math.max(0, balance) - applied).toBeCloseTo(Math.max(0, balance - requested), 6);
    }
  });

  it('sums requests across funds before capping, so one fund cannot hide another', () => {
    const a = makeCarFund({ id: 'a', linked_account: null, current_saved: 500, down_payment_goal: 5000, gift_contribution: 0 });
    const b = makeCarFund({ id: 'b', linked_account: 'funding-acct', current_saved: 2000, down_payment_goal: 3000, gift_contribution: 1000 });
    expect(resolveCarFundEarmark([a, b], 'funding-acct', 1500)).toEqual({
      requested: 2500, applied: 1500, shortfall: 1000,
    });
  });
});
