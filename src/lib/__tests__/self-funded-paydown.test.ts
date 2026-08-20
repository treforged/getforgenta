import { describe, it, expect } from 'vitest';
import {
  capacityAt,
  simulateSelfFundedPaydown,
  creditApplicationCollisions,
  type PlannedCreditEvent,
} from '../self-funded-paydown';
import { simulateStatusQuo, type ConsolidationCard } from '../consolidation';

const ASOF = '2026-08-20';

/**
 * Tre's real cards, read from Postgres 2026-08-20 — the same fixture `consolidation.test.ts` pins.
 * Venture X is NOT open (`card_start_date` 2027-04-20), so its $10,000 limit is not drawable and
 * must stay out of utilization until then.
 */
const DISCOVER: ConsolidationCard = {
  id: 'discover',
  name: 'Discover it Card',
  balance: 10422.03,
  creditLimit: 11000,
  apr: 16.6,
  minPayment: 249,
  tranches: [
    { id: 'promo', label: '7.99% promo', balance: 5037.73, apr: 7.99, promo_end_date: '2028-01-04' },
  ],
};

const VISA: ConsolidationCard = {
  id: 'visa',
  name: 'Prime Visa',
  balance: 8396.9,
  creditLimit: 14400,
  apr: 27.49,
  minPayment: 210,
};

const CARDS = [DISCOVER, VISA];

describe('capacityAt', () => {
  it('treats a plain number as flat forever', () => {
    expect(capacityAt(900, 0)).toBe(900);
    expect(capacityAt(900, 500)).toBe(900);
  });

  it('carries the LAST entry forward — the terminal number is the one the plan lives on', () => {
    const schedule = [447.62, 447.62, 471.67, 927.5, 11.93];
    expect(capacityAt(schedule, 0)).toBeCloseTo(447.62, 2);
    expect(capacityAt(schedule, 3)).toBeCloseTo(927.5, 2);
    expect(capacityAt(schedule, 99)).toBeCloseTo(11.93, 2);
  });

  it('is 0 for an empty schedule rather than undefined', () => {
    expect(capacityAt([], 0)).toBe(0);
  });
});

