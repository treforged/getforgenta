import { describe, it, expect } from 'vitest';
import { parseStatementPlans } from '../statement-plans';

// SYNTHETIC rows in the column layout pdf.js extracts from a Chase statement's plan tables.
// Every merchant, date and amount here is invented; no real statement data is in this file.
const POT = [
  'PURCHASES AND REDEMPTIONS ',
  'ACME HARDWARE #12   03/04/2026   $240.00   12   10   $200.00   $3.10   $23.10',
  'Lakeside Travel Co   03/04/2026   $600.00   6   6   $600.00   $7.50   $107.50',
  'NORTHWIND GOODS   03/04/2026   $1,200.00   12   12   $1,200.00   $12.00   $112.00',
  '$2,000.00   $2,040.00   $22.60   $242.60',
  'This amount is included in both your Minimum Payment Due and Interest Saving Balance.',
];
const EP = [
  'Equal Pay Promo   $500.00   $400.00   04/07/2027   ----   ----   ----   $50.00',
  'Equal Pay Promo   $2,400.00   $2,000.00   08/07/2027   ----   ----   ----   $200.00',
];
const RATE_ROWS = [
  'Equal Pay Promo   0.00%   (d)   $410.00   - 0 -',
  'Purchases   24.99%(v)(d)   - 0 -   - 0 -',
];

describe('parseStatementPlans', () => {
  it('reads every Pay Over Time column exactly and ignores the totals row', () => {
    const plans = parseStatementPlans(POT.join('\n'));
    expect(plans).toHaveLength(3);
    expect(plans[0]).toEqual({
      kind: 'pay_over_time', description: 'ACME HARDWARE #12', originalAmount: 240,
      remainingBalance: 200, monthlyPayment: 23.1, monthlyFee: 3.1, startDate: '2026-03-04',
      endDate: null, totalPayments: 12, remainingPayments: 10,
    });
    expect(plans[1].description).toBe('Lakeside Travel Co');
    expect(plans[2]).toMatchObject({ description: 'NORTHWIND GOODS', originalAmount: 1200, monthlyFee: 12, monthlyPayment: 112 });
  });

  it('reads Equal Pay rows with their expiry and no fee', () => {
    const plans = parseStatementPlans(EP.join('\n'));
    expect(plans).toEqual([
      { kind: 'equal_pay', description: 'Equal Pay Promo', originalAmount: 500, remainingBalance: 400,
        monthlyPayment: 50, monthlyFee: null, startDate: null, endDate: '2027-04-07', totalPayments: null, remainingPayments: null },
      { kind: 'equal_pay', description: 'Equal Pay Promo', originalAmount: 2400, remainingBalance: 2000,
        monthlyPayment: 200, monthlyFee: null, startDate: null, endDate: '2027-08-07', totalPayments: null, remainingPayments: null },
    ]);
  });

  it('still finds all five rows when the page arrives as one line', () => {
    const plans = parseStatementPlans([...POT.slice(1), ...EP].join(' '));
    expect(plans.map(p => [p.description, p.remainingBalance])).toEqual([
      ['ACME HARDWARE #12', 200], ['Lakeside Travel Co', 600], ['NORTHWIND GOODS', 1200],
      ['Equal Pay Promo', 400], ['Equal Pay Promo', 2000],
    ]);
  });

  it('finds nothing in rate rows or empty input', () => {
    expect(parseStatementPlans(RATE_ROWS.join('\n'))).toEqual([]);
    expect(parseStatementPlans('')).toEqual([]);
    expect(parseStatementPlans(null)).toEqual([]);
    expect(parseStatementPlans(undefined)).toEqual([]);
  });

  it('collapses a repeated table but keeps different plans with the same description', () => {
    const plans = parseStatementPlans([...EP, ...EP, ...POT, ...POT].join('\n'));
    expect(plans).toHaveLength(5);
    expect(plans.filter(p => p.kind === 'equal_pay')).toHaveLength(2);
  });

  it('skips a row with an impossible date or a balance above its original', () => {
    expect(parseStatementPlans('ACME   13/02/2026   $100.00   12   12   $100.00   $1.00   $9.00')).toEqual([]);
    expect(parseStatementPlans('ACME   09/02/2026   $100.00   12   12   $150.00   $1.00   $9.00')).toEqual([]);
    expect(parseStatementPlans('ACME   09/02/2026   $100.00   12   13   $100.00   $1.00   $9.00')).toEqual([]);
    expect(parseStatementPlans('Equal Pay Promo   $100.00   $150.00   07/07/2027   ----   ----   ----   $9.00')).toEqual([]);
  });
});
