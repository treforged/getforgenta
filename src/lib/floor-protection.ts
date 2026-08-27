// Shared floor-breach protection algorithm, used independently by both useCardProjection.ts
// and Forecast.tsx. Each caller builds its own per-month cash-flow arrays from its own model
// (the two are computed independently on purpose — see the comments at each call site) and
// calls computeFloorProtection with them. Sharing the algorithm (not the data) means a fix here
// fixes both callers at once, while keeping each caller's own numbers as an independent check
// against the other ever silently disagreeing.

// PROJECTION_MONTHS comes from './scheduling' directly (not re-exported via credit-card-engine)
// so credit-card-engine can import FLOOR_CUSHION_DOLLARS from here without an import cycle.
import { PROJECTION_MONTHS } from './scheduling';

/** Cushion above the cash floor that every floor-pinning drain targets. The convergence loop
 * stops at a $1 debtPayment tolerance (forecast-convergence.ts), so a fixed point that pins end
 * cash EXACTLY at the floor can settle cents below it — invisible in the rounded Forecast table
 * until the rounding falls the wrong way and a month shows $1 under its floor (2026-07-16 live
 * report). Draining to floor+cushion instead keeps sub-tolerance residue at or above the floor.
 * Must stay ≥ the convergence toleranceDollars. */
export const FLOOR_CUSHION_DOLLARS = 2;
import type { EnrichedTransaction } from './pay-schedule';
import type { CarFund } from './types';

export interface FloorProtectionParams {
  /** Per-month net income, length PROJECTION_MONTHS. Index 0 is month 0's own (today-to-EOM) remaining income. */
  incomeByMonth: number[];
  /** Comprehensive per-month expense figure EXCLUDING the debt payment itself — every other cash
   * outflow that month (base expenses, savings/car/mortgage/vehicle/lump-transfer/cycling-card
   * costs, etc). Length PROJECTION_MONTHS. */
  expenseByMonth: number[];
  /** Per-month net (income - expenses) from one-time, non-recurring items. Length PROJECTION_MONTHS. */
  oneTimeNetByMonth: number[];
  /** Per-month car down-payment cash outflow (lump sum landing in checking that month). Length PROJECTION_MONTHS. */
  carDownPaymentByMonth: number[];
  /** Per-month safe-cash floor (augmented — includes card-minimum/car-loan buffers). Length PROJECTION_MONTHS. */
  floorByMonth: number[];
  /** Starting liquid balance (today's actual balance in the funding account). */
  startingBalance: number;
  /** Combined CC minimum payment total — debt payments are never reduced below this. */
  ccMinTotal: number;
  /** Per-month CC minimum from simulation — when provided, overrides ccMinTotal per month so
   * post-payoff months use 0 instead of today's static live minimums. Falls back to ccMinTotal. */
  ccMinByMonth?: number[];
  /** Per-month label for the MANDATORY credit-card term inside `ccMinByMonth` — a pinned
   * statement balance the simulation pays unconditionally that month. Labeling only, like
   * `cyclingExcessByMonth` / `carFunds` / `transactions` below: the dollars are already in
   * `ccMinByMonth` and nothing here reaches the cash math. Indexed in ABSOLUTE month space
   * (same as `carDownPaymentByMonth`), i.e. the month the statement LANDS, and read by
   * `describeBreach` at the breach month. Sparse — null everywhere no pin lands.
   * Omitted ⇒ today's heuristics, unchanged. */
  ccMandatoryReasonByMonth?: (string | null)[];
  /** Per-month upper bound on the reducible (revolving + cycling-backlog) debt payment — the
   * debt actually outstanding entering month m, from the caller's simulation. Without it the
   * cash walks below assume every dollar above the floor goes to debt FOREVER, so the modeled
   * balance rides the floor even years after all revolving debt has cleared — and a large
   * cycling statement in a post-payoff month then looks like a floor breach from a balance the
   * user doesn't actually have, capping the preceding months' payments and forcing the cycling
   * card to underpay a statement it could easily afford (the Feb–Jun 2028 underpayment).
   * The engine can never pay more than what's owed, so capping `natural` (and the assumed
   * minimum) by this bound makes the walk accumulate cash exactly where reality does.
   * Omitted ⇒ Infinity everywhere (legacy floor-riding behavior). */
  reducibleDebtCapByMonth?: number[];
  /** Per-month cycling-card statement EXCESS over baseline — used only for "what caused this"
   * save-up reason labeling (the historical "$X CC purchase statement payment" label), not for
   * the cash-flow math itself (that's already folded into expenseByMonth by the caller). */
  cyclingExcessByMonth: number[];
  /** Saving-phase car funds — used only to label a car-down-payment-driven save-up reason. */
  carFunds: CarFund[];
  /** One-time transactions — used only to label a transaction-driven save-up reason. */
  transactions: EnrichedTransaction[];
  /** Card account ids (and "account:id" keys) — used only to exclude CC-charged transactions
   * from the "biggest one-time expense" reason fallback. */
  ccSourceIds: Set<string>;
  now: Date;
  formatCurrency: (amount: number, showCents: boolean) => string;
}