describe('simulateSelfFundedPaydown', () => {
  it('lines up with simulateStatusQuo, and costs a little more because minimums are real', () => {
    const payment = 1200;
    const mine = simulateSelfFundedPaydown({ cards: CARDS, asOf: ASOF, capacity: payment });
    const theirs = simulateStatusQuo(CARDS, payment, ASOF);

    expect(mine.payoffMonth).not.toBeNull();
    // Both walk the same buckets at the same rates. They differ by one only in what the number
    // COUNTS: `simulateStatusQuo` returns the number of payments made, `payoffMonth` is a month
    // OFFSET where 0 is this month — so clearing on the 18th payment is offset 17. The timeline is
    // indexed by that offset, so it has to be the offset here.
    expect(mine.payoffMonth!).toBe(theirs.months! - 1);
    expect(mine.timeline).toHaveLength(theirs.months!);

    // `simulateStatusQuo` is a BASELINE: it throws every dollar at the highest rate and ignores
    // that the other card still has a minimum due. This is a PLAN, so Discover's $249 gets paid
    // whether or not the Visa is more expensive — and that costs about $100 over the run. The gap
    // is the price of not missing a payment, and it belongs in the plan, not hidden by matching a
    // baseline that never had to make one.
    expect(mine.totalInterest).toBeGreaterThan(theirs.totalInterest);
    expect(mine.totalInterest - theirs.totalInterest).toBeLessThan(150);
  });

  it('reports payoffMonth null when the money never clears the cards', () => {
    const res = simulateSelfFundedPaydown({ cards: CARDS, asOf: ASOF, capacity: 100, maxMonths: 60 });
    expect(res.payoffMonth).toBeNull();
    expect(res.payoffDate).toBeNull();
  });

  it('flags months where capacity cannot even cover the minimums', () => {
    const res = simulateSelfFundedPaydown({ cards: CARDS, asOf: ASOF, capacity: 100, maxMonths: 6 });
    expect(res.shortfallMonths.length).toBe(6);
    expect(res.shortfallMonths[0].minimumsDue).toBeCloseTo(459, 2);
    expect(res.shortfallMonths[0].capacity).toBe(100);
  });

  it('pays minimums on every card before honouring the priority order', () => {
    // Enough for both minimums and $41 of surplus. The Visa minimum must still be paid.
    const res = simulateSelfFundedPaydown({
      cards: CARDS,
      asOf: ASOF,
      capacity: 500,
      priorityCardIds: ['discover'],
      maxMonths: 1,
    });
    const visa = res.timeline[0].perCard.find(c => c.cardId === 'visa')!;
    const visaInterest = (8396.9 * 0.2749) / 12;
    expect(visa.balance).toBeCloseTo(8396.9 + visaInterest - 210, 2);
  });

  it('DISCOVER-FIRST reaches 30% on Discover sooner than avalanche, and costs more interest', () => {
    const capacity = 1200;
    const opts = { cards: CARDS, asOf: ASOF, capacity, milestonesPct: [30], maxMonths: 120 };
    const avalanche = simulateSelfFundedPaydown(opts);
    const discoverFirst = simulateSelfFundedPaydown({ ...opts, priorityCardIds: ['discover'] });

    const at30 = (r: typeof avalanche) => r.milestones.find(m => m.target === 'discover' && m.pct === 30)!.month;
    expect(at30(discoverFirst)).not.toBeNull();
    expect(at30(avalanche)).not.toBeNull();
    // The whole reason the plan deliberately is not avalanche.
    expect(at30(discoverFirst)!).toBeLessThan(at30(avalanche)!);
    // And the price of that choice, which the surface must show rather than hide.
    expect(discoverFirst.totalInterest).toBeGreaterThan(avalanche.totalInterest);
  });

  it('excludes a card that is not open yet from utilization until its start date', () => {
    const ventureX: ConsolidationCard = {
      id: 'venturex',
      name: 'Venture X',
      balance: 0,
      creditLimit: 10000,
      apr: 24,
      startDate: '2027-04-20',
    };
    const res = simulateSelfFundedPaydown({
      cards: [DISCOVER, ventureX],
      asOf: ASOF,
      capacity: 400,
      maxMonths: 12,
    });
    const first = res.timeline[0];
    expect(first.perCard.find(c => c.cardId === 'venturex')!.isOpen).toBe(false);
    // Aggregate is Discover against its own $11,000 only — not $21,000.
    const discover = first.perCard.find(c => c.cardId === 'discover')!;
    expect(first.aggregateUtilizationPct).toBeCloseTo(discover.utilizationPct!, 4);
  });

  it('adds committed charges back, which pushes every milestone later', () => {
    const opts = { cards: CARDS, asOf: ASOF, capacity: 900, milestonesPct: [50], maxMonths: 120 };
    const clean = simulateSelfFundedPaydown(opts);
    const withCharges = simulateSelfFundedPaydown({
      ...opts,
      charges: [{ label: 'Pay in 4', cardId: 'discover', amountPerMonth: 200, monthsRemaining: 12 }],
    });

    const at50 = (r: typeof clean) => r.milestones.find(m => m.target === 'discover' && m.pct === 50)!.month!;
    expect(at50(withCharges)).toBeGreaterThan(at50(clean));
    expect(withCharges.timeline[0].chargesAdded).toBeCloseTo(200, 2);
  });

  it('a repointed charge costs nothing — landsOnCard:false never touches the card', () => {
    const opts = { cards: CARDS, asOf: ASOF, capacity: 900, milestonesPct: [50], maxMonths: 120 };
    const clean = simulateSelfFundedPaydown(opts);
    const repointed = simulateSelfFundedPaydown({
      ...opts,
      charges: [{ label: 'Pay in 4', cardId: 'discover', amountPerMonth: 200, monthsRemaining: 12, landsOnCard: false }],
    });
    expect(repointed.totalInterest).toBeCloseTo(clean.totalInterest, 6);
    expect(repointed.timeline[0].chargesAdded).toBe(0);
  });

  it('applies a one-off in its own month only', () => {
    const res = simulateSelfFundedPaydown({
      cards: CARDS,
      asOf: ASOF,
      capacity: 900,
      oneOffs: [{ label: 'February bonus', month: 6, amount: 1397 }],
      maxMonths: 8,
    });
    expect(res.timeline[5].paid).toBeCloseTo(900, 2);
    expect(res.timeline[6].paid).toBeCloseTo(2297, 2);
    expect(res.timeline[7].paid).toBeCloseTo(900, 2);
  });

  it('honours a varying capacity schedule rather than averaging it', () => {
    const schedule = [447.62, 447.62, 447.62, 927.5];
    const res = simulateSelfFundedPaydown({ cards: CARDS, asOf: ASOF, capacity: schedule, maxMonths: 6 });
    expect(res.timeline[0].paid).toBeCloseTo(447.62, 2);
    expect(res.timeline[3].paid).toBeCloseTo(927.5, 2);
    // Carried forward past the end of the array.
    expect(res.timeline[5].paid).toBeCloseTo(927.5, 2);
  });

  it('reports a milestone as null rather than inventing a date it never reaches', () => {
    const res = simulateSelfFundedPaydown({
      cards: CARDS,
      asOf: ASOF,
      capacity: 459, // minimums exactly; nothing ever comes down
      milestonesPct: [10],
      maxMonths: 24,
    });
    const discover = res.milestones.find(m => m.target === 'discover' && m.pct === 10)!;
    expect(discover.month).toBeNull();
    expect(discover.date).toBeNull();
  });

  it('never pays more than is owed', () => {
    const res = simulateSelfFundedPaydown({ cards: CARDS, asOf: ASOF, capacity: 50000, maxMonths: 12 });
    expect(res.payoffMonth).toBe(0);
    expect(res.totalPaid).toBeCloseTo(18818.93 + res.totalInterest, 2);
  });
});

