// §1B Stage 6 — the four cases that could never produce a suggestion, and now can.
//
// Each `describe` below is one of them, and each opens with the REAL row shape that motivated it
// (2026-08-13, Tre's live database). Every assertion is about COVERAGE — that a suggestion exists at
// all — because in all four cases the shipped matcher was already correct and simply never asked.
//
// ⚠️ THE MATCHER ITSELF IS NOT RELAXED ANYWHERE, and the last describe is what pins that: a charge
// the old code would have refused must still be refused. If a future change makes these pass by
// widening a tolerance rather than by asking about more obligations, that block goes red.

import { describe, it, expect } from 'vitest';
import { buildReviewQueue } from '../bank-activity-queue';
import { paymentPlanObligations, carChargeObligations } from '../charge-obligations';
import { matchRuleOnDates, ruleChargeAccountId } from '../transaction-matching';
import type { CarFund } from '../types';

const ACCT = 'aaaaaaaa-0000-0000-0000-000000000001';
const CARD = 'bbbbbbbb-0000-0000-0000-000000000002';

const charge = (id: string, date: string, amount: number) => ({ id, account_id: ACCT, amount, date });
const cardCharge = (id: string, date: string, amount: number) => ({ id, account_id: CARD, amount, date });

/** The queue with only the arguments a case cares about; everything else empty. */
const queueOf = (input: Partial<Parameters<typeof buildReviewQueue>[0]>) =>
  buildReviewQueue({
    charges: [], reviewsByCharge: {}, rules: [], ledger: [], ...input,
  } as Parameters<typeof buildReviewQueue>[0]);

describe('case 1 — income rules, which read deposit_account and not payment_source', () => {
  // Live shape: `GF Half of Rent/Groceries`, monthly income, $1,100, due_day 28,
  // payment_source NULL, deposit_account 933cbc10… — so `matchCharge`'s first line returned null.
  const gfRule = {
    id: 'r-gf', name: 'GF Half of Rent/Groceries', amount: 1100, due_day: 28,
    frequency: 'monthly', rule_type: 'income', payment_source: null, deposit_account: ACCT,
    active: true,
  };

  it('resolves an income rule to its deposit account', () => {
    expect(ruleChargeAccountId(gfRule)).toBe(ACCT);
  });

  it('suggests the rule for the deposit that settles it', () => {
    // Inflow: Stage A signs inflows NEGATIVE.
    const deposit = charge('c1', '2026-06-28', -1100);
    const { suggestions } = queueOf({ charges: [deposit], rules: [gfRule] });
    expect(suggestions.c1?.rule?.id).toBe('r-gf');
  });

  it('leaves payment_source in charge when both columns are set — the fallback is additive only', () => {
    expect(ruleChargeAccountId({ ...gfRule, payment_source: CARD })).toBe(CARD);
  });

  it('does NOT read deposit_account on an expense rule, where it means the transfer destination', () => {
    const transferish = { ...gfRule, rule_type: 'expense', payment_source: null };
    expect(ruleChargeAccountId(transferish)).toBeNull();
  });

  it('still refuses a rule that names no account at all', () => {
    // The ~45 duplicate `Weekly Paycheck` rows in the live data are exactly this: no
    // payment_source, no deposit_account. They must stay inert.
    const orphan = { ...gfRule, id: 'r-orphan', deposit_account: null };
    const { suggestions } = queueOf({ charges: [charge('c1', '2026-06-28', -1100)], rules: [orphan] });
    expect(suggestions.c1).toBeUndefined();
  });
});

