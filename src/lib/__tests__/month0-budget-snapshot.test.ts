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
    fundingBalance: 2800, income: 5850, expenses: 1975, planExpenses: 0, goalContributions: 150,
    carSavedEarmark: 0, carSavedShortfall: 0,
    carReserve: 0, carLoanPayment: 0, vehicleInsurance: 0, mortgagePayment: 0,
    transfers: 0, oneTimeNet: 0,
    ...over,
  };
  return {
    ...base,
    // Mirrors the engine: every term is exact cents and cashPreDebt is their exact sum
    // (Tre, 2026-08-06 — the terms used to be rounded individually and summed rounded).
    // `carSavedShortfall` is deliberately absent: it is not cash leaving the account, it is the part
    // of the earmark the account could not cover. Folding it would double-count (finding §2.9).
    cashPreDebt: base.fundingBalance + base.income - base.expenses - base.planExpenses - base.goalContributions
      - base.carSavedEarmark
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
  carReserveHeld: 0,
  endCash: chain().cashPreDebt - 1000,
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
  // Cents, not dollars: the rows carry exact values, so the fold must balance to the cent.
  for (const cp of checkpoints) expect(cp.actual).toBeCloseTo(cp.expected, 2);
  // And the final checkpoint is the engine's canonical number, unmodified.
  expect(checkpoints[1].expected).toBeCloseTo(m0.safeToPayTotal, 2);
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
        planExpenses: 150, goalContributions: 150, carReserve: 267, carLoanPayment: 612,
        vehicleInsurance: 187, mortgagePayment: 1850, transfers: 25, oneTimeNet: -40,
      }),
      carReserveEvent: { vehicleName: 'Toyota RAV4' },
      safeToPayTotal: 400,
    }));
    for (const key of ['planExpenses', 'goals', 'carReserve', 'carLoan', 'vehicleInsurance', 'mortgage', 'transfers', 'oneTime']) {
      expect(snap.rows.find(r => r.key === key), `missing row: ${key}`).toBeDefined();
    }
    expect(snap.rows.find(r => r.key === 'oneTime')?.sign).toBe('−');
  });

  it('surfaces payment-plan installments as their own row — finding §1.1 cause B', () => {
    // The engine folds checking-sourced plan installments into `baseExpenses`, so they are part of
    // cashPreDebt whether or not the UI prints them. Before this row existed they were invisible,
    // and the snapshot read high by exactly one month's installments ($150 of the reported gap).
    const snap = expectRowsToBalance(month0({ chain: chain({ planExpenses: 150 }) }));
    const row = snap.rows.find(r => r.key === 'planExpenses');
    expect(row?.value).toBe(150);
    expect(row?.sign).toBe('−');
    expect(snap.projectedRemaining).toBe(6525 - 150);
    // And the donut counts it too, so the chart cannot disagree with the rows.
    expect(snap.pie.locked + snap.pie.deployable).toBeCloseTo(snap.projectedRemaining, 2);
  });

  // ── Finding §2.9: the car-fund earmark is a visible term, not a pre-netted balance ──────────
  //
  // `chain.fundingBalance` used to arrive ALREADY net of the earmark, so a demo holding $2,800 in
  // checking with $3,200 "saved" toward a car rendered "Balance on hand $0" and the snapshot had no
  // way to say why. Tre's decision (2026-08-08): show the gross balance and the earmark as its own
  // labeled row, and name the shortfall in a note.

  it('shows the car-fund earmark as its own row and still folds exactly', () => {
    const snap = expectRowsToBalance(month0({ chain: chain({ carSavedEarmark: 1200 }) }));
    const row = snap.rows.find(r => r.key === 'carSavedEarmark');
    expect(row?.value).toBe(1200);
    expect(row?.sign).toBe('−');
    // Gross balance is still on screen — that is the whole point of the row.
    expect(snap.rows.find(r => r.key === 'balance')?.value).toBe(2800);
    expect(snap.projectedRemaining).toBe(6525 - 1200);
  });

  it('explains the shortfall in the note when the earmark exceeds the account', () => {
    // The §2.9 demo case: $3,200 claimed, $2,800 available, $400 unaccounted for.
    const snap = expectRowsToBalance(month0({
      chain: chain({ carSavedEarmark: 2800, carSavedShortfall: 400 }),
      m0SafeFloor: 0,
      safeToPayTotal: 1000,
    }));
    const row = snap.rows.find(r => r.key === 'carSavedEarmark');
    expect(row?.value).toBe(2800);
    expect(row?.note).toContain('400');
    expect(row?.note).toMatch(/isn't in this account|not in this account/i);
  });

  it('keeps the note free of shortfall language when the account covers the earmark', () => {
    const snap = buildMonth0Snapshot(month0({ chain: chain({ carSavedEarmark: 1200 }) }));
    expect(snap.rows.find(r => r.key === 'carSavedEarmark')?.note).not.toMatch(/isn't in this account/i);
  });

  it('counts the earmark in the donut so the chart total does not grow with the gross balance', () => {
    // fundingBalance is now gross, so the earmark must land in a segment or the donut over-reports
    // by exactly the earmark.
    const withEarmark = buildMonth0Snapshot(month0({ chain: chain({ carSavedEarmark: 1200 }) }));
    const without = buildMonth0Snapshot(month0());
    const total = (s: typeof withEarmark) =>
      s.pie.billsAndReserves + s.pie.locked + s.pie.deployable;
    expect(total(withEarmark)).toBeCloseTo(total(without), 2);
    expect(withEarmark.pie.locked + withEarmark.pie.deployable).toBeCloseTo(withEarmark.projectedRemaining, 2);
  });

  it('omits the earmark row entirely when there is no car fund earmarking anything', () => {
    expect(buildMonth0Snapshot(month0()).rows.find(r => r.key === 'carSavedEarmark')).toBeUndefined();
  });

  it('still surfaces the shortfall when the account is empty and nothing could be applied', () => {
    // applied = 0 means there is no cash term to print, but the user is exactly the one who needs
    // the explanation — a zero-value row would be unrenderable, so the note rides the balance row.
    const snap = expectRowsToBalance(month0({ chain: chain({ carSavedEarmark: 0, carSavedShortfall: 3200 }) }));
    expect(snap.rows.find(r => r.key === 'carSavedEarmark')).toBeUndefined();
    expect(snap.rows.find(r => r.key === 'balance')?.note).toContain('3,200');
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

  it('carries cents through the equation instead of rounding each term — 2026-08-06', () => {
    // THE POINT: with per-term rounding, these terms summed to a `cashPreDebt` up to a dollar off
    // the engine's own figure, which is why Dashboard MONTH-END CASH and Forecast END CASH could
    // print $1 apart. Exact cents in, exact cents out, and the column still folds to its total.
    const snap = expectRowsToBalance(month0({
      chain: chain({ fundingBalance: 2800.37, income: 5850.49, expenses: 1975.66, goalContributions: 150.25 }),
      safeToPayTotal: 1000.5,
      m0SafeFloor: 2402.75,
    }));
    expect(snap.projectedRemaining).toBeCloseTo(2800.37 + 5850.49 - 1975.66 - 150.25, 2);
    expect(snap.rows.find(r => r.key === 'expenses')?.value).toBeCloseTo(1975.66, 2);
    expect(snap.availableToDeploy).toBe(1000.5);
  });

  it('keeps a sub-dollar term as a row — it is renderable at two decimals', () => {
    // Under the old integer rows anything rounding to $0 vanished from the equation, silently
    // shifting cents into the residual. Only a term below half a cent is unrenderable.
    const shown = buildMonth0Snapshot(month0({ chain: chain({ transfers: 0.4 }) }));
    expect(shown.rows.find(r => r.key === 'transfers')?.value).toBeCloseTo(0.4, 2);
    const hidden = buildMonth0Snapshot(month0({ chain: chain({ transfers: 0.001 }) }));
    expect(hidden.rows.find(r => r.key === 'transfers')).toBeUndefined();
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
    expect(snap.pie.locked + snap.pie.deployable).toBeCloseTo(snap.projectedRemaining, 2);
    expect(snap.pie.shortfall).toBe(0);
  });
});
