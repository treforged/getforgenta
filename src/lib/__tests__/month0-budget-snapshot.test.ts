// Findings §2.6 / §2.3 regression guard.
//
// The bug: Dashboard's snapshot printed the engine's `safeToPayTotal` as the "=" of a chain of
// rows it had derived independently, so the rows did not sum to their own total ($6,488 shown,
// $3,856 actual). The structural fix is that every row now comes from `month0.chain` and the
// leftover is rendered as a computed row.
//
// THE POINT OF THIS FILE: assert the rows fold to their own checkpoints, on every shape of month
// the engine can produce. If someone adds a term to the engine's cashPreDebt and forgets to
// surface it, or hand-patches a missing line item the way the old code did, these fail.

import { describe, it, expect } from 'vitest';
import { buildMonth0Snapshot, foldSnapshotRows } from '../month0-budget-snapshot';
import type { Month0Result, Month0CashChain } from '../debt-model-types';

const chain = (over: Partial<Month0CashChain> = {}): Month0CashChain => {
  const base = {
    fundingBalance: 2800, income: 5850, expenses: 1975, goalContributions: 150,
    carReserve: 0, carLoanPayment: 0, vehicleInsurance: 0, mortgagePayment: 0,
    transfers: 0, oneTimeNet: 0,
    ...over,
  };
  return {
    ...base,
    // Mirrors the engine: cashPreDebt is the sum of the rounded terms.
    cashPreDebt: base.fundingBalance + base.income - base.expenses - base.goalContributions
      - base.carReserve - base.carLoanPayment - base.vehicleInsurance - base.mortgagePayment
      - base.transfers + base.oneTimeNet,
  };
};

const month0 = (over: Partial<Month0Result> = {}): Month0Result => ({
  safeToPayTotal: 1000,
  maxCapacity: 1000,
  holdback: 0,
  holdbackEvent: null,
  cyclingPayment: 0,
  revolvingPayment: 1000,
  perCardAdjusted: [],
  m0SafeFloor: 2402,
  carReserve: 0,
  carReserveEvent: null,
  vehicleInsurance: 0,
  mortgagePayment: 0,
  chain: chain(),
  ...over,
});

/** The whole contract in one helper: every '=' row must equal the fold of the rows above it. */
const expectRowsToBalance = (m0: Month0Result) => {
  const snap = buildMonth0Snapshot(m0);
  const { checkpoints } = foldSnapshotRows(snap.rows);
  expect(checkpoints.length).toBe(2);
  for (const cp of checkpoints) expect(cp.actual).toBe(cp.expected);
  // And the final checkpoint is the engine's canonical number, unmodified.
  expect(checkpoints[1].expected).toBe(Math.round(m0.safeToPayTotal));
  return snap;
};

