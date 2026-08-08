import { describe, it, expect } from 'vitest';
import { getSavingPhaseCarFund } from '../vehicle-loan-engine';
import type { CarFund } from '../types';

// User-reported (2026-08-06): the Dashboard kept showing "Car Goal: 2004 Chevorlet C5" with a
// saving progress bar after that loan was already active — the car had been bought. The Dashboard
// took carFunds[0] with no phase filter, so it also picked an arbitrary fund for a user with more
// than one. This pins the phase gate so a future refactor cannot quietly revert to carFunds[0].

function makeCarFund(overrides: Partial<CarFund>): CarFund {
  return {
    id: 'car-1', user_id: 'u1', vehicle_name: 'Test Car', target_price: 0, tax_fees: 0,
    down_payment_goal: 0, current_saved: 0, saved_source: 'fixed', saved_percent: 0, monthly_insurance: 0, expected_apr: 6,
    loan_term_months: 12, phase: 'loan', loan_amount: 12000,
    loan_start_date: '2026-01-01', payment_start_date: '2026-01-01', interest_start_date: '2026-01-01',
    actual_monthly_payment: 0, linked_account: null, linked_rule_id: null, loan_payment_account: null,
    planned_purchase_date: null, gift_contribution: 0, lump_sum_payments: [], insurance_start_date: null,
    created_at: '2026-01-01',
    ...overrides,
  };
}

describe('getSavingPhaseCarFund', () => {
  it('returns null when the only car fund is already in its loan phase', () => {
    // Tre's exact reproduction: one fund, phase 'loan', goal tile must disappear.
    expect(getSavingPhaseCarFund([makeCarFund({ phase: 'loan' })])).toBeNull();
  });

  it('returns the saving-phase fund even when a loan-phase fund is listed first', () => {
    const loanFund = makeCarFund({ id: 'loan-car', phase: 'loan' });
    const savingFund = makeCarFund({ id: 'saving-car', phase: 'saving' });
    expect(getSavingPhaseCarFund([loanFund, savingFund])?.id).toBe('saving-car');
  });

  it('returns the saving-phase fund when it is the only one', () => {
    expect(getSavingPhaseCarFund([makeCarFund({ phase: 'saving' })])?.id).toBe('car-1');
  });

  it('returns null for empty, null, and undefined inputs rather than throwing', () => {
    expect(getSavingPhaseCarFund([])).toBeNull();
    expect(getSavingPhaseCarFund(null)).toBeNull();
    expect(getSavingPhaseCarFund(undefined)).toBeNull();
  });

  it('does not fall back to a loan-phase fund when no fund is saving', () => {
    const funds = [makeCarFund({ id: 'a', phase: 'loan' }), makeCarFund({ id: 'b', phase: 'loan' })];
    expect(getSavingPhaseCarFund(funds)).toBeNull();
  });
});
