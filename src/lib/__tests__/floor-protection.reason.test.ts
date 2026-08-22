import { describe, it, expect } from 'vitest';
import { computeFloorProtection, type FloorProtectionParams } from '../floor-protection';
import { PROJECTION_MONTHS } from '../scheduling';
import { formatCurrency } from '../calculations';
import type { CarFund } from '../types';

// describeBreach's output was untested repo-wide, which is how a $2,443 reserve driven by a pinned
// credit-card statement came to be reported to the user as "$200 Pay sibling to watch dogs" — the
// biggest one-time transaction that month, with no causal link to the reserve at all.
//
// `ccMandatoryReasonByMonth` is labeling only. Case 2 is the guard that proves that: forecast-engine
// is the other caller of computeFloorProtection, passes nothing, and must be byte-identical.

const NOW = new Date(2026, 7, 22);

/** A month-1 floor step-up with no room to fund it — forces `cap < natural - 1` at month 0. */
function buildParams(overrides: Partial<FloorProtectionParams> = {}): FloorProtectionParams {
  const zeros = () => Array(PROJECTION_MONTHS).fill(0);
  const floorByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, m) => (m === 0 ? 1000 : 4000));
  return {
    incomeByMonth: Array(PROJECTION_MONTHS).fill(5000),
    expenseByMonth: Array(PROJECTION_MONTHS).fill(4500),
    oneTimeNetByMonth: zeros(),
    carDownPaymentByMonth: zeros(),
    floorByMonth,
    startingBalance: 4000,
    ccMinTotal: 200,
    cyclingExcessByMonth: zeros(),
    carFunds: [],
    transactions: [],
    ccSourceIds: new Set<string>(),
    now: NOW,
    formatCurrency,
    ...overrides,
  };
}

const REASON = "Prime Visa's $2,845 statement, due the 7th";

describe('computeFloorProtection save-up reason', () => {
  it('prefers the pinned-statement reason over the spending heuristics', () => {
    const ccMandatoryReasonByMonth: (string | null)[] = Array(PROJECTION_MONTHS).fill(null);
    ccMandatoryReasonByMonth[1] = REASON;
    const r = computeFloorProtection(buildParams({ ccMandatoryReasonByMonth }));

    expect(r.saveUpMonths.has(0)).toBe(true);
    expect(r.saveUpReason.get(0)!.eventName).toBe(REASON);
    // monthLabel is still derived from the breach month, not from the reason string.
    expect(r.saveUpReason.get(0)!.monthLabel).toBe('September 2026');
  });

  it('is byte-identical when the field is omitted or all-null (the forecast-engine guard)', () => {
    const baseline = computeFloorProtection(buildParams());
    const allNull = computeFloorProtection(buildParams({
      ccMandatoryReasonByMonth: Array(PROJECTION_MONTHS).fill(null),
    }));
    const withReason = computeFloorProtection(buildParams({
      ccMandatoryReasonByMonth: Array.from({ length: PROJECTION_MONTHS }, (_, m) => (m === 1 ? REASON : null)),
    }));

    expect(allNull.saveUpReason.get(0)!.eventName).toBe(baseline.saveUpReason.get(0)!.eventName);
    // The cash math is untouched by the label, present or absent.
    expect(withReason.maxDebtPaymentByMonth).toEqual(baseline.maxDebtPaymentByMonth);
    expect([...withReason.saveUpMonths]).toEqual([...baseline.saveUpMonths]);
    expect([...withReason.strictSaveUpMonths]).toEqual([...baseline.strictSaveUpMonths]);
  });

  it('wins the tie-break against a car down payment in the same month', () => {
    const carDownPaymentByMonth = Array(PROJECTION_MONTHS).fill(0);
    carDownPaymentByMonth[1] = 3000;
    const carFunds = [{
      id: 'cf1', vehicle_name: 'Bronco', phase: 'saving', down_payment_goal: 3000,
      gift_contribution: 0, current_saved: 0, planned_purchase_date: '2026-09-01',
    } as unknown as CarFund];

    const withoutReason = computeFloorProtection(buildParams({ carDownPaymentByMonth, carFunds }));
    expect(withoutReason.saveUpReason.get(0)!.eventName).toContain('Bronco');

    const withReason = computeFloorProtection(buildParams({
      carDownPaymentByMonth, carFunds,
      ccMandatoryReasonByMonth: Array.from({ length: PROJECTION_MONTHS }, (_, m) => (m === 1 ? REASON : null)),
    }));
    expect(withReason.saveUpReason.get(0)!.eventName).toBe(REASON);
  });

  it('is read at the BREACH month, not the save-up month', () => {
    // The reason parked one month past the breach must not be picked up.
    const r = computeFloorProtection(buildParams({
      ccMandatoryReasonByMonth: Array.from({ length: PROJECTION_MONTHS }, (_, m) => (m === 2 ? REASON : null)),
    }));
    expect(r.saveUpMonths.has(0)).toBe(true);
    expect(r.saveUpReason.get(0)!.eventName).not.toBe(REASON);
    expect(r.saveUpReason.get(0)!.eventName).toBe('upcoming expense');
  });
});
