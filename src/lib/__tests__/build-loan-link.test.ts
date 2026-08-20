import { describe, it, expect } from 'vitest';
import { resolveBuildCarFund, summarizeBuildCarFund } from '../build-loan-link';
import { getActiveCarLoanPayments } from '../vehicle-loan-engine';
import type { CarBuild, CarFund } from '../types';

// Tre, 2026-08-20: "on build page, allow users to connect car loan plan to the car."
//
// The numbers below are his real 2004 C5 (the same row `vehicle-loan-link.test.ts` is built on),
// because the point of the join is that the Build page quotes the SAME payoff date the Vehicles
// page and the forecast already quote. A test that invented its own loan would not check that.

function makeCarFund(overrides: Partial<CarFund> = {}): CarFund {
  return {
    id: 'car-1', user_id: 'u1', vehicle_name: '2004 Chevorlet C5', target_price: 0, tax_fees: 0,
    down_payment_goal: 0, current_saved: 0, saved_source: 'fixed', saved_percent: 0, sort_order: 0,
    auto_extra: false, monthly_insurance: 0, expected_apr: 10.18, loan_term_months: 48,
    phase: 'loan', loan_amount: 16530,
    loan_start_date: '2026-06-21', payment_start_date: '2026-08-07', interest_start_date: '2026-08-07',
    actual_monthly_payment: 422.89, linked_account: null, linked_rule_id: null,
    loan_payment_account: null, linked_loan_account_id: null,
    planned_purchase_date: null, gift_contribution: 0, lump_sum_payments: [],
    insurance_start_date: null, created_at: '2026-01-01',
    ...overrides,
  };
}

