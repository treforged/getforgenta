import { describe, it, expect } from 'vitest';
import {
  planDatedCommitments, allocateAgainstCommitments,
  type DatedCommitment,
} from '@/lib/dated-commitments';

const ASOF = '2026-08-01';

function commitment(over: Partial<DatedCommitment> = {}): DatedCommitment {
  return {
    id: 'c1', source: 'savings_goal', label: 'A goal',
    remaining: 1200, dueDate: '2027-08-01', committedMonthly: 0,
    consequence: { kind: 'hard' },
    ...over,
  };
}

describe('planDatedCommitments — the floor', () => {
  it('divides what is left by the months left', () => {
    const [p] = planDatedCommitments([commitment()], { asOf: ASOF, bestAlternativeApr: 20 });
    expect(p.monthsRemaining).toBe(12);
    expect(p.requiredMonthly).toBe(100);
  });

  it('calls a goal with nothing going in UNFUNDED, not on track', () => {
    const [p] = planDatedCommitments([commitment()], { asOf: ASOF, bestAlternativeApr: 20 });
    expect(p.status).toBe('unfunded');
    expect(p.shortfallMonthly).toBe(100);
  });

  it('calls a goal contributing too little BEHIND, and reports only the gap', () => {
    const [p] = planDatedCommitments(
      [commitment({ committedMonthly: 60 })], { asOf: ASOF, bestAlternativeApr: 20 });
    expect(p.status).toBe('behind');
    expect(p.shortfallMonthly).toBe(40);
  });

  it('never reports a negative shortfall for someone over-contributing', () => {
    const [p] = planDatedCommitments(
      [commitment({ committedMonthly: 500 })], { asOf: ASOF, bestAlternativeApr: 20 });
    expect(p.status).toBe('on_track');
    expect(p.shortfallMonthly).toBe(0);
  });

  it('treats a fully funded goal as met and stops reserving for it', () => {
    const [p] = planDatedCommitments(
      [commitment({ remaining: 0 })], { asOf: ASOF, bestAlternativeApr: 20 });
    expect(p.status).toBe('met');
    expect(p.requiredMonthly).toBe(0);
    expect(p.binding).toBe(false);
  });

  it('does not explode on a date that has already passed', () => {
    const [p] = planDatedCommitments(
      [commitment({ dueDate: '2026-01-01' })], { asOf: ASOF, bestAlternativeApr: 20 });
    expect(p.monthsRemaining).toBe(1);
    expect(Number.isFinite(p.requiredMonthly)).toBe(true);
    expect(p.requiredMonthly).toBe(1200);
  });

  it('reads soonest-first, the way a calendar does', () => {
    const plans = planDatedCommitments([
      commitment({ id: 'late', dueDate: '2028-01-01' }),
      commitment({ id: 'soon', dueDate: '2026-11-01' }),
    ], { asOf: ASOF, bestAlternativeApr: 20 });
    expect(plans.map(p => p.id)).toEqual(['soon', 'late']);
  });
});

describe('planDatedCommitments — which deadlines are worth meeting', () => {
  it('always binds a hard deadline, whatever the money could otherwise earn', () => {
    const [p] = planDatedCommitments(
      [commitment({ consequence: { kind: 'hard' } })],
      { asOf: ASOF, bestAlternativeApr: 99 });
    expect(p.binding).toBe(true);
    expect(p.notBindingReason).toBeNull();
  });

  it('binds a priced deadline whose miss costs MORE than the alternative earns', () => {
    const [p] = planDatedCommitments(
      [commitment({ source: 'promo_tranche', consequence: { kind: 'priced', missedApr: 29.99 } })],
      { asOf: ASOF, bestAlternativeApr: 16.6 });
    expect(p.binding).toBe(true);
  });

  it('REFUSES a priced deadline the money is better off ignoring, and says why', () => {
    // The non-obvious result, and the reason this module exists: a promo repricing to 16.6% is not
    // worth clearing early when the same dollar kills a 27.49% balance instead.
    const [p] = planDatedCommitments(
      [commitment({ source: 'promo_tranche', consequence: { kind: 'priced', missedApr: 16.6 } })],
      { asOf: ASOF, bestAlternativeApr: 27.49 });
    expect(p.binding).toBe(false);
    expect(p.notBindingReason).toContain('16.6%');
    expect(p.notBindingReason).toContain('27.49%');
  });

  it('binds every priced deadline for someone carrying no debt at all', () => {
    const [p] = planDatedCommitments(
      [commitment({ source: 'promo_tranche', consequence: { kind: 'priced', missedApr: 0.01 } })],
      { asOf: ASOF, bestAlternativeApr: 0 });
    expect(p.binding).toBe(true);
  });
});

