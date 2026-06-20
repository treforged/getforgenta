import { describe, it, expect } from 'vitest';
import { simulateVariablePayoff, CardData } from '../credit-card-engine';

// Regression for the real bug behind a user-reported symptom on a live 3-card account: a
// genuinely-revolving card (Discover) stayed pinned at its bare minimum for over a year of
// simulated months while two cycling cards' (Prime Visa/Venture X) combined "owed" grew without
// bound — confirmed live: one card's owed grew from $2,060 to $3,222 over 15 months, another from
// $3,655 to $4,957, with steadily climbing interest-carry on both, because cycling cards had
// unconditional first claim on 100% of cash above the floor via a dedicated pool that ran before
// the revolving avalanche cascade ever saw a dollar. Fixed by unifying both pools: a cycling
// card's MANDATORY current-cycle statement still gets funded first (unconditionally — you can't
// skip paying for groceries you already bought), but any shortfall becomes "backlog" that
// competes for "extra" cash in the SAME avalanche/snowball cascade revolving cards use.

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 0, creditLimit: 5000,
    minPayment: 25, targetPayment: 25, monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: 'statement', autopayFullBalance: true,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

describe('simulateVariablePayoff — unified cycling/revolving avalanche cascade', () => {
  it('a revolving card stops being pinned at its minimum once cash genuinely increases, even with two competing cycling cards', () => {
    const rev = makeCard({ id: 'rev', name: 'Rev', balance: 5000, apr: 28, minPayment: 100, autopayFullBalance: false });
    const cycA = makeCard({ id: 'cycA', name: 'CycA', apr: 20, monthlyNewPurchases: 600 });
    const cycB = makeCard({ id: 'cycB', name: 'CycB', apr: 12, monthlyNewPurchases: 500 });
    const months = 12;
    // Months 0-5: tight cash — cycA/cycB's combined mandatory pool chronically falls short,
    // building backlog every month. Months 6+: income jumps — there's genuinely more cash.
    const monthEvents = Array.from({ length: months }, (_, m) => ({ income: m < 6 ? 2400 : 3400, expenses: 1500 }));

    const sim = simulateVariablePayoff([rev, cycA, cycB], 1200, 1000, 'avalanche', 2400, 1500, months, monthEvents);

    // Tight months: rev pinned at its bare minimum — confirms the scenario actually reproduces
    // chronic cycling-pool pressure, not just "there's always plenty of cash for everyone."
    for (let m = 1; m < 6; m++) {
      expect(sim.monthlyPayments.get('rev')![m]).toBeCloseTo(100, 2);
    }
    // The two cycling cards genuinely build backlog during the tight months — confirms the
    // pressure is real, not an artifact of the fixture.
    expect(sim.monthlyCyclingBacklog.get('cycA')![5]).toBeGreaterThan(500);
    expect(sim.monthlyCyclingBacklog.get('cycB')![5]).toBeGreaterThan(400);

    // The month income increases, rev gets a large extra payment in the SAME month — not stuck
    // waiting for the cycling cards to fully resolve their backlogs first. This is the literal
    // bug fix: once there's genuinely more cash, it doesn't sit locked inside an ever-growing
    // cycling pool — it flows to whichever card needs it most by avalanche priority.
    expect(sim.monthlyPayments.get('rev')![6]).toBeGreaterThan(500);

    // Both cycling cards' backlogs shrink (not grow) once they're no longer the only thing
    // competing for the extra cash — confirms they're still being serviced, not abandoned.
    expect(sim.monthlyCyclingBacklog.get('cycA')![11]).toBeLessThan(sim.monthlyCyclingBacklog.get('cycA')![5]!);
    expect(sim.monthlyCyclingBacklog.get('cycB')![11]).toBeLessThan(sim.monthlyCyclingBacklog.get('cycB')![5]!);
  });

  it('a backlog card is protected (not zeroed) during a genuine floor breach, sorted correctly alongside revolving cards', () => {
    // Mirrors a real floor-breach scenario but with a cycling card that already carries backlog
    // entering the breached month — guards against the snowball-protection sort mis-ranking a
    // backlog card (whose `balances` entry is always 0, since it's tracked separately) ahead of
    // or behind where its actual backlog amount should place it.
    const rev = makeCard({ id: 'rev', name: 'Rev', balance: 4000, apr: 20, minPayment: 150, autopayFullBalance: false });
    const cyc = makeCard({ id: 'cyc', name: 'Cyc', apr: 15, monthlyNewPurchases: 400 });
    const monthEvents = [
      { income: 1000, expenses: 1000 },
      { income: 1350, expenses: 1000 }, // tight — cyc is shorted, builds backlog
      { income: 1000, expenses: 1000 }, // breached — cash barely covers anyone's minimum
    ];
    const SKIP8 = [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined] as const;

    const sim = simulateVariablePayoff([rev, cyc], 1000, 1000, 'avalanche', 0, 0, 3, monthEvents,
      ...SKIP8, [0, 150, 0]);

    expect(sim.monthlyCyclingBacklog.get('cyc')![1]).toBeGreaterThan(0); // backlog exists entering month 2
    expect(sim.flags.some(f => f.month === 3 && f.flag === 'FLOOR_BREACHED')).toBe(true);
    // Even in the breach, the backlog card still gets at least its own minimum — not zeroed out
    // just because its `balances` entry (unused for backlog cards) would sort it as if it owed $0.
    expect(sim.monthlyPayments.get('cyc')![2]).toBeGreaterThanOrEqual(Math.min(cyc.minPayment, sim.monthlyCyclingBacklog.get('cyc')![1]!));
    expect(sim.monthlyPayments.get('rev')![2]).toBeGreaterThanOrEqual(150);
  });
});
