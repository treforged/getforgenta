import { describe, it, expect } from 'vitest';
import {
  amortizedPayment,
  loanTotalInterest,
  monthsToPayOff,
  buildPayoffBuckets,
  solveMinimumPrincipal,
  evaluateConsolidation,
  simulateStatusQuo,
  breakEvenApr,
  promoCliffMonths,
  type ConsolidationCard,
  type ScheduledCardCharge,
} from '../consolidation';

const ASOF = '2026-08-20';

/**
 * Tre's real cards, read from Postgres 2026-08-20. Venture X and Apple Card are NOT open —
 * `card_start_date` is in the future — so their $20,000 of limit must stay out of utilization.
 * That distinction is the whole reason his real number is 74.1% and not 41.5%.
 */
const CARDS: ConsolidationCard[] = [
  {
    id: 'discover',
    name: 'Discover it Card',
    balance: 10422.03,
    creditLimit: 11000,
    apr: 16.6,
    minPayment: 249,
    tranches: [
      {
        id: 'bt-promo',
        label: 'Balance transfer promo',
        balance: 5037.73,
        apr: 7.99,
        promo_end_date: '2028-01-04',
      },
    ],
  },
  { id: 'visa', name: 'Prime Visa', balance: 8396.9, creditLimit: 14400, apr: 27.49, minPayment: 450.79 },
  { id: 'venturex', name: 'Venture X', balance: 0, creditLimit: 10000, apr: 22.99, startDate: '2026-12-20' },
  { id: 'apple', name: 'Apple Card', balance: 0, creditLimit: 10000, apr: 22.99, startDate: '2028-02-28' },
];

/**
 * The three PayPal Pay-in-4 plans still funding off the Discover card. Installments already taken
 * are excluded — only what has NOT landed yet can be planned around.
 */
const CHARGES: ScheduledCardCharge[] = [
  { label: 'Exhaust (PayPal 4)', cardId: 'discover', amountPerMonth: 356.86, monthsRemaining: 3 },
  { label: 'Cold Air Intake (PayPal 4)', cardId: 'discover', amountPerMonth: 98.97, monthsRemaining: 3 },
  { label: 'Rear Diff Seals (PayPal 4)', cardId: 'discover', amountPerMonth: 24.05, monthsRemaining: 3 },
];

const TOTAL_CARD_DEBT = 18818.93;
const REMAINING_PLAN_CHARGES = 1439.64;

describe('amortization — verified against Discover\'s own printed payment table', () => {
  // The mailer's fine print states the table is computed at 11.99% APR. Every cell below is read
  // off that table, so a mismatch means our arithmetic disagrees with the lender's, not with us.
  const cases: [number, number, number][] = [
    [20000, 36, 664],
    [20000, 48, 527],
    [20000, 60, 445],
    [20000, 72, 391],
    [20000, 84, 353],
    [15000, 72, 293], // also quoted verbatim in the letter body
    [5000, 36, 166],
    [40000, 36, 1328],
  ];
  it.each(cases)('$%d over %d months at 11.99%% is about $%d', (principal, months, expected) => {
    expect(Math.round(amortizedPayment(principal, 11.99, months))).toBe(expected);
  });

  it('treats a 0% loan as straight-line rather than dividing by zero', () => {
    expect(amortizedPayment(1200, 0, 12)).toBeCloseTo(100, 6);
    expect(loanTotalInterest(1200, 0, 12)).toBeCloseTo(0, 6);
  });

  it('reports "never" rather than a large number when the payment cannot cover interest', () => {
    expect(monthsToPayOff(10000, 24, 100)).toBeNull(); // $200/mo of interest, $100 paid
    expect(monthsToPayOff(10000, 24, 500)).toBeGreaterThan(0);
  });
});

