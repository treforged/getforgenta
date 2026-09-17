import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { simulateVariablePayoff, type CardData } from '../credit-card-engine';

/**
 * A CARD THAT HAS NOT BEEN BILLED YET TAKES NOTHING THIS MONTH - NOT EVEN SURPLUS.
 *
 * Tre, 2026-09-17, after the unconditional fix shipped: "The Robinhood payment is still showing
 * like it's coming off in September."
 *
 * He was right, and the first fix was not wrong - it was incomplete. `minSuppressed` stops the
 * MINIMUM at five sites, and `unconditionalDesired` now stops the "always pay this" settlement.
 * Neither touches STEP 5b, the avalanche/snowball surplus cascade, which was handing the card its
 * whole balance out of spare cash. So the row still showed a September payment.
 *
 * ⚠️ AND THE OBVIOUS FIX WAS WRONG. Reusing `minSuppressed` in the cascade would also have stopped
 * extra payments on every card whose minimum was already settled before the sim started
 * (`m0MinSettled`) - a card that CAN take more money, and a different feature entirely. The
 * cascade uses the narrower `notBilledYet`, and the last test here is what holds those apart.
 */
function makeCard(o: Partial<CardData>): CardData {
  return { id: 'card', name: 'Card', balance: 0, apr: 24, creditLimit: 20000,
    minPayment: 25, minPaymentIsManual: true, targetPayment: 25,
    monthlyNewPurchases: 0, monthlyRepayments: 0, color: '#000',
    paymentPreference: null, autopayFullBalance: false, dueDay: 10,
    statementBalancePhase: false, statementBalance: null, ...o } as CardData;
}
const PAD = new Array(12).fill(undefined) as [];
const flat = (n: number, i: number, e: number) => Array.from({ length: n }, () => ({ income: i, expenses: e }));
// Deliberately cash-rich, so the cascade has surplus to spend. A tight month would pass this test
// for the wrong reason - there would be nothing to hand out.
const run = (cards: CardData[]) => simulateVariablePayoff(cards, 8000, 3000, 'avalanche', 0, 0, 4, flat(4, 3000, 1000), ...PAD);

const rh = (o: Partial<CardData> = {}) => makeCard({
  id: 'rh', name: 'Robinhood Credit Card', balance: 211.62, apr: 29.99,
  creditLimit: 5250, minPayment: 0, targetPayment: 211.62, paymentPreference: 'full', ...o,
});

describe('a card whose first payment is not due yet', () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-17T12:00:00')); });
  afterAll(() => { vi.useRealTimers(); });

  it('POSITIVE CONTROL: with no first due date the cascade still pays it this month', () => {
    const pay = run([rh()]).monthlyPayments.get('rh')!;
    expect(pay[0]).toBeGreaterThan(200);
  });

  it('takes NOTHING this month when its first payment is due in October', () => {
    const pay = run([rh({ firstDueDate: '2026-10-10' })]).monthlyPayments.get('rh')!;
    expect(pay[0]).toBe(0);
  });

  it('and is paid in full the month it IS due - suppressed, not forgotten', () => {
    const pay = run([rh({ firstDueDate: '2026-10-10' })]).monthlyPayments.get('rh')!;
    expect(pay[1]).toBeGreaterThan(200);
  });

  it('the surplus goes to the next card in line rather than sitting idle', () => {
    const other = makeCard({ id: 'other', name: 'Other', balance: 900, apr: 18, minPayment: 25, targetPayment: 25 });
    const withRh = run([rh({ firstDueDate: '2026-10-10' }), other]);
    const alone = run([other]);
    expect(withRh.monthlyPayments.get('rh')![0]).toBe(0);
    expect(withRh.monthlyPayments.get('other')![0]).toBe(alone.monthlyPayments.get('other')![0]);
  });

  it('⚠️ A CARD WHOSE MINIMUM WAS ALREADY SETTLED STILL TAKES SURPLUS - the two halves are not the same', () => {
    // `m0MinSettled` means "already paid before the sim started", never "cannot be paid more".
    // If the cascade ever starts reading `minSuppressed` instead of `notBilledYet`, this goes red.
    const pay = run([rh({ m0MinSettled: true })]).monthlyPayments.get('rh')!;
    expect(pay[0]).toBeGreaterThan(200);
  });
});
