import { describe, it, expect } from 'vitest';
import { proposePlanTranches, payOverTimeEndDate } from '../statement-plan-tranches';
import type { BalanceTranche } from '../balance-tranches';
import type { StatementPlan } from '../statement-plans';

// Synthetic plans and tranches; no real account data.
const ep = (orig: number, rem: number, pay: number, end: string): StatementPlan => ({
  kind: 'equal_pay', description: 'Equal Pay Promo', originalAmount: orig, remainingBalance: rem,
  monthlyPayment: pay, monthlyFee: null, startDate: null, endDate: end, totalPayments: null, remainingPayments: null,
});
const pot = (desc: string, orig: number, rem: number, pay: number, fee: number, start: string, total: number): StatementPlan => ({
  kind: 'pay_over_time', description: desc, originalAmount: orig, remainingBalance: rem, monthlyPayment: pay,
  monthlyFee: fee, startDate: start, endDate: null, totalPayments: total, remainingPayments: total,
});
const ids = () => { let n = 0; return () => `new-${++n}`; };

const EXISTING: BalanceTranche[] = [
  { id: 'a', label: 'Equal Pay Promo (exp Apr 2027, orig $500.00)', balance: 450, apr: 0, promo_end_date: '2027-04-07', min_payment: 50, monthly_fee: null, fixed_term: false },
  { id: 'b', label: 'Pay Over Time - Acme Hardware (12 mo)', balance: 240, apr: 0, promo_end_date: '2027-03-07', min_payment: 23.1, monthly_fee: 3.1, fixed_term: true },
  { id: 'c', label: 'Balance transfer 7.99%', balance: 1000, apr: 7.99, promo_end_date: '2028-01-04', min_payment: null, monthly_fee: null, fixed_term: false },
  { id: 'd', label: 'Equal Pay Promo (exp Jan 2027, orig $90.00)', balance: 30, apr: 0, promo_end_date: '2027-01-07', min_payment: 15, monthly_fee: null, fixed_term: false },
];

describe('proposePlanTranches', () => {
  it('updates a matched Equal Pay promo by its original amount and keeps its id and label', () => {
    const p = proposePlanTranches(EXISTING, [ep(500, 400, 50, '2027-04-07')], 7, ids());
    expect(p.changes).toHaveLength(1);
    expect(p.changes[0].status).toBe('update');
    expect(p.changes[0].after).toMatchObject({ id: 'a', label: 'Equal Pay Promo (exp Apr 2027, orig $500.00)', balance: 400, min_payment: 50 });
  });

  it('reports an identical plan as unchanged', () => {
    const p = proposePlanTranches(EXISTING, [pot('ACME HARDWARE #12', 240, 240, 23.1, 3.1, '2026-03-04', 12)], 7, ids());
    expect(p.changes[0].status).toBe('unchanged');
    expect(p.changes[0].after.id).toBe('b');
  });

  it('adds an unknown plan with a derived label, 0% rate, fee and fixed term', () => {
    const p = proposePlanTranches(EXISTING, [pot('NORTHWIND GOODS', 1200, 1200, 112, 12, '2026-11-15', 12)], 7, ids());
    expect(p.changes[0]).toMatchObject({ status: 'new', before: null });
    expect(p.changes[0].after).toEqual({
      id: 'new-1', label: 'Pay Over Time - Northwind Goods (12 mo)', balance: 1200, apr: 0,
      promo_end_date: '2027-11-07', min_payment: 112, monthly_fee: 12, fixed_term: true,
    });
    expect(p.next).toHaveLength(5);
  });

  it('never drops a tranche: a plan missing from the statement is reported and kept, others untouched', () => {
    const p = proposePlanTranches(EXISTING, [ep(500, 400, 50, '2027-04-07')], 7, ids());
    expect(p.notOnStatement.map(t => t.id)).toEqual(['b', 'd']);
    expect(p.next.map(t => t.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(p.next[2]).toBe(EXISTING[2]);
  });

  it('matches by expiry only when exactly one promo expires that day', () => {
    const two: BalanceTranche[] = [
      { ...EXISTING[0], id: 'x', label: 'Equal Pay Promo', promo_end_date: '2027-07-07' },
      { ...EXISTING[0], id: 'y', label: 'Equal Pay Promo', promo_end_date: '2027-07-07' },
    ];
    expect(proposePlanTranches(two, [ep(700, 600, 60, '2027-07-07')], 7, ids()).changes[0].status).toBe('new');
    expect(proposePlanTranches([two[0]], [ep(700, 600, 60, '2027-07-07')], 7, ids()).changes[0].after.id).toBe('x');
  });

  it('does not match two statement plans onto the same tranche', () => {
    const p = proposePlanTranches(EXISTING, [ep(500, 400, 50, '2027-04-07'), ep(500, 400, 50, '2027-04-07')], 7, ids());
    expect(p.changes.map(c => c.status)).toEqual(['update', 'new']);
  });
});

describe('payOverTimeEndDate', () => {
  it('lands on the due day, total months after the start, wrapping the year and clamping short months', () => {
    expect(payOverTimeEndDate('2026-09-02', 12, 7)).toBe('2027-09-07');
    expect(payOverTimeEndDate('2026-11-15', 3, 31)).toBe('2027-02-28');
    expect(payOverTimeEndDate('2026-01-20', 6, null)).toBe('2026-07-20');
  });
});
