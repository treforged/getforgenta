// Quick add (ask 661548f5): the rules behind the bottom-bar `+` sheet.
//
// Would-fail checks: let "0" keep a leading zero and "keeps no leading zero" fails ("$05");
// allow a third decimal and "stops at cents" fails, which would save $3.999 as $4.00 silently;
// rank chips by recency alone and "ranks by count" fails; offer a deleted card as the default
// account and "ignores a source no longer on offer" fails; save income under the chip that was
// selected for an expense and "income always files as Income" fails.

import { describe, it, expect } from 'vitest';
import {
  pressKeypad, keypadValue, formatKeypadAmount, quickAddSaveLabel,
  topExpenseCategories, lastUsedChip, lastUsedPaymentSource, quickAddPayload,
  DEFAULT_EXPENSE_CHIPS, type KeypadKey,
} from '../quick-add';

const type = (keys: string) => [...keys].reduce((a, k) => pressKeypad(a, (k === '<' ? 'back' : k) as KeypadKey), '');

describe('pressKeypad', () => {
  it('builds an amount digit by digit', () => {
    expect(type('36')).toBe('36');
    expect(type('4.5')).toBe('4.5');
  });
  it('keeps no leading zero', () => {
    expect(type('05')).toBe('5');
    expect(type('0')).toBe('0');
  });
  it('starts a bare decimal as "0."', () => {
    expect(type('.5')).toBe('0.5');
  });
  it('allows one decimal point', () => {
    expect(type('3..5')).toBe('3.5');
  });
  it('stops at cents', () => {
    expect(type('3.999')).toBe('3.99');
  });
  it('caps the whole-dollar digits', () => {
    expect(type('123456789')).toBe('1234567');
  });
  it('backspace removes the last character, and is harmless on empty', () => {
    expect(type('36<')).toBe('3');
    expect(type('<')).toBe('');
    expect(type('3.<')).toBe('3');
  });
});

describe('display', () => {
  it('shows $0 before anything is typed', () => {
    expect(formatKeypadAmount('')).toBe('$0');
  });
  it('groups thousands and keeps decimals as typed', () => {
    expect(formatKeypadAmount('1234.5')).toBe('$1,234.5');
    expect(formatKeypadAmount('12.')).toBe('$12.');
  });
  it('the save label says the amount, cents only when there are any', () => {
    expect(quickAddSaveLabel('')).toBe('Add');
    expect(quickAddSaveLabel('0.')).toBe('Add');
    expect(quickAddSaveLabel('36')).toBe('Add $36');
    expect(quickAddSaveLabel('4.5')).toBe('Add $4.50');
    expect(quickAddSaveLabel('1250')).toBe('Add $1,250');
  });
  it('keypadValue reads partial input', () => {
    expect(keypadValue('')).toBe(0);
    expect(keypadValue('0.')).toBe(0);
    expect(keypadValue('12.3')).toBe(12.3);
  });
});

const row = (category: string, date: string, extra: Partial<{ type: string; created_at: string; payment_source: string }> = {}) =>
  ({ type: 'expense', category, date, ...extra });

describe('topExpenseCategories', () => {
  it('falls back to the everyday defaults with no history', () => {
    expect(topExpenseCategories([])).toEqual([...DEFAULT_EXPENSE_CHIPS]);
  });
  it('ranks by count, then by most recent', () => {
    const rows = [
      row('Dining', '2026-10-01'), row('Dining', '2026-10-02'),
      row('Pets', '2026-10-05'),
      row('Travel', '2026-09-01'),
      row('Gas', '2026-10-01'), row('Gas', '2026-10-03'), row('Gas', '2026-10-04'),
    ];
    expect(topExpenseCategories(rows, 4)).toEqual(['Gas', 'Dining', 'Pets', 'Travel']);
  });
  it('tops up from the defaults without repeating one', () => {
    expect(topExpenseCategories([row('Gas', '2026-10-01')], 3)).toEqual(['Gas', 'Groceries', 'Dining']);
  });
  it('never offers Income, Other, income rows or an unknown category', () => {
    const rows = [
      row('Income', '2026-10-01'), row('Other', '2026-10-01'), row('Made Up', '2026-10-01'),
      row('Travel', '2026-10-01', { type: 'income' }),
    ];
    expect(topExpenseCategories(rows)).toEqual([...DEFAULT_EXPENSE_CHIPS]);
  });
});

describe('lastUsedChip', () => {
  const chips = ['Groceries', 'Dining', 'Gas'];
  it('selects the most recently entered expense category when it is a chip', () => {
    const rows = [
      row('Dining', '2026-10-05', { created_at: '2026-10-05T10:00:00Z' }),
      row('Gas', '2026-10-01', { created_at: '2026-10-06T10:00:00Z' }),
    ];
    expect(lastUsedChip(rows, chips)).toBe('Gas');
  });
  it('selects nothing when the last category is not on screen', () => {
    expect(lastUsedChip([row('Travel', '2026-10-05')], chips)).toBeNull();
    expect(lastUsedChip([], chips)).toBeNull();
  });
});

describe('lastUsedPaymentSource', () => {
  const options = [{ value: 'cash' }, { value: 'account:card-1' }];
  it('starts on the account of the last entered expense', () => {
    const rows = [
      row('Gas', '2026-10-01', { created_at: '2026-10-01T09:00:00Z', payment_source: 'cash' }),
      row('Gas', '2026-09-01', { created_at: '2026-10-02T09:00:00Z', payment_source: 'account:card-1' }),
    ];
    expect(lastUsedPaymentSource(rows, options)).toBe('account:card-1');
  });
  it('ignores a source no longer on offer', () => {
    const rows = [row('Gas', '2026-10-01', { payment_source: 'account:deleted' })];
    expect(lastUsedPaymentSource(rows, options)).toBe('');
  });
});

describe('quickAddPayload', () => {
  const base = { type: 'expense' as const, amount: '36', category: 'Groceries', date: '2026-10-08', paymentSource: 'cash', note: '' };
  it('writes the same one-off shape the full form writes', () => {
    expect(quickAddPayload(base)).toEqual({
      date: '2026-10-08', type: 'expense', amount: 36, category: 'Groceries',
      account: 'Checking', note: 'Transaction', payment_source: 'cash',
    });
  });
  it('refuses a zero amount', () => {
    expect(quickAddPayload({ ...base, amount: '' })).toBeNull();
    expect(quickAddPayload({ ...base, amount: '0.' })).toBeNull();
  });
  it('income always files as Income', () => {
    expect(quickAddPayload({ ...base, type: 'income' })?.category).toBe('Income');
  });
  it('refuses an unknown category', () => {
    expect(quickAddPayload({ ...base, category: 'Made Up' })).toBeNull();
  });
  it('keeps cents exact', () => {
    expect(quickAddPayload({ ...base, amount: '4.5' })?.amount).toBe(4.5);
  });
});
