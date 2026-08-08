// Dashboard's "Monthly Budget Snapshot" equation — findings §2.6 and §2.3.
//
// The defect this file exists to make impossible: the snapshot printed
// `cardProjection.month0.safeToPayTotal` (an ENGINE output) as the "=" of a chain of rows the
// Dashboard had assembled from its own page-local transaction sums and its own cash-floor call.
// Two independent derivations rendered as one equation, so the rows did not sum to their own
// total and the floor row showed a floor the engine never applied.
//
// Tre's decision (2026-08-05): accuracy wins — the ENGINE total stays canonical and the ROWS get
// derived from it. So every row below comes from `month0.chain`, the exact terms the engine
// consumed, and whatever is left over is COMPUTED and rendered as a labeled row. It is never
// fudged, never absorbed into another line, and never closed by hand-patching a missing item
// (which is what `Dashboard.tsx`'s one-off "Vehicle Insurance (est.)" row used to do).
//
// Tre's decision (2026-08-06): every value here is EXACT CENTS, and the renderer prints two
// decimals. The chain it reads used to be rounded per-term so this column added up in integer
// arithmetic; that cost up to $1 against the engine's own cash figure and made MONTH-END CASH
// disagree with Forecast END CASH. Cents keep both properties — the column adds up AND it equals
// what the engine computed. Do not reintroduce rounding below; round in the renderer if ever.
//
// The invariant — rows fold to their own subtotals — is asserted in
// `__tests__/month0-budget-snapshot.test.ts`. That test is what stops this drifting back.

import type { Month0Result } from './debt-model-types';
import { formatCurrency as money } from './calculations';

/** ' ' opens the chain, '+'/'−' are terms, '=' is a checkpoint the running fold must equal. */
export type SnapshotRowSign = ' ' | '+' | '−' | '=';

export type SnapshotRowTone = 'neutral' | 'positive' | 'negative' | 'muted' | 'subtotal';

export interface SnapshotRow {
  key: string;
  label: string;
  /** Non-negative on '+'/'−'/' ' rows — `sign` carries the direction there. SIGNED on '='
   *  checkpoint rows, which can legitimately be negative (a projected shortfall). Renderers take
   *  the absolute value; colour comes from `tone`. */
  value: number;
  sign: SnapshotRowSign;
  tone: SnapshotRowTone;
  /** Rendered under the row as explanatory copy. */
  note?: string;
  /** Set on the cash-floor row so the UI can wire the floor-calculator popover. */
  interactive?: boolean;
}

export interface Month0Snapshot {
  rows: SnapshotRow[];
  /** Cash on hand before any revolving-debt payment — the first '=' checkpoint. */
  projectedRemaining: number;
  /** The engine's canonical answer. The final '=' checkpoint. */
  availableToDeploy: number;
  /** projectedRemaining − cashFloor − availableToDeploy. Positive = held back, negative = card
   *  minimums are being paid through the floor. Zero when the floor is exactly binding. */
  residual: number;
  cashFloor: number;
  /** Donut segments, derived from the same terms so the chart cannot disagree with the rows. */
  pie: { spentSoFar: number; billsAndReserves: number; locked: number; deployable: number; shortfall: number };
}

/** Fold a row list the way the UI reads it, so callers (and the test) can verify the equation. */
export function foldSnapshotRows(rows: readonly SnapshotRow[]): { running: number; checkpoints: { key: string; expected: number; actual: number }[] } {
  let running = 0;
  const checkpoints: { key: string; expected: number; actual: number }[] = [];
  for (const row of rows) {
    if (row.sign === '=') {
      checkpoints.push({ key: row.key, expected: row.value, actual: running });
      continue;
    }
    running += row.sign === '−' ? -row.value : row.value;
  }
  return { running, checkpoints };
}

/** Below half a cent a term cannot be rendered at all, so it is not a row. */
const CENT = 0.005;

function term(
  key: string, label: string, value: number, sign: '+' | '−', tone: SnapshotRowTone, note?: string,
): SnapshotRow | null {
  if (Math.abs(value) < CENT) return null;
  // A negative term flips direction rather than printing a negative number behind a '−'.
  const flipped: '+' | '−' = value < 0 ? (sign === '−' ? '+' : '−') : sign;
  return { key, label, value: Math.abs(value), sign: flipped, tone, ...(note ? { note } : {}) };
}

/**
 * Build the snapshot equation from the engine's own month-0 cash chain.
 *
 * `spentSoFar` is the only page-local input: month-to-date actual outflow, which the engine has
 * no equivalent for (it models what is still to come). It feeds the donut only — never the rows —
 * so it cannot unbalance the equation.
 */
