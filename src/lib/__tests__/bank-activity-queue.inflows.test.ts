/**
 * MONEY COMING IN IS NOT A SPENDING QUESTION.
 *
 * Tre, 2026-09-13: "have her look at my transactions requesting catorigization and help her
 * determine why these arent auto linking/sorting. thats the whole purpose of this. so users have
 * to think less."
 *
 * Measured against his real rows that day: 37 waiting, of which **26 were not spending** — 9 his
 * Lockheed payroll, plus an IRS refund, HealthEquity, a Stripe credit, a dividend, and 2 Discover
 * card payments. 16 of the 37 were money IN, totalling $8,128.44. The app was asking what category
 * his paycheck is.
 *
 * ⚠️ THE PAIR IS THE TEST, not the exclusion on its own. An inflow the matcher HAS an answer for
 * still belongs in the queue — it is one tap, and the link is what keeps the forecast's income
 * right. A filter that dropped those too would trade a prompt for a wrong number. So every case
 * below is "same row, with and without a suggestion".
 */
import { describe, it, expect } from 'vitest';
import { isUnansweredInflow, buildReviewQueue } from '../bank-activity-queue';

const ACCT = 'aaaaaaaa-0000-0000-0000-000000000001';
const charge = (id: string, date: string, amount: number) => ({ id, account_id: ACCT, amount, date });
const queueOf = (input: Partial<Parameters<typeof buildReviewQueue>[0]>) =>
  buildReviewQueue({
    charges: [], reviewsByCharge: {}, rules: [], ledger: [], ...input,
  } as Parameters<typeof buildReviewQueue>[0]);

describe('isUnansweredInflow — only the inflow nobody has an answer for', () => {
  it('HIDES an unanswered inflow: the paycheck with no suggestion', () => {
    // -814.96 is the real amount of the Lockheed payroll row that sat unreviewed.
    expect(isUnansweredInflow({ amount: -814.96 }, false)).toBe(true);
  });

  it('KEEPS the same inflow once the app has an answer for it', () => {
    // 25 of his payroll rows ARE linked to "Weekly Paycheck". Those are one-tap confirmations and
    // the income link feeds the projection — hiding them would be the worse failure.
    expect(isUnansweredInflow({ amount: -814.96 }, true)).toBe(false);
  });

  it('KEEPS an unanswered OUTFLOW — spending is exactly what the queue is for', () => {
    // The control. Without it, a filter that hid everything unanswered would pass the first case
    // and empty the product.
    expect(isUnansweredInflow({ amount: 42.5 }, false)).toBe(false);
  });

  it('KEEPS a zero-amount row — zero is not an inflow', () => {
    expect(isUnansweredInflow({ amount: 0 }, false)).toBe(false);
  });

  it('KEEPS a row whose amount cannot be read — absence of evidence is not an inflow', () => {
    // A NaN must not silently hide a charge. `Number('')` is 0 and `Number('abc')` is NaN; both
    // have to leave the row visible rather than guess about money.
    expect(isUnansweredInflow({ amount: Number.NaN }, false)).toBe(false);
    expect(isUnansweredInflow({ amount: 'not-a-number' as unknown as number }, false)).toBe(false);
  });

  it('reads a STRING amount, because numeric columns arrive as strings', () => {
    // `synced_transactions.amount` is `numeric`, which supabase-js hands back as a string. A
    // comparison that forgot the cast would silently never hide anything.
    expect(isUnansweredInflow({ amount: '-814.96' as unknown as number }, false)).toBe(true);
    expect(isUnansweredInflow({ amount: '42.50' as unknown as number }, false)).toBe(false);
  });
});

/**
 * ⚠️ THE BLOCK THAT PINS THE WIRING, AND IT EXISTS BECAUSE THE UNIT TESTS ABOVE DO NOT.
 *
 * Measured 2026-09-13: deleting the filter from `buildReviewQueue`'s call site left **3,303 tests
 * green**. Every case above exercises `isUnansweredInflow` directly, so they prove the rule is
 * correct and say nothing about whether anything calls it — the inert-gate shape this repo keeps
 * finding, and the third instance in one session.
 *
 * These assert on `needsDecision` itself, so a future "tidy-up" that drops the filter goes red.
 */
describe('buildReviewQueue — the filter is actually wired to the queue', () => {
  it('an unanswered inflow does NOT reach needsDecision', () => {
    const paycheck = charge('c-pay', '2026-09-04', -814.96);
    const { needsDecision } = queueOf({ charges: [paycheck] });
    expect(needsDecision.map(c => c.id)).not.toContain('c-pay');
  });

  it('an unanswered OUTFLOW still does — the queue is not emptied', () => {
    // The control. A filter hiding everything would satisfy the case above.
    const spend = charge('c-spend', '2026-09-04', 42.5);
    const { needsDecision } = queueOf({ charges: [spend] });
    expect(needsDecision.map(c => c.id)).toContain('c-spend');
  });

  it('an inflow the matcher HAS an answer for is kept, one tap from being linked', () => {
    // The income-rule shape from the coverage suite: income rules resolve through
    // `deposit_account`, and Stage A signs inflows negative.
    const incomeRule = {
      id: 'r-pay', name: 'Weekly Paycheck', amount: 1100, due_day: 28,
      frequency: 'monthly', rule_type: 'income', payment_source: null, deposit_account: ACCT,
      active: true,
    };
    const deposit = charge('c-in', '2026-06-28', -1100);
    const { needsDecision, suggestions } = queueOf({ charges: [deposit], rules: [incomeRule] });
    // Guard the premise: if the matcher stopped suggesting, this case would pass for the wrong
    // reason and quietly stop covering the exception it exists for.
    expect(suggestions['c-in']).toBeTruthy();
    expect(needsDecision.map(c => c.id)).toContain('c-in');
  });
});
