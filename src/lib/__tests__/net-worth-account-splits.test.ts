// How the asset side splits on the Dashboard's overview strip.
//
// These three lists and the sum over them moved out of `Accounts.tsx` on 2026-08-22 when the
// tiles moved to the top of the Dashboard. A move must not change a figure, so what is pinned
// here is the historic membership of each list — in particular that `hsa` and `ira` are NOT in
// the Retirement tile even though ACCOUNT_TYPE_GROUP files them under "Retirement" for the
// breakdown list below it.
import { describe, it, expect } from 'vitest';
import {
  sumBalanceByAccountType,
  LIQUID_ACCOUNT_TYPES,
  INVESTMENT_ACCOUNT_TYPES,
  RETIREMENT_ACCOUNT_TYPES,
  type NetWorthAccount,
} from '../net-worth';

const acct = (account_type: string, balance: number | string): NetWorthAccount => ({
  name: `${account_type} account`,
  account_type,
  balance,
  active: true,
});

const ONE_OF_EACH: NetWorthAccount[] = [
  acct('checking', 1200),
  acct('savings', 800),
  acct('high_yield_savings', 5000),
  acct('business_checking', 300),
  acct('cash', 60),
  acct('brokerage', 14000),
  acct('roth_ira', 9000),
  acct('401k', 41000),
  acct('hsa', 2500),
  acct('ira', 7000),
  acct('other_asset', 15000),
  acct('credit_card', 6976.94),
];

describe('the overview strip splits', () => {
  it('counts liquid cash as the five spendable account types', () => {
    expect(sumBalanceByAccountType(ONE_OF_EACH, LIQUID_ACCOUNT_TYPES)).toBe(1200 + 800 + 5000 + 300 + 60);
  });

  it('counts only a brokerage as Investments', () => {
    expect(sumBalanceByAccountType(ONE_OF_EACH, INVESTMENT_ACCOUNT_TYPES)).toBe(14000);
  });

  it('counts Retirement as roth_ira + 401k, leaving hsa and ira out exactly as the tile always did', () => {
    expect(sumBalanceByAccountType(ONE_OF_EACH, RETIREMENT_ACCOUNT_TYPES)).toBe(9000 + 41000);
    // Stated as its own assertion because it is the surprising half: an HSA is grouped under
    // "Retirement" in the breakdown list, and moving the tile is not the moment to change what
    // the tile counts.
    expect(sumBalanceByAccountType(ONE_OF_EACH, RETIREMENT_ACCOUNT_TYPES)).not.toBe(9000 + 41000 + 2500 + 7000);
  });

  it('never counts one account in two tiles', () => {
    const lists = [LIQUID_ACCOUNT_TYPES, INVESTMENT_ACCOUNT_TYPES, RETIREMENT_ACCOUNT_TYPES];
    const all = lists.flatMap(l => [...l]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('reads a Postgres numeric string, and treats a null balance as nothing rather than NaN', () => {
    const rows: NetWorthAccount[] = [
      acct('checking', '1200.55'),
      { ...acct('savings', 0), balance: null as unknown as number },
    ];
    expect(sumBalanceByAccountType(rows, LIQUID_ACCOUNT_TYPES)).toBe(1200.55);
  });

  it('leaves an account type it does not know out of all three, rather than guessing a tile', () => {
    const rows = [acct('crypto', 9999)];
    expect(sumBalanceByAccountType(rows, LIQUID_ACCOUNT_TYPES)).toBe(0);
    expect(sumBalanceByAccountType(rows, INVESTMENT_ACCOUNT_TYPES)).toBe(0);
    expect(sumBalanceByAccountType(rows, RETIREMENT_ACCOUNT_TYPES)).toBe(0);
  });

  it('sums the list it is handed and does no filtering of its own', () => {
    // Callers pass an already-active-filtered list. Pinned so a caller that forgets cannot be
    // rescued silently here — an inactive account showing up in a tile is a caller bug.
    const inactive = [{ ...acct('checking', 500), active: false }];
    expect(sumBalanceByAccountType(inactive, LIQUID_ACCOUNT_TYPES)).toBe(500);
  });
});
