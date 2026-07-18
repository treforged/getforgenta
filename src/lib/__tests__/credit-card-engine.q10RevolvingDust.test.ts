import { describe, it, expect } from 'vitest';
import { simulateVariablePayoff, type CardData } from '../credit-card-engine';

// Q10 (2026-07-17): the convergence loop feeds the sim whole-dollar debtCashTargetByMonth
// values, so a statement-preference card's payoff-month payment can land cents short of its
// revolving carry. The leftover sub-dollar dust (live: Prime Visa held $0.04 from month 12
// onward) then self-sustains: the paid-off transition's tolerance was purchases + $0.01, the
// engine rounds the dust back into a $0 next-pass target, and monthlyRevolvingBalances never
// reports exact 0 — nulling simRevolvingPayoffMonth / forecastRevolvingPayoffMonth and
// suppressing the CC Debt Free milestone. Sub-dollar revolving dust must clear to 0, matching
// the engine's existing < $1 dust convention on total balances and cycling backlog.

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 0, creditLimit: 20000,
    minPayment: 25, targetPayment: 25, monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: null, autopayFullBalance: false,
    dueDay: 25, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

/** Statement card + whole-dollar targets: month 0 pays 1000 of the 1500.04 balance, month 1's
 *  500 target lands $0.04 short of the revolving carry — the dust-forming scenario. */
function runDustSim(balance: number, targets: number[]) {
  const card = makeCard({
    id: 'p', paymentPreference: 'statement', apr: 0,
    balance, monthlyNewPurchases: 500,
  });
  const events = Array.from({ length: 8 }, () => ({ income: 3000, expenses: 1500 }));
  return simulateVariablePayoff(
    [card], 5000, 1000, 'avalanche', 3000, 1500, 8, events,
    undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, targets,
  );
}

describe('simulateVariablePayoff — sub-dollar revolving dust clears (Q10)', () => {
  const wholeDollarTargets = [1000, ...Array.from({ length: 7 }, () => 500)];

  it('a $0.04-short payoff month reports revolving $0, not persistent dust', () => {
    const sim = runDustSim(1500.04, wholeDollarTargets);
    const rev = sim.monthlyRevolvingBalances.get('p')!;
    expect(rev[1]).toBe(0);
    expect(rev.slice(1).every(v => v === 0)).toBe(true);
  });

  it('the dust card leaves debtCards — payoff ETA freezes instead of running the horizon', () => {
    const sim = runDustSim(1500.04, wholeDollarTargets);
    expect(sim.projectedPayoffMonths).toBe(2);
  });

  it('a genuine revolving carry above $1 is NOT written off as dust', () => {
    // Same shape but the shortfall is $2.04 — real debt, must keep reporting > 0.
    const sim = runDustSim(1502.04, wholeDollarTargets);
    const rev = sim.monthlyRevolvingBalances.get('p')!;
    expect(rev[1]).toBeCloseTo(2.04, 2);
    expect(rev[2]).toBeGreaterThan(0);
  });
});
