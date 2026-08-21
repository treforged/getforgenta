import { describe, it, expect } from 'vitest';
import {
  assessReachability, assessSurplusCollision, monthIndexOf,
} from '../surplus-reachability';

const ASOF = '2026-08-21';

describe('monthIndexOf', () => {
  it('counts whole calendar months, 0 being the current month', () => {
    expect(monthIndexOf(ASOF, '2026-08-01')).toBe(0);
    expect(monthIndexOf(ASOF, '2026-08-31')).toBe(0);
    expect(monthIndexOf(ASOF, '2026-09-01')).toBe(1);
    expect(monthIndexOf(ASOF, '2027-07-01')).toBe(11);
    expect(monthIndexOf(ASOF, '2026-06-01')).toBe(-2);
  });
});

describe('assessReachability', () => {
  it('says NOTHING when no schedule was measured, rather than printing a zero', () => {
    const r = assessReachability({ id: 'g', remaining: 10_340, targetDate: '2027-07-01' }, ASOF);
    expect(r.verdict).toBe('unknown');
    expect(r.shortfall).toBe(0);
  });

  it('distinguishes "no schedule" from "a schedule that funds nothing"', () => {
    const measured = assessReachability(
      { id: 'g', remaining: 10_340, targetDate: '2027-07-01', monthly: new Array(24).fill(0) }, ASOF,
    );
    expect(measured.verdict).toBe('never');
    expect(measured.shortfall).toBe(10_340);
  });

  it('is the Move fund, exactly as it stands live: $10,340 by Jul 2027 with $0/mo', () => {
    const r = assessReachability(
      { id: 'move', remaining: 10_340, targetDate: '2027-07-01', monthly: new Array(60).fill(0) }, ASOF,
    );
    expect(r.verdict).toBe('never');
    expect(r.targetMonthIndex).toBe(11);
    expect(r.fundedByTargetDate).toBe(0);
    expect(r.shortfall).toBe(10_340);
    expect(r.monthsToFund).toBeNull();
  });

  it('calls a target funded on time on track, and reports when it lands', () => {
    const r = assessReachability(
      { id: 'g', remaining: 1_200, targetDate: '2027-07-01', monthly: new Array(24).fill(200) }, ASOF,
    );
    expect(r.verdict).toBe('on_track');
    expect(r.monthsToFund).toBe(5);
    expect(r.shortfall).toBe(0);
  });

  it('calls a target that gets there but misses the date LATE, with the months', () => {
    const r = assessReachability(
      { id: 'g', remaining: 10_340, targetDate: '2027-07-01', monthly: new Array(60).fill(500) }, ASOF,
    );
    expect(r.verdict).toBe('late');
    expect(r.monthsToFund).toBe(20);
    expect(r.monthsLate).toBe(9);
    expect(r.shortfall).toBe(10_340 - 12 * 500);
  });

  it('measures the real curve, not a flat average — funding that grows as cards retire', () => {
    // $0 for the first six months, then $1,000. A flat average of the same total would say the
    // target lands months earlier than it does.
    const monthly = [...new Array(6).fill(0), ...new Array(18).fill(1_000)];
    const r = assessReachability({ id: 'g', remaining: 3_000, targetDate: '2027-01-01', monthly }, ASOF);
    expect(r.monthsToFund).toBe(8);
    expect(r.verdict).toBe('late');
  });

  it('needs no date to answer "when"', () => {
    const r = assessReachability(
      { id: 'g', remaining: 600, targetDate: null, monthly: new Array(12).fill(200) }, ASOF,
    );
    expect(r.verdict).toBe('undated');
    expect(r.monthsToFund).toBe(2);
  });

  it('a target with nothing left needs no schedule to be called funded', () => {
    expect(assessReachability({ id: 'g', remaining: 0, targetDate: '2027-01-01' }, ASOF).verdict)
      .toBe('funded');
  });

  it('measures a target date already in the past at month 0 rather than going negative', () => {
    const r = assessReachability(
      { id: 'g', remaining: 500, targetDate: '2026-01-01', monthly: new Array(12).fill(100) }, ASOF,
    );
    expect(r.targetMonthIndex).toBe(0);
    expect(r.fundedByTargetDate).toBe(100);
    expect(r.shortfall).toBe(400);
    expect(r.verdict).toBe('late');
  });
});

describe('assessSurplusCollision', () => {
  it('prices demand against supply, and names the shortfall', () => {
    // Aug 2026 - Aug 2027 is THIRTEEN months inclusive, holding the $16,232 of net capacity
    // measured live in session 4, against a $10,340 move fund and $18,819 of card balances, both
    // dated inside the window.
    const capacity = new Array(13).fill(16_232 / 13);
    const c = assessSurplusCollision([
      { id: 'move', remaining: 10_340, targetDate: '2027-07-01', monthly: new Array(13).fill(0) },
      { id: 'cards', remaining: 18_819, targetDate: '2027-08-01', monthly: new Array(13).fill(0) },
    ], capacity, ASOF);
    expect(c.capacity).toBeCloseTo(16_232, 0);
    expect(c.demand).toBeCloseTo(29_159, 0);
    expect(c.shortfall).toBeCloseTo(12_927, 0);
    expect(c.unreachable.map(u => u.id)).toEqual(['cards', 'move']);
  });

  it('does not manufacture a shortfall out of an undated aspiration', () => {
    const c = assessSurplusCollision(
      [{ id: 'someday', remaining: 1_000_000, targetDate: null, monthly: new Array(12).fill(0) }],
      new Array(12).fill(100), ASOF,
    );
    expect(c.demand).toBe(0);
    expect(c.shortfall).toBe(0);
  });

  it('ignores demand that falls outside the horizon it was asked about', () => {
    const c = assessSurplusCollision(
      [{ id: 'far', remaining: 5_000, targetDate: '2030-01-01', monthly: new Array(12).fill(0) }],
      new Array(12).fill(100), ASOF, 12,
    );
    expect(c.demand).toBe(0);
    expect(c.shortfall).toBe(0);
  });

  it('never measures more months than it was actually given', () => {
    const c = assessSurplusCollision([], new Array(6).fill(100), ASOF, 60);
    expect(c.horizonMonths).toBe(6);
    expect(c.capacity).toBe(600);
  });

  it('reports no shortfall when the money goes round', () => {
    const c = assessSurplusCollision(
      [{ id: 'g', remaining: 1_200, targetDate: '2027-01-01', monthly: new Array(12).fill(200) }],
      new Array(12).fill(1_000), ASOF,
    );
    expect(c.shortfall).toBe(0);
    expect(c.unreachable).toEqual([]);
  });
});
