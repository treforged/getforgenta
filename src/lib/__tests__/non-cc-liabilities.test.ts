// The three ways the forecast's liability total used to disagree with the rows under it, each
// pinned as its own case. Would-fail checks are noted per test: they describe the OLD two-source
// behaviour (total from `debts`, rows from `accounts`), which every one of these now rejects.

import { describe, it, expect } from 'vitest';
import { buildNonCCLiabilities } from '@/lib/non-cc-liabilities';

const MONTHS = 6;
const acct = (over: Partial<{ id: string; name: string; account_type: string; balance: number | null }> = {}) => ({
  id: 'a1', name: 'Loan', account_type: 'auto_loan', balance: 10000, ...over,
});
const debt = (over: Partial<{ id: string; name: string; balance: number | null; apr: number | null; target_payment: number | null }> = {}) => ({
  id: 'd1', name: 'Loan', balance: 10000, apr: 0, target_payment: 0, ...over,
});

const sumRows = (r: ReturnType<typeof buildNonCCLiabilities>, m: number) =>
  r.rows.reduce((s, row) => s + row.balances[m], 0);

describe('buildNonCCLiabilities — the total is the rows', () => {
  it('counts an account that has no debts row (the Plaid auto_loan case)', () => {
    // Would-fail: the old total summed `debts` only, so this account showed a row worth $16,254
    // against a $0 contribution to Total Liabilities.
    const r = buildNonCCLiabilities({
      accounts: [acct({ name: 'FIXED RATE LOAN', balance: 16254.49 })],
      debts: [],
      months: MONTHS,
    });
    expect(r.rows.map(x => x.name)).toEqual(['FIXED RATE LOAN']);
    expect(r.totalByMonth[0]).toBeCloseTo(16254.49, 2);
    // No payment known, so it holds flat rather than pretending to amortize.
    expect(r.totalByMonth[5]).toBeCloseTo(16254.49, 2);
  });

  it('itemises a debts row that has no account', () => {
    // Would-fail: the old drawer mapped accounts only, so this $4,000 was in the total with no
    // row on screen to explain it.
    const r = buildNonCCLiabilities({
      accounts: [],
      debts: [debt({ name: 'Medical bill', balance: 4000, target_payment: 500 })],
      months: MONTHS,
    });
    expect(r.rows.map(x => x.name)).toEqual(['Medical bill']);
    expect(r.totalByMonth[0]).toBe(4000);
    expect(r.totalByMonth[2]).toBe(3000);
    expect(sumRows(r, 2)).toBe(r.totalByMonth[2]);
  });

  it('amortizes a matched pair once, so the row and the total cannot drift', () => {
    // Would-fail: the row was linear (`start - payment * i`) while the total compounded at the
    // apr, so month 5 disagreed by the interest the row never charged.
    const r = buildNonCCLiabilities({
      accounts: [acct({ name: 'Student Loan', balance: 12000 })],
      debts: [debt({ name: 'student loan', balance: 9999, apr: 12, target_payment: 300 })],
      months: MONTHS,
    });
    expect(r.rows).toHaveLength(1);
    // The ACCOUNT's balance wins over the stale manual 9999 (Tre, 2026-08-18).
    expect(r.rows[0].balances[0]).toBe(12000);
    // 12% apr = 1%/mo: 12000 → 12000*1.01 - 300 = 11820.
    expect(r.rows[0].balances[1]).toBeCloseTo(11820, 6);
    for (let m = 0; m < MONTHS; m++) expect(sumRows(r, m)).toBeCloseTo(r.totalByMonth[m], 6);
  });

  it('drops a linked vehicle loan from BOTH halves, account row and debts row alike', () => {
    const r = buildNonCCLiabilities({
      accounts: [acct({ id: 'veh', name: 'FIXED RATE LOAN', balance: 16254.49 })],
      debts: [debt({ name: 'Fixed Rate Loan', balance: 16530 })],
      excludedAccountIds: new Set(['veh']),
      months: MONTHS,
    });
    expect(r.rows).toHaveLength(0);
    expect(r.totalByMonth[0]).toBe(0);
  });

  it('leaves a debts row that mirrors a credit card to the card projection', () => {
    const r = buildNonCCLiabilities({
      accounts: [],
      debts: [debt({ name: 'Discover', balance: 5000 })],
      creditCardAccountNames: ['discover'],
      months: MONTHS,
    });
    expect(r.rows).toHaveLength(0);
    expect(r.totalByMonth[0]).toBe(0);
  });

  it('never reports a negative balance once a debt is paid off', () => {
    const r = buildNonCCLiabilities({
      accounts: [],
      debts: [debt({ name: 'Small loan', balance: 900, target_payment: 500 })],
      months: MONTHS,
    });
    expect(r.rows[0].balances).toEqual([900, 400, 0, 0, 0, 0]);
    expect(r.totalByMonth[5]).toBe(0);
  });

  it('gives two same-named accounts one debts row each rather than double-claiming it', () => {
    const r = buildNonCCLiabilities({
      accounts: [acct({ id: 'a1', name: 'Loan', balance: 1000 }), acct({ id: 'a2', name: 'Loan', balance: 2000 })],
      debts: [debt({ name: 'Loan', balance: 1, target_payment: 100 })],
      months: MONTHS,
    });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].balances[1]).toBe(900);   // claimed the payment
    expect(r.rows[1].balances[1]).toBe(2000);  // no second debts row to claim
    expect(r.totalByMonth[1]).toBe(2900);
  });
});