describe('payoff buckets', () => {
  it('splits the Discover card at its promo boundary and ranks across cards by real rate', () => {
    const buckets = buildPayoffBuckets(CARDS, ASOF);
    expect(buckets.map(b => [b.cardId, b.label, Math.round(b.balance * 100) / 100, b.effectiveApr])).toEqual([
      ['visa', 'Standard balance', 8396.9, 27.49],
      ['discover', 'Standard balance', 5384.3, 16.6],
      ['discover', 'Balance transfer promo', 5037.73, 7.99],
    ]);
    expect(buckets.reduce((s, b) => s + b.balance, 0)).toBeCloseTo(TOTAL_CARD_DEBT, 2);
  });

  it('reprices the promo tranche once its end date passes, moving it up the payoff order', () => {
    const after = buildPayoffBuckets(CARDS, '2028-02-01');
    const promo = after.find(b => b.label === 'Balance transfer promo')!;
    expect(promo.effectiveApr).toBe(16.6);
    expect(promo.promoEndDate).toBeNull();
  });

  it('knows how long the cheap money stays cheap', () => {
    expect(promoCliffMonths(CARDS[0], ASOF)).toBe(17);
    expect(promoCliffMonths(CARDS[1], ASOF)).toBeNull();
  });
});

describe('utilization baseline', () => {
  it('excludes the two unopened cards, so the real figure is 74.1% and not 41.5%', () => {
    const r = evaluateConsolidation({ cards: CARDS, terms: { principal: 0, aprPct: 0, termMonths: 36 }, asOf: ASOF });
    expect(r.before.totalLimit).toBe(25400); // NOT 45400
    expect(r.before.totalBalance).toBeCloseTo(TOTAL_CARD_DEBT, 2);
    expect(r.before.aggregatePct!).toBeCloseTo(74.09, 1);
    expect(r.before.worstCardPct!).toBeCloseTo(94.75, 1); // Discover
  });
});

describe('solveMinimumPrincipal — how much is actually needed', () => {
  it('"all cards under 30% and interest free", holding through the PayPal charges', () => {
    const r = solveMinimumPrincipal({
      cards: CARDS,
      charges: CHARGES,
      constraints: {
        maxCardUtilizationPct: 30,
        requireInterestFree: true,
        holdThroughScheduledCharges: true,
      },
      asOf: ASOF,
      minPrincipal: 2500,
      maxPrincipal: 40000,
    });
    // Every interest-bearing dollar retired, plus cash so the committed charges never touch a card.
    expect(r.netProceedsRequired).toBeCloseTo(TOTAL_CARD_DEBT, 2);
    expect(r.cashReserveRequired).toBeCloseTo(REMAINING_PLAN_CHARGES, 2);
    expect(r.principalRequired).toBeCloseTo(20258.57, 2);
    expect(r.withinLenderRange).toBe(true);
  });

  it('repointing the PayPal plans at checking is worth $1,439.64 of principal, for free', () => {
    const redirected = CHARGES.map(c => ({ ...c, landsOnCard: false }));
    const r = solveMinimumPrincipal({
      cards: CARDS,
      charges: redirected,
      constraints: { maxCardUtilizationPct: 30, requireInterestFree: true, holdThroughScheduledCharges: true },
      asOf: ASOF,
    });
    expect(r.principalRequired).toBeCloseTo(TOTAL_CARD_DEBT, 2);
    expect(r.cashReserveRequired).toBe(0);
  });

  it('dropping the interest-free requirement keeps the 7.99% money and costs $7,620 less', () => {
    const r = solveMinimumPrincipal({
      cards: CARDS,
      charges: CHARGES,
      constraints: { maxCardUtilizationPct: 30, holdThroughScheduledCharges: true },
      asOf: ASOF,
    });
    // Discover ceiling $3,300 less $1,439.64 of incoming charges = $1,860.36 target.
    const disc = r.perCard.find(c => c.cardId === 'discover')!;
    expect(disc.targetBalance).toBeCloseTo(1860.36, 2);
    expect(disc.paydownRequired).toBeCloseTo(8561.67, 2);
    // Visa ceiling is a flat 30% of $14,400 — nothing else lands on it.
    const visa = r.perCard.find(c => c.cardId === 'visa')!;
    expect(visa.targetBalance).toBeCloseTo(4320, 2);
    expect(visa.paydownRequired).toBeCloseTo(4076.9, 2);
    expect(r.principalRequired).toBeCloseTo(12638.57, 2);
  });

  it('grosses up for an origination fee, so the NET is what reaches the creditors', () => {
    const r = solveMinimumPrincipal({
      cards: CARDS,
      constraints: { requireInterestFree: true },
      asOf: ASOF,
      originationFeePct: 5,
    });
    expect(r.principalRequired).toBeCloseTo(TOTAL_CARD_DEBT / 0.95, 2); // $19,809.40
  });

  it('never counts an unopened card\'s limit as headroom to fill', () => {
    const r = solveMinimumPrincipal({
      cards: CARDS,
      constraints: { maxCardUtilizationPct: 30 },
      asOf: ASOF,
    });
    for (const id of ['venturex', 'apple']) {
      expect(r.perCard.find(c => c.cardId === id)!.paydownRequired).toBe(0);
    }
  });
});

