import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { unconditionalDesired, settleUnconditional } from '../unconditional-payment';
import type { CardData } from '../credit-card-engine';

/**
 * "ALWAYS PAY THE STATEMENT" MEANS THE STATEMENT, NOT THE WHOLE BALANCE (ask 72dca9af).
 *
 * Tre, 2026-10-03: the debt tab planned $927 on Robinhood - its current balance - when his
 * autopay sends the $334.26 statement. The extra $592 should go to the Prime Visa
 * interest-saving balance. The multi-month sim already paid the statement; only month 0
 * (`unconditionalDesired`, shared by the recommendations and `settleUnconditional`) did not.
 *
 * ARM 1 IS THE POSITIVE CONTROL: with no statement entered it still wants the balance, so a
 * function that returned the statement (or 0) for everybody cannot pass this file.
 */
const card = (o: Partial<CardData> = {}): CardData => ({
  id: 'rh', name: 'Robinhood Credit Card', balance: 926.85, apr: 29.99, creditLimit: 5250,
  minPayment: 25, minPaymentIsManual: false, targetPayment: 25,
  monthlyNewPurchases: 0, monthlyRepayments: 0, color: '#000',
  paymentPreference: 'statement', autopayFullBalance: false, dueDay: 12,
  statementBalancePhase: true, statementBalance: null,
  paymentUnconditional: true,
  ...o,
} as CardData);

describe('an unconditional statement-preference card', () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-03T12:00:00')); });
  afterAll(() => { vi.useRealTimers(); });

  it('POSITIVE CONTROL: with no statement entered it wants the whole balance, as before', () => {
    expect(unconditionalDesired(card())).toBe(926.85);
  });

  it('wants the STATEMENT when one is entered and due this month - the defect Tre reported', () => {
    expect(unconditionalDesired(card({ statementBalance: 334.26 }))).toBe(334.26);
  });

  it('wants nothing when this month\'s due day has passed: that statement is paid', () => {
    expect(unconditionalDesired(card({ statementBalance: 334.26, dueDay: 1 }))).toBe(0);
  });

  it('the first due date decides the due month when it is recorded', () => {
    expect(unconditionalDesired(card({ statementBalance: 334.26, dueDay: 1, firstDueDate: '2026-10-12' }))).toBe(334.26);
    expect(unconditionalDesired(card({ statementBalance: 334.26, firstDueDate: '2026-11-12' }))).toBe(0);
  });

  it('never wants more than the card owes', () => {
    expect(unconditionalDesired(card({ statementBalance: 2000 }))).toBe(926.85);
  });

  it('a FULL-preference card still pays the whole balance, statement or not', () => {
    expect(unconditionalDesired(card({ paymentPreference: 'full', statementBalance: 334.26 }))).toBe(926.85);
  });

  it('leaves the freed cash in the pool: Tre\'s $1,850 month keeps $1,515.74 for other cards', () => {
    const { byCard, remaining } = settleUnconditional([card({ statementBalance: 334.26 })], 1850);
    expect(byCard.get('rh')?.payment).toBe(334.26);
    expect(remaining).toBe(1515.74);
  });
});