export function buildMonth0Snapshot(month0: Month0Result, spentSoFar = 0): Month0Snapshot {
  const c = month0.chain;
  // Every value below is EXACT CENTS. The chain carries cents (Tre, 2026-08-06) and the renderer
  // prints two decimals, so nothing is rounded here — rounding a row would put the equation back
  // in the position of not adding up to its own total. `m0SafeFloor` / `safeToPayTotal` arrive
  // already whole from the engine; they are passed through, not re-rounded.
  const cashFloor = month0.m0SafeFloor;
  const availableToDeploy = month0.safeToPayTotal;
  const projectedRemaining = c.cashPreDebt;
  const residual = projectedRemaining - cashFloor - availableToDeploy;

  // Split the residual by what the engine actually held back. `holdback` is the save-up reserve;
  // anything past it is cash no revolving balance can absorb. Both parts are derived from the
  // residual itself, so their sum is exact no matter how the engine arrived at either number.
  const heldForEvent = residual > 0 ? Math.min(residual, month0.holdback) : 0;
  const surplus = residual > 0 ? residual - heldForEvent : 0;
  const belowFloor = residual < 0 ? -residual : 0;
  const event = month0.holdbackEvent;

  // Finding §2.9. `fundingBalance` is now GROSS and the car-fund earmark is its own term, so the
  // chain can say why the balance dropped instead of arriving pre-netted and unexplainable.
  // `carSavedShortfall` is saved cash the linked account does not hold — not a cash term (folding it
  // would double-count against money that was never there), so it rides as copy. When some of the
  // earmark applied it explains that row; when NONE could apply there is no row to hang it on, so
  // it falls back to the balance row, which is exactly the user seeing an unexplained figure.
  const shortfallNote = c.carSavedShortfall >= CENT
    ? `${money(c.carSavedShortfall)} of your saved down payment isn't in this account — link the car fund to the account actually holding it.`
    : undefined;

  const rows: SnapshotRow[] = [
    {
      key: 'balance', label: 'Balance on hand', value: c.fundingBalance, sign: ' ', tone: 'neutral',
      ...(shortfallNote && c.carSavedEarmark < CENT ? { note: shortfallNote } : {}),
    },
    term('income', 'Income still coming', c.income, '+', 'positive'),
    term('expenses', 'Bills still coming', c.expenses, '−', 'negative'),
    // Finding §1.1 cause B: the engine folds checking-sourced payment-plan installments into
    // `baseExpenses`, so they must appear as their own row here — otherwise they are an invisible
    // part of the fold and the rows read high by exactly one month's installments.
    term('planExpenses', 'Payment plans (from checking)', c.planExpenses, '−', 'negative'),
    term('goals', 'Savings goals', c.goalContributions, '−', 'muted'),
    term('carSavedEarmark', 'Already saved toward a car', c.carSavedEarmark, '−', 'muted',
      shortfallNote
        ?? 'Down-payment cash already sitting in this account — still yours, just already spoken for'),
    term('carReserve', 'Car down payment', c.carReserve, '−', 'muted',
      month0.carReserveEvent ? `Reserved for ${month0.carReserveEvent.vehicleName} — still your cash, just not deployable this month` : undefined),
    term('carLoan', 'Auto loan payment', c.carLoanPayment, '−', 'muted'),
    term('vehicleInsurance', 'Vehicle insurance (est.)', c.vehicleInsurance, '−', 'muted'),
    term('mortgage', 'Mortgage payment', c.mortgagePayment, '−', 'muted'),
    term('transfers', 'Transfers & lump sums', c.transfers, '−', 'muted'),
    term('oneTime', 'One-time transactions', c.oneTimeNet, '+', c.oneTimeNet >= 0 ? 'positive' : 'negative'),
    {
      key: 'projectedRemaining', label: 'Projected remaining', value: projectedRemaining,
      sign: '=', tone: 'subtotal',
      ...(projectedRemaining < 0 ? { note: 'Projected to end the month short' } : {}),
    },
    { key: 'cashFloor', label: 'Cash floor', value: cashFloor, sign: '−', tone: 'muted', interactive: true },
    term('heldForEvent', event ? `Held for ${event.eventName}` : 'Held back this month', heldForEvent, '−', 'muted',
      event ? `Saving ahead for ${event.monthLabel}` : undefined),
    term('surplus', 'Kept as surplus', surplus, '−', 'muted', 'More cash than the remaining card balances can absorb'),
    term('belowFloor', 'Card minimums above floor', belowFloor, '+', 'negative',
      'Minimum payments due this month exceed what the floor leaves — the floor is being dipped into'),
    { key: 'availableToDeploy', label: 'Available to deploy', value: availableToDeploy, sign: '=', tone: availableToDeploy >= 0 ? 'positive' : 'negative' },
  ].filter((r): r is SnapshotRow => r !== null);

  return {
    rows,
    projectedRemaining,
    availableToDeploy,
    residual,
    cashFloor,
    pie: {
      spentSoFar: Math.max(0, spentSoFar),
      // §2.9: `fundingBalance` is gross now, so the earmark must land in a segment or the donut
      // over-reports the whole pie by exactly the earmark.
      billsAndReserves: Math.max(0, c.expenses + c.planExpenses + c.goalContributions + c.carSavedEarmark
        + c.carReserve + c.carLoanPayment + c.vehicleInsurance + c.mortgagePayment + c.transfers),
      locked: Math.max(0, cashFloor + heldForEvent + surplus),
      deployable: Math.max(0, availableToDeploy),
      shortfall: projectedRemaining < 0 ? -projectedRemaining : 0,
    },
  };
}
