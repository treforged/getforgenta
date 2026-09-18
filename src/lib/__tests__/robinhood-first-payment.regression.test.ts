/**
 * HIS ROBINHOOD CARD MUST NOT DEMAND A SEPTEMBER PAYMENT — pinned to his REAL row.
 *
 * Tre, 2026-09-17, on localhost: "Robinhood is charging for this month. They're saying there's
 * gonna be a payment this month when it doesn't start till October 10. that payment is causing a
 * shortage of my account which is incorrect. I thought we set this up to be fixed."
 *
 * ⚠️ THE VALUES BELOW ARE HIS PRODUCTION ROW, read from `accounts` on 2026-09-18, not a fixture:
 * first_payment_due_date 2026-10-10, payment_due_day 10, card_start_date 2026-08-26,
 * balance 324.27, payment_unconditional true. It is the ONLY row of his ten credit cards that
 * carries a first_payment_due_date, which is what made "the column is NULL and the fix is inert"
 * the first thing to check — and what retired it.
 *
 * The guard lives in `unconditionalDesired` because an unconditional card is settled OFF THE TOP,
 * before minimums, so it never met `minSuppressed` in the engine. Both the one-shot and the sim
 * path settle through here, which is why asserting this function covers the screen he looks at.
 */
import { describe, it, expect } from 'vitest';
import { unconditionalDesired, settleUnconditional } from '@/lib/unconditional-payment';
import type { CardData } from '@/lib/credit-card-engine';

const HIS_ROBINHOOD = {
  id: 'robinhood', name: 'Robinhood Credit Card',
  balance: 324.27, apr: 0, aprIsUnknown: false, creditLimit: 5250,
  minPayment: 0, minPaymentIsManual: false, targetPayment: 0,
  monthlyNewPurchases: 0, steadyMonthlyPurchases: 0, monthlyRepayments: 0,
  color: '#000', paymentPreference: 'full', autopayFullBalance: false,
  dueDay: 10, firstDueDate: '2026-10-10', startDate: '2026-08-26',
  statementBalancePhase: false, statementBalance: null,
  paymentUnconditional: true,
  installmentBalance: 0, installmentMonthlyPayment: 0,
} as unknown as CardData;

const SEPTEMBER = new Date('2026-09-18T12:00:00');

describe('Robinhood first payment, on his real row', () => {
  it('wants NOTHING in September', () => {
    expect(unconditionalDesired(HIS_ROBINHOOD, SEPTEMBER)).toBe(0);
  });

  it('takes nothing from the pool and reports no shortfall — the false shortage', () => {
    const s = settleUnconditional([HIS_ROBINHOOD], 1000);
    expect(s.byCard.get('robinhood')?.payment ?? 0).toBe(0);
    expect(s.byCard.get('robinhood')?.shortfall ?? 0).toBe(0);
    expect(s.remaining).toBe(1000);
  });

  /**
   * ⚠️ POSITIVE CONTROL. Without this, the zeros above are equally consistent with a probe that
   * cannot see a payment at all, and a card that is simply never charged.
   */
  it('CONTROL: with no first_payment_due_date the same row wants the full balance', () => {
    expect(unconditionalDesired({ ...HIS_ROBINHOOD, firstDueDate: null } as CardData, SEPTEMBER))
      .toBeCloseTo(324.27, 2);
  });

  /** CONTROL: the guard must EXPIRE, or it would suppress his payment for ever. */
  it('CONTROL: in October the payment IS demanded', () => {
    expect(unconditionalDesired(HIS_ROBINHOOD, new Date('2026-10-05T12:00:00')))
      .toBeCloseTo(324.27, 2);
  });
});
