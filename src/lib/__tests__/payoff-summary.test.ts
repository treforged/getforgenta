// Slice 2 — the Dashboard hero's selectors.
//
// Two properties are load-bearing and are asserted rather than assumed:
//   1. The payoff resolution order matches CreditCardEngine.tsx's Payoff ETA cell exactly
//      (sim → forecast → per-card). If it drifts, /debt and the Dashboard print different
//      dates for the same plan, which is the whole reason this selector is shared.
//   2. No branch can produce a confident zero. Every path without a real reading returns
//      `empty` with a reason (DIRECTION.md rule 3).
import { describe, it, expect } from 'vitest';
import {
  selectRevolvingPayoff,
  selectDashboardHero,
  type RevolvingPayoffInput,
} from '@/lib/payoff-summary';

const ASOF = new Date(2026, 7, 14); // 2026-08-14

const baseInput: RevolvingPayoffInput = {
  simRevolvingPayoffMonth: null,
  forecastRevolvingPayoffMonth: null,
};

describe('selectRevolvingPayoff — resolution order', () => {
  it('prefers the sim payoff month over every other reading', () => {
    const got = selectRevolvingPayoff({
      ...baseInput,
      simRevolvingPayoffMonth: 24,
      forecastRevolvingPayoffMonth: 30,
      forecastAdjustedRevolvingBalances: new Map([['a', [100, 0]]]),
      cardIds: ['a'],
      months: 2,
    }, ASOF);
    expect(got?.source).toBe('sim');
    expect(got?.month).toBe(24);
  });

  it('falls back to the forecast payoff month when the sim has none', () => {
    const got = selectRevolvingPayoff({
      ...baseInput,
      forecastRevolvingPayoffMonth: 30,
      forecastAdjustedRevolvingBalances: new Map([['a', [100, 0]]]),
      cardIds: ['a'],
      months: 2,
    }, ASOF);
    expect(got?.source).toBe('forecast');
    expect(got?.month).toBe(30);
  });

  it('falls back to the per-card trajectory when neither aggregate resolved', () => {
    const got = selectRevolvingPayoff({
      ...baseInput,
      forecastAdjustedRevolvingBalances: new Map([['a', [500, 250, 0]], ['b', [100, 0, 0]]]),
      cardIds: ['a', 'b'],
      months: 3,
    }, ASOF);
    expect(got?.source).toBe('perCard');
    expect(got?.month).toBe(3);
  });

  it('ignores non-positive month readings the way the Payoff ETA cell does', () => {
    const got = selectRevolvingPayoff({
      ...baseInput,
      simRevolvingPayoffMonth: 0,
      forecastRevolvingPayoffMonth: -1,
      forecastAdjustedRevolvingBalances: new Map([['a', [500, 0]]]),
      cardIds: ['a'],
      months: 2,
    }, ASOF);
    expect(got?.source).toBe('perCard');
    expect(got?.month).toBe(2);
  });
});

describe('selectRevolvingPayoff — calendar mapping', () => {
  it('maps month 1 to the current month and zero months away', () => {
    const got = selectRevolvingPayoff({ ...baseInput, simRevolvingPayoffMonth: 1 }, ASOF);
    expect(got?.monthsAway).toBe(0);
    expect(got?.date.getFullYear()).toBe(2026);
    expect(got?.date.getMonth()).toBe(7); // Aug
    expect(got?.date.getDate()).toBe(1);
  });

  it('rolls across a year boundary — 24 months out from Aug 2026 is Jul 2028', () => {
    const got = selectRevolvingPayoff({ ...baseInput, simRevolvingPayoffMonth: 24 }, ASOF);
    expect(got?.monthsAway).toBe(23);
    expect(got?.date.getFullYear()).toBe(2028);
    expect(got?.date.getMonth()).toBe(6); // Jul
  });

  it('lands on the same month CreditCardEngine prints for the same eta', () => {
    // CreditCardEngine.tsx:1383-1385 — new Date(), setDate(1), setMonth(+eta-1).
    const eta = 17;
    const engineDate = new Date(ASOF);
    engineDate.setDate(1);
    engineDate.setMonth(engineDate.getMonth() + eta - 1);
    const got = selectRevolvingPayoff({ ...baseInput, simRevolvingPayoffMonth: eta }, ASOF);
    expect(got?.date.getFullYear()).toBe(engineDate.getFullYear());
    expect(got?.date.getMonth()).toBe(engineDate.getMonth());
  });
});

describe('selectRevolvingPayoff — no reading', () => {
  it('returns null when nothing resolves rather than a month 0', () => {
    expect(selectRevolvingPayoff(baseInput, ASOF)).toBeNull();
  });

  it('returns null when the trajectory never clears inside the horizon', () => {
    const got = selectRevolvingPayoff({
      ...baseInput,
      forecastAdjustedRevolvingBalances: new Map([['a', [500, 480, 460]]]),
      cardIds: ['a'],
      months: 3,
    }, ASOF);
    expect(got).toBeNull();
  });

  it('returns null when the balances map is present but no card ids were given', () => {
    const got = selectRevolvingPayoff({
      ...baseInput,
      forecastAdjustedRevolvingBalances: new Map([['a', [500, 0]]]),
      cardIds: [],
      months: 2,
    }, ASOF);
    expect(got).toBeNull();
  });
});