function makeBuild(overrides: Partial<CarBuild> = {}): CarBuild {
  return {
    id: 'b1', user_id: 'u1', name: 'C5 Build', year: 2004, make: 'Chevrolet', model: 'Corvette',
    notes: null, sort_order: 0, share_token: null, maintenance_public: false, pricing_public: true,
    photos: null, car_fund_id: null, created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const ASOF = new Date('2026-08-20T12:00:00Z');

describe('resolveBuildCarFund — the id is resolved, never trusted', () => {
  it('returns the connected fund', () => {
    const fund = makeCarFund();
    expect(resolveBuildCarFund(makeBuild({ car_fund_id: 'car-1' }), [fund])).toBe(fund);
  });

  it('returns null for an unconnected build', () => {
    expect(resolveBuildCarFund(makeBuild(), [makeCarFund()])).toBeNull();
  });

  // The FK guarantees the row exists; it cannot guarantee it is the caller's. A build pointed at
  // a fund the caller cannot see must read as unconnected rather than as anything else.
  it('returns null when the id is not among the callers own funds', () => {
    expect(resolveBuildCarFund(makeBuild({ car_fund_id: 'someone-elses' }), [makeCarFund()])).toBeNull();
  });

  it('survives missing inputs rather than throwing', () => {
    expect(resolveBuildCarFund(makeBuild({ car_fund_id: 'car-1' }), null)).toBeNull();
    expect(resolveBuildCarFund(makeBuild({ car_fund_id: 'car-1' }), [])).toBeNull();
    expect(resolveBuildCarFund(null, [makeCarFund()])).toBeNull();
    expect(resolveBuildCarFund(undefined, undefined)).toBeNull();
  });
});

describe('summarizeBuildCarFund — an active loan', () => {
  it('quotes the engine, to the cent, rather than a second model of it', () => {
    const fund = makeCarFund();
    const summary = summarizeBuildCarFund(fund, { asOf: ASOF });
    const engine = getActiveCarLoanPayments([fund], ASOF)[0];

    expect(summary.kind).toBe('loan');
    if (summary.kind !== 'loan') throw new Error('unreachable');
    expect(summary.payment).toBe(engine.payment);
    expect(summary.remainingBalance).toBe(engine.remainingBalance);
    expect(summary.payoffDate).toBe(engine.payoffDate);
    expect(summary.isDeferredInterest).toBe(engine.isDeferredInterest);
    expect(summary.vehicleName).toBe('2004 Chevorlet C5');
  });

  it('re-anchors to a linked account balance the same way every other surface does', () => {
    const drifted = summarizeBuildCarFund(makeCarFund(), { asOf: ASOF });
    const anchored = summarizeBuildCarFund(
      makeCarFund({ current_balance_override: 16254.49 }), { asOf: ASOF },
    );
    if (drifted.kind !== 'loan' || anchored.kind !== 'loan') throw new Error('unreachable');
    expect(anchored.remainingBalance).not.toBe(drifted.remainingBalance);
    expect(anchored.remainingBalance).toBeCloseTo(16254.49, 0);
  });
});

// The three ways a `phase: 'loan'` fund can have no active payment are NOT the same news, and
// collapsing them would print `$0` and a blank payoff date over all three.
describe('summarizeBuildCarFund — loan phase without an active payment', () => {
  it('reads as pending before the first payment is due', () => {
    const summary = summarizeBuildCarFund(
      makeCarFund({ loan_start_date: '2026-11-01', payment_start_date: '2026-12-01' }),
      { asOf: ASOF },
    );
    expect(summary).toEqual({
      kind: 'loan_pending', vehicleName: '2004 Chevorlet C5', paymentStartDate: '2026-12-01',
    });
  });

  it('reads as pending, with no date, when the dates were never filled in', () => {
    const summary = summarizeBuildCarFund(
      makeCarFund({ loan_start_date: null, payment_start_date: null }), { asOf: ASOF },
    );
    expect(summary).toEqual({
      kind: 'loan_pending', vehicleName: '2004 Chevorlet C5', paymentStartDate: null,
    });
  });

  it('reads as paid off when the schedule has nothing left owed', () => {
    const summary = summarizeBuildCarFund(
      makeCarFund({ loan_amount: 0, current_balance_override: 0 }), { asOf: ASOF },
    );
    expect(summary).toEqual({ kind: 'loan_paid', vehicleName: '2004 Chevorlet C5' });
  });
});

describe('summarizeBuildCarFund — still saving', () => {
  const saving = makeCarFund({
    phase: 'saving', vehicle_name: '2024 Honda Civic',
    target_price: 28000, tax_fees: 2000, down_payment_goal: 5600, current_saved: 1400,
    planned_purchase_date: '2027-04-01',
  });

  it('reports progress toward the down payment and the loan it implies', () => {
    const summary = summarizeBuildCarFund(saving, { asOf: ASOF });
    expect(summary).toEqual({
      kind: 'saving',
      vehicleName: '2024 Honda Civic',
      saved: 1400,
      downPaymentGoal: 5600,
      pct: 25,
      estimatedLoan: 28000 + 2000 - 5600,
      plannedPurchaseDate: '2027-04-01',
    });
  });

  it('resolves the saved figure through getCarFundSaved rather than current_saved', () => {
    const pctFund = { ...saving, saved_source: 'account_percent' as const, saved_percent: 50, linked_account: 'a1' };
    const summary = summarizeBuildCarFund(pctFund, { linkedAccountBalance: 3000, asOf: ASOF });
    if (summary.kind !== 'saving') throw new Error('unreachable');
    expect(summary.saved).toBe(1500);
  });

  it('falls back to the typed figure when the linked balance is unresolved', () => {
    const pctFund = { ...saving, saved_source: 'account_percent' as const, saved_percent: 50, linked_account: 'a1' };
    const summary = summarizeBuildCarFund(pctFund, { linkedAccountBalance: null, asOf: ASOF });
    if (summary.kind !== 'saving') throw new Error('unreachable');
    expect(summary.saved).toBe(1400);
  });

  it('caps the bar at 100% and never divides by a zero goal', () => {
    const over = summarizeBuildCarFund({ ...saving, current_saved: 9999 }, { asOf: ASOF });
    const noGoal = summarizeBuildCarFund({ ...saving, down_payment_goal: 0 }, { asOf: ASOF });
    if (over.kind !== 'saving' || noGoal.kind !== 'saving') throw new Error('unreachable');
    expect(over.pct).toBe(100);
    expect(noGoal.pct).toBe(0);
  });
});
