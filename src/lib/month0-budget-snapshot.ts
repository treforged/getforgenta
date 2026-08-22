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
import { FLOOR_CUSHION_DOLLARS } from './floor-protection';

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
   *  minimums are being paid through the floor.
   *
   *  NOT AN INVARIANT IN EITHER DIRECTION — do not let a caller assume a sign or a magnitude. An
   *  earlier draft of this comment said "NOT zero when the floor binds", which the file's own
   *  `balances with no residual at all when the floor binds exactly` test contradicts on its face
   *  and the arithmetic below does not guarantee.
   *
   *  What is true: since 1eebd1f3 (2026-08-21) gave month 0 the same FLOOR_CUSHION_DOLLARS as
   *  every other month, a month whose payment is capped by CASH settles at the cushion plus BOTH
   *  whole-dollar roundings — the one on the floor this row subtracts (`m0SafeFloor` is rounded,
   *  the drain aimed at the unrounded figure) and the one on the per-card recommendation. On the
   *  real fixture that is $2.00 + $0.12 + $0.08 = $2.20. But each rounding is signed and can run
   *  the other way, so a cash-capped month can also land AT zero or a little under the cushion;
   *  and a month capped by something else — live card balances, a save-up holdback, mandatory
   *  minimums breaching the floor — lands anywhere from hundreds positive to negative. The rows
   *  below name whatever is actually here part by part rather than calling the lot "surplus". */
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

/** Residue under a dollar left over once the cushion is accounted for is quantisation, not money.
 *  Month 0 is the one month quantised to WHOLE DOLLARS on BOTH sides of the subtraction, so there
 *  are TWO rounding sources, not one: the floor the drawer shows is `Math.round(m0FloorAugmented)`
 *  (useCardProjection.ts, the emitted `m0SafeFloor: Math.round(m0FloorAugmented)`) and the
 *  recommendation is a sum of per-card integers (useCardProjection.ts, `perCardAdjusted`'s
 *  `payment = Math.round(...)`). Measured
 *  2026-08-22 against `forecast-inputs.real.json` by running the real convergence: the raw floor
 *  $3,145.12 prints as $3,145 (12c), and the cent-exact cash cap $1,452.08 pays as $1,452 (8c).
 *  Neither 20c belongs to the user's cards or to a save-up, so it rides with the cushion rather
 *  than getting its own row (see the split below), and this constant is how much quantisation the
 *  cushion window is widened to swallow. Matches the engine's existing sub-dollar dust convention
 *  (`REVOLVING_DUST_DOLLARS`, revolving-payoff.ts). */
