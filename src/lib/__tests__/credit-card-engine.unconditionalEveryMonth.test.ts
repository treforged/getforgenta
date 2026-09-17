import { describe, it, expect } from 'vitest';
import { simulateVariablePayoff, type CardData } from '../credit-card-engine';

/**
 * "ALWAYS PAY THIS IN FULL" MUST HOLD IN EVERY MONTH, AND THE GAP MUST BE REPORTED.
 *
 * Tre, 2026-09-17, looking at his own /debt tab: "it doesn't seem like Robinhood is being paid at
 * all when I look at the drop-down and even the chart shows like it's not being paid at all."
 *
 * WHY THE EXISTING TESTS COULD NOT SEE IT, and this is the whole reason this file exists.
 * `credit-card-engine.unconditionalPayment.test.ts` says so in its own header: its central claim
 * is UNPROVEN, because that fixture's pool is never smaller than the obligation, so the clamp it
 * was written to catch never binds. And every one of its tests goes through
 * `getMonthlyDebtBreakdown`, which settles MONTH 0. The defect lives in months 1 and later, in
 * `simulateVariablePayoff` — the function that draws the chart and fills the dropdown he was
 * looking at — which never read `paymentUnconditional` at all.
 *
 * So this file drives the SIMULATION directly, over a horizon, and builds the genuinely tight
 * month the older file records as missing.
 *
 * WHAT IS ASSERTED, AND WHY EACH ARM IS NECESSARY:
 *   A  tight month  — the obligation is paid IN FULL in every month it owes, not only month 0.
 *      The fixture is TIGHT on purpose: a rich one clears the card in month 0, which turns it
 *      cycling and pays it in full for reasons that have nothing to do with the setting.
 *   A' positive control — the COMPETING card is still paid something. Without it, "the
 *      unconditional card gets everything" is equally satisfied by a simulation that has stopped
 *      paying anyone, and an arm that only checks the one card cannot tell those apart.
 *   B  the gap      — the shortfall is a POSITIVE NUMBER, in a month AFTER month 0.
 *      Shipping A without B is the same lie pointed the other way: the other cards get starved
 *      silently. The shortfall field is what makes that visible.
 *   B' negative control — the shortfall is 0 in every month of the RICH run. A field that is
 *      always positive reports nothing; this is what proves it discriminates.
 *   C  not billed yet — a card whose first statement has not cut pays NOTHING and reports NO
 *      shortfall. That is the September charge Tre reported, which took three separate fixes, and
 *      an obligation that outranks the cash pool is exactly the shape that reintroduces it.
 *   D  the flag is what does it — the identical fixture WITHOUT the setting behaves differently.
 *      Otherwise every assertion above could be a property of the fixture.
 */

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 0, creditLimit: 5000,
    minPayment: 25, targetPayment: 25, monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: 'statement', autopayFullBalance: false,
    dueDay: 12, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

const MONTHS = 6;
const PURCHASES = 200;

/**
 * His shape: a card he has told the app to clear in full, carrying NO contract minimum
 * (`min_payment` is 0 on his row), against a competitor the avalanche prefers.
 *
 * The competitor's APR is deliberately HIGHER. That is what makes the fixture discriminating:
 * with no minimum and a lower rate, the surplus cascade has no reason to send this card anything,
 * which is precisely why his chart was empty. A fixture where the unconditional card happened to
 * rank first would pass with the feature removed.
 */
const cards = (unconditional: boolean): CardData[] => [
  makeCard({
    id: 'rh', name: 'Robinhood', balance: 800, apr: 29.99, minPayment: 0, targetPayment: 0,
    monthlyNewPurchases: PURCHASES, paymentPreference: 'full',
    ...(unconditional ? { paymentUnconditional: true } : {}),
  }),
  makeCard({
    id: 'other', name: 'Other Card', balance: 6000, apr: 31.99, minPayment: 120,
    targetPayment: 120, paymentPreference: 'statement',
  }),
];

const purchasesByMonth = Array.from({ length: MONTHS }, (_, m) => ({
  // Month 0 is 0 by the engine's own convention — the live balance already includes today's
  // purchases. Months 1+ carry the steady amount.
  rh: m === 0 ? 0 : PURCHASES,
  other: 0,
}));

function run(unconditional: boolean, income: number, liquid: number) {
  const monthEvents = Array.from({ length: MONTHS }, () => ({ income, expenses: 1500 }));
  return simulateVariablePayoff(
    cards(unconditional), liquid, 0, 'avalanche', income, 1500, MONTHS, monthEvents,
    undefined, purchasesByMonth,
  );
}

const RICH = () => run(true, 6000, 4000);
const TIGHT = () => run(true, 1750, 250);
const TIGHT_OFF = () => run(false, 1750, 250);

/** Months in which this card actually owed something - the only months a payment can be judged. */
const owingMonths = (owed: number[]): number[] =>
  owed.map((v, m) => (v > 0.005 ? m : -1)).filter(m => m >= 0);

