import { describe, it, expect } from 'vitest';
import {
  getUpfrontCardPlanDates, getUpfrontPlanProgress, deriveUpfrontPlanFields,
  getPaymentDates, PaymentPlan,
} from '../payment-plan-generator';
import { simulateVariablePayoff, CardData } from '../credit-card-engine';

// Regression for the upfront-plan due-date anchoring bug: a card-charged 'upfront' plan
// (Chase Plan It / Amazon monthly-payments style) had its installment stream anchored at the
// PURCHASE date, so installments counted as "paid" up to two statement cycles before anything
// was actually due. That understated the card's 0% installment carve-out (installmentBalance),
// leaking plan principal into the revolving balance at the card's full APR — which the
// avalanche then flooded with surplus (paying off interest-free debt early) while cards with
// real accruing interest sat pinned at their minimums.
//
// Real-data example this encodes: "Car Amazon Starter Pack" purchased 2026-06-23 on a card
// with due day 7 — the upcoming Jul 7 due date belongs to the statement that already closed,
// so the first installment is due Aug 7, not Jun 23 and not Jul 7.

function makePlan(overrides: Partial<PaymentPlan>): PaymentPlan {
  return {
    id: 'plan-1', user_id: 'u', name: 'Plan', provider: null,
    total_amount: 1200, payment_amount: 100, frequency: 'monthly',
    start_date: '2026-06-23', total_payments: 12, category: 'Shopping',
    payment_source: 'account:card-1', plan_type: 'upfront', notes: null,
    active: true, created_at: '2026-06-23T00:00:00Z',
    ...overrides,
  };
}

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 0, creditLimit: 10000,
    minPayment: 25, targetPayment: 25, monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: null, autopayFullBalance: false,
    dueDay: 7, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

describe('getUpfrontCardPlanDates — due-date anchoring', () => {
  it('first installment lands on the due date AFTER the upcoming one (Jun 23 purchase, due day 7 → Aug 7)', () => {
    const dates = getUpfrontCardPlanDates(makePlan({}), 7);
    expect(dates[0]).toBe('2026-08-07');
    expect(dates[1]).toBe('2026-09-07');
    expect(dates).toHaveLength(12);
    expect(dates[11]).toBe('2027-07-07');
  });

  it('a purchase ON the due day still skips that same-day due date and the next one', () => {
    // Purchased exactly on the 7th: that due date is today (statement long closed), the Jul 7
    // one belongs to the closing statement — first installment Aug 7.
    const dates = getUpfrontCardPlanDates(makePlan({ start_date: '2026-06-07' }), 7);
    expect(dates[0]).toBe('2026-08-07');
  });

  it('clamps the due day in short months instead of rolling into the next month', () => {
    const dates = getUpfrontCardPlanDates(makePlan({ start_date: '2026-12-15', total_payments: 3 }), 31);
    expect(dates[0]).toBe('2027-01-31'); // Dec 31 was the upcoming due date — skipped
    expect(dates[1]).toBe('2027-02-28'); // clamped from 31 in short February
  });

  it('falls back to the plain start_date stream when the card has no due day', () => {
    const plan = makePlan({});
    expect(getUpfrontCardPlanDates(plan, null)).toEqual(
      getPaymentDates(plan.start_date, plan.frequency, plan.total_payments),
    );
  });
});

