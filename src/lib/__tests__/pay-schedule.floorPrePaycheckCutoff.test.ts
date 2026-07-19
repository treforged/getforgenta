import { describe, it, expect } from 'vitest';
import { getAugmentedMinSafeCash, buildPayConfig } from '../pay-schedule';
import type { CarFund } from '../types';
import type { MinSafeCashCard } from '../pay-schedule';

// Q12 regression. getAugmentedMinSafeCash applied the "bills due before next month's first
// paycheck" cutoff to budget RULES only (via getPrePaycheckNextMonthBills). The three loops it
// adds afterward — car loan, car insurance, credit-card minimums — reserved by due day
// unconditionally, gated only by dueSynced (month-0 Plaid). An obligation due AFTER the first
// paycheck of next month is covered by that paycheck and must not be reserved from this month's
// ending cash.
//
// Fixture mirrors the live Aug 2026 case that surfaced this: first Sep 2026 paycheck is Fri
// Sep 4 (weekly, paycheckDay 5), so the cutoff is Sep 5. Day-7 obligations (car loan 422.89 +
// insurance 173.23 + PV min 510.50 = 1,106.62) are post-paycheck and must drop out of the floor;
// day-3 obligations are pre-paycheck and must stay.

const now = new Date(2026, 7, 15); // 2026-08-15 → next month window is Sep 2026
const config = buildPayConfig({});
const BASE_FLOOR = 2800;

const carFund = (dueDay: number, payment: number, insurance: number): Partial<CarFund> => ({
  vehicle_name: 'Car',
  phase: 'loan',
  monthly_insurance: insurance,
  loan_start_date: '2026-01-01',
  payment_start_date: `2026-08-${String(dueDay).padStart(2, '0')}`,
  planned_purchase_date: null,
  loan_amount: 20000,
  expected_apr: 5,
  loan_term_months: 60,
  interest_start_date: `2026-08-${String(dueDay).padStart(2, '0')}`,
  actual_monthly_payment: payment,
  lump_sum_payments: [],
});

const revolvingCard = (dueDay: number): MinSafeCashCard => ({
  id: 'pv', name: 'PV', dueDay, minPayment: 0,
  paymentPreference: null, autopayFullBalance: false,
});

function run(dueDay: number, opts: { payment?: number; insurance?: number; min?: number } = {}) {
  const { payment = 422.89, insurance = 173.23, min = 510.5 } = opts;
  return getAugmentedMinSafeCash(
    [], config, BASE_FLOOR, null, now,
    [carFund(dueDay, payment, insurance)] as CarFund[],
    {
      simCards: [revolvingCard(dueDay)],
      monthlyRevolvingBalances: new Map([['pv', [5000]]]),
      perCardMinPayments: new Map([['pv', [min]]]),
    },
    0,
  );
}

describe('getAugmentedMinSafeCash — pre-paycheck cutoff applies to loan/insurance/CC loops', () => {
  it('excludes a car loan payment due after next month\'s first paycheck', () => {
    const { floorItems } = run(7);
    expect(floorItems.find(i => i.name === 'Car loan')).toBeUndefined();
  });

  it('excludes car insurance due after next month\'s first paycheck', () => {
    const { floorItems } = run(7);
    expect(floorItems.find(i => i.name === 'Car insurance')).toBeUndefined();
  });

  it('excludes a revolving card minimum due after next month\'s first paycheck', () => {
    const { floorItems, ccRevolvingMinIncluded } = run(7);
    expect(floorItems.find(i => i.name === 'PV min')).toBeUndefined();
    expect(ccRevolvingMinIncluded).toBe(0);
  });

  it('collapses the floor to the base when every obligation is post-paycheck', () => {
    // 422.89 + 173.23 + 510.50 = 1,106.62 reserved pre-fix; all of it is post-paycheck, so the
    // pre-paycheck need falls below the base floor and the base wins.
    const { monthMinSafe, prePaycheckBillsTotal } = run(7);
    expect(prePaycheckBillsTotal).toBe(0);
    expect(monthMinSafe).toBe(BASE_FLOOR);
  });

  it('still reserves all three when they are due before the first paycheck', () => {
    const { floorItems, prePaycheckBillsTotal, ccRevolvingMinIncluded } = run(3);
    expect(floorItems.find(i => i.name === 'Car loan')).toBeDefined();
    expect(floorItems.find(i => i.name === 'Car insurance')).toBeDefined();
    expect(floorItems.find(i => i.name === 'PV min')).toBeDefined();
    expect(prePaycheckBillsTotal).toBeCloseTo(1106.62, 2);
    expect(ccRevolvingMinIncluded).toBeCloseTo(510.5, 2);
  });

  it('includes an obligation due ON the first paycheck day — the paycheck arrives that day', () => {
    const { floorItems } = run(4); // Fri Sep 4 2026
    expect(floorItems.find(i => i.name === 'Car insurance')).toBeDefined();
  });
});
