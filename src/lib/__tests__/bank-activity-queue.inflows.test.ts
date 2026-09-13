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

/**
 * ⚠️ THE REGRESSION NEITHER CHANGE CAUSED ALONE.
 *
 * Tre, 2026-09-13: his weekly paycheck "should have auto-cleared and been recognised as his weekly
 * paycheck". Measured on his account that day — 2026-08-07, 08-14, 08-21 and 08-28 are ALL
 * `linked_rule` to Weekly Paycheck, four hand-links in four weeks, and 2026-09-04 sat unreviewed.
 *
 * The money-in exclusion above is right. Link-memory auto-apply is right. But the exclusion runs
 * FIRST and threw away the one charge the app had enough evidence to clear silently — the deck
 * builds its cards from `needsDecision`, so a hidden charge can never reach the gates that would
 * have cleared it. He got silence where he asked for recognition.
 *
 * The matcher cannot rescue this and must not try: his paycheck genuinely varies ($848.46,
 * $815.75, $814.96) against a 1% tolerance, and widening that band is forbidden outright.
 */
describe('an inflow the user has already taught us about is not unanswered', () => {
  const PAYROLL_RULE = {
    id: 'rule-paycheck', name: 'Weekly Paycheck', amount: 820, due_day: 5,
    frequency: 'weekly', rule_type: 'income', payment_source: null,
    deposit_account: ACCT, active: true,
  };
  /**
   * His real descriptor. The trailing PPD ID CHANGES between months (4521893632 in August,
   * 5521893632 in September) and `normalizeMerchant` strips it — verified by running the app's own
   * normalizer on both strings, which key identically to "LOCKHEED MARTIN PAYROLL". An earlier
   * draft interpolated the TEST id here instead, giving every charge a different merchant key and
   * no memory at all.
   */
  const payroll = (id: string, date: string, amount: number, ppd = '4521893632') => ({
    ...charge(id, date, amount),
    name: `LOCKHEED MARTIN PAYROLL PPD ID: ${ppd}`, merchant_name: null,
  });
  /**
   * ⚠️ THE AMOUNTS BELOW SIT OUTSIDE THE MATCHER'S 1% BAND ON PURPOSE, AND THE TEST IS WORTHLESS
   * WITHOUT THAT. A first draft used -814.96 against an 820 rule — 0.6% out, well inside the strong
   * tolerance — so `matchRuleOnDates` supplied a suggestion and the charge stayed in the queue for a
   * reason that had nothing to do with link memory. It passed with the fix REMOVED. $848.46 against
   * 820 is 3.5% out, which is his real spread and which the matcher genuinely cannot reach, so link
   * memory is the only evidence that can keep this row.
   */
  /** Two prior weeks he answered by hand — `MIN_LINKS_TO_REMEMBER` is 2. */
  const REMEMBERED = {
    'p-aug1': [{ status: 'linked_rule', rule_id: 'rule-paycheck', updated_at: '2026-08-21T00:00:00Z' }],
    'p-aug2': [{ status: 'linked_rule', rule_id: 'rule-paycheck', updated_at: '2026-08-28T00:00:00Z' }],
  };

  it('KEEPS the new paycheck in the queue, because this merchant has been linked before', () => {
    const q = queueOf({
      charges: [payroll('p-aug1', '2026-08-21', -814.97), payroll('p-aug2', '2026-08-28', -814.96),
                payroll('p-sep', '2026-09-04', -848.46, '5521893632')],
      reviewsByCharge: REMEMBERED,
      rules: [PAYROLL_RULE],
    });
    expect(q.needsDecision.map(c => c.id)).toContain('p-sep');
  });

  it('⚠️ STILL HIDES AN INFLOW FROM A MERCHANT NOBODY HAS EVER LINKED — the control', () => {
    // Without this, "keep everything" would pass the case above and undo the exclusion entirely.
    const q = queueOf({
      charges: [{ ...charge('z1', '2026-09-04', -100), name: 'Zelle payment from A FRIEND', merchant_name: null }],
      reviewsByCharge: {},
      rules: [PAYROLL_RULE],
    });
    expect(q.needsDecision.map(c => c.id)).not.toContain('z1');
  });

  it('⚠️ STILL HIDES IT WHEN THE REMEMBERED RULE HAS BEEN RETIRED', () => {
    // Offering a charge whose only evidence points at a rule the user deliberately ended would
    // resurrect a projection they killed. Silence is the safe direction.
    const q = queueOf({
      charges: [payroll('p-aug1', '2026-08-21', -814.97), payroll('p-aug2', '2026-08-28', -814.96),
                payroll('p-sep', '2026-09-04', -848.46, '5521893632')],
      reviewsByCharge: REMEMBERED,
      rules: [{ ...PAYROLL_RULE, active: false }],
    });
    expect(q.needsDecision.map(c => c.id)).not.toContain('p-sep');
  });

  it('⚠️ STILL HIDES IT WHEN THE AMOUNT COULD NOT PLAUSIBLY SETTLE THE RULE', () => {
    // A $15 inflow is not this $820 paycheck, however many times the merchant has been linked.
    const q = queueOf({
      charges: [payroll('p-aug1', '2026-08-21', -814.97), payroll('p-aug2', '2026-08-28', -814.96),
                payroll('p-sep', '2026-09-04', -15, '5521893632')],
      reviewsByCharge: REMEMBERED,
      rules: [PAYROLL_RULE],
    });
    expect(q.needsDecision.map(c => c.id)).not.toContain('p-sep');
  });

  it('leaves OUTFLOW behaviour untouched — this widens one filter, not the queue', () => {
    const q = queueOf({
      charges: [{ ...charge('o1', '2026-09-04', 42.5), name: 'Some Shop', merchant_name: null }],
      reviewsByCharge: {},
      rules: [PAYROLL_RULE],
    });
    expect(q.needsDecision.map(c => c.id)).toContain('o1');
  });
});
