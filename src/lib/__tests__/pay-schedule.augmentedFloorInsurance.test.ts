import { describe, it, expect } from 'vitest';
import { getAugmentedMinSafeCash, buildPayConfig } from '../pay-schedule';

// Regression for a user-reported gap: car insurance was subtracted as a normal monthly expense
// elsewhere, but never reserved by the cash floor itself — getAugmentedMinSafeCash protected a
// car's LOAN payment but never its monthly_insurance, in either phase.

const now = new Date(2026, 5, 20); // 2026-06-20
const config = buildPayConfig({});

function run(carFunds: any[]) {
  return getAugmentedMinSafeCash([], config, 1000, null, now, carFunds, null, 0);
}

describe('getAugmentedMinSafeCash — car insurance', () => {
  it('adds insurance for a loan-phase car, anchored to payment_start_date\'s day-of-month', () => {
    const cf = {
      vehicle_name: 'Real Account Car', phase: 'loan',
      monthly_insurance: 77, loan_start_date: '2026-01-01', payment_start_date: '2026-08-07',
      planned_purchase_date: null,
    };
    const { floorItems, prePaycheckBillsTotal } = run([cf]);
    const item = floorItems.find(i => i.name === 'Real Account Car insurance');
    expect(item).toBeDefined();
    expect(item!.amount).toBe(77);
    expect(item!.dueDay).toBe(7);
    expect(prePaycheckBillsTotal).toBeGreaterThanOrEqual(77);
  });

  it('adds insurance for a saving-phase car with a past purchase date, falling back to planned_purchase_date\'s day when payment_start_date is unset', () => {
    const cf = {
      vehicle_name: 'Saving Car', phase: 'saving',
      monthly_insurance: 50, loan_start_date: null, payment_start_date: null,
      planned_purchase_date: '2026-01-15',
    };
    const { floorItems } = run([cf]);
    const item = floorItems.find(i => i.name === 'Saving Car insurance');
    expect(item).toBeDefined();
    expect(item!.amount).toBe(50);
    expect(item!.dueDay).toBe(15);
  });

  it('does not add insurance for a saving-phase car whose purchase date is still in the future — not owned yet', () => {
    const cf = {
      vehicle_name: 'Future Car', phase: 'saving',
      monthly_insurance: 90, loan_start_date: null, payment_start_date: '2026-12-01',
      planned_purchase_date: '2026-12-01',
    };
    const { floorItems } = run([cf]);
    expect(floorItems.find(i => i.name === 'Future Car insurance')).toBeUndefined();
  });

  it('adds nothing when monthly_insurance is 0', () => {
    const cf = {
      vehicle_name: 'No Insurance Car', phase: 'loan',
      monthly_insurance: 0, loan_start_date: '2026-01-01', payment_start_date: '2026-08-07',
      planned_purchase_date: null,
    };
    const { floorItems } = run([cf]);
    expect(floorItems.find(i => i.name === 'No Insurance Car insurance')).toBeUndefined();
  });
});
