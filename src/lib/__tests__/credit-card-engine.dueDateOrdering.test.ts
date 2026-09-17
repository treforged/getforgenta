import { describe, it, expect } from 'vitest';
import { simulateVariablePayoff, type CardData } from '../credit-card-engine';
import { fallsAfterDueDate } from '../sync-cutoff';

/**
 * A FULL-BALANCE PAYMENT CANNOT PAY A CHARGE THAT HAS NOT HAPPENED YET.
 *
 * Tre, 2026-09-17: *"for Robinhood, if you look at when full balance was enabled, I don't think it
 * was calculating correctly since the due date was on the 10th it would be full balance at that
 * time not the payment of groceries that comes after"*.
 *
 * He is right, and it is UPSTREAM of the transition-month fix that shipped the same morning
 * (`d0bf7c6`, which removed a DOUBLE charge). This is the other half: the payment should not have
 * included those purchases AT ALL. The engine targeted `startBal + interest + EVERY purchase this
 * month`, and `cardPurchasesThisMonth` is month-granular - it carries no day, so nothing in the
 * simulation could tell the 4th from the 19th.
 *
 * ⚠️ EVERY ARM HERE HAS ITS OPPOSITE, because "pays less" is satisfied perfectly by an engine that
 * has stopped paying purchases at all, and "the balance is higher" is satisfied by one that has
 * stopped paying anything. So: a charge BEFORE the due date must still be paid; the debt must
 * still GROW by every purchase whether or not the payment reaches it; and omitting the new input
 * must reproduce the old numbers exactly.
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
const PURCHASES = 290;

/** His row, as read from the database on 2026-09-17. Due on the 10th. */
const hisCard = (over: Partial<CardData> = {}): CardData => makeCard({
  id: 'rh', name: 'Robinhood Credit Card', balance: 211.62, apr: 29.99, minPayment: 0,
  targetPayment: 0, paymentPreference: 'full', paymentUnconditional: true,
  firstDueDate: '2026-10-10', dueDay: 10, statementBalancePhase: true, creditLimit: 5250,
  monthlyNewPurchases: PURCHASES,
  ...over,
});

const purchases = Array.from({ length: MONTHS }, (_, m) => ({ rh: m === 0 ? 0 : PURCHASES }));
/** Every one of those purchases dated after the 10th - his Groceries rule sits on the 19th. */
const allAfterDue = Array.from({ length: MONTHS }, (_, m) => ({ rh: m === 0 ? 0 : PURCHASES }));
/** The same money, dated before the 10th. The payment must still reach it. */
const noneAfterDue = Array.from({ length: MONTHS }, () => ({ rh: 0 }));

function run(card: CardData, afterDue?: { [id: string]: number }[]) {
  const ev = Array.from({ length: MONTHS }, () => ({ income: 5000, expenses: 3500 }));
  return simulateVariablePayoff(
    [card], 3000, 0, 'avalanche', 5000, 3500, MONTHS, ev,
    undefined, purchases,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    afterDue ? { purchasesAfterDueByMonth: afterDue } : undefined,
  );
}

const pay = (sim: ReturnType<typeof run>, m: number) =>
  Math.round((sim.monthlyPayments.get('rh')![m] ?? 0) * 100) / 100;
const bal = (sim: ReturnType<typeof run>, m: number) =>
  Math.round((sim.monthlyBalances.get('rh')![m] ?? 0) * 100) / 100;

describe('fallsAfterDueDate', () => {
  it('splits the month at the due date', () => {
    expect(fallsAfterDueDate('2026-09-19', '2026-09', 10)).toBe(true);
    expect(fallsAfterDueDate('2026-09-04', '2026-09', 10)).toBe(false);
    // The due date itself is covered by a payment made that day.
    expect(fallsAfterDueDate('2026-09-10', '2026-09', 10)).toBe(false);
  });

  it('no due day excludes NOTHING - the unknown falls toward paying more', () => {
    expect(fallsAfterDueDate('2026-09-28', '2026-09', null)).toBe(false);
    expect(fallsAfterDueDate('2026-09-28', '2026-09', undefined)).toBe(false);
  });

  it('a day-31 due date includes the whole of a short month', () => {
    // dueDateInMonth yields 2026-02-31, which no real February date sorts above. That is the
    // intended reading of a month-end due date, not an accident to be "fixed" with a clamp.
    expect(fallsAfterDueDate('2026-02-28', '2026-02', 31)).toBe(false);
  });
});

describe('his card: a charge after the due date is not in the full-balance payment', () => {
  it('pays the balance, and NOT the groceries dated after it', () => {
    const before = run(hisCard());
    const after = run(hisCard(), allAfterDue);
    // Month 1 is the first month that has both a payment and purchases.
    expect(pay(before, 1) - pay(after, 1)).toBeCloseTo(PURCHASES, 2);
  });

  it('POSITIVE CONTROL - the same money dated BEFORE the due date is still paid in full', () => {
    // Without this, "pays 290 less" is satisfied by an engine that pays no purchases at all.
    const before = run(hisCard());
    const early = run(hisCard(), noneAfterDue);
    expect(pay(early, 1)).toBeCloseTo(pay(before, 1), 2);
  });

  it('the DEBT still grows by every purchase - only the TARGET narrowed', () => {
    // An unpaid charge is still owed. If this passed by the purchase vanishing, the fix would be
    // creating money rather than re-ordering it.
    const before = run(hisCard());
    const after = run(hisCard(), allAfterDue);
    expect(bal(after, 1) - bal(before, 1)).toBeCloseTo(PURCHASES, 2);
  });

  it('and it is paid the FOLLOWING month, not forgiven', () => {
    const after = run(hisCard(), allAfterDue);
    // Month 2 pays month 1's deferred groceries on top of its own reachable balance, so the
    // cumulative two-month payment still covers what has been charged by then.
    expect(pay(after, 2)).toBeGreaterThan(0);
    expect(pay(after, 1) + pay(after, 2)).toBeGreaterThan(PURCHASES);
  });
});

describe('the narrow blast radius is itself asserted', () => {
  it('omitting the input reproduces the old numbers exactly', () => {
    const omitted = run(hisCard());
    const zeroes = run(hisCard(), noneAfterDue);
    for (let m = 0; m < MONTHS; m++) {
      expect(pay(zeroes, m)).toBeCloseTo(pay(omitted, m), 2);
      expect(bal(zeroes, m)).toBeCloseTo(bal(omitted, m), 2);
    }
  });

  it('a `statement` card is untouched - its target never held this month purchases', () => {
    const stmt = hisCard({ paymentPreference: 'statement', paymentUnconditional: false });
    const before = run(stmt);
    const after = run(stmt, allAfterDue);
    for (let m = 0; m < MONTHS; m++) {
      expect(pay(after, m)).toBeCloseTo(pay(before, m), 2);
    }
  });

  it('the extra-cash CASCADE honours it too, not just the unconditional pin', () => {
    // paymentUnconditional: false takes the OTHER of the two code paths that spell out what
    // "full" means. Both had to change or they would come to mean different things.
    const card = hisCard({ paymentUnconditional: false });
    const before = run(card);
    const after = run(card, allAfterDue);
    expect(pay(before, 1) - pay(after, 1)).toBeCloseTo(PURCHASES, 2);
  });
});