describe('evaluateConsolidation — pricing a concrete offer', () => {
  const terms = { principal: 20000, aprPct: 15, termMonths: 84, originationFeePct: 0 };

  it('$20,000 clears both cards and leaves cash against the incoming charges', () => {
    const r = evaluateConsolidation({
      cards: CARDS,
      terms,
      charges: CHARGES,
      constraints: { maxCardUtilizationPct: 30, requireInterestFree: true, holdThroughScheduledCharges: true },
      asOf: ASOF,
    });
    expect(r.after.totalBalance).toBeCloseTo(0, 2);
    expect(r.after.aggregatePct!).toBeCloseTo(0, 2);
    expect(r.leftoverCash).toBeCloseTo(20000 - TOTAL_CARD_DEBT, 2); // $1,181.07
    expect(r.shortfall).toBe(0);
    // $1,181.07 of leftover absorbs part of $1,439.64, leaving $258.57 on Discover = 2.4%.
    expect(r.afterScheduledCharges.totalBalance).toBeCloseTo(258.57, 2);
    expect(r.constraints.allCardsUnderMax).toBe(true);
  });

  it('flags the constraint at its WORST future point, not on funding day', () => {
    // $16,000 leaves Discover at $2,818.93 (25.6%) — under 30% today, over it by December.
    const r = evaluateConsolidation({
      cards: CARDS,
      terms: { principal: 16000, aprPct: 15, termMonths: 84 },
      charges: CHARGES,
      constraints: { maxCardUtilizationPct: 30, holdThroughScheduledCharges: true },
      asOf: ASOF,
    });
    expect(r.after.perCard.find(c => c.cardId === 'discover')!.utilizationPct!).toBeCloseTo(25.63, 1);
    expect(r.afterScheduledCharges.perCard.find(c => c.cardId === 'discover')!.utilizationPct!)
      .toBeCloseTo(38.71, 1);
    expect(r.constraints.allCardsUnderMax).toBe(false);
    expect(r.constraints.violations.join(' ')).toContain('Discover');
  });

  it('the same $16,000 passes once the PayPal plans are repointed at checking', () => {
    const r = evaluateConsolidation({
      cards: CARDS,
      terms: { principal: 16000, aprPct: 15, termMonths: 84 },
      charges: CHARGES.map(c => ({ ...c, landsOnCard: false })),
      constraints: { maxCardUtilizationPct: 30, holdThroughScheduledCharges: true },
      asOf: ASOF,
    });
    expect(r.constraints.allCardsUnderMax).toBe(true);
    expect(r.constraints.interestFree).toBe(true); // what is left is the live 7.99% promo, which costs nothing today
  });

  it('retires the 27.49% Visa before the 7.99% promo, whatever order the cards arrive in', () => {
    const r = evaluateConsolidation({
      cards: CARDS,
      terms: { principal: 9000, aprPct: 15, termMonths: 84 },
      asOf: ASOF,
    });
    expect(r.applied[0].cardId).toBe('visa');
    expect(r.after.perCard.find(c => c.cardId === 'visa')!.balance).toBeCloseTo(0, 2);
    // The leftover $603.10 goes to Discover's 16.6% money, never the 7.99% tranche.
    expect(r.applied[1].apr).toBe(16.6);
    expect(r.shortfall).toBeCloseTo(TOTAL_CARD_DEBT - 9000, 2);
  });

  it('reports the affordability gap rather than assuming the payment fits', () => {
    const r = evaluateConsolidation({
      cards: CARDS,
      terms: { principal: 20000, aprPct: 18, termMonths: 84 },
      asOf: ASOF,
      monthlyCapacity: 3678.52 - 3783.02, // Tre's solo income once the $1,100/mo ends, before debt
    });
    expect(r.affordability.fits).toBe(false);
    expect(r.affordability.headroom!).toBeLessThan(-500);
  });
});

