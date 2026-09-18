import { describe, it, expect } from 'vitest';
import { simulateVariablePayoff, clearsStatement, type CardData } from '../credit-card-engine';

/**
 * A CARD PAID IN FULL DOES NOT ACCRUE INTEREST.
 *
 * Tre, 2026-09-17, on his own /debt tab: *"Robinhood is showing interest on the debt tab in
 * September and October for some reason. also it's not showing all the purchase amount in October
 * even though I'm paying 502. there's a gap and how much money is there."*
 *
 * BOTH HALVES WERE ONE CAUSE. The grace-period regime was gated on
 * `paymentPreference === 'statement'` in THREE separate places - the map's initialiser, the
 * interest calculation that reads it, and the monthly update that writes it - so a `full` card
 * never entered grace and accrued interest every cycle while paying everything off. And the "gap"
 * he asked about was precisely that interest: the payment exceeded the purchases by it.
 *
 * Measured on his row (balance 211.62, APR 29.99, first payment due 2026-10-10, ~290/month of
 * purchases) BEFORE the fix: interest 5.29 in September and 5.42 in October, October payment
 * 512.33 against 290 of purchases. AFTER: interest 0 in every month and a payment of 501.62,
 * which is 211.62 + 290.00 exactly - no gap.
 *
 * ⚠️ THE PAIR IS THE POINT. "No interest" alone is satisfied by an engine that has stopped
 * charging interest at all, which would be a far worse bug than the one being fixed. So every
 * arm here has its opposite: a `full` card that does NOT cover its statement must still accrue.
 */

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 0, creditLimit: 5000, minPayment: 25,
    targetPayment: 25, monthlyNewPurchases: 0, monthlyRepayments: 0, color: '#000',
    paymentPreference: 'statement', autopayFullBalance: false, dueDay: 12,
    statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

const MONTHS = 5;

/** His row, as read from the database on 2026-09-17. */
const hisCard = (over: Partial<CardData> = {}): CardData => makeCard({
  id: 'rh', name: 'Robinhood Credit Card', balance: 211.62, apr: 29.99, minPayment: 0,
  targetPayment: 0, paymentPreference: 'full', paymentUnconditional: true,
  firstDueDate: '2026-10-10', dueDay: 10, statementBalancePhase: true, creditLimit: 5250,
  monthlyNewPurchases: 290,
  ...over,
});

const purchases = Array.from({ length: MONTHS }, (_, m) => ({ rh: m === 0 ? 0 : 290 }));

function run(card: CardData, income: number, liquid: number) {
  const ev = Array.from({ length: MONTHS }, () => ({ income, expenses: 3500 }));
  return simulateVariablePayoff([card], liquid, 0, 'avalanche', income, 3500, MONTHS, ev,
    undefined, purchases);
}

/**
 * ⚠️ HIS ROW HAS CHANGED SINCE THE FIX, AND THAT IS WHY THIS ARM EXISTS.
 *
 * `hisCard` above records the row as read on 2026-09-17: balance **211.62**, preference
 * **`full`**. Read again on **2026-09-18** it is balance **324.27**, preference **`statement`**
 * - he changed the setting himself. So the shape the fix was aimed at is no longer the shape he
 * is looking at, and a session checking his report against `e321c9fc` alone would be reasoning
 * about a card that no longer exists.
 *
 * `statement` was ALWAYS inside the grace regime and was never the broken path, so this arm is
 * expected to pass - and that is exactly why it is worth pinning rather than assuming. His live
 * row also carries `statement_balance` **NULL** while `statement_balance_phase` is **true**, a
 * combination worth having under a test before someone decides it is impossible.
 */
const hisCardToday = (over: Partial<CardData> = {}): CardData => makeCard({
  id: 'rh', name: 'Robinhood Credit Card', balance: 324.27, apr: 29.99, minPayment: 0,
  targetPayment: 0, paymentPreference: 'statement', paymentUnconditional: true,
  firstDueDate: '2026-10-10', dueDay: 10, statementBalancePhase: true, statementBalance: null,
  creditLimit: 5250, monthlyNewPurchases: 290,
  ...over,
});

