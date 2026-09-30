import { describe, it, expect } from 'vitest';
import { projectCardVariable, type CardData } from '../credit-card-engine';

// 8a90fa8a - the sim bills a cycling card max(scheduled purchases, monthlyNewPurchases), so the
// displayed row must show that same figure, or End != Start + purchases - payment. Found on Tre's
// 2026-09-29 capture: 22 Prime Visa rows off by exactly $106 (his Supplements rule).
function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'pv', name: 'Prime Visa', balance: 0, apr: 24, creditLimit: 5000,
    minPayment: 25, targetPayment: 25, monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: 'statement', autopayFullBalance: true,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}
const N = 6;
const fill = (x: number) => Array.from({ length: N }, () => x);

function rows(card: CardData, scheduled: number, owed: number) {
  // Sim-shaped inputs: cycling from month 1, each cycle owes `owed`, paid in full.
  return projectCardVariable(card, fill(owed), N, true, fill(scheduled), fill(0), fill(owed), fill(0)).months;
}

describe('cycling row purchases match what the sim charged', () => {
  it('shows the baseline when the schedule is below it, and the row adds up', () => {
    const r = rows(makeCard({ monthlyNewPurchases: 253.99 }), 147.99, 253.99);
    for (const row of r.slice(0, N - 1)) {
      expect(row.newPurchases).toBeCloseTo(253.99, 2);
      expect(row.endBalance).toBeCloseTo(row.startBalance + row.newPurchases + row.interest - row.payment, 2);
    }
  });

  it('control: the schedule wins when it is above the baseline', () => {
    const r = rows(makeCard({ monthlyNewPurchases: 100 }), 147.99, 147.99);
    expect(r[0].newPurchases).toBeCloseTo(147.99, 2);
  });
});