describe('the interest answer and the utilization answer are reported separately', () => {
  it('at 18% the move COSTS interest, even though 18% is under the 19.16% blended rate', () => {
    // The blended rate is a trap. Under avalanche the 27.49% Visa dies first, so the surviving
    // balance drifts toward the 7.99% promo money and the effective rate FALLS month over month.
    // A flat-rate loan charges 18% on that promo tranche for the whole term. Comparing a loan
    // against a card blend is how consolidation gets oversold; the simulation prices it honestly.
    const r = evaluateConsolidation({
      cards: CARDS,
      terms: { principal: 18818.93, aprPct: 18, termMonths: 36 },
      asOf: ASOF,
      comparisonMonthlyPayment: amortizedPayment(18818.93, 18, 36),
    });
    expect(r.interest.blendedCardApr).toBeCloseTo(19.16, 1);
    expect(r.interest.delta!).toBeGreaterThan(0);      // costs MORE, not less
    expect(r.interest.delta!).toBeCloseTo(593, -2);
    // Meanwhile utilization does transform. Both numbers, never blended into one score.
    expect(r.before.aggregatePct!).toBeCloseTo(74.09, 1);
    expect(r.after.aggregatePct!).toBeCloseTo(0, 2);
  });

  it('excluding the promo tranche moves the break-even from ~17% up to ~20.5%', () => {
    // Same $13,781.20 of expensive money, but the 7.99% is left where it is.
    const atEighteen = loanTotalInterest(13781.2, 18, 36);
    const atTwentyTwo = loanTotalInterest(13781.2, 22, 36);
    const carried = simulateStatusQuo(CARDS, amortizedPayment(13781.2, 18, 36), ASOF);
    expect(atEighteen).toBeLessThan(carried.totalInterest);   // still wins at 18%
    expect(atTwentyTwo).toBeGreaterThan(0);
    expect(breakEvenApr(CARDS, 36, 699.79, ASOF, 13781.2)!).toBeGreaterThan(
      breakEvenApr(CARDS, 36, 699.79, ASOF, 18818.93)!,
    );
  });

  it('at 12% the same move is worth real money', () => {
    const pmt = amortizedPayment(18818.93, 12, 36);
    const r = evaluateConsolidation({
      cards: CARDS,
      terms: { principal: 18818.93, aprPct: 12, termMonths: 36 },
      asOf: ASOF,
      comparisonMonthlyPayment: pmt,
    });
    expect(r.interest.delta!).toBeLessThan(-1500);
  });

  it('stretching the term is what actually costs money, and the break-even rate says so', () => {
    const carryPayment = 699.79; // the two card minimums he pays today
    const be36 = breakEvenApr(CARDS, 36, carryPayment, ASOF)!;
    const be84 = breakEvenApr(CARDS, 84, carryPayment, ASOF)!;
    expect(be84).toBeLessThan(be36);
    // A 36-month loan competes with a ~25-month self-payoff; 84 months has to be far cheaper to win.
    expect(be36).toBeGreaterThan(10);
    expect(be84).toBeLessThan(be36 - 3);
  });

  it('a status quo that never pays off is reported as null, not as a huge number', () => {
    const sq = simulateStatusQuo(CARDS, 200, ASOF); // below the ~$300/mo of accruing interest
    expect(sq.months).toBeNull();
  });

  it('the status quo baseline retires the cards in about 25 months at $699.79', () => {
    const sq = simulateStatusQuo(CARDS, 699.79, ASOF);
    expect(sq.months).toBeGreaterThanOrEqual(29);
    expect(sq.months).toBeLessThanOrEqual(34);
    expect(sq.totalInterest).toBeGreaterThan(2500);
  });
});