export interface FloorProtectionResult {
  /** Per-month cap on the total debt payment allocation (revolving cards only). Infinity where
   * no reserve is needed that month. */
  maxDebtPaymentByMonth: number[];
  /** Months where the cap actually reduced the payment below what would otherwise be paid. */
  saveUpMonths: Set<number>;
  /** Currently always equal to saveUpMonths — kept distinct because callers gate their own
   * surplus-redirect step on this name specifically, in case the two ever need to diverge again. */
  strictSaveUpMonths: Set<number>;
  saveUpReason: Map<number, { eventName: string; monthLabel: string }>;
  /**
   * The backward pass itself: the minimum ENDING balance for each month that
   * guarantees no LATER month ends below its own floor.
   *
   * Returned because the debt-payment cap above is not the only lever on a
   * month's ending cash, and on real data it is often not the effective one. A
   * caller holding back a DISCRETIONARY reserve should clamp against this rather
   * than against a one-month-ahead floor, or it will drain a month to that
   * floor and strand a spike two or three months out. Measured 2026-08-26:
   * December 2028's requiredEnd is 2883, the month actually ended at 2011
   * because a ranked reserve took the difference, and January 2029 then landed
   * at 1246 against a floor of 1955. The payment cap could not help, because by
   * then no reducible debt remained for it to reduce.
   */
  requiredEndByMonth: number[];
}

/**
 * Reserve-based floor-breach protection.
 *
 * requiredEndByMonth[m] (backward pass) is the minimum ENDING balance for month m that guarantees
 * no month from m through the last projected month (PROJECTION_MONTHS - 1) ends below ITS OWN
 * floor — assuming every month from m onward pays only as much above the minimum as it can truly
 * spare. The forward pass then caps each month's debt payment only enough to reach it.
 *
 * This replaced an earlier all-or-nothing "is this month fully protected" flag, which required
 * an unbroken chain of fully-protected months reaching all the way back from any future breach —
 * one unprotected month in between reset the accumulated buffer straight back to the bare floor.
 * Once a chain of even a few months was needed, that cascaded backward, capping far more months
 * at the card minimum than the shortfall actually required. Each month here instead banks
 * exactly its own marginal contribution toward a future need and sends the rest to debt.
 */
