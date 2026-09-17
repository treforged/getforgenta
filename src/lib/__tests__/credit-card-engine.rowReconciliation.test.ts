import { describe, it, expect } from 'vitest';
import { simulateVariablePayoff, projectCardVariable, CardData, CardMonthRow } from '../credit-card-engine';

// Every displayed projection row must satisfy End = Start + purchases + interest − payment.
//
// WHY THIS EXISTS. Tre reported a /debt row on 2026-09-17 that does not add up: Start 262,
// purchases 280, payment 542, End 280 — and 262 + 280 − 542 = 0, not 280. His arithmetic is
// right. A reconciliation guard for exactly this class of bug already existed in
// projectCardVariable, but ONLY inside the revolving display branch: the cycling branch
// `continue`s before reaching it, so the one path that carries deferred-model bookkeeping —
// where Start and End belong to DIFFERENT billing cycles, the hardest place to eyeball an
// error — had no check at all.
//
// It is not obvious the identity binds on a cycling row, so the algebra is worth stating.
// Start = S + B (this cycle's statement plus carried backlog), Payment P = p_s + p_b, and next
// cycle's backlog B' = B + (S − p_s) − p_b. Then
//   End = purchases + B' = purchases + (S + B) − P = Start + purchases − P.
// So it binds exactly as hard as on a revolving row.
//
// WHAT THIS GATE DOES NOT COVER, stated so it is not trusted past its reach: it exercises the
// LOCAL sim path (simulateVariablePayoff -> projectCardVariable). The live /debt page can feed
// projectCardVariable payments from the CONVERGED forecast run while taking balances from the
// same result, and this gate does not run that convergence. Every shape below reconciles
// exactly, which is a measured negative — the sim's own cycling path never pays
// owed + purchases — and is therefore evidence about where the reported defect is NOT.

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 0, creditLimit: 5000,
    minPayment: 25, targetPayment: 25, monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: 'statement', autopayFullBalance: true,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

/** The identity under test, as a number. Positive or negative means the row does not add up. */
function residualOf(r: CardMonthRow): number {
  return Math.round((r.endBalance - (r.startBalance + r.newPurchases + r.interest - r.payment)) * 100) / 100;
}

/** Interest may be attributed to the row after the cycle it accrued in, which shows up as a
 * small equal-and-opposite pair. $1 is the same tolerance the in-engine guard uses and
 * comfortably clears whole-dollar payment rounding, while catching the hundreds-of-dollars
 * divergence this gate is named for. */
const TOLERANCE = 1;

function projectFromSim(card: CardData, monthEvents: { income: number; expenses: number }[], purchases: number[]) {
  const sim = simulateVariablePayoff([card], 0, 0, 'avalanche', 3000, 1500, purchases.length, monthEvents);
  const pays = sim.monthlyPayments.get(card.id)!;
  return {
    pays,
    proj: projectCardVariable(
      card, pays, purchases.length, true, purchases,
      sim.monthlyRevolvingBalances.get(card.id)!,
      sim.monthlyCyclingOwed.get(card.id)!,
      sim.monthlyCyclingInterest.get(card.id)!,
      sim.monthlyBalances.get(card.id)!,
      sim.monthlyInterest.get(card.id)!,
    ),
  };
}

const FLUSH = Array.from({ length: 6 }, () => ({ income: 9000, expenses: 1500 }));
const STARVED = [
  { income: 9000, expenses: 1500 },
  { income: 100, expenses: 1500 },
  { income: 9000, expenses: 1500 },
  { income: 9000, expenses: 1500 },
  { income: 9000, expenses: 1500 },
  { income: 9000, expenses: 1500 },
];
const PURCHASES = Array.from({ length: 6 }, () => 280);

describe('projectCardVariable — every displayed row reconciles', () => {
  // POSITIVE CONTROL FIRST. A gate that reports "nothing violates this" is worthless until it
  // has been shown it can find a violation — a zero from a broken assertion and a zero from a
  // healthy engine are the same zero. This constructs Tre's ACTUAL reported row and requires
  // residualOf to flag it, so the instrument proves it works before its silence is believed.
  it('CONTROL: flags the row Tre reported (262 + 280 − 542 ≠ 280)', () => {
    const reported: CardMonthRow = {
      month: 2, label: 'Oct 2026', startBalance: 262, newPurchases: 280,
      interest: 0, payment: 542, endBalance: 280, utilization: 0,
    };
    expect(residualOf(reported)).toBe(280);
    expect(Math.abs(residualOf(reported))).toBeGreaterThan(TOLERANCE);

    // And the mirror: the two coherent readings of that same row BOTH reconcile, which is what
    // makes 262/280/542/280 a contradiction rather than a matter of interpretation.
    expect(residualOf({ ...reported, payment: 262 })).toBe(0);           // deferred: pay the statement
    expect(residualOf({ ...reported, payment: 542, endBalance: 0 })).toBe(0); // full: pay everything
  });

  const shapes: [string, CardData, { income: number; expenses: number }[]][] = [
    ['cycling from zero, abundant cash', makeCard({ id: 'card', apr: 22, monthlyNewPurchases: 280 }), FLUSH],
    ['revolving balance clearing into cycling', makeCard({ id: 'card', apr: 22, balance: 212, monthlyNewPurchases: 280 }), FLUSH],
    ['starved month creates backlog, then catch-up', makeCard({ id: 'card', apr: 22, balance: 212, monthlyNewPurchases: 280 }), STARVED],
    ['full-balance preference', makeCard({ id: 'card', apr: 22, balance: 212, monthlyNewPurchases: 280, paymentPreference: 'full' }), FLUSH],
  ];

  for (const [name, card, events] of shapes) {
    it(`reconciles: ${name}`, () => {
      const { proj } = projectFromSim(card, events, PURCHASES);
      // An empty row list would pass every assertion below, so count what was examined.
      expect(proj.months.length).toBeGreaterThan(0);
      for (const r of proj.months) {
        expect(
          Math.abs(residualOf(r)),
          `${name} ${r.label}: End ${r.endBalance} ≠ Start ${r.startBalance} + purch ${r.newPurchases} + int ${r.interest} − pay ${r.payment}`,
        ).toBeLessThanOrEqual(TOLERANCE);
      }
    });
  }

  // The measured negative that relocates the reported defect: across every shape above the sim
  // never funds a cycling card beyond what it owes. Stated as its own assertion so that if the
  // engine ever starts doing so, this fails by name rather than only as a residual.
  it('a cycling card is never paid more than statement + backlog', () => {
    let examined = 0;
    for (const [name, card, events] of shapes) {
      const sim = simulateVariablePayoff([card], 0, 0, 'avalanche', 3000, 1500, 6, events);
      const owed = sim.monthlyCyclingOwed.get(card.id)!;
      const pays = sim.monthlyPayments.get(card.id)!;
      for (let m = 0; m < owed.length; m++) {
        if (owed[m] <= 0) continue; // not cycling this month — nothing to compare against
        examined++;
        expect(pays[m], `${name} m${m}: paid ${pays[m]} against owed ${owed[m]}`)
          .toBeLessThanOrEqual(owed[m] + TOLERANCE);
      }
    }
    expect(examined, 'no cycling months were compared — the shapes stopped cycling').toBeGreaterThan(10);
  });
});
