import { describe, it, expect } from 'vitest';
import { getAugmentedMinSafeCash, buildPayConfig } from '../pay-schedule';
import type { CarFund } from '../types';

// Regression for a user-reported gap: car insurance was subtracted as a normal monthly expense
// elsewhere, but never reserved by the cash floor itself — getAugmentedMinSafeCash protected a
// car's LOAN payment but never its monthly_insurance, in either phase.

const now = new Date(2026, 5, 20); // 2026-06-20
const config = buildPayConfig({});

function run(carFunds: Partial<CarFund>[]) {
  return getAugmentedMinSafeCash([], config, 1000, null, now, carFunds as CarFund[], null, 0);
}

describe('getAugmentedMinSafeCash — car insurance', () => {
  it('adds insurance for a loan-phase car, anchored to payment_start_date\'s day-of-month', () => {
    const cf: Partial<CarFund> = {
      vehicle_name: 'Real Account Car', phase: 'loan',
      // Day 1 (was the 7th): with now = 2026-06-20 the next-month cutoff is Jul 4, so a day-7
      // anchor is post-paycheck and correctly no longer reserved. This test asserts the anchoring
      // rule, so it uses a pre-paycheck day; the cutoff has its own suite
      // (pay-schedule.floorPrePaycheckCutoff.test.ts).
      monthly_insurance: 77, loan_start_date: '2026-01-01', payment_start_date: '2026-08-01',
      planned_purchase_date: null,
    };
    const { floorItems, prePaycheckBillsTotal } = run([cf]);
    const item = floorItems.find(i => i.name === 'Real Account Car insurance');
    expect(item).toBeDefined();
    expect(item!.amount).toBe(77);
    expect(item!.dueDay).toBe(1);
    expect(prePaycheckBillsTotal).toBeGreaterThanOrEqual(77);
  });

  it('adds insurance for a saving-phase car with a past purchase date, falling back to planned_purchase_date\'s day when payment_start_date is unset', () => {
    const cf: Partial<CarFund> = {
      vehicle_name: 'Saving Car', phase: 'saving',
      monthly_insurance: 50, loan_start_date: null, payment_start_date: null,
      planned_purchase_date: '2026-01-02', // day 2: pre-paycheck (was the 15th, now post-cutoff)
    };
    const { floorItems } = run([cf]);
    const item = floorItems.find(i => i.name === 'Saving Car insurance');
    expect(item).toBeDefined();
    expect(item!.amount).toBe(50);
    expect(item!.dueDay).toBe(2);
  });

  it('does not add insurance for a saving-phase car whose purchase date is still in the future — not owned yet', () => {
    const cf: Partial<CarFund> = {
      vehicle_name: 'Future Car', phase: 'saving',
      monthly_insurance: 90, loan_start_date: null, payment_start_date: '2026-12-01',
      planned_purchase_date: '2026-12-01',
    };
    const { floorItems } = run([cf]);
    expect(floorItems.find(i => i.name === 'Future Car insurance')).toBeUndefined();
  });

  it('adds nothing when monthly_insurance is 0', () => {
    const cf: Partial<CarFund> = {
      vehicle_name: 'No Insurance Car', phase: 'loan',
      monthly_insurance: 0, loan_start_date: '2026-01-01', payment_start_date: '2026-08-07',
      planned_purchase_date: null,
    };
    const { floorItems } = run([cf]);
    expect(floorItems.find(i => i.name === 'No Insurance Car insurance')).toBeUndefined();
  });
});
