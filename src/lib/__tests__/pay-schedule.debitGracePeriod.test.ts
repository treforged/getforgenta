// THE GRACE PERIOD FOR A BILL THAT HAS NOT CLEARED.
//
// Tre, 2026-09-02: "my rent hasnt been taken out of my account yet, there should be a grace
// period. when this type of issue occurs, it can throw off other calculations for days."
//
// The `getRemainingTransaction*` helpers asked a bare `t.date > cutoffDate`, so a projected bill
// was dropped the instant Plaid's sync date passed its due date - on the DATE ALONE, with no check
// that the money had actually left. His rent is due the 1st and has cleared on the 2nd, 2nd, 2nd,
// 4th, 2nd, 2nd and 3rd across seven months, so from the 2nd it vanished from remaining expenses
// while $2,070 was still in the account and still about to go. Cash read HIGH - the unsafe
// direction - and stayed wrong until the debit landed.
//
// These assert NUMBERS, not the absence of a crash, because the defect was a number.
//
// Would-fail check: revert `isDebitStillOutstanding` to `date > cutoffDate` and the first two
// cases fail with the rent missing; widen it to income and the last case fails.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getRemainingTransactionExpensesByDay,
  getRemainingTransactionIncomeByDay,
} from '@/lib/pay-schedule';
import { SETTLEMENT_LAG_DAYS } from '@/lib/sync-cutoff';
import type { EnrichedTransaction } from '@/lib/pay-schedule';

/** His real rent occurrence: generated from a rule due on the 1st. */
const RENT: EnrichedTransaction = {
  id: 'gen:rent:2026-09-01', date: '2026-09-01', type: 'expense',
  amount: 2070, category: 'Bills', note: 'Rent (incl. internet, smart home, water)',
  isGenerated: true,
};

const INCOME: EnrichedTransaction = {
  id: 'gen:pay:2026-09-01', date: '2026-09-01', type: 'income',
  amount: 849, category: 'Income', note: 'Weekly Paycheck', isGenerated: true,
};

/** Mid-month so `dueAlreadyPassed` is false and the window is the plain one. */
const anchor = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-15T12:00:00'));
};

afterEach(() => vi.useRealTimers());

describe('a debit that has not cleared keeps being reserved', () => {
  it('is STILL COUNTED the day after the sync cutoff passes its due date', () => {
    anchor();
    // Rent due the 1st; Plaid last synced the 2nd. The money has not moved.
    const total = getRemainingTransactionExpensesByDay([RENT], 28, false, new Set(), new Set(), '2026-09-02');
    expect(total).toBe(2070);
  });

  it('is still counted throughout the whole grace window, to the last day of it', () => {
    anchor();
    // The window is SETTLEMENT_LAG_DAYS wide: a cutoff of due + 3 is the last one that keeps it.
    const lastKept = `2026-09-0${1 + SETTLEMENT_LAG_DAYS}`; // 2026-09-04
    expect(
      getRemainingTransactionExpensesByDay([RENT], 28, false, new Set(), new Set(), lastKept),
    ).toBe(2070);
  });

  it('drops once the grace window has genuinely expired', () => {
    anchor();
    // One day past the window. By now the charge really should have landed, and continuing to
    // reserve it would double-count against a balance that already reflects it.
    expect(
      getRemainingTransactionExpensesByDay([RENT], 28, false, new Set(), new Set(), '2026-09-05'),
    ).toBe(0);
  });

  it('the old behaviour was the bug: without the lag this money vanished on day two', () => {
    anchor();
    // Reproduces the defect exactly, so the fix cannot be quietly reverted: a bare date compare
    // against a 2 September cutoff excludes a 1 September charge.
    const bareCompare = RENT.date > '2026-09-02';
    expect(bareCompare).toBe(false);
    // ...while the shipped predicate keeps it.
    expect(
      getRemainingTransactionExpensesByDay([RENT], 28, false, new Set(), new Set(), '2026-09-02'),
    ).toBe(2070);
  });
});

describe('income does NOT get the grace period', () => {
  it('a deposit dated before the cutoff stays excluded', () => {
    anchor();
    // The lag exists because money LEAVES later than scheduled. A deposit already behind the sync
    // date is in the balance, and extending it three days would count the same paycheck twice.
    expect(
      getRemainingTransactionIncomeByDay([INCOME], 28, '2026-09-02'),
    ).toBe(0);
  });

  it('a deposit still ahead of the cutoff is counted, unchanged', () => {
    anchor();
    expect(
      getRemainingTransactionIncomeByDay([INCOME], 28, '2026-08-31'),
    ).toBe(849);
  });
});