const SURPLUS_DUST_DOLLARS = 1;

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
  // what is left past it is the cushion the drain deliberately refuses to spend, plus (only when
  // the cards genuinely cannot take it) cash no revolving balance can absorb. Every part below is
  // derived from the residual itself, so the parts sum back to it exactly no matter how the engine
  // arrived at any one of them.
  const heldForEvent = residual > 0 ? Math.min(residual, month0.holdback) : 0;
  const aboveFloor = residual > 0 ? residual - heldForEvent : 0;

  // ── The floor cushion is not surplus (2026-08-22) ─────────────────────────────────────────
  //
  // `aboveFloor` used to render as ONE row, "Kept as surplus", explained as "more cash than the
  // remaining card balances can absorb". Since 1eebd1f3 gave month 0 the same
  // FLOOR_CUSHION_DOLLARS every other month already had, that sentence is false on real data.
  // Measured 2026-08-22 against `forecast-inputs.real.json` (captured 2026-07-20) by running the
  // real convergence and reading the engine's own unrounded fields, not by back-derivation:
  //
  //   rawMonthMinSafe $3,145.12  →  m0SafeFloor $3,145   (Math.round, useCardProjection.ts)      
  //   m0DrainFloor    $3,145.12 + $2.00 cushion          = $3,147.12
  //   cash cap        $4,599.20 − $3,147.12 − $0 cycling = $1,452.08  →  paid $1,452
  //   residue         $4,599.20 − $3,145 − $1,452        = $2.20  (rawEndingCash $3,147.20)
  //
  // and the plan pays Discover $1,452 against a live balance in the thousands, so the cards could
  // have absorbed every cent of that $2.20. It decomposes as $2.00 of FLOOR_CUSHION_DOLLARS plus
  // TWO separate roundings, not one: 12c the floor row rounds away (m0SafeFloor is whole dollars,
  // so the drawer subtracts $3,145 from cash the engine held back $3,145.12 of) and 8c the
  // per-card integer split leaves on the $1,452.08 cap. The drawer's entire purpose is explaining
  // where each dollar went, so a true number under a false reason is a defect even though the
  // column still added up.
  //
  // The residue therefore splits three ways instead of two:
  //   - up to FLOOR_CUSHION_DOLLARS is the cushion: the margin the month-0 drain leaves above the
  //     floor on purpose. The constant is shared with every other month (credit-card-engine.ts's
  //     `step5Floor`, floor-protection.ts:211's `requiredEndBal` next-month floor requirement),
  //     neither of which is whole-dollar quantised, so it does NOT exist because of rounding — it
  //     exists for sub-tolerance CONVERGENCE RESIDUE. What whole-dollar rounding does is make
  //     month 0 need it MORE than the other months, because month 0 alone rounds each card's share
  //     and so can land up to half a dollar per card off the cent-exact cap in either direction
  //     (useCardProjection.ts, `perCardAdjusted`'s `payment = Math.round(...)`).
  //   - anything past it really is cash no live card balance could take. That is the branch where
  //     `holdback` was capped by `liveRevolvingBal` instead of by the headroom, so the old label
  //     is exactly right for this part and keeps it.
  //   - a sub-dollar leftover rides WITH the cushion instead of claiming its own row. It is the
  //     same quantisation the cushion is there to absorb, and giving $0.20 a line reading "more
  //     than your cards can absorb" would just retell the original lie in miniature.
  //
  // WHY A SIZE TEST DECIDES THIS. Whether the cushion was actually paid is the one thing this
  // layer cannot read straight off the engine, so it is inferred from how much is left.
  //
  // The premise is NOT "the constant is applied in one place". An earlier draft of this comment
  // said the cushion is subtracted inside the month-0 revolving cap "and nowhere else", and that
  // is false: FLOOR_CUSHION_DOLLARS is applied at four sites, and the shared-with-every-month
  // bullet above already contradicts it.
  //   useCardProjection.ts        `m0DrainFloor`  — the month-0 drain target
  //   credit-card-engine.ts       `step5Floor`    — Step 5, EVERY simulated month including 0
  //   floor-protection.ts:211     `requiredEndBal`— the save-up cap's next-month requirement
  //   forecast-engine.ts          `step3DrainTo`  — the forecast's own PASS-3 drain
  // (Three of those four are cited by SYMBOL and not by line on purpose: useCardProjection.ts,
  // credit-card-engine.ts and forecast-engine.ts were all being edited while this was written, and
  // useCardProjection.ts moved 9 lines under the previous draft — which is exactly how that draft
  // ended up with four wrong line numbers. floor-protection.ts is quiet, so it keeps its line.
  // `grep -rn FLOOR_CUSHION_DOLLARS src/` is the authoritative list either way and takes a second.)
  //
  // The premise that actually holds is narrower, and it is about THIS SUBTRACTION rather than
  // about the codebase. `residual` is built from exactly three fields, and only one of them
  // carries the cushion:
  //   - `chain.cashPreDebt` is struck before any floor is applied at all;
  //   - `m0SafeFloor` is emitted UNCUSHIONED — `Math.round(m0FloorAugmented)`,
  //     useCardProjection.ts, the `m0SafeFloor:` field of the emitted month0 — NOT m0DrainFloor;
  //   - `safeToPayTotal` alone was sized against the cushioned target, via `m0DrainFloor` and the
  //     cap it feeds (`availableForRevolving`, useCardProjection.ts).
  // So the cushion can enter `residual` exactly once, as the gap between the floor this drawer
  // subtracts and the floor the payment was actually sized against — never twice, never with a
  // coefficient. The other three sites govern later months and the forecast ledger; they can move
  // `simRevolvingTotal` and so decide WHICH branch month 0 lands in, but they contribute no second
  // cushion term to either branch. That is what the size bound needs, and it is true.
  //
  // From there the bound is arithmetic. Write H = cashPreDebt − m0DrainFloor − cyclingPayment. The
  // cap is `availableForRevolving` = max(ccMinForMonth, max(0, H)) and the payment is
  // rev = min(simRevolvingTotal, availableForRevolving) (both in useCardProjection.ts). In the
  // branch where the CASH cap binds — simRevolvingTotal >= H > ccMinForMonth, so rev = H —
  //     safeToPayTotal = cyclingPayment + H = cashPreDebt − m0FloorAugmented − FLOOR_CUSHION_DOLLARS
  // and cashPreDebt cancels out of the subtraction entirely, leaving
  //     residual = FLOOR_CUSHION_DOLLARS
  //              + (m0FloorAugmented − Math.round(m0FloorAugmented))            ≤ half a dollar
  //              + (cyclingPayment + rev − safeToPayTotalFinal)                 the per-card split
  // — the cushion plus the two roundings named above and nothing else. The engine's own holdback
  // is 0 in that branch: H − rev = 0 makes `surplusIfFree` 0, and `holdback` is
  // `maxCapacity − safeToPayTotal` = `surplusIfFree` (both in useCardProjection.ts). So
  // `aboveFloor` IS that residual: three dollars at the very most. Note that this derivation never
  // appeals to where the constant is applied — only to the fact that `m0SafeFloor` is the
  // uncushioned floor while `safeToPayTotal` was sized against the cushioned one. Correcting the
  // premise therefore leaves the discriminator standing exactly as it was.
  //
  // Everywhere else the residue is a different animal. The engine's holdback is
  // max(0, min(H − rev, liveRevolvingBal)) (`surplusIfFree` in useCardProjection.ts), so when the
  // live balances cap it,
  //     aboveFloor = cashPreDebt − Math.round(m0FloorAugmented) − cyclingPayment − rev
  //                             − liveRevolvingBal
  // — hundreds or thousands of dollars. The cushion did not put it there: it survives in that
  // expression only through `rev` (= simRevolvingTotal, whatever the sim itself chose to pay), so
  // setting FLOOR_CUSHION_DOLLARS to 0 moves the figure by at most a couple of dollars out of the
  // hundreds. An earlier draft said "leaves that figure IDENTICAL", which overstates it now that
  // the sim's own Step 5 is cushioned too; the conclusion is unchanged and the reason is the
  // MAGNITUDE, not exact invariance. That state is reachable for anyone whose spare cash is more
  // than about twice their revolving balance, i.e. anyone near debt-free, so a "Safety cushion
  // $2.00" row there is a true number under a false reason — this slice's own defect, inverted.
  // Round 1 of this change used `revolvingPayment > 0` alone and did exactly that.
  //
  // What the size test CANNOT see: it cannot tell a cushion-shaped residue from a coincidence. A
  // month whose cash happens to settle $2.40 above its rounded floor for unrelated reasons is
  // indistinguishable here from one drained to the cushion, and renders as the cushion. That
  // misattribution is capped at FLOOR_CUSHION_DOLLARS + SURPLUS_DUST_DOLLARS ($3) by construction,
  // which is the trade being made: a $3 row can be wrong about its reason, a $623 one cannot.
  //
  // `revolvingPayment > 0` earns its place as a second guard because it rules out a branch the
  // size test cannot see: a user with no live revolving balance never enters the capped expression
  // at all (`availableForRevolving` in useCardProjection.ts short-circuits to 0 unless
  // `liveRevolvingBal > 0`), so no cushion was ever subtracted for them, yet their cash can still
  // land a couple of dollars above a rounded floor by coincidence. Known blind
  // spot, unchanged from the old behaviour: when every revolving card's recommendation is zeroed
  // by the sync-cutoff autopay sweep (perCardAdjustedFinal), the cushion was paid but
  // `revolvingPayment` reads 0, so the residue renders as surplus exactly as it did before this
  // split existed.
  const cushionApplies = month0.revolvingPayment > 0
    && aboveFloor <= FLOOR_CUSHION_DOLLARS + SURPLUS_DUST_DOLLARS;
  // Once that gate passes the WHOLE residue is cushion-shaped — at most the cushion plus one
  // dollar of quantisation — so the cushion row takes all of it. Splitting $2.20 into a $2.00
  // cushion and a $0.20 "more than your cards can absorb" would retell the original lie in
  // miniature, which is the one thing this split exists to stop.
  const floorCushion = cushionApplies ? aboveFloor : 0;
  // Defined as the remainder, never as its own expression: `floorCushion + surplus === aboveFloor`
  // to the cent by construction, which is what keeps the fold below balancing.
  const surplus = aboveFloor - floorCushion;
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
    // Ranked automatic extra payments. Its own row rather than folded into 'Savings goals': the
    // manual contribution is a fixed bill the user set, this is surplus the ranking diverted, and
    // a user who sees their card paydown drop is owed the reason on the same screen.
    term('autoExtra', 'Extra to goals & car funds', c.autoExtraReserve, '−', 'muted',
      'Surplus automatically sent to the goals and car funds you ranked above your cards'),
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
    // Sits directly under the floor row because it IS a floor term: the month is drained to the
    // floor plus this, never to the floor itself.
    term('floorCushion', 'Safety cushion', floorCushion, '−', 'muted',
      'Held just above your cash floor on purpose, so rounding the payment to whole dollars cannot end the month underneath it'),
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
      billsAndReserves: Math.max(0, c.expenses + c.planExpenses + c.goalContributions + c.autoExtraReserve
        + c.carSavedEarmark + c.carReserve + c.carLoanPayment + c.vehicleInsurance + c.mortgagePayment + c.transfers),
      // `floorCushion` belongs in the same segment as the floor it sits on: splitting the residue
      // into two rows must not change what the donut says, or the chart and the rows disagree
      // again. floorCushion + surplus === aboveFloor, so this total is unchanged by the split.
      locked: Math.max(0, cashFloor + heldForEvent + floorCushion + surplus),
      deployable: Math.max(0, availableToDeploy),
      shortfall: projectedRemaining < 0 ? -projectedRemaining : 0,
    },
  };
}
