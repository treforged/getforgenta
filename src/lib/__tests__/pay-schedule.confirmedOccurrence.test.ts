import { describe, it, expect } from 'vitest';
import {
  getRemainingTransactionExpensesByDay,
  getRemainingTransactionExpenseItemsByDay,
  getRemainingTransactionExpensesThisMonth,
  type EnrichedTransaction,
} from '../pay-schedule';
import { buildConfirmedOccurrences } from '../confirmed-capture';

// §1B Stage 4A wiring. The three "remaining expenses" helpers drop a generated rule occurrence the
// user has confirmed a bank transaction already paid. The parameter is optional on purpose: with it
// omitted every helper must return exactly what it returned before Stage 4 existed, which is what
// lets call sites be wired one at a time. Each assertion below pairs the suppressed result with the
// un-suppressed one so a regression cannot pass by making both wrong.

const now = new Date();
const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const monthEndDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
// Last day of this month is always >= today, so the row sits inside the remaining window whichever
// day the suite runs on. The cutoff is the 1st, so the `t.date > cutoffDate` branch includes it.
const dateInWindow = `${monthStr}-${String(monthEndDay).padStart(2, '0')}`;
const cutoffDate = `${monthStr}-01`;

const RULE_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_RULE_ID = '22222222-2222-2222-2222-222222222222';

const generated = (ruleId: string, date: string, amount: number): EnrichedTransaction => ({
  id: `gen:${ruleId}:${date}`,
  date,
  type: 'expense',
  amount,
  category: 'Utilities',
  isGenerated: true,
} as EnrichedTransaction);

const manual = (id: string, date: string, amount: number): EnrichedTransaction => ({
  id,
  date,
  type: 'expense',
  amount,
  category: 'Utilities',
} as EnrichedTransaction);

const confirmedFor = (ruleId: string, monthKey: string) =>
  buildConfirmedOccurrences([{ status: 'linked_rule', rule_id: ruleId, occurrence_month: monthKey }]);

describe('§1B Stage 4A — confirmed occurrences in the remaining-expense helpers', () => {
  it('getRemainingTransactionExpensesByDay drops the confirmed occurrence and nothing else', () => {
    const txns = [generated(RULE_ID, dateInWindow, 120), generated(OTHER_RULE_ID, dateInWindow, 45)];
    const confirmed = confirmedFor(RULE_ID, monthStr);

    expect(getRemainingTransactionExpensesByDay(txns, 31, false, new Set(), new Set(), cutoffDate)).toBe(165);
    expect(getRemainingTransactionExpensesByDay(txns, 31, false, new Set(), new Set(), cutoffDate, confirmed)).toBe(45);
  });

  it('never suppresses a real ledger row, only generated rule expansions', () => {
    // A manual row whose id happens to be a bare uuid can never carry the `gen:` shape, and a
    // confirmation must not erase spending the user typed in by hand.
    const txns = [manual(RULE_ID, dateInWindow, 120)];
    const confirmed = confirmedFor(RULE_ID, monthStr);

    expect(getRemainingTransactionExpensesByDay(txns, 31, false, new Set(), new Set(), cutoffDate, confirmed)).toBe(120);
  });

  it('confirming one month does not pay another month of the same rule', () => {
    const txns = [generated(RULE_ID, dateInWindow, 120)];
    const otherMonth = confirmedFor(RULE_ID, '1999-01');

    expect(getRemainingTransactionExpensesByDay(txns, 31, false, new Set(), new Set(), cutoffDate, otherMonth)).toBe(120);
  });

  it('omitting the parameter is byte-identical to passing an empty confirmation set', () => {
    const txns = [generated(RULE_ID, dateInWindow, 120), manual('m1', dateInWindow, 45)];

    expect(getRemainingTransactionExpensesByDay(txns, 31, false, new Set(), new Set(), cutoffDate, new Set()))
      .toBe(getRemainingTransactionExpensesByDay(txns, 31, false, new Set(), new Set(), cutoffDate));
  });

  it('getRemainingTransactionExpenseItemsByDay drops the same row, so the tooltip matches the total', () => {
    const txns = [generated(RULE_ID, dateInWindow, 120), generated(OTHER_RULE_ID, dateInWindow, 45)];
    const confirmed = confirmedFor(RULE_ID, monthStr);

    const before = getRemainingTransactionExpenseItemsByDay(txns, 31, false, new Set(), new Set(), cutoffDate);
    const after = getRemainingTransactionExpenseItemsByDay(txns, 31, false, new Set(), new Set(), cutoffDate, confirmed);

    expect(before.map(i => i.amount)).toEqual([120, 45]);
    expect(after.map(i => i.amount)).toEqual([45]);
  });

  it('getRemainingTransactionExpensesThisMonth honours the confirmation too', () => {
    const txns = [generated(RULE_ID, dateInWindow, 120), generated(OTHER_RULE_ID, dateInWindow, 45)];
    const confirmed = confirmedFor(RULE_ID, monthStr);

    expect(getRemainingTransactionExpensesThisMonth(txns, false, cutoffDate)).toBe(165);
    expect(getRemainingTransactionExpensesThisMonth(txns, false, cutoffDate, undefined, undefined, confirmed)).toBe(45);
  });

  it('a linked_txn review confirms nothing — only linked_rule suppresses an occurrence', () => {
    const txns = [generated(RULE_ID, dateInWindow, 120)];
    const linkedTxn = buildConfirmedOccurrences([
      { status: 'linked_txn', rule_id: RULE_ID, occurrence_month: monthStr },
    ]);

    expect(getRemainingTransactionExpensesByDay(txns, 31, false, new Set(), new Set(), cutoffDate, linkedTxn)).toBe(120);
  });
});
