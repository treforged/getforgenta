/**
 * Akoya response normalisation.
 *
 * The FDX payload shape is the highest-risk part of the integration: it is a
 * category-keyed union, institutions populate different balance fields, and we
 * only had two of the six category keys confirmed in Akoya's docs. These tests
 * pin down the behaviour we rely on, including for categories we've never seen.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  mapAkoyaType,
  normalizeAkoyaAccounts,
  unwrapAccount,
} from '../../../supabase/functions/_shared/providers/akoya-normalize';

describe('unwrapAccount', () => {
  it('derives the category from the wrapper key', () => {
    expect(unwrapAccount({ investmentAccount: { accountId: '1' } })).toEqual({
      category: 'investment',
      account: { accountId: '1' },
    });
    expect(unwrapAccount({ depositAccount: { accountId: '2' } })?.category).toBe('deposit');
  });

  it('handles categories we have not seen in the docs', () => {
    // lineOfCredit / annuity / insurance follow the same convention but were
    // never confirmed literally — structural derivation must still work.
    expect(unwrapAccount({ lineOfCreditAccount: { accountId: '3' } })?.category)
      .toBe('lineofcredit');
    expect(unwrapAccount({ annuityAccount: { accountId: '4' } })?.category).toBe('annuity');
  });

  it('returns null when no account-shaped key is present', () => {
    expect(unwrapAccount({ somethingElse: { accountId: '1' } })).toBeNull();
    expect(unwrapAccount({ depositAccount: null as unknown as object })).toBeNull();
  });
});

describe('mapAkoyaType', () => {
  it('prefers the specific accountType over the category', () => {
    // A Roth IRA arrives under investmentAccount; the category alone would
    // mislabel it as a plain brokerage.
    expect(mapAkoyaType('investment', 'ROTHIRA')).toBe('roth_ira');
    expect(mapAkoyaType('investment', 'IRA')).toBe('401k');
    expect(mapAkoyaType('deposit', 'SAVINGS')).toBe('savings');
  });

  it('is insensitive to FDX enum casing and punctuation', () => {
    expect(mapAkoyaType('investment', 'Roth IRA')).toBe('roth_ira');
    expect(mapAkoyaType('investment', 'roth_ira')).toBe('roth_ira');
    expect(mapAkoyaType('deposit', 'Money Market')).toBe('savings');
  });

  it('falls back to the category when the type is unknown or missing', () => {
    expect(mapAkoyaType('deposit', undefined)).toBe('checking');
    expect(mapAkoyaType('investment', 'SOMETHING_NEW')).toBe('brokerage');
    expect(mapAkoyaType('lineofcredit', null)).toBe('credit_card');
    expect(mapAkoyaType('loan', '')).toBe('other_liability');
  });

  it('never returns undefined for a wholly unknown category', () => {
    expect(mapAkoyaType('somethingelse', 'whatever')).toBe('other_asset');
  });
});

describe('normalizeAkoyaAccounts', () => {
  it('returns an empty array for malformed payloads', () => {
    expect(normalizeAkoyaAccounts(null)).toEqual([]);
    expect(normalizeAkoyaAccounts({})).toEqual([]);
    expect(normalizeAkoyaAccounts({ accounts: 'nope' })).toEqual([]);
  });

  it('maps an investment account from the documented Akoya example', () => {
    const [account] = normalizeAkoyaAccounts({
      accounts: [{
        investmentAccount: {
          accountId: '426444887',
          accountType: 'IRA',
          nickname: 'My IRA',
          productName: 'RolloverIRA Investment Acct',
          currentValue: 69746.83,
        },
      }],
    });

    expect(account).toMatchObject({
      providerAccountId: '426444887',
      name: 'My IRA',
      accountType: '401k',
      balance: 69746.83,
      liabilityDataAvailable: false,
    });
  });

  it('prefers the settled balance over the available balance', () => {
    // A pending transaction must not make the displayed number jump around.
    const [account] = normalizeAkoyaAccounts({
      accounts: [{
        depositAccount: {
          accountId: 'a1',
          accountType: 'CHECKING',
          currentBalance: 1000,
          availableBalance: 850,
        },
      }],
    });
    expect(account.balance).toBe(1000);
  });

  it('reports balances as positive regardless of sign convention', () => {
    // Liability balances arrive negative from some institutions; the accounts
    // table stores magnitude and derives direction from account_type.
    const [account] = normalizeAkoyaAccounts({
      accounts: [{
        lineOfCreditAccount: {
          accountId: 'c1',
          accountType: 'CREDITCARD',
          currentBalance: -2400.5,
        },
      }],
    });
    expect(account.balance).toBe(2400.5);
    expect(account.accountType).toBe('credit_card');
  });

  it('flags liability data as available only for credit cards', () => {
    const accounts = normalizeAkoyaAccounts({
      accounts: [
        { lineOfCreditAccount: { accountId: 'c1', accountType: 'CREDITCARD' } },
        { depositAccount: { accountId: 'd1', accountType: 'CHECKING' } },
      ],
    });
    expect(accounts[0].liabilityDataAvailable).toBe(true);
    expect(accounts[1].liabilityDataAvailable).toBe(false);
  });

  it('defaults a missing balance to zero rather than NaN', () => {
    const [account] = normalizeAkoyaAccounts({
      accounts: [{ depositAccount: { accountId: 'd1', accountType: 'CHECKING' } }],
    });
    expect(account.balance).toBe(0);
  });

  it('skips accounts with no usable id instead of writing junk rows', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const accounts = normalizeAkoyaAccounts({
      accounts: [
        { depositAccount: { accountType: 'CHECKING' } },
        { depositAccount: { accountId: '', accountType: 'CHECKING' } },
        { depositAccount: { accountId: 'good', accountType: 'CHECKING' } },
      ],
    });
    expect(accounts.map(a => a.providerAccountId)).toEqual(['good']);
    warn.mockRestore();
  });

  it('coerces numeric strings, which FDX allows for money fields', () => {
    const [account] = normalizeAkoyaAccounts({
      accounts: [{
        lineOfCreditAccount: {
          accountId: 'c1',
          accountType: 'CREDITCARD',
          currentBalance: '1250.75',
          creditLine: '5000',
          minimumPaymentAmount: '35',
        },
      }],
    });
    expect(account.balance).toBe(1250.75);
    expect(account.creditLimit).toBe(5000);
    expect(account.minPayment).toBe(35);
  });

  it('falls back through the name fields in priority order', () => {
    const [noNickname] = normalizeAkoyaAccounts({
      accounts: [{
        investmentAccount: {
          accountId: 'i1',
          productName: 'Rollover IRA',
          description: 'desc',
        },
      }],
    });
    expect(noNickname.name).toBe('Rollover IRA');

    const [nothing] = normalizeAkoyaAccounts({
      accounts: [{ investmentAccount: { accountId: 'i2' } }],
    });
    expect(nothing.name).toBe('Account');
  });
});