describe('simulateVariablePayoff - "always pay in full" holds in every month', () => {
  it('A: a cash-TIGHT month pays the card in full in EVERY month it owes, not only month 0', () => {
    const sim = TIGHT();
    const pays = sim.monthlyPayments.get('rh')!;
    const owed = sim.monthlyCyclingOwed.get('rh')!;
    const months = owingMonths(owed);
    // The fixture must actually exercise later months, or this arm proves nothing about them.
    expect(months.filter(m => m > 0).length,
      'the fixture never billed this card after month 0 - it cannot show a later-month defect')
      .toBeGreaterThanOrEqual(3);
    for (const m of months) {
      expect(pays[m], `month ${m} paid ${pays[m]} against ${owed[m]} owed - the payment was shrunk to fit`)
        .toBeGreaterThanOrEqual(Math.round(owed[m] * 100) / 100 - 0.01);
    }
    // ...and nothing is carried, which is the user-visible meaning of the setting.
    const bal = sim.monthlyBalances.get('rh')!;
    for (let m = 0; m < MONTHS; m++) {
      expect(bal[m], `month ${m} carried ${bal[m]} forward on a card set to pay in full`)
        .toBeLessThanOrEqual(0.01);
    }
  });

  it("A': positive control - the competing card is still paid every month, so A is not measuring a starved simulation", () => {
    const other = TIGHT().monthlyPayments.get('other')!;
    for (let m = 0; m < MONTHS; m++) {
      expect(other[m], `month ${m} sent the competing card nothing - the obligation ate the whole plan`)
        .toBeGreaterThan(0);
    }
  });

  it('B: the tight month reports the gap as a positive number, in words, with the amount in it', () => {
    const sim = TIGHT();
    const short = sim.monthlyUnconditionalShortfall.get('rh')!;
    expect(short.length).toBe(MONTHS);
    expect(short.filter(v => v > 0).length,
      'the obligation was held but NO shortfall was reported - the rest of the plan is being starved silently')
      .toBeGreaterThan(0);
    // ...and specifically AFTER month 0. A month-0-only report is exactly what shipped before
    // this fix, so an arm satisfied by month 0 alone cannot tell the two apart.
    expect(short.slice(1).filter(v => v > 0).length,
      'the gap was only ever reported in month 0 - the months the chart draws report nothing')
      .toBeGreaterThan(0);
    const warned = sim.warningMessages.filter(w => /always pay in full/.test(w.message));
    expect(warned.length).toBeGreaterThan(0);
    expect(warned[0].message).toMatch(/\$[0-9]/);
  });

  it("B': negative control - the cash-RICH run reports a shortfall of 0 in every month", () => {
    const short = RICH().monthlyUnconditionalShortfall.get('rh')!;
    expect(short.length).toBe(MONTHS);
    for (let m = 0; m < MONTHS; m++) {
      expect(short[m], `month ${m} reported a gap of ${short[m]} in a month that plainly affords it`).toBe(0);
    }
  });

  it('C: a card whose first statement has not been billed pays nothing, and reports no gap', () => {
    const now = new Date();
    const due = new Date(now.getFullYear(), now.getMonth() + 2, 10);
    const iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-10`;
    const withFirstDue = cards(true).map(c => (c.id === 'rh' ? { ...c, firstDueDate: iso } : c));
    const monthEvents = Array.from({ length: MONTHS }, () => ({ income: 6000, expenses: 1500 }));
    const sim = simulateVariablePayoff(
      withFirstDue, 4000, 0, 'avalanche', 6000, 1500, MONTHS, monthEvents,
      undefined, purchasesByMonth,
    );
    const pays = sim.monthlyPayments.get('rh')!;
    const short = sim.monthlyUnconditionalShortfall.get('rh')!;
    expect(pays[0], 'a payment was demanded before the first statement was cut').toBe(0);
    expect(pays[1], 'a payment was demanded before the first statement was cut').toBe(0);
    expect(short[0]).toBe(0);
    expect(short[1]).toBe(0);
    // ...and it does start once billed, so this arm cannot pass by the card being inert.
    const total = pays.reduce((s, v) => s + v, 0);
    expect(total, 'the card never started paying at all').toBeGreaterThan(0);
  });

  it('D: the SETTING is what does it - without it the same fixture lets the balance CLIMB', () => {
    const on = TIGHT().monthlyBalances.get('rh')!;
    const off = TIGHT_OFF().monthlyBalances.get('rh')!;
    const last = MONTHS - 1;
    expect(off[last], 'the card did not accumulate debt without the setting - the fixture is not tight')
      .toBeGreaterThan(off[0]);
    expect(on[last], 'the setting made no difference - every other arm is measuring the fixture')
      .toBeLessThan(off[last]);
    expect(on[last]).toBeLessThanOrEqual(0.01);
  });
});
