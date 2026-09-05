// @vitest-environment jsdom
//
// WHAT A PAYMENT PIN MEANS — settled 2026-09-05, on the committed demo fixture.
//
// The standing explanation for "paying more does not move my payoff date" was
// "his cards are promo-heavy". That explanation is WRONG, and these assertions are
// why. Measured on the demo fixture AND reproduced on the real capture:
//
//   1. A pin is a REPLACEMENT, not a floor and not extra money. `paymentOverridesByMonth`
//      (credit-card-engine.ts) sets the card's EXACT total for that month, clamped only at
//      >= 0 and at what the card owes, and the card is then excluded from normal allocation
//      so the others rebalance around it. Pinning $400 on a card the plan was paying $743
//      pays it DOWN by $343.
//   2. A pin therefore cannot add cash to debt. The horizon's total debt payment is set by
//      income minus the cash floor, not by the pin, so it stays flat however the pin moves.
//   3. Which card is BINDING is not the highest-APR one. On this fixture the 24.74% card is
//      clear by month 2 while the payoff month is 16 — set entirely by the other card. Paying
//      more onto a card that is already finished cannot move a date it does not set.
//
// If one of these breaks, the product's strongest control has changed meaning. Read the
// failure before changing the number.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { runDemoCardProjection } from './fixtures/demo-forecast-harness';

/** Pinned so a filmed/asserted figure does not move with the wall clock. */
const NOW = new Date('2026-09-03T12:00:00');

/** The demo's two credit cards: d7 Cobalt (24.74% APR), d8 Summit (18.99%, pays in full). */
const HIGHEST_APR_CARD = 'd7';

interface PinnableProjection {
  simRevolvingPayoffMonth: number | null;
  perCardPayments: { name: string; id: string; payments: number[] }[];
  monthlyRevolvingBalances: Map<string, number[]>;
  paymentLedger: { total: number }[];
  withPaymentOverrides: (p: { [cardId: string]: Record<number, number> }) => PinnableProjection;
}

const HORIZON = 18;
const ledgerTotal = (r: PinnableProjection) =>
  Math.round(r.paymentLedger.slice(0, HORIZON).reduce((s, e) => s + e.total, 0));
const paymentsFor = (r: PinnableProjection, id: string) =>
  r.perCardPayments.find(p => p.id === id)?.payments ?? [];
/** First month index where the card's revolving balance is settled (sub-dollar dust tolerated). */
const clearsAtMonth = (r: PinnableProjection, id: string) =>
  (r.monthlyRevolvingBalances.get(id) ?? []).findIndex(v => v <= 1);

describe('payment pin semantics — the demo fixture', () => {
  let base: PinnableProjection;

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    base = runDemoCardProjection(NOW) as unknown as PinnableProjection;
  });
  afterAll(() => vi.useRealTimers());

  /** Pin one card to a flat monthly amount for months 1..12, leaving month 0 alone. */
  const pinMonths1to12 = (cardId: string, amount: number) => {
    const months: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) months[m] = amount;
    return base.withPaymentOverrides({ [cardId]: months });
  };

  it('pays the pin EXACTLY — a pin replaces the payment, it does not floor it', () => {
    const unpinned = paymentsFor(base, HIGHEST_APR_CARD);
    // The plan was already sending far more than $400 to this card, so a $400 pin is a CUT.
    expect(Math.round(unpinned[1])).toBe(1673);
    expect(Math.round(unpinned[4])).toBe(743);

    const pinned = paymentsFor(pinMonths1to12(HIGHEST_APR_CARD, 400), HIGHEST_APR_CARD);
    for (let m = 1; m <= 12; m++) expect(Math.round(pinned[m])).toBe(400);
  });

  it('never increases the total cash the plan sends to debt', () => {
    const baseTotal = ledgerTotal(base);
    expect(baseTotal).toBe(19785);
    // Every pin redistributes; none of them finds new money.
    for (const amount of [400, 600, 1000]) {
      expect(ledgerTotal(pinMonths1to12(HIGHEST_APR_CARD, amount))).toBeLessThanOrEqual(baseTotal);
    }
  });

  it('is not the highest-APR card that sets the payoff month', () => {
    expect(base.simRevolvingPayoffMonth).toBe(16);
    // ...while the 24.74% card is settled fourteen months earlier.
    expect(clearsAtMonth(base, HIGHEST_APR_CARD)).toBe(2);
  });

  it('moves the payoff month non-monotonically, because it only re-orders', () => {
    // $400 and $600 both pull the date IN (cash cascades to the binding card); $1000 pushes it
    // back out (the binding card is starved). "Pay more" is not what this control does.
    expect(pinMonths1to12(HIGHEST_APR_CARD, 400).simRevolvingPayoffMonth).toBe(14);
    expect(pinMonths1to12(HIGHEST_APR_CARD, 600).simRevolvingPayoffMonth).toBe(14);
    expect(pinMonths1to12(HIGHEST_APR_CARD, 1000).simRevolvingPayoffMonth).toBe(15);
  });
});