describe('allocateAgainstCommitments', () => {
  const plans = (bestAlternativeApr = 27.49) => planDatedCommitments([
    commitment({ id: 'move', remaining: 1200, dueDate: '2027-08-01' }),
    commitment({
      id: 'promo', source: 'promo_tranche', remaining: 6000, dueDate: '2027-02-01',
      consequence: { kind: 'priced', missedApr: 16.6 },
    }),
  ], { asOf: ASOF, bestAlternativeApr });

  it('reserves the hard floor and hands the rest to the debt', () => {
    const a = allocateAgainstCommitments(1000, plans());
    expect(a.reserved.get('move')).toBe(100);
    expect(a.surplusRemaining).toBe(900);
    expect(a.feasible).toBe(true);
  });

  it('reserves nothing for the deadline it decided was not worth meeting', () => {
    // 'promo' is due FIRST and would otherwise swallow the whole surplus.
    expect(allocateAgainstCommitments(1000, plans()).reserved.has('promo')).toBe(false);
  });

  it('reserves for that same promo once the alternative is worse than the cliff', () => {
    const a = allocateAgainstCommitments(1000, plans(5));
    expect(a.reserved.get('promo')).toBeCloseTo(1000, 6);
    expect(a.reserved.has('move')).toBe(false); // nothing left; see feasibility below
  });

  it('pays the soonest deadline first when the money does not stretch', () => {
    const a = allocateAgainstCommitments(1000, plans(5));
    expect(a.surplusRemaining).toBe(0);
    expect(a.feasible).toBe(false);
  });

  it('says the plan does not work rather than quietly under-funding it', () => {
    const a = allocateAgainstCommitments(50, plans());
    expect(a.reserved.get('move')).toBe(50);
    expect(a.feasible).toBe(false);
    expect(a.monthlyShortfall).toBe(50);
  });

  it('treats no surplus as a shortfall, not as a balanced plan', () => {
    const a = allocateAgainstCommitments(0, plans());
    expect(a.totalReserved).toBe(0);
    expect(a.feasible).toBe(false);
    expect(a.monthlyShortfall).toBe(100);
  });
});

describe("Tre's own account, 2026-08-20 — the case this was built for", () => {
  // Real figures, read from Postgres:
  //   • "Move fund (lease break + movers + deposit)" — $10,340 by 2027-07-01, $0 saved,
  //     $0/month set. A hard deadline: miss it and the move does not happen.
  //   • Discover balance-transfer promo — $5,037.73 at 7.99% until 2028-01-04, repricing to 16.6%.
  //   • Prime Visa — $8,396.90 at 27.49%, no promo, no deadline. The best alternative use.
  const REAL: DatedCommitment[] = [
    {
      id: 'move', source: 'savings_goal', label: 'Move fund (lease break + movers + deposit)',
      remaining: 10340, dueDate: '2027-07-01', committedMonthly: 0,
      consequence: { kind: 'hard' },
    },
    {
      id: 'discover-promo', source: 'promo_tranche', label: 'Balance transfer promo',
      remaining: 5037.73, dueDate: '2028-01-04', committedMonthly: 0,
      consequence: { kind: 'priced', missedApr: 16.6 },
    },
  ];

  const plans = planDatedCommitments(REAL, { asOf: '2026-08-20', bestAlternativeApr: 27.49 });
  const move = plans.find(p => p.id === 'move')!;
  const promo = plans.find(p => p.id === 'discover-promo')!;

  it('turns the hand-typed $0 into the number he actually has to send', () => {
    expect(move.monthsRemaining).toBe(11);
    expect(move.requiredMonthly).toBeCloseTo(940, 0);
    expect(move.status).toBe('unfunded');
  });

  it('leaves the Discover promo alone, because the Visa is the more expensive dollar', () => {
    expect(promo.binding).toBe(false);
  });

  it('sends every dollar above the move floor at the 27.49% card', () => {
    const a = allocateAgainstCommitments(1500, plans);
    expect(a.totalReserved).toBeCloseTo(940, 0);
    expect(a.surplusRemaining).toBeCloseTo(560, 0);
    expect(a.feasible).toBe(true);
  });
});
