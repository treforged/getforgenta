import { describe, it, expect } from 'vitest';
import { intendedCyclingStatement } from '../cycling-statement-reserve';
import { computeFloorProtection } from '../floor-protection';
import { PROJECTION_MONTHS } from '../scheduling';

const card = (id: string, monthlyNewPurchases: number) => ({ id, monthlyNewPurchases });
/** `cardPurchasesPerMonth` — sparse by design, so the months with no entry are bare objects. */
const months = (...m: { [cardId: string]: number }[]): { [cardId: string]: number }[] => m;

describe('the statement a cycling card will actually present', () => {
  it('falls back to the steady recurring spend when nothing is scheduled in the map', () => {
    // THE REGRESSION. This read `?? 0` until 2026-08-27, so a card spending through an ordinary
    // recurring rule reserved nothing, the `max(actual, intended)` deadlock-breaker collapsed to
    // the sim's own underpayment, and a $230 grocery statement on a 29.99% card was paid $50.
    expect(intendedCyclingStatement([], 3, card('rh', 230))).toBe(230);
    expect(intendedCyclingStatement(undefined, 3, card('rh', 230))).toBe(230);
    expect(intendedCyclingStatement(months({}, {}, {}), 3, card('rh', 230))).toBe(230);
  });

  it('takes the scheduled month when a one-off is bigger than the steady spend', () => {
    const perMonth = months({}, {}, { rh: 1_730 });
    expect(intendedCyclingStatement(perMonth, 3, card('rh', 230))).toBe(1_730);
  });

  it('never drops BELOW the steady spend, because the engine charges it either way', () => {
    // The engine defers max(cardPurchasesThisMonth, monthlyNewPurchases), so a map entry smaller
    // than the recurring estimate is not a cheaper month — reserving it would guarantee an overrun.
    const perMonth = months({}, {}, { rh: 40 });
    expect(intendedCyclingStatement(perMonth, 3, card('rh', 230))).toBe(230);
  });

  it('reads the month BEFORE — a statement is last cycle’s purchases', () => {
    const perMonth = months({}, { rh: 900 }, { rh: 5 });
    expect(intendedCyclingStatement(perMonth, 2, card('rh', 0))).toBe(900);
  });

  it('is zero at month 0, which has no deferred history to have reserved for', () => {
    expect(intendedCyclingStatement(months({ rh: 900 }), 0, card('rh', 230))).toBe(0);
  });

  it('treats a negative or unusable steady figure as no spend rather than a credit', () => {
    expect(intendedCyclingStatement([], 3, card('rh', -50))).toBe(0);
    expect(intendedCyclingStatement([], 3, card('rh', NaN))).toBe(0);
  });
});

describe('a reserved statement makes the month before it save up', () => {
  // The chain the fix relies on: a bigger cycling statement lands in `expenseByMonth`, which lifts
  // `requiredEndByMonth` for the month before, which caps that month's debt payment and marks it a
  // strict save-up month — and `forecast-engine.ts`'s surplus branch is gated on exactly that set,
  // so the cap survives instead of being echoed back as the sim's own spend.
  const flat = (v: number) => Array(PROJECTION_MONTHS).fill(v);
  const run = (statementMonth: number, statement: number) => {
    const expenseByMonth = flat(3_000);
    expenseByMonth[statementMonth] += statement;
    return computeFloorProtection({
      incomeByMonth: flat(4_000),
      expenseByMonth,
      oneTimeNetByMonth: flat(0),
      carDownPaymentByMonth: flat(0),
      floorByMonth: flat(2_000),
      startingBalance: 2_400,
      ccMinTotal: 150,
      ccMinByMonth: flat(150),
      cyclingExcessByMonth: flat(0),
      carFunds: [], transactions: [], ccSourceIds: new Set<string>(),
      now: new Date(2026, 7, 27),
      formatCurrency: (n: number) => `$${n}`,
    });
  };

  it('leaves every month uncapped when the statement is small enough to absorb', () => {
    const { strictSaveUpMonths } = run(3, 0);
    expect(strictSaveUpMonths.has(2)).toBe(false);
  });

  it('caps the month BEFORE a statement the month cannot absorb on its own', () => {
    const { strictSaveUpMonths, maxDebtPaymentByMonth } = run(3, 1_200);
    expect(strictSaveUpMonths.has(2)).toBe(true);
    expect(maxDebtPaymentByMonth[2]).toBeLessThan(Infinity);
  });

  it('never caps a month below its contract minimums, however big the statement', () => {
    // Minimums are exempt by construction (`cap = max(mCcMin, availableForDebt)`) — this is the
    // half of Tre's 2026-08-27 ruling that the save-up must not touch.
    const { maxDebtPaymentByMonth } = run(3, 40_000);
    expect(maxDebtPaymentByMonth[2]).toBeGreaterThanOrEqual(150);
  });
});
