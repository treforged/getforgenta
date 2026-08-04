import { describe, it, expect } from 'vitest';
import {
  aggregateNetWorth,
  buildNetWorthBreakdown,
  isLiabilityAccountType,
  totalsFromBreakdown,
  type NetWorthAccount,
} from '@/lib/net-worth';

const account = (over: Partial<NetWorthAccount> = {}): NetWorthAccount => ({
  name: 'Checking',
  account_type: 'checking',
  balance: 1000,
  active: true,
  ...over,
});

describe('isLiabilityAccountType', () => {
  it('covers every liability account type the app can create', () => {
    for (const type of ['credit_card', 'mortgage', 'student_loan', 'auto_loan', 'other_liability']) {
      expect(isLiabilityAccountType(type)).toBe(true);
    }
  });

  it('treats asset and unmapped types as non-liabilities', () => {
    for (const type of ['checking', 'hsa', 'ira', 'other_asset', 'something_new']) {
      expect(isLiabilityAccountType(type)).toBe(false);
    }
  });
});

describe('aggregateNetWorth', () => {
  it('subtracts loan accounts instead of counting them as assets', () => {
    // The old snapshot rule counted only credit cards, so this auto loan was
    // *added* to net worth: 2000 + 12000 = 14000 instead of 2000 - 12000.
    const totals = aggregateNetWorth(
      [
        account({ name: 'Checking', balance: 2000 }),
        account({ name: 'Chevy Loan', account_type: 'auto_loan', balance: 12000 }),
      ],
      [],
      [],
    );
    expect(totals).toEqual({ totalAssets: 2000, totalLiabilities: 12000, netWorth: -10000 });
  });

  it('counts a mortgage, which the Dashboard tile used to omit', () => {
    const totals = aggregateNetWorth(
      [
        account({ name: 'Checking', balance: 5000 }),
        account({ name: 'Home Loan', account_type: 'mortgage', balance: 250000 }),
      ],
      [],
      [],
    );
    expect(totals.totalLiabilities).toBe(250000);
    expect(totals.netWorth).toBe(-245000);
  });

  it('treats credit cards as liabilities and every other type as an asset', () => {
    const totals = aggregateNetWorth(
      [
        account({ name: 'Checking', account_type: 'checking', balance: 2000 }),
        account({ name: 'Brokerage', account_type: 'investment', balance: 5000 }),
        account({ name: 'Amex', account_type: 'credit_card', balance: 1500 }),
      ],
      [],
      [],
    );
    expect(totals).toEqual({ totalAssets: 7000, totalLiabilities: 1500, netWorth: 5500 });
  });

  it('ignores inactive accounts on both sides', () => {
    const totals = aggregateNetWorth(
      [
        account({ name: 'Old Savings', balance: 900, active: false }),
        account({ name: 'Closed Card', account_type: 'credit_card', balance: 400, active: false }),
        account({ name: 'Checking', balance: 100 }),
      ],
      [],
      [],
    );
    expect(totals).toEqual({ totalAssets: 100, totalLiabilities: 0, netWorth: 100 });
  });

  it('adds manual assets and liabilities to the live totals', () => {
    const totals = aggregateNetWorth(
      [account({ name: 'Checking', balance: 1000 })],
      [{ name: 'Car', value: 12000 }],
      [{ name: 'Student Loan', balance: 8000 }],
    );
    expect(totals).toEqual({ totalAssets: 13000, totalLiabilities: 8000, netWorth: 5000 });
  });

  it('drops manual rows whose name duplicates a live account, case-insensitively', () => {
    const totals = aggregateNetWorth(
      [
        account({ name: 'Checking', balance: 1000 }),
        account({ name: 'Amex', account_type: 'credit_card', balance: 500 }),
      ],
      [{ name: 'CHECKING', value: 999999 }],
      [{ name: 'amex', balance: 999999 }],
    );
    expect(totals).toEqual({ totalAssets: 1000, totalLiabilities: 500, netWorth: 500 });
  });

  it('coerces string balances coming back from Postgres numerics', () => {
    const totals = aggregateNetWorth(
      [account({ name: 'Checking', balance: '1500.50' })],
      [{ name: 'Car', value: '2000.25' }],
      [{ name: 'Loan', balance: '500.75' }],
    );
    expect(totals.totalAssets).toBeCloseTo(3500.75, 6);
    expect(totals.totalLiabilities).toBeCloseTo(500.75, 6);
    expect(totals.netWorth).toBeCloseTo(3000, 6);
  });

  it('returns zeroes when there is nothing to aggregate', () => {
    expect(aggregateNetWorth([], [], [])).toEqual({
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
    });
  });
});

describe('buildNetWorthBreakdown', () => {
  const accounts = [
    account({ id: 'a1', name: 'Checking', balance: 2000 }),
    account({ id: 'a2', name: 'HSA', account_type: 'hsa', balance: 500 }),
    account({ id: 'a3', name: 'Discover', account_type: 'credit_card', balance: 4000 }),
    account({ id: 'a4', name: 'Chevy Loan', account_type: 'auto_loan', balance: 12000 }),
    account({ id: 'a5', name: 'Closed', balance: 99, active: false }),
  ];
  const manualAssets = [{ id: 'm1', name: 'Coin Collection', type: 'Other', value: 300 }];
  const manualLiabilities = [{ id: 'm2', name: 'Family Loan', type: 'Personal Loan', balance: 700 }];

  it('itemises exactly the rows the totals are made of', () => {
    const breakdown = buildNetWorthBreakdown(accounts, manualAssets, manualLiabilities);
    expect(breakdown.assets.map(a => a.name)).toEqual(['Checking', 'HSA', 'Coin Collection']);
    expect(breakdown.liabilities.map(l => l.name)).toEqual(['Discover', 'Chevy Loan', 'Family Loan']);
    expect(totalsFromBreakdown(breakdown)).toEqual(
      aggregateNetWorth(accounts, manualAssets, manualLiabilities),
    );
  });

  it('labels rows by account-type group and namespaces ids by source', () => {
    const { assets, liabilities } = buildNetWorthBreakdown(accounts, manualAssets, manualLiabilities);
    expect(assets[1]).toMatchObject({ id: 'live:a2', type: 'Retirement', isLive: true });
    expect(assets[2]).toMatchObject({ id: 'manual:m1', type: 'Other', isLive: false });
    expect(liabilities[1]).toMatchObject({ id: 'live:a4', type: 'Auto Loan', isLive: true });
    expect(liabilities[2]).toMatchObject({ id: 'manual:m2', type: 'Personal Loan', isLive: false });
  });
});
