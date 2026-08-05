import { describe, it, expect } from 'vitest';
import {
  FUNDING_ACCOUNT_TYPES,
  isUsableFundingAccount,
  resolveFundingAccountId,
} from '../funding-account';

type Acct = { id: string; active: boolean; account_type: string };

const accounts: Acct[] = [
  { id: 'checking-1', active: true, account_type: 'checking' },
  { id: 'checking-2', active: true, account_type: 'checking' },
  { id: 'biz-1', active: true, account_type: 'business_checking' },
  { id: 'cash-1', active: true, account_type: 'cash' },
  { id: 'savings-1', active: true, account_type: 'high_yield_savings' },
  { id: 'card-1', active: true, account_type: 'credit_card' },
  { id: 'closed-1', active: false, account_type: 'checking' },
];

describe('isUsableFundingAccount', () => {
  it.each(FUNDING_ACCOUNT_TYPES)('accepts an active %s account', type => {
    const id = accounts.find(a => a.account_type === type)!.id;
    expect(isUsableFundingAccount(accounts, id)).toBe(true);
  });

  it('rejects a non-fundable account type', () => {
    expect(isUsableFundingAccount(accounts, 'savings-1')).toBe(false);
    expect(isUsableFundingAccount(accounts, 'card-1')).toBe(false);
  });

  it('rejects an inactive account', () => {
    expect(isUsableFundingAccount(accounts, 'closed-1')).toBe(false);
  });

  it('rejects an id that names no account at all', () => {
    // Finding §2.8: a stale localStorage id — deleted account, or a real UUID read in demo mode.
    expect(isUsableFundingAccount(accounts, '933cbc10-bceb-4c20-8227-4a02e6db728a')).toBe(false);
  });

  it('rejects empty and nullish ids', () => {
    expect(isUsableFundingAccount(accounts, '')).toBe(false);
    expect(isUsableFundingAccount(accounts, null)).toBe(false);
    expect(isUsableFundingAccount(accounts, undefined)).toBe(false);
  });

  it('rejects everything when the account list is still empty (loading)', () => {
    expect(isUsableFundingAccount([], 'checking-1')).toBe(false);
  });
});

describe('resolveFundingAccountId', () => {
  it('returns the first usable candidate in priority order', () => {
    expect(resolveFundingAccountId(accounts, 'checking-2', 'checking-1')).toBe('checking-2');
  });

  it('falls through a stale candidate to the next usable one', () => {
    // The whole point: a persisted id that no longer resolves must not win over the default.
    expect(resolveFundingAccountId(accounts, 'stale-uuid', 'checking-1')).toBe('checking-1');
  });

  it('skips empty and nullish candidates', () => {
    expect(resolveFundingAccountId(accounts, '', null, undefined, 'cash-1')).toBe('cash-1');
  });

  it('returns null when no candidate resolves', () => {
    // null disables the funding-account exclusion instead of excluding every expense.
    expect(resolveFundingAccountId(accounts, 'stale-uuid', 'savings-1')).toBeNull();
  });

  it('returns null with no candidates', () => {
    expect(resolveFundingAccountId(accounts)).toBeNull();
  });
});