describe('case 2 — weekly and biweekly, whose due_day is a day of the WEEK', () => {
  // Live shape: `Weekly Paycheck`, weekly, $848.89, due_day 5 (Friday), deposit_account 933cbc10…,
  // start_date 2026-03-18 — 30 settled rows in 8 months and never once suggested.
  const weeklyPay = {
    id: 'r-pay', name: 'Weekly Paycheck', amount: 848.89, due_day: 5,
    frequency: 'weekly', rule_type: 'income', payment_source: null, deposit_account: ACCT,
    start_date: '2026-03-18', active: true,
  };
  // Live shape: `Fuel`, biweekly, $65, due_day 5, payment_source 9111bd9f…, created_at 2026-03-22.
  const fuel = {
    id: 'r-fuel', name: 'Fuel', amount: 65, due_day: 5,
    frequency: 'biweekly', rule_type: 'expense', payment_source: ACCT,
    created_at: '2026-03-22T05:16:36Z', active: true,
  };

  it('suggests the weekly rule for MORE THAN ONE paycheck in the same month', () => {
    // Fridays in August 2026: 7th, 14th, 21st, 28th.
    const charges = [
      charge('p1', '2026-08-07', -848.89),
      charge('p2', '2026-08-14', -848.89),
      charge('p3', '2026-08-21', -848.89),
    ];
    const { suggestions, suggestedCount } = queueOf({ charges, rules: [weeklyPay] });
    expect(suggestedCount).toBe(3);
    expect(Object.values(suggestions).every(s => s.rule?.id === 'r-pay')).toBe(true);
  });

  it('suggests a biweekly rule on its OWN phase, not on every matching weekday', () => {
    // Anchored at created_at 2026-03-22 (a Sunday) advanced to the next due_day-5 Friday,
    // 2026-03-27; stepping 14 days from there lands the August fill-ups on the 14th and the 28th.
    // The 7th and the 21st are Fridays this rule does NOT bill, and getting that wrong is the whole
    // reason `resolveBiweeklyAnchor` exists.
    const charges = [
      charge('f1', '2026-08-07', 65),
      charge('f2', '2026-08-14', 65),
      charge('f3', '2026-08-21', 65),
    ];
    const { suggestions } = queueOf({ charges, rules: [fuel] });
    expect(suggestions.f2?.rule?.id).toBe('r-fuel');
    // The off-phase Fridays get no suggestion. A wrong one here is what the phase anchor exists to
    // prevent, and it would have been accepted in one click by "Accept all suggested".
    expect(suggestions.f1).toBeUndefined();
    expect(suggestions.f3).toBeUndefined();
  });

  // ⚠️ MONTH-GRANULAR, and deliberately not tightened here. `getRuleOccurrenceDatesInMonth` gates a
  // weekly rule's `start_date` at the month boundary, so occurrences earlier in the START month are
  // still emitted; that is a known gap of the app's ONE occurrence definition
  // (`pay-schedule.recurringCoverage.test.ts`), and forking a stricter copy for suggestions would
  // give the queue and the link writer different ideas of when a rule began.
  it('honours start_date at month granularity — nothing from before the rule\'s first month', () => {
    const early = charge('e1', '2026-02-06', -848.89);
    const { suggestions } = queueOf({ charges: [early], rules: [weeklyPay] });
    expect(suggestions.e1).toBeUndefined();
  });

  it('matchRuleOnDates carries WHICH occurrence matched, so a biweekly link can be dated', () => {
    const matches = matchRuleOnDates(
      { ...fuel, due_day: 5 },
      ['2026-08-07', '2026-08-21'],
      [{ id: 'f1', account_id: ACCT, amount: 65, date: '2026-08-07', pending: false }],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].occurrenceDate).toBe('2026-08-07');
  });
});

describe('case 3 — payment plan instalments', () => {
  // Live shape, 2026-08-10 on Discover: `Cold Air Intake (DIY)` $98.9725 and `Exhaust` $356.855,
  // both monthly Paypal Pay in 4 plans starting 2026-08-10 on account 34c9574b…, showing on the
  // feed as `Paypal Pay in 4 -99` and `-357` with a picker and no suggestion.
  const intake = {
    id: 'p-intake', name: 'Cold Air Intake (DIY)', payment_amount: 98.9725, frequency: 'monthly',
    start_date: '2026-08-10', total_payments: 4, payment_source: `account:${CARD}`, active: true,
  };
  const exhaust = {
    id: 'p-exhaust', name: 'Exhaust', payment_amount: 356.855, frequency: 'monthly',
    start_date: '2026-08-10', total_payments: 4, payment_source: `account:${CARD}`, active: true,
  };

  it('suggests each plan for its own instalment', () => {
    const charges = [cardCharge('x1', '2026-08-10', 98.97), cardCharge('x2', '2026-08-10', 356.86)];
    const { suggestions } = queueOf({ charges, plans: [intake, exhaust] });
    expect(suggestions.x1?.plan?.id).toBe('p-intake');
    expect(suggestions.x2?.plan?.id).toBe('p-exhaust');
  });

  it('emits one obligation per instalment, on the plan account', () => {
    const obligations = paymentPlanObligations([intake]);
    expect(obligations).toHaveLength(4);
    expect(obligations[0].charge.accountId).toBe(CARD);
    expect(obligations.map(o => o.charge.dueDate)).toEqual(
      ['2026-08-10', '2026-09-10', '2026-10-10', '2026-11-10'],
    );
  });

  it('offers nothing for an inactive plan, matching the picker', () => {
    const charges = [cardCharge('x1', '2026-08-10', 98.97)];
    const { suggestions } = queueOf({ charges, plans: [{ ...intake, active: false }] });
    expect(suggestions.x1).toBeUndefined();
  });

  it('offers nothing for a plan with no payment source — there is no account to match on', () => {
    const charges = [cardCharge('x1', '2026-08-10', 98.97)];
    const { suggestions } = queueOf({ charges, plans: [{ ...intake, payment_source: null }] });
    expect(suggestions.x1).toBeUndefined();
  });
});