describe('getUpfrontPlanProgress / deriveUpfrontPlanFields', () => {
  it('counts zero installments paid before the first real due date (the leak this fixes)', () => {
    // As of Jul 6: start_date anchoring counted Jun 23 (and, for a Jul 1 plan, Jul 1) as paid.
    // Due-date anchoring: nothing due until Aug 7 → 0 paid, full principal stays in the carve-out.
    const { paid, remaining } = getUpfrontPlanProgress(makePlan({}), 7, '2026-07-06');
    expect(paid).toBe(0);
    expect(remaining).toBe(12);
  });

  it('derives the full carve-out and a schedule with $0 due before the first due month', () => {
    // Mirrors the real account: two upfront plans on one card (4210 @ 12mo from Jun 23,
    // 995.97 @ 6mo from Jul 1), card balance 5675.58, due day 7, evaluated Jul 6.
    const card = makeCard({ id: 'card-1', balance: 5675.58, apr: 27.49 });
    const plans = [
      makePlan({ id: 'p1', total_amount: 4210, payment_amount: 350.8333333333333, total_payments: 12, start_date: '2026-06-23' }),
      makePlan({ id: 'p2', total_amount: 995.97, payment_amount: 165.995, total_payments: 6, start_date: '2026-07-01' }),
    ];
    const now = new Date(2026, 6, 6); // Jul 6 2026
    const { installmentByCard, upfrontPayByMonth } = deriveUpfrontPlanFields([card], plans, 36, now, '2026-07-01');

    const derived = installmentByCard.get('card-1')!;
    expect(derived.balance).toBeCloseTo(5205.97, 2); // 4210 + 995.97 — nothing pre-counted as paid
    expect(derived.monthlyPayment).toBeCloseTo(516.83, 2);

    expect(Object.keys(upfrontPayByMonth[0])).toHaveLength(0); // Jul: nothing due yet
    expect(upfrontPayByMonth[1]['card-1']).toBeCloseTo(516.83, 2); // Aug 7: both plans' first installment
    expect(upfrontPayByMonth[6]['card-1']).toBeCloseTo(516.83, 2); // Jan: both still running
    expect(upfrontPayByMonth[7]['card-1']).toBeCloseTo(350.83, 2); // Feb: 6-payment plan finished
    expect(upfrontPayByMonth[12]['card-1']).toBeCloseTo(350.83, 2); // Jul '27: last of 12
    expect(upfrontPayByMonth[13]?.['card-1']).toBeUndefined();
  });

  it('caps the carve-out at the card live balance', () => {
    const card = makeCard({ id: 'card-1', balance: 500 });
    const { installmentByCard } = deriveUpfrontPlanFields(
      [card], [makePlan({ payment_amount: 100, total_payments: 12 })], 36, new Date(2026, 6, 6), '2026-07-01',
    );
    expect(installmentByCard.get('card-1')!.balance).toBe(500);
  });
});

describe('simulateVariablePayoff — upfrontPayByMonth schedule', () => {
  // Positional params after monthEvents (arg 8) up to upfrontPayByMonth (arg 19):
  // fundingAccountId, cardPurchasesPerMonth, m0Income, m0Expenses, oneTimeByMonth,
  // month0SafeFloor, maxDebtPaymentByMonth, cashFloorByMonth, ccMinAlreadyInFloorByMonth,
  // installmentChargeByMonth — 10 params — THEN upfrontPayByMonth.
  const SKIP10 = Array(10).fill(undefined) as undefined[];

  it('pays the installment only in scheduled months (not from month 0), flat fallback unchanged', () => {
    const mk = () => makeCard({
      id: 'c1', name: 'C1', balance: 1000, apr: 20,
      installmentBalance: 500, installmentMonthlyPayment: 250,
    });
    const monthEvents = Array.from({ length: 4 }, () => ({ income: 3000, expenses: 1500 }));

    // Schedule: first installment due in month 1 (due-date-anchored), none in month 0.
    const schedule: { [cardId: string]: number }[] = [{}, { c1: 250 }, { c1: 250 }, {}];
    const scheduled = simulateVariablePayoff([mk()], 5000, 1000, 'avalanche', 3000, 1500, 4, monthEvents,
      ...SKIP10, schedule);
    // Flat legacy behavior: installment paid from month 0 while balance lasts.
    const flat = simulateVariablePayoff([mk()], 5000, 1000, 'avalanche', 3000, 1500, 4, monthEvents);

    // Month 0: scheduled sim pays no installment — its total payment is only the revolving
    // cascade; the flat sim's month-0 payment includes the $250 installment on top.
    // Both pay the card off fast with this much cash; the discriminating signal is the
    // installment balance trajectory: flat has consumed all $500 by end of month 1, while
    // the schedule doesn't finish it until end of month 2.
    const scheduledPays = scheduled.monthlyPayments.get('c1')!;
    const flatPays = flat.monthlyPayments.get('c1')!;
    expect(flatPays[0]).toBeGreaterThanOrEqual(250); // installment included at m0
    // Scheduled month 1 and 2 include the $250 installment; month 0 must not.
    expect(scheduledPays[1]).toBeGreaterThanOrEqual(250);
    expect(scheduledPays[2]).toBeGreaterThanOrEqual(250);
  });
});
