// ⚠️ §2.4 Phase 2 depends on this stamp and NOTHING downstream can recover it: the generated row
// is the only place the originating `rule_type` is still in hand. Drop `isTransfer` from
// `generateMonthTransactionsFromRules` and `MonthlyExpenseModel.transfers` silently returns to 0
// with every other test still green — which is exactly how it sat at 0 for months.
import { describe, it, expect } from 'vitest';
import { generateMonthTransactionsFromRules } from '@/lib/pay-schedule';
import type { RuleRow, AccountRow } from '@/hooks/useSupabaseData';

const accounts = [
  { id: 'a1', name: 'Checking', account_type: 'checking', balance: 0, active: true },
  { id: 'a2', name: 'Roth', account_type: 'roth_ira', balance: 0, active: true },
] as unknown as AccountRow[];

const rule = (over: Record<string, unknown>) => ({
  id: 'r1', user_id: 'u', name: 'R', amount: 100, rule_type: 'expense',
  frequency: 'monthly', due_day: 5, due_month: null, start_date: '2026-01-01',
  end_date: null, category: 'Bills', payment_source: 'a1', deposit_account: null,
  active: true, notes: '', created_at: '', updated_at: '', ...over,
}) as unknown as RuleRow;

describe('generated rows carry where they came from', () => {
  it('marks transfer and investment rules, and nothing else', () => {
    const rules = [
      rule({ id: 'r-exp', rule_type: 'expense' }),
      rule({ id: 'r-xfer', rule_type: 'transfer', deposit_account: 'a2' }),
      rule({ id: 'r-inv', rule_type: 'investment', deposit_account: 'a2' }),
      rule({ id: 'r-inc', rule_type: 'income', payment_source: null, deposit_account: 'a1' }),
    ];
    const rows = generateMonthTransactionsFromRules(rules, accounts, 2026, 7);
    const flag = (id: string) => rows.find(r => r.ruleId === id)?.isTransfer;
    expect(flag('r-exp')).toBe(false);
    expect(flag('r-xfer')).toBe(true);
    expect(flag('r-inv')).toBe(true);
    expect(flag('r-inc')).toBe(false);
  });

  it('carries the rule id, so a row can be traced back to what made it', () => {
    const rows = generateMonthTransactionsFromRules([rule({ id: 'r-traced' })], accounts, 2026, 7);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.ruleId === 'r-traced')).toBe(true);
  });
});

// WHERE THE MONEY LANDED. Tre, 2026-09-02: transfers "need to show". They already appeared in
// Transactions, but styled as an expense and naming only the account they LEFT, so his $130
// "Owners Contribution" read as $130 of business spending rather than $130 sitting in another of
// his own accounts. `rawSource` in the generator keeps exactly one account per row, which is the
// whole story for an expense and half of it for a transfer.
//
// Would-fail check: drop `transferDestination` from the generator and the first case here goes
// red while every other test in this file stays green - the same silent shape as the `isTransfer`
// stamp above, which sat unread for months.
describe('generated transfer rows say where the money went', () => {
  it('carries the destination account for transfers and investments', () => {
    const rows = generateMonthTransactionsFromRules([
      rule({ id: 'r-xfer', rule_type: 'transfer', payment_source: 'a1', deposit_account: 'a2' }),
      rule({ id: 'r-inv', rule_type: 'investment', payment_source: 'a1', deposit_account: 'a2' }),
    ], accounts, 2026, 7);
    const dest = (id: string) => rows.find(r => r.ruleId === id)?.transferDestination;
    expect(dest('r-xfer')).toBe('a2');
    expect(dest('r-inv')).toBe('a2');
    // The source end must still be the account it LEFT, or the row would name one account twice.
    expect(rows.find(r => r.ruleId === 'r-xfer')?.payment_source).toContain('a1');
  });

  it('leaves it undefined on rows that are not transfers, rather than guessing', () => {
    const rows = generateMonthTransactionsFromRules([
      rule({ id: 'r-exp', rule_type: 'expense', deposit_account: 'a2' }),
      rule({ id: 'r-inc', rule_type: 'income', payment_source: null, deposit_account: 'a1' }),
    ], accounts, 2026, 7);
    // An expense rule can carry a deposit_account for other reasons; it is not a transfer
    // destination and must not be rendered as one.
    expect(rows.find(r => r.ruleId === 'r-exp')?.transferDestination).toBeUndefined();
    expect(rows.find(r => r.ruleId === 'r-inc')?.transferDestination).toBeUndefined();
  });

  it('is null, not a fabricated account, when a transfer names no destination', () => {
    const rows = generateMonthTransactionsFromRules([
      rule({ id: 'r-nodest', rule_type: 'transfer', payment_source: 'a1', deposit_account: null }),
    ], accounts, 2026, 7);
    expect(rows.find(r => r.ruleId === 'r-nodest')?.transferDestination).toBeNull();
    expect(rows.find(r => r.ruleId === 'r-nodest')?.isTransfer).toBe(true);
  });
});
