import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { unconditionalDesired, settleUnconditional } from '../unconditional-payment';
import type { CardData } from '../credit-card-engine';

/**
 * "ALWAYS PAY THIS" CANNOT DEMAND A PAYMENT THAT IS NOT OWED YET.
 *
 * Tre, 2026-09-17, on his own account: "Robinhood is charging for this month ... when it doesn't
 * start till October 10. that payment is causing a shortage of my account which is incorrect. I
 * thought we set this up to be fixed."
 *
 * He was right that it was set up: `first_payment_due_date` and `firstPaymentDueMonthOffset` have
 * existed since 2026-09-05. They were wired into the MINIMUM path only - `minSuppressed` in
 * credit-card-engine, applied at five sites. An unconditional card never reaches any of them: it
 * is settled OFF THE TOP, before minimums and before the cascade. So a card opened in August whose
 * first bill lands on 10 October sent its whole balance in September and REPORTED THE GAP AS A
 * SHORTFALL - the month was declared short because of a payment nobody had asked for.
 *
 * ARM 1 IS THE POSITIVE CONTROL AND RUNS FIRST. Every other arm here asserts that something is NOT
 * demanded, and a `unconditionalDesired` that returned 0 for everybody would satisfy all of them
 * perfectly while breaking the feature completely.
 */
const card = (o: Partial<CardData> = {}): CardData => ({
  id: 'rh', name: 'Robinhood Credit Card', balance: 211.62, apr: 29.99, creditLimit: 5250,
  minPayment: 0, minPaymentIsManual: true, targetPayment: 211.62,
  monthlyNewPurchases: 0, monthlyRepayments: 0, color: '#000',
  paymentPreference: 'full', autopayFullBalance: false, dueDay: 10,
  statementBalancePhase: false, statementBalance: null,
  paymentUnconditional: true,
  ...o,
} as CardData);

describe('an unconditional card whose first payment is not due yet', () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-17T12:00:00')); });
  afterAll(() => { vi.useRealTimers(); });

  it('POSITIVE CONTROL: with no first due date recorded it still wants the whole balance', () => {
    expect(unconditionalDesired(card())).toBe(211.62);
  });

  it('wants NOTHING when its first payment is due next month - the defect Tre reported', () => {
    expect(unconditionalDesired(card({ firstDueDate: '2026-10-10' }))).toBe(0);
  });

  it('still wants the balance when the first payment is due THIS month', () => {
    expect(unconditionalDesired(card({ firstDueDate: '2026-09-28' }))).toBe(211.62);
  });

  it('falls back to normal once the first due month has gone by', () => {
    expect(unconditionalDesired(card({ firstDueDate: '2026-07-10' }))).toBe(211.62);
  });

  it('a card that is not unconditional is unaffected either way', () => {
    expect(unconditionalDesired(card({ paymentUnconditional: false, firstDueDate: '2026-10-10' }))).toBe(0);
    expect(unconditionalDesired(card({ paymentUnconditional: false }))).toBe(0);
  });

  it('REPORTS NO SHORTFALL on an empty month, because nothing is owed', () => {
    // This is the number he actually saw. With no cash at all, the old rule sent $211.62 and
    // called the month $211.62 short; the card is not due until October, so neither is true.
    const settled = settleUnconditional([card({ firstDueDate: '2026-10-10' })], 0);
    expect(settled.byCard.size).toBe(0);
    expect(settled.remaining).toBe(0);
  });

  it('CONTROL: the same empty month DOES report a shortfall when the card is genuinely due', () => {
    const settled = settleUnconditional([card()], 0);
    expect(settled.byCard.get('rh')).toEqual({ payment: 211.62, shortfall: 211.62 });
  });
});