describe('case 4 — vehicle loan payments and insurance premiums', () => {
  // Live shape: `2004 Chevorlet C5`, phase loan, $16,530 @ 10.18% / 48mo, payment_start 2026-08-07,
  // actual payment $422.89, insurance $173.23 from 2026-06-25, loan_payment_account 933cbc10….
  const c5: CarFund = {
    id: 'cf-c5', user_id: 'u', vehicle_name: '2004 Chevorlet C5',
    target_price: 0, tax_fees: 0, down_payment_goal: 0, current_saved: 0,
    saved_source: 'fixed', saved_percent: 0,
    monthly_insurance: 173.23, expected_apr: 10.18, loan_term_months: 48, phase: 'loan',
    loan_amount: 16530, loan_start_date: '2026-06-21', payment_start_date: '2026-08-07',
    interest_start_date: '2026-08-07', insurance_start_date: '2026-06-25',
    actual_monthly_payment: 422.89, linked_account: ACCT, linked_rule_id: null,
    loan_payment_account: ACCT, linked_loan_account_id: null, planned_purchase_date: null,
    gift_contribution: 0, lump_sum_payments: [], created_at: '2026-06-21T00:00:00Z',
  } as CarFund;

  it('suggests the car payment for the debit that settles it', () => {
    const charges = [charge('v1', '2026-08-07', 422.89)];
    const { suggestions } = queueOf({ charges, carFunds: [c5] });
    expect(suggestions.v1?.carCharge?.kind).toBe('loan_payment');
    expect(suggestions.v1?.carCharge?.vehicleName).toBe('2004 Chevorlet C5');
  });

  it('suggests INSURANCE separately, on its own anchor and its own amount', () => {
    // Insurance runs from 2026-06-25, two months before the first loan payment — so this is a month
    // in which the vehicle bills exactly one thing, and it is not the payment.
    const charges = [charge('v2', '2026-07-25', 173.23)];
    const { suggestions } = queueOf({ charges, carFunds: [c5] });
    expect(suggestions.v2?.carCharge?.kind).toBe('insurance');
  });

  it('bills no insurance before the policy starts', () => {
    const obligations = carChargeObligations([c5], ['2026-05'], null);
    expect(obligations).toHaveLength(0);
  });

  it('bills no loan payment before payment_start_date', () => {
    const july = carChargeObligations([c5], ['2026-07'], null);
    expect(july.map(o => o.carChargeKind)).toEqual(['insurance']);
  });

  it('falls back to the funding account when the fund names none', () => {
    const unattributed = { ...c5, loan_payment_account: null };
    const withFallback = carChargeObligations([unattributed], ['2026-08'], ACCT);
    expect(withFallback.every(o => o.charge.accountId === ACCT)).toBe(true);
    // And with no fallback either, it yields nothing rather than guessing an account.
    expect(carChargeObligations([unattributed], ['2026-08'], null)).toHaveLength(0);
  });

  it('ignores a saving-phase fund — it bills nothing a bank charge could settle', () => {
    const saving = { ...c5, id: 'cf-civic', phase: 'saving' as const };
    expect(carChargeObligations([saving], ['2026-08'], ACCT)).toHaveLength(0);
  });
});

describe('the matcher is not relaxed — the refusals that must survive', () => {
  const plan = {
    id: 'p1', name: 'Exhaust', payment_amount: 356.855, frequency: 'monthly',
    start_date: '2026-08-10', total_payments: 4, payment_source: `account:${CARD}`, active: true,
  };

  it('refuses an instalment-sized charge outside the ±5 day window', () => {
    const { suggestions } = queueOf({ charges: [cardCharge('x1', '2026-08-20', 356.86)], plans: [plan] });
    expect(suggestions.x1).toBeUndefined();
  });

  it('refuses a charge on a different account', () => {
    const { suggestions } = queueOf({ charges: [charge('x1', '2026-08-10', 356.86)], plans: [plan] });
    expect(suggestions.x1).toBeUndefined();
  });

  it('refuses an inflow for an outflow obligation', () => {
    const { suggestions } = queueOf({ charges: [cardCharge('x1', '2026-08-10', -356.86)], plans: [plan] });
    expect(suggestions.x1).toBeUndefined();
  });

  it('refuses when two charges are equally good candidates for one instalment', () => {
    // The same shape as the three identical $10.00 CFX tolls: `matchCharge` sees two candidates in
    // the window and must say nothing about EITHER rather than flip a coin.
    const charges = [cardCharge('x1', '2026-08-10', 356.86), cardCharge('x2', '2026-08-11', 356.86)];
    const { suggestions, suggestedCount } = queueOf({ charges, plans: [plan] });
    expect(suggestedCount).toBe(0);
    expect(suggestions.x1).toBeUndefined();
    expect(suggestions.x2).toBeUndefined();
  });

  it('never suggests anything for a charge the user has already decided', () => {
    const charges = [cardCharge('x1', '2026-08-10', 356.86)];
    const { suggestions, needsDecision } = queueOf({
      charges, plans: [plan], reviewsByCharge: { x1: [{ status: 'ignored' }] },
    });
    expect(needsDecision).toHaveLength(0);
    expect(suggestions.x1).toBeUndefined();
  });
});
