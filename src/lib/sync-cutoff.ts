// The one definition of "is this month-0 outflow already reflected in the stored balance?"
//
// Finding §1.1 cause C. Two surfaces answered this differently for the SAME car loan in the SAME
// month: `useCardProjection.ts` dropped a payment whose due day was before the sync date ("Plaid
// already captured it") while `forecast-engine.ts`'s `activeCarLoanByMonth` applied no cutoff at
// all, so Forecast charged $537 the Dashboard did not. Two more asymmetries were found alongside
// it: the engine's loan-insurance gate used `<=` where the hook used `<` (a charge due exactly on
// the cutoff day went two ways), and every caller re-derived the cutoff date inline.
//
// Two facts drive the rules below, both verified 2026-08-05:
//
// 1. `supabase/functions/plaid-sync/index.ts:232` stores `balances.current`. For depository
//    accounts Plaid's `current` does NOT net out pending transactions — `available` does. So a
//    payment that has posted but not settled is absent from the balance we hold, and treating it
//    as captured overstates cash. Hence SETTLEMENT_LAG_DAYS: a due date only counts as captured
//    once it is far enough behind the basis date to have settled. Tre's call (2026-08-05): 3
//    calendar days, chosen over business-day arithmetic for being one rule with nothing to get
//    wrong. It errs toward charging a payment twice, which reads cash LOW — the safe direction.
//
// 2. Without a Plaid link the balance is a number the user typed, current as of when the row was
//    last written. `accounts.updated_at` is that moment and is strictly better than assuming
//    today. Falling back to today is still correct when no timestamp is available at all.
//
// There is no settled/pending evidence to consult: `plaid-sync` pulls balances and liabilities
// only, no transactions. When transaction sync lands (§1A), the accurate rule becomes "captured
// iff a settled transaction matches it" and this date heuristic should be retired, not tuned.

/** Days a due date must trail the basis date before its charge counts as settled into the balance. */
export const SETTLEMENT_LAG_DAYS = 3;

export interface SyncCutoffBasis {
  /** `plaid_items.last_synced_at` for the funding account's item, if it has one. */
  lastSyncedAt?: string | null;
  /** `accounts.updated_at` for the funding account — the manual-balance fallback. */
  balanceUpdatedAt?: string | null;
  /** Local date, `YYYY-MM-DD`. Last-resort basis; also the clamp ceiling. */
  today: string;
}

const toDateOnly = (iso: string): string => iso.split('T')[0];

const shiftDays = (dateOnly: string, days: number): string => {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const shifted = new Date(y, m - 1, d + days);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`;
};

/**
 * The date the stored balance is accurate AS OF — Plaid sync, else the manual row write, else
 * today. Never after `today`: clock skew or a future-dated sync must not swallow events still to
 * come.
 *
 * NO settlement lag here. The lag lives in `isCapturedInBalance` because it is an OUTFLOW-only
 * correction, and this date also gates income. Verified live 2026-08-05: lagging this value
 * re-admitted a $1,463 deposit that had already landed and was already in the balance, moving
 * Forecast's month-0 END CASH from $2,346 to $4,346 — inflating cash, the unsafe direction.
 * Deposits settle into `balances.current`; only debits sit pending outside it.
 */
export function resolveSyncCutoffDate(basis: SyncCutoffBasis): string {
  // `||`, not `??`: demo fixtures carry `updated_at: ''` and an empty timestamp is absent, not a
  // date. Parsing one yields NaN and a cutoff of "NaN-NaN-NaN", which compares as capturing
  // nothing — a silent, whole-surface behaviour change from one empty string.
  const raw = basis.lastSyncedAt || basis.balanceUpdatedAt || null;
  const anchor = raw ? toDateOnly(raw) : basis.today;
  return anchor > basis.today ? basis.today : anchor;
}

/**
 * Is a month-0 OUTFLOW due on `dueDate` already reflected in the stored balance?
 *
 * `balanceAsOf` is `resolveSyncCutoffDate`'s answer; the settlement lag is applied here, so it
 * touches debits only and never the income gates that share that date.
 *
 * Strict `<`: a charge due ON the (lagged) boundary counts as NOT yet captured and still shows in
 * month 0. Every caller must use this rather than open-coding the comparison — the direction of
 * this one operator was itself a defect (engine `<=` vs hook `<` for the same charge).
 */
export function isCapturedInBalance(dueDate: string, balanceAsOf: string): boolean {
  return dueDate < shiftDays(balanceAsOf, -SETTLEMENT_LAG_DAYS);
}

/** `YYYY-MM-DD` for a day-of-month within the month key `YYYY-MM` — the shape due days arrive in. */
export function dueDateInMonth(monthKey: string, dayOfMonth: number): string {
  return `${monthKey}-${String(dayOfMonth).padStart(2, '0')}`;
}