export function computeFloorProtection(params: FloorProtectionParams): FloorProtectionResult {
  const {
    incomeByMonth, expenseByMonth, oneTimeNetByMonth, carDownPaymentByMonth, floorByMonth,
    startingBalance, ccMinTotal, ccMinByMonth, cyclingExcessByMonth, carFunds, transactions,
    ccSourceIds, now, formatCurrency, reducibleDebtCapByMonth, ccMandatoryReasonByMonth,
  } = params;

  const debtCap = (m: number) => reducibleDebtCapByMonth?.[m] ?? Infinity;
  // The mandatory minimum can't exceed the debt outstanding either — once revolving debt is
  // clear the real minimum is $0, whatever today's static live minimums say.
  const ccMin = (m: number) => Math.min(ccMinByMonth?.[m] ?? ccMinTotal, debtCap(m));

  const maxDebtPaymentByMonth: number[] = Array(PROJECTION_MONTHS).fill(Infinity);
  const saveUpMonths = new Set<number>();
  const strictSaveUpMonths = new Set<number>();
  const saveUpReason = new Map<number, { eventName: string; monthLabel: string }>();

  // Per-month net cash flow if only the minimum is ever sent to debt — the most that could
  // possibly be preserved that month. Feeds the backward pass below.
  const netAtMin: number[] = Array.from({ length: PROJECTION_MONTHS }, (_, m) =>
    incomeByMonth[m] - expenseByMonth[m] + oneTimeNetByMonth[m] - carDownPaymentByMonth[m] - ccMin(m),
  );

  // Minimum ENDING balance for each month, three requirements deep. The FIRST is the one this
  // recurrence did not carry until 2026-08-25 and is the whole of the fix:
  //
  //   • floorByMonth[m]      — month m's OWN floor. `belowSafeMinimum` (forecast-engine.ts) judges
  //                            every month against its own `monthMinSafe`, and the sim's cash walk
  //                            does the same; this pass did not. It required only that month m end
  //                            at the NEXT month's floor, so wherever a floor STEPS DOWN (the real
  //                            2026-07-20 capture: Apr 2027's $3,332.12 against May's $2,800) the
  //                            reserve demanded of every earlier month was short by exactly that
  //                            step. Measured on the controlled probe (floor-protection.ownFloor
  //                            test): $1,098 below the shock month's own floor, against $0 in the
  //                            otherwise-identical flat-floor control.
  //   • floorByMonth[m + 1]  — end-of-month cash IS next month's pre-paycheck cash, so month m + 1
  //                            must start at or above its own floor (Q9, 2026-07-16).
  //   • requiredEnd[m+1] − netAtMin[m+1]
  //                          — the chain: whatever month m + 1 must end with, less what it can add
  //                            on its own while paying only the minimum.
  //
  // The last two terms are algebraically what the previous `reserveNeeded` recurrence computed
  // (reserveNeeded[m] + floorByMonth[m] was its implied required START balance, and
  // nextFloor + reserveNeeded[m + 1] its implied required END balance). Restating it as an
  // absolute ending balance — the same quantity the forward pass caps to, and the same quantity
  // the engine's own floor test reads — is what made the missing term visible: the old form's
  // "every month starts at its own floor" baseline silently assumed netAtMin[m] >= 0, which is
  // false in precisely the month a large one-time expense lands.
  const requiredEndByMonth: number[] = Array(PROJECTION_MONTHS).fill(0);
  for (let m = PROJECTION_MONTHS - 1; m >= 0; m--) {
    const nextFloor = m + 1 < PROJECTION_MONTHS ? floorByMonth[m + 1] : floorByMonth[PROJECTION_MONTHS - 1];
    const fromChain = m + 1 < PROJECTION_MONTHS ? requiredEndByMonth[m + 1] - netAtMin[m + 1] : -Infinity;
    requiredEndByMonth[m] = Math.max(floorByMonth[m], nextFloor, fromChain);
  }


  // ⚠️ THE EARLY RETURN SITS HERE, AFTER THE BACKWARD PASS, and it moved on
  // 2026-08-26. It used to sit above and hand back zeroes, on the reasoning that
  // "no CC minimum means no protection is configured". That was true while the
  // only output was `maxDebtPaymentByMonth`, which caps a DEBT payment and has
  // nothing to cap when there is no card debt. It stopped being true the moment
  // `requiredEndByMonth` became an output, because the reserve clamp in
  // forecast-engine.ts reads it and a user with NO credit cards still has goals,
  // still has a cash floor, and can still be walked into a spike months out by a
  // ranked reserve. Returning zeroes left exactly that user with no look-ahead at
  // all. Caught by the regression test this pass was written for, which had no
  // cards in its fixture.
  //
  // The caps below are still skipped, which is the part that was always right:
  // with `ccMinTotal <= 0` there is no reducible payment to cap.
  if (ccMinTotal <= 0) {
    return { maxDebtPaymentByMonth, saveUpMonths, strictSaveUpMonths, saveUpReason, requiredEndByMonth };
  }

  // Unprotected (no caps at all) trajectory, purely to identify which future months would
  // actually breach the floor and why — used only to label saveUpReason below, not to decide
  // the caps themselves (requiredEndByMonth already does that more precisely).
  const rawBreachMonths: number[] = [];
  {
    let rawBal = startingBalance;
    for (let m = 0; m < PROJECTION_MONTHS; m++) {
      const mFloor = floorByMonth[m];
      const natural = Math.min(debtCap(m), Math.max(ccMin(m), Math.max(0, rawBal + incomeByMonth[m] - expenseByMonth[m] + oneTimeNetByMonth[m] - carDownPaymentByMonth[m] - mFloor)));
      rawBal += incomeByMonth[m] - expenseByMonth[m] - natural + oneTimeNetByMonth[m] - carDownPaymentByMonth[m];
      if (rawBal < mFloor - 0.01) rawBreachMonths.push(m);
    }
  }

  const describeBreach = (i: number): { eventName: string; monthLabel: string } => {
    const carD = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const monthLabel = carD.toLocaleString('en', { month: 'long', year: 'numeric' });
    let eventName = 'upcoming expense';
    const ccReason = ccMandatoryReasonByMonth?.[i];
    if (ccReason) {
      // PREFERRED over everything below. A pinned statement is the only term here whose cause is
      // KNOWN: it is the mandatory outflow that raised this month's ccMin and therefore sized the
      // reserve. The three branches below are heuristics that infer a cause from whatever else is
      // happening that month, and the biggest-transaction fallback in particular has no causal
      // link at all — it is how a $2,443 reserve for Prime Visa's September statement came to be
      // reported as '$200 Pay sibling to watch dogs'.
      eventName = ccReason;
    } else if (carDownPaymentByMonth[i] > 0) {
      const car = carFunds.find(c => {
        if (c.phase !== 'saving') return false;
        const dp = Math.max(0, Number(c.down_payment_goal || 0) - Number(c.gift_contribution || 0));
        if (dp <= 0) return false;
        let pmi: number;
        if (c.planned_purchase_date) {
          const parts = c.planned_purchase_date.split('-').map(Number);
          const pd = new Date(parts[0], parts[1] - 1, parts[2]);
          pmi = Math.max(0, (pd.getFullYear() - now.getFullYear()) * 12 + (pd.getMonth() - now.getMonth()));
        } else {
          const rem = Math.max(0, Number(c.down_payment_goal || 0) - Number(c.current_saved || 0) - Number(c.gift_contribution || 0));
          const contrib = rem > 0 ? Math.min(rem / 12, 500) : 0;
          pmi = contrib > 0 ? Math.ceil(rem / contrib) : 999;
        }
        return isFinite(pmi) && pmi === i;
      });
      if (car) eventName = `${formatCurrency(carDownPaymentByMonth[i], false)} ${car.vehicle_name || 'vehicle'} down payment`;
    } else if (cyclingExcessByMonth[i] > 0) {
      eventName = `${formatCurrency(cyclingExcessByMonth[i], false)} CC purchase statement payment`;
    } else {
      const od = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const omk = `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}`;
      const monthTxns = transactions.filter(t => {
        if (t.type !== 'expense' || t.isGenerated) return false;
        if (!t.date || !t.date.startsWith(omk)) return false;
        if (t.category === 'Debt Payments' || t.category === 'Balance Adjustment') return false;
        if (t.payment_source && ccSourceIds.has(t.payment_source)) return false;
        return true;
      });
      const biggest = monthTxns.reduce((max: EnrichedTransaction | null, t) =>
        !max || Number(t.amount) > Number(max.amount) ? t : max, null);
      if (biggest) {
        const label = biggest.note?.trim() || biggest.category || 'expense';
        eventName = `${formatCurrency(Number(biggest.amount), false)} ${label}`;
      }
    }
    return { eventName, monthLabel };
  };

  // Forward pass: the actual cash trajectory, capping each month's debt payment so the ending
  // balance never dips below what requiredEndByMonth says this month must end with.
  let bal = startingBalance;
  for (let m = 0; m < PROJECTION_MONTHS; m++) {
    const mInc = incomeByMonth[m];
    const mExp = expenseByMonth[m];
    const oneTimeNet = oneTimeNetByMonth[m];
    const carDP = carDownPaymentByMonth[m];
    const mFloor = floorByMonth[m];
    const mCcMin = ccMin(m);
    const natural = Math.min(debtCap(m), Math.max(mCcMin, Math.max(0, bal + mInc - mExp + oneTimeNet - carDP - mFloor)));

    // `natural` drains cash to this month's OWN floor (mirroring PASS 3 / the sim's Step 5, which
    // pin end cash to the current month's effectiveFloor), so a cap is needed exactly when this
    // month must end HIGHER than that — whether because a future at-minimum breach needs a reserve
    // banking here, or because next month's floor is simply higher than this one's (Q9: a floor
    // step-up between months left the next month starting below its own pre-paycheck floor, since
    // Discover's discretionary paydown drained the months the ISB-pinned month needed). Both are
    // now single terms inside requiredEndByMonth[m], which is never below mFloor, so one
    // comparison covers what two used to.
    const requiredEnd = requiredEndByMonth[m];
    if (requiredEnd > mFloor) {
      const requiredEndBal = requiredEnd + FLOOR_CUSHION_DOLLARS;
      const availableForDebt = Math.max(0, bal + mInc - mExp + oneTimeNet - carDP - requiredEndBal);
      const cap = Math.max(mCcMin, availableForDebt);
      maxDebtPaymentByMonth[m] = cap;
      const actualPay = Math.min(cap, natural);
      if (cap < natural - 1) {
        saveUpMonths.add(m);
        strictSaveUpMonths.add(m);
        if (!saveUpReason.has(m)) {
          const i = rawBreachMonths.find(b => b > m);
          saveUpReason.set(m, describeBreach(i !== undefined ? i : Math.min(PROJECTION_MONTHS - 1, m + 1)));
        }
      }
      bal += mInc - mExp - actualPay + oneTimeNet - carDP;
    } else {
      bal += mInc - mExp - natural + oneTimeNet - carDP;
    }
  }

  return { maxDebtPaymentByMonth, saveUpMonths, strictSaveUpMonths, saveUpReason, requiredEndByMonth };
}