describe('buildMonth0Snapshot', () => {
  it('rows fold exactly to Projected remaining and to Available to deploy', () => {
    const snap = expectRowsToBalance(month0());
    expect(snap.projectedRemaining).toBe(6525);
    expect(snap.availableToDeploy).toBe(1000);
    expect(snap.residual).toBe(6525 - 2402 - 1000);
  });

  it('reproduces the reported §2.6 gap as a visible row instead of a silent one', () => {
    // The demo numbers from the finding: the old UI showed no row for the $3,123 it was holding.
    const snap = expectRowsToBalance(month0());
    const held = snap.rows.filter(r => r.key === 'surplus' || r.key === 'heldForEvent');
    expect(held.reduce((s, r) => s + r.value, 0)).toBe(snap.residual);
    expect(held.length).toBeGreaterThan(0);
  });

  it('labels the save-up holdback with the engine event and keeps the split exact', () => {
    const snap = expectRowsToBalance(month0({
      holdback: 800,
      holdbackEvent: { eventName: 'Car Down Payment', monthLabel: 'Dec 2026' },
    }));
    const event = snap.rows.find(r => r.key === 'heldForEvent');
    expect(event?.label).toBe('Held for Car Down Payment');
    expect(event?.value).toBe(800);
    expect(snap.rows.find(r => r.key === 'surplus')?.value).toBe(snap.residual - 800);
  });

  it('caps the holdback row at the residual when the engine holdback exceeds it', () => {
    // safeToPayTotal consumes nearly everything, so the residual is smaller than `holdback`.
    const snap = expectRowsToBalance(month0({
      safeToPayTotal: 4000,
      holdback: 900,
      holdbackEvent: { eventName: 'Vacation', monthLabel: 'Mar 2027' },
    }));
    expect(snap.residual).toBe(6525 - 2402 - 4000);
    expect(snap.rows.find(r => r.key === 'heldForEvent')?.value).toBe(snap.residual);
    expect(snap.rows.find(r => r.key === 'surplus')).toBeUndefined();
  });

  it('shows a below-floor row when card minimums are paid through the floor', () => {
    // Q9/Q11 territory: minimums are mandatory, so safeToPayTotal can exceed what the floor allows.
    const snap = expectRowsToBalance(month0({ safeToPayTotal: 4500 }));
    expect(snap.residual).toBeLessThan(0);
    const breach = snap.rows.find(r => r.key === 'belowFloor');
    expect(breach?.sign).toBe('+');
    expect(breach?.value).toBe(-snap.residual);
    expect(snap.rows.find(r => r.key === 'surplus')).toBeUndefined();
  });

  it('balances with no residual at all when the floor binds exactly', () => {
    const snap = expectRowsToBalance(month0({ safeToPayTotal: 6525 - 2402 }));
    expect(snap.residual).toBe(0);
    expect(snap.rows.some(r => ['surplus', 'heldForEvent', 'belowFloor'].includes(r.key))).toBe(false);
  });

  it('balances with every reserve term present — the case the old hand-patched row missed', () => {
    const snap = expectRowsToBalance(month0({
      chain: chain({
        goalContributions: 150, carReserve: 267, carLoanPayment: 612,
        vehicleInsurance: 187, mortgagePayment: 1850, transfers: 25, oneTimeNet: -40,
      }),
      carReserveEvent: { vehicleName: 'Toyota RAV4' },
      safeToPayTotal: 400,
    }));
    for (const key of ['goals', 'carReserve', 'carLoan', 'vehicleInsurance', 'mortgage', 'transfers', 'oneTime']) {
      expect(snap.rows.find(r => r.key === key), `missing row: ${key}`).toBeDefined();
    }
    expect(snap.rows.find(r => r.key === 'oneTime')?.sign).toBe('−');
  });

  it('renders a negative Projected remaining as a signed checkpoint, not an absolute value', () => {
    const snap = expectRowsToBalance(month0({
      chain: chain({ fundingBalance: 100, income: 200, expenses: 900, goalContributions: 0 }),
      m0SafeFloor: 0,
      safeToPayTotal: -600,
    }));
    expect(snap.projectedRemaining).toBe(-600);
    expect(snap.rows.find(r => r.key === 'projectedRemaining')?.value).toBe(-600);
  });

  it('omits zero terms so the chain stays readable', () => {
    const snap = buildMonth0Snapshot(month0());
    expect(snap.rows.find(r => r.key === 'mortgage')).toBeUndefined();
    expect(snap.rows.find(r => r.key === 'transfers')).toBeUndefined();
  });

  it('keeps spentSoFar out of the equation — it only feeds the donut', () => {
    const withSpend = buildMonth0Snapshot(month0(), 3200);
    const without = buildMonth0Snapshot(month0(), 0);
    expect(withSpend.rows).toEqual(without.rows);
    expect(withSpend.pie.spentSoFar).toBe(3200);
  });

  it('derives donut segments from the same terms as the rows', () => {
    const snap = buildMonth0Snapshot(month0({
      holdback: 800,
      holdbackEvent: { eventName: 'Car Down Payment', monthLabel: 'Dec 2026' },
    }), 1500);
    // locked + deployable is exactly what is left after bills and reserves.
    expect(snap.pie.locked + snap.pie.deployable).toBe(snap.projectedRemaining);
    expect(snap.pie.shortfall).toBe(0);
  });
});
