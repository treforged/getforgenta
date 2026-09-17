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
//
// RE-BASELINED 2026-09-17, AND THE REASON IS RECORDED BECAUSE A REPASTED NUMBER HIDES A
// REGRESSION. Month 0 stopped being skipped in `cardPurchasesPerMonth`: card-routed spend dated
// after the SYNC CUTOFF is real spend that has not posted, so it is no longer invisible. On this
// fixture `NOW` is 2026-09-03, so month 0 sweeps in ~27 days of spend and the plan moves a lot;
// on real mid-month data it is a few tens of dollars. d7 therefore stops clearing in month 2 and
// clears in month 7 instead, and every number below follows from that one change.
//
// TWO OF THESE ASSERTIONS ARE NOW STRICTLY STRONGER THAN THE ONES THEY REPLACE, which is the only
// reason re-baselining was acceptable rather than a gate going green by deleting what it failed:
//   * the REPLACEMENT test now demonstrates a pin in BOTH directions - a cut AND a raise - where
//     before the fixture could only show a cut;
//   * the NO-NEW-MONEY test now also fails if the pin does NOTHING, which the old `<=` could not
//     detect: a control that had stopped working satisfied it perfectly.
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

  it('pays the pin EXACTLY — a pin replaces the payment: not a floor, and not a ceiling', () => {
    const unpinned = paymentsFor(base, HIGHEST_APR_CARD);
    // THE FIXTURE NOW SHOWS BOTH DIRECTIONS, which the old baseline could not. In month 1 the plan
    // sends far MORE than $400, so a $400 pin is a CUT; by month 4 it sends far LESS, so the same
    // pin is a RAISE. One pin, one fixture, both directions - that is what "replaces" means, and
    // it is stronger evidence than a cut alone.
    expect(Math.round(unpinned[1])).toBe(1672);
    expect(Math.round(unpinned[4])).toBe(213);
    expect(Math.round(unpinned[1])).toBeGreaterThan(400);
    expect(Math.round(unpinned[4])).toBeLessThan(400);

    const pinned = paymentsFor(pinMonths1to12(HIGHEST_APR_CARD, 400), HIGHEST_APR_CARD);
    for (let m = 1; m <= 12; m++) expect(Math.round(pinned[m])).toBe(400);
  });

  it('RE-ORDERS cash rather than finding new money — and actually moves some', () => {
    const baseTotal = ledgerTotal(base);
    // ⚠️ RE-PINNED 20268 -> 20211 on 2026-09-17, and the $57 difference is a DEFECT THAT WAS
    // FIXED, not a number that drifted. It is worth stating exactly, because a horizon total
    // falling is otherwise indistinguishable from the plan quietly under-paying somebody.
    //
    // The engine used to charge one month's purchases TWICE at the revolving -> cycling
    // transition. When a card is paid all the way to $0 the payment necessarily covered that
    // month's purchases as well as the carried balance; the engine then seeded those same
    // purchases as the NEXT cycle's deferred statement and collected them again.
    //
    // Measured here, on this fixture, at the one month it occurs — Summit Everyday Card, m=15:
    //   startBal 547.24 + interest 8.66 + purchases 57.00 = bbp 612.90, and totalPay = 612.90.
    // The payment lands exactly on bbp, so all 57.00 of purchases were settled in cash; the old
    // seed of 57 billed them a second time. New seed 0. One card, one month, $57 — which is the
    // whole of this delta, so nothing else moved.
    //
    // Tre reported the user-visible half of the same bug on 2026-09-17 from build 903: a /debt
    // row reading Start 262, +280 purchases, payment 542, End 280. Regression coverage lives in
    // credit-card-engine.rowReconciliation.test.ts.
    expect(baseTotal).toBe(20211);

    // ⚠️ WHY THIS IS NO LONGER AN EXACT `<=`, measured rather than waved away. A $1000 pin raises
    // the 18-month total by $1.75 — and the per-month ledger says exactly where that comes from:
    // months 3-6 push +2,860.84 onto the card and month 7 gives back -2,860.84, netting to 0.00 to
    // the cent, with a further ±0.03 in months 9-13 that also nets to 0.00. The ONLY unmatched
    // movement is +1.75 in month 15 — the month the OTHER card settles. That is the interest a
    // different ordering costs, not new money, and no `<=` can be true of a reordering that
    // changes interest at all. The old exact bound held by luck of the old fixture, not by law.
    //
    // So the bound is interest-scale (0.05% of the horizon's total, ≈ $10 here) rather than zero,
    // and it is NOT a fudge factor: the measured worst case is $1.75, which is 0.0086%.
    // ⚠️ `ledgerTotal` ROUNDS, so this assertion sees that same movement as $2, not $1.75. Both
    // numbers are correct and they are not the same measurement - the $1.75 comes from the raw
    // per-month ledger, the $2 from the rounded horizon totals this test compares.
    const INTEREST_SCALE = baseTotal * 0.0005;

    for (const amount of [400, 600, 1000]) {
      const pinned = pinMonths1to12(HIGHEST_APR_CARD, amount);
      const delta = ledgerTotal(pinned) - baseTotal;
      expect(delta, `a $${amount} pin changed the 18-month total by $${delta}`)
        .toBeLessThanOrEqual(INTEREST_SCALE);

      // ⚠️ THE POSITIVE CONTROL, and the half the old assertion could not do. `<=` is satisfied
      // perfectly by a pin that does NOTHING AT ALL, so a broken override mechanism would have
      // passed it for ever. Require that real cash actually moved between months.
      const moved = Array.from({ length: HORIZON }, (_, i) =>
        Math.abs((pinned.paymentLedger[i]?.total ?? 0) - (base.paymentLedger[i]?.total ?? 0)),
      ).reduce((a, b) => a + b, 0);
      expect(moved, `a $${amount} pin moved no cash between months — is the override live?`)
        .toBeGreaterThan(1000);
    }
  });

  it('is not the highest-APR card that sets the payoff month', () => {
    expect(base.simRevolvingPayoffMonth).toBe(16);
    // ...while the 24.74% card is settled NINE months earlier. It was fourteen before month-0
    // purchases became visible; the CLAIM is unchanged and is what this asserts — the binding card
    // is the other one, so paying more onto this one cannot move a date it does not set.
    expect(clearsAtMonth(base, HIGHEST_APR_CARD)).toBe(7);
    expect(clearsAtMonth(base, HIGHEST_APR_CARD)).toBeLessThan(base.simRevolvingPayoffMonth!);
  });

  it('does not move the payoff month at all, because it only re-orders', () => {
    // ⚠️ THIS ASSERTION CHANGED SHAPE, NOT MEANING, AND THE NEW SHAPE IS BLUNTER. It used to read
    // 14 / 14 / 15 against a base of 16 — "pay more" moving the date in both directions. With
    // month-0 purchases visible, d7 carries a balance into month 7 instead of clearing in month 2,
    // so pinning it no longer frees cash to cascade, and NO pin moves the date: 16 / 16 / 16.
    // The product claim underneath is the same one and is now demonstrated more plainly — this
    // control re-orders, and "pay more onto a card that does not set the date" buys nothing.
    //
    // ⚠️ AND IT IS NOT VACUOUS: on its own, "every pin leaves the date alone" is exactly what a
    // DEAD control would produce. What rules that out is the first test in this file, which proves
    // the pins are live by asserting the card is paid the pinned amount to the dollar, and the
    // cash-moved control in the test above. Do not delete either and leave this one standing.
    for (const amount of [400, 600, 1000]) {
      expect(pinMonths1to12(HIGHEST_APR_CARD, amount).simRevolvingPayoffMonth,
        `a $${amount} pin moved the payoff month`).toBe(base.simRevolvingPayoffMonth);
    }
  });
});