describe('selectDashboardHero', () => {
  const payoff = selectRevolvingPayoff({ ...baseInput, simRevolvingPayoffMonth: 24 }, ASOF)!;

  it('leads with the payoff date when there is debt and a date', () => {
    const state = selectDashboardHero({
      hasAccounts: true, revolvingDebt: 6800, payoff, cashAboveFloor: 412, projectionReady: true,
    });
    expect(state).toEqual({ kind: 'payoff', payoff, cashAboveFloor: 412, hasOtherDebt: false });
  });

  it('still leads with the payoff date when the floor reading is missing', () => {
    const state = selectDashboardHero({
      hasAccounts: true, revolvingDebt: 6800, payoff, cashAboveFloor: null, projectionReady: true,
    });
    expect(state).toEqual({ kind: 'payoff', payoff, cashAboveFloor: null, hasOtherDebt: false });
  });

  it('leads with cash above floor when there is no card debt', () => {
    const state = selectDashboardHero({
      hasAccounts: true, revolvingDebt: 0, payoff: null, cashAboveFloor: 1240, projectionReady: true,
    });
    expect(state).toEqual({ kind: 'cash', cashAboveFloor: 1240, carriesCardBalance: false, hasOtherDebt: false });
  });

  it('keeps a NEGATIVE cash-above-floor as the hero — bad news is not suppressed', () => {
    const state = selectDashboardHero({
      hasAccounts: true, revolvingDebt: 0, payoff: null, cashAboveFloor: -310, projectionReady: true,
    });
    expect(state).toEqual({ kind: 'cash', cashAboveFloor: -310, carriesCardBalance: false, hasOtherDebt: false });
  });

  it('does NOT call a pay-in-full user debt free — a cleared card still carries a balance', () => {
    const state = selectDashboardHero({
      hasAccounts: true, revolvingDebt: 0, cardBalance: 940, payoff: null,
      cashAboveFloor: 1240, projectionReady: true,
    });
    expect(state).toEqual({ kind: 'cash', cashAboveFloor: 1240, carriesCardBalance: true, hasOtherDebt: false });
  });

  it('flags other debt on the payoff hero — the date is a CARD date, not a debt-free date', () => {
    const state = selectDashboardHero({
      hasAccounts: true, revolvingDebt: 6800, otherDebt: 24_310, payoff,
      cashAboveFloor: 412, projectionReady: true,
    });
    expect(state).toEqual({ kind: 'payoff', payoff, cashAboveFloor: 412, hasOtherDebt: true });
  });

  it('does NOT call a user with a car loan debt free just because the cards are clear', () => {
    const state = selectDashboardHero({
      hasAccounts: true, revolvingDebt: 0, otherDebt: 24_310, payoff: null,
      cashAboveFloor: 1240, projectionReady: true,
    });
    expect(state).toEqual({ kind: 'cash', cashAboveFloor: 1240, carriesCardBalance: false, hasOtherDebt: true });
  });

  it('treats a settled loan as no loan — a $0 balance is not a claim to soften', () => {
    const state = selectDashboardHero({
      hasAccounts: true, revolvingDebt: 0, otherDebt: 0, payoff: null,
      cashAboveFloor: 1240, projectionReady: true,
    });
    expect(state).toEqual({ kind: 'cash', cashAboveFloor: 1240, carriesCardBalance: false, hasOtherDebt: false });
  });

  it('other debt NARROWS the claim and never changes which hero is shown', () => {
    // Same inputs but for otherDebt: the empty reason must be identical, because a loan is
    // not a reading the card hero could have led with.
    const withLoan = selectDashboardHero({
      hasAccounts: true, revolvingDebt: 6800, otherDebt: 24_310, payoff: null,
      cashAboveFloor: 100, projectionReady: false,
    });
    const without = selectDashboardHero({
      hasAccounts: true, revolvingDebt: 6800, otherDebt: 0, payoff: null,
      cashAboveFloor: 100, projectionReady: false,
    });
    expect(withLoan).toEqual(without);
    expect(withLoan).toEqual({ kind: 'empty', reason: 'projecting' });
  });

  it('is empty, not $0, when there are no accounts', () => {
    const state = selectDashboardHero({
      hasAccounts: false, revolvingDebt: 0, payoff: null, cashAboveFloor: 900, projectionReady: true,
    });
    expect(state).toEqual({ kind: 'empty', reason: 'no-accounts' });
  });

  it('is empty, not $0, when there is no debt and no floor reading', () => {
    const state = selectDashboardHero({
      hasAccounts: true, revolvingDebt: 0, payoff: null, cashAboveFloor: null, projectionReady: true,
    });
    expect(state).toEqual({ kind: 'empty', reason: 'no-reading' });
  });

  it('says it is still projecting when debt exists but the engine has not answered', () => {
    const state = selectDashboardHero({
      hasAccounts: true, revolvingDebt: 6800, payoff: null, cashAboveFloor: 100, projectionReady: false,
    });
    expect(state).toEqual({ kind: 'empty', reason: 'projecting' });
  });

  it('says the plan does not clear when a converged plan produced no payoff month', () => {
    const state = selectDashboardHero({
      hasAccounts: true, revolvingDebt: 6800, payoff: null, cashAboveFloor: 100, projectionReady: true,
    });
    expect(state).toEqual({ kind: 'empty', reason: 'no-payoff-in-range' });
  });
});