describe('his CURRENT row (2026-09-18): statement preference, first payment 10 October', () => {
  it('accrues NO interest in September or October', () => {
    const sim = run(hisCardToday(), 6000, 4000);
    const interest = sim.monthlyInterest.get('rh')!;
    expect(interest[0], `September interest was ${interest[0]}`).toBe(0);
    expect(interest[1], `October interest was ${interest[1]}`).toBe(0);
  });

  /**
   * HIS "GAP" - *"its not showing all the purchase amount in October even though Im paying 502.
   * theres a gap and how much money is there."*
   *
   * ⚠️ MY FIRST VERSION OF THIS ASSERTED `324.27 + 290` AND IT FAILED, AND THE ENGINE WAS RIGHT.
   * October pays **324.27** - the STATEMENT balance alone. That is correct for a
   * `statement`-preference card: the cycle's own purchases land on the NEXT statement, so they
   * are deliberately not in this payment. Recording the wrong expectation rather than deleting it,
   * because it is the same reasoning error a user makes when they read the row.
   *
   * ⚠️ AND IT MEANS HIS ORIGINAL COMPLAINT CANNOT BE RE-CHECKED AGAINST TODAY'S NUMBER. He was
   * looking at a `full` card paying 501.62 (= 211.62 + 290). He has since switched the card to
   * `statement`, which pays 324.27 and EXCLUDES the current cycle's purchases BY DESIGN. So a
   * payment that "does not include all the purchases" is now the CORRECT behaviour, and anyone
   * comparing his old words to this figure will diagnose a defect that is not there.
   *
   * What this pins is the part that is still a defect if it breaks: no interest, and a payment
   * that reconciles to the statement exactly - nothing unexplained left over.
   */
  it('October settles the statement exactly, with nothing unexplained', () => {
    const sim = run(hisCardToday(), 6000, 4000);
    const pays = sim.monthlyPayments.get('rh')!;
    const interest = sim.monthlyInterest.get('rh')!;
    // Nothing in September - the first statement has not been cut.
    expect(pays[0]).toBe(0);
    // October settles the carried statement balance to the cent, with no interest riding on it.
    expect(pays[1]).toBeCloseTo(324.27, 2);
    expect(interest[1]).toBe(0);
  });

  /**
   * ⚠️ THE LOAD-BEARING OPPOSITE, in this file's own house style. "No interest" alone is
   * satisfied by an engine that has stopped charging interest at all - a far worse defect than
   * the one being checked. A card that does NOT clear its statement must still accrue.
   */
  it('CONTROL: the same row as a plain revolving card DOES accrue', () => {
    const revolving = hisCardToday({
      paymentPreference: undefined, paymentUnconditional: false, minPayment: 25, targetPayment: 25,
    });
    const sim = run(revolving, 3600, 0);
    const interest = sim.monthlyInterest.get('rh')!;
    expect(interest.some(v => v > 0), 'no month accrued - the engine may not be charging at all')
      .toBe(true);
  });
});

describe('clearsStatement', () => {
  it('covers both intents to clear, and NOT a plain revolving card', () => {
    expect(clearsStatement({ paymentPreference: 'statement' })).toBe(true);
    expect(clearsStatement({ paymentPreference: 'full' })).toBe(true);
    // The negative is load-bearing: giving an unstated card grace would stop interest accruing
    // for nearly every user of the app.
    expect(clearsStatement({ paymentPreference: null })).toBe(false);
  });
});

describe('a full-preference card paid in full accrues no interest', () => {
  it('his exact row: zero interest in every month', () => {
    const sim = run(hisCard(), 5000, 3000);
    const interest = sim.monthlyInterest.get('rh')!;
    for (let m = 0; m < MONTHS; m++) {
      expect(interest[m], `month ${m} charged ${interest[m]} of interest on a card paid in full`)
        .toBeLessThanOrEqual(0.01);
    }
  });

  it('and the payment equals balance + purchases exactly, with no gap', () => {
    const sim = run(hisCard(), 5000, 3000);
    const pays = sim.monthlyPayments.get('rh')!;
    // October: September's 211.62 carry plus that cycle's 290 of purchases.
    expect(pays[1]).toBeCloseTo(211.62 + 290, 2);
  });

  it('NEGATIVE CONTROL: a full-preference card that canNOT cover its statement still accrues', () => {
    // Not unconditional, a real minimum, and a month too tight to clear it - the ordinary
    // revolving case. If this reads zero, interest has stopped working rather than grace starting.
    const starved = hisCard({
      paymentUnconditional: false, minPayment: 25, balance: 4000,
      firstDueDate: null, statementBalancePhase: false,
    });
    const sim = run(starved, 3600, 100);
    const interest = sim.monthlyInterest.get('rh')!;
    const charged = interest.filter(v => v > 0.01);
    expect(charged.length,
      'no interest was charged anywhere on a card that never covers its statement - grace is now unconditional, which is worse than the bug')
      .toBeGreaterThan(0);
  });

  it('NOT BILLED YET is not a failure to pay: grace survives the first, unbilled cycle', () => {
    // His card again. September pays nothing because the first payment is not due until 10
    // October - that is correct - and scoring it as a missed statement charged interest in
    // OCTOBER. This is the third place the first-payment-due rule has had to be wired.
    const interest = run(hisCard(), 5000, 3000).monthlyInterest.get('rh')!;
    expect(interest[1], `October charged ${interest[1]} because September was scored as a miss`)
      .toBeLessThanOrEqual(0.01);
  });
});
