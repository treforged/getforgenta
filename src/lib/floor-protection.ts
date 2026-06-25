// Shared floor-breach protection algorithm, used independently by both useCardProjection.ts
// and Forecast.tsx. Each caller builds its own per-month cash-flow arrays from its own model
// (the two are computed independently on purpose — see the comments at each call site) and
// calls computeFloorProtection with them. Sharing the algorithm (not the data) means a fix here
// fixes both callers at once, while keeping each caller's own numbers as an independent check
// against the other ever silently disagreeing.

import { PROJECTION_MONTHS } from './credit-card-engine';
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
}

/**
 * Reserve-based floor-breach protection.
 *
 * reserveNeeded[m] (backward pass) is the minimum cash required at the START of month m, beyond
 * that month's own bare floor, to guarantee no future floor breach through the last projected
 * month (PROJECTION_MONTHS - 1) — assuming
 * every month from m onward pays only as much above the minimum as it can truly spare. The
 * forward pass then caps each month's debt payment only enough to keep the ending balance at or
 * above what the following month's own reserveNeeded requires.
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
    ccSourceIds, now, formatCurrency,
  } = params;

  const ccMin = (m: number) => ccMinByMonth?.[m] ?? ccMinTotal;

  const maxDebtPaymentByMonth: number[] = Array(PROJECTION_MONTHS).fill(Infinity);
  const saveUpMonths = new Set<number>();
  const strictSaveUpMonths = new Set<number>();
  const saveUpReason = new Map<number, { eventName: string; monthLabel: string }>();

  if (ccMinTotal <= 0) {
    return { maxDebtPaymentByMonth, saveUpMonths, strictSaveUpMonths, saveUpReason };
  }

  // Per-month net cash flow if only the minimum is ever sent to debt — the most that could
  // possibly be preserved that month. Feeds the backward pass below.
  const netAtMin: number[] = Array.from({ length: PROJECTION_MONTHS }, (_, m) =>
    incomeByMonth[m] - expenseByMonth[m] + oneTimeNetByMonth[m] - carDownPaymentByMonth[m] - ccMin(m),
  );

  const reserveNeeded: number[] = Array(PROJECTION_MONTHS + 1).fill(0);
  for (let m = PROJECTION_MONTHS - 1; m >= 0; m--) {
    const nextFloor = m + 1 < PROJECTION_MONTHS ? floorByMonth[m + 1] : floorByMonth[PROJECTION_MONTHS - 1];
    const endBalAtMin = floorByMonth[m] + netAtMin[m];
    reserveNeeded[m] = Math.max(0, nextFloor + reserveNeeded[m + 1] - endBalAtMin);
  }

  // Unprotected (no caps at all) trajectory, purely to identify which future months would
  // actually breach the floor and why — used only to label saveUpReason below, not to decide
  // the caps themselves (reserveNeeded already does that more precisely).
  const rawBreachMonths: number[] = [];
  {
    let rawBal = startingBalance;
    for (let m = 0; m < PROJECTION_MONTHS; m++) {
      const mFloor = floorByMonth[m];
      const natural = Math.max(ccMin(m), Math.max(0, rawBal + incomeByMonth[m] - expenseByMonth[m] + oneTimeNetByMonth[m] - carDownPaymentByMonth[m] - mFloor));
      rawBal += incomeByMonth[m] - expenseByMonth[m] - natural + oneTimeNetByMonth[m] - carDownPaymentByMonth[m];
      if (rawBal < mFloor - 0.01) rawBreachMonths.push(m);
    }
  }

  const describeBreach = (i: number): { eventName: string; monthLabel: string } => {
    const carD = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const monthLabel = carD.toLocaleString('en', { month: 'long', year: 'numeric' });
    let eventName = 'upcoming expense';
    if (carDownPaymentByMonth[i] > 0) {
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
  // balance never dips below what reserveNeeded says the following month requires.
  let bal = startingBalance;
  for (let m = 0; m < PROJECTION_MONTHS; m++) {
    const mInc = incomeByMonth[m];
    const mExp = expenseByMonth[m];
    const oneTimeNet = oneTimeNetByMonth[m];
    const carDP = carDownPaymentByMonth[m];
    const mFloor = floorByMonth[m];
    const mCcMin = ccMin(m);
    const natural = Math.max(mCcMin, Math.max(0, bal + mInc - mExp + oneTimeNet - carDP - mFloor));

    if (reserveNeeded[m + 1] > 0) {
      const nextFloor = m + 1 < PROJECTION_MONTHS ? floorByMonth[m + 1] : floorByMonth[PROJECTION_MONTHS - 1];
      const requiredEndBal = nextFloor + reserveNeeded[m + 1];
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

  return { maxDebtPaymentByMonth, saveUpMonths, strictSaveUpMonths, saveUpReason };
}
