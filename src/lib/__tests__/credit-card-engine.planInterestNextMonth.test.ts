import { describe, it, expect } from 'vitest';
import {
  getPlanInterestNextMonth, projectCard, type CardData, type CardProjection, type CardMonthRow,
} from '../credit-card-engine';

// The "at plan" half of /debt's hero. Two things are pinned here and they matter equally:
//   1. it reads NEXT month's interest off the projection the recommended-payment sim produced —
//      not this month's, which the hero already shows beside it;
//   2. when there is no plan to read (convergence never settled, no projections, a projection
//      with no next-month row) it returns NULL. A $0 reading and a failed reading must never look
//      the same on screen — DIRECTION.md rule 3, and the reason the hero drops the half entirely.

const CARD_BASE = {
  creditLimit: 10000, monthlyRepayments: 0, color: '#000',
  autopayFullBalance: false, statementBalancePhase: false, statementBalance: null,
  steadyMonthlyPurchases: 0, monthlyNewPurchases: 0, paymentPreference: null,
} as const;

function makeCard(overrides: Partial<CardData> & Pick<CardData, 'id'>): CardData {
  return {
    ...CARD_BASE, name: overrides.id, balance: 0, apr: 0,
    minPayment: 25, targetPayment: 25, dueDay: 15,
    ...overrides,
  } as CardData;
}

function row(month: number, interest: number): CardMonthRow {
  return {
    month, label: `M${month}`, startBalance: 1000, newPurchases: 0,
    interest, payment: 100, endBalance: 900, utilization: 10,
  };
}

/** A hand-built projection — only `months` is read by the selector. */
function projectionWith(months: CardMonthRow[]): CardProjection {
  return {
    card: makeCard({ id: 'H', balance: 1000, apr: 12 }),
    months, payoffMonth: null, totalInterest: 0,
    projectedInterestThisMonth: months[0]?.interest ?? 0,
    recommendedPayment: 100, utilizationNow: 10,
  };
}

describe('getPlanInterestNextMonth', () => {
  it('sums NEXT month\'s interest across the cards, not this month\'s', () => {
    const projections = [
      projectionWith([row(1, 40), row(2, 33.5), row(3, 27)]),
      projectionWith([row(1, 10), row(2, 8.25), row(3, 6)]),
    ];
    expect(getPlanInterestNextMonth(projections, true)).toBe(41.75);
    // Guard against reading the wrong column: this month's total is a different number.
    expect(getPlanInterestNextMonth(projections, true)).not.toBe(50);
  });

  it('reads a real projectCard walk — next month is lower than this month once payments land', () => {
    const projections = [projectCard(makeCard({
      id: 'R', name: 'Revolver', balance: 4000, apr: 22.99, minPayment: 100, targetPayment: 600,
    }), 12)];
    const thisMonth = projections[0].projectedInterestThisMonth;
    const atPlan = getPlanInterestNextMonth(projections, true);
    expect(atPlan).not.toBeNull();
    expect(atPlan).toBeCloseTo(projections[0].months[1].interest, 2);
    expect(atPlan!).toBeLessThan(thisMonth);
  });

  it('is ABSENT (null), never 0, when the plan has not converged', () => {
    const projections = [projectionWith([row(1, 40), row(2, 33.5)])];
    expect(getPlanInterestNextMonth(projections, false)).toBeNull();
  });

  it('is ABSENT (null), never 0, when there are no projections', () => {
    expect(getPlanInterestNextMonth([], true)).toBeNull();
  });

  it('is ABSENT (null), never 0, when a projection has no next-month row', () => {
    const projections = [
      projectionWith([row(1, 40), row(2, 33.5)]),
      projectionWith([row(1, 12)]), // stops at this month — nothing to read
    ];
    expect(getPlanInterestNextMonth(projections, true)).toBeNull();
  });

  it('is ABSENT (null) when the second row is not month 2', () => {
    expect(getPlanInterestNextMonth([projectionWith([row(1, 40), row(3, 33.5)])], true)).toBeNull();
  });

  it('is ABSENT (null) when a next-month interest figure is not a finite number', () => {
    expect(getPlanInterestNextMonth([projectionWith([row(1, 40), row(2, NaN)])], true)).toBeNull();
  });

  it('returns a true $0 when every card genuinely charges no interest next month', () => {
    // Absence is for "we could not read it". A converged plan that really costs nothing next
    // month IS zero, and must still report as a number.
    expect(getPlanInterestNextMonth([projectionWith([row(1, 0), row(2, 0)])], true)).toBe(0);
  });

  it('rounds to cents rather than leaking float dust', () => {
    const projections = [
      projectionWith([row(1, 0), row(2, 0.1)]),
      projectionWith([row(1, 0), row(2, 0.2)]),
    ];
    expect(getPlanInterestNextMonth(projections, true)).toBe(0.3);
  });
});