describe('creditApplicationCollisions', () => {
  const events: PlannedCreditEvent[] = [
    { id: 'venturex', label: 'Venture X', date: '2027-04-20', kind: 'card-opening' },
    { id: 'apple', label: 'Apple Card', date: '2028-02-28', kind: 'card-opening' },
    { id: 'reapply', label: 'Discover loan reapplication', date: '2027-04-01', kind: 'loan-application' },
  ];

  it('catches the Venture X / reapply collision that nothing in the app noticed', () => {
    const hits = creditApplicationCollisions(events);
    expect(hits).toHaveLength(1);
    expect(hits[0].openingId).toBe('venturex');
    expect(hits[0].applicationId).toBe('reapply');
    expect(hits[0].monthsFromApplication).toBe(0);
    expect(hits[0].suggestedOpeningDate).toBe('2027-06-01');
  });

  it('leaves a card opening a year out alone', () => {
    const hits = creditApplicationCollisions(events);
    expect(hits.some(h => h.openingId === 'apple')).toBe(false);
  });

  it('flags an opening inside the lookback window before the application', () => {
    const hits = creditApplicationCollisions([
      { id: 'card', label: 'New card', date: '2027-01-10', kind: 'card-opening' },
      { id: 'loan', label: 'Loan', date: '2027-05-01', kind: 'loan-application' },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].monthsFromApplication).toBe(-4);
    expect(hits[0].reason).toContain('recently opened trade');
  });

  it('clears an opening older than the lookback window', () => {
    const hits = creditApplicationCollisions([
      { id: 'card', label: 'Old card', date: '2026-09-10', kind: 'card-opening' },
      { id: 'loan', label: 'Loan', date: '2027-05-01', kind: 'loan-application' },
    ]);
    expect(hits).toEqual([]);
  });

  it('flags an opening during underwriting but clears one after it', () => {
    const during = creditApplicationCollisions([
      { id: 'card', label: 'New card', date: '2027-06-10', kind: 'card-opening' },
      { id: 'loan', label: 'Loan', date: '2027-05-01', kind: 'loan-application' },
    ]);
    expect(during).toHaveLength(1);
    expect(during[0].reason).toContain('underwritten');

    const after = creditApplicationCollisions([
      { id: 'card', label: 'New card', date: '2027-07-10', kind: 'card-opening' },
      { id: 'loan', label: 'Loan', date: '2027-05-01', kind: 'loan-application' },
    ]);
    expect(after).toEqual([]);
  });

  it('returns nothing when there is no application planned at all', () => {
    expect(creditApplicationCollisions(events.filter(e => e.kind === 'card-opening'))).toEqual([]);
  });

  it('honours a wider lookback window', () => {
    const hits = creditApplicationCollisions(
      [
        { id: 'card', label: 'Old card', date: '2026-09-10', kind: 'card-opening' },
        { id: 'loan', label: 'Loan', date: '2027-05-01', kind: 'loan-application' },
      ],
      { lookbackMonths: 12 },
    );
    expect(hits).toHaveLength(1);
  });
});
