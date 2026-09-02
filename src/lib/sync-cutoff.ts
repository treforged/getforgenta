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
// §1A Stage C did what the line above this used to promise. Settled transactions now exist
// (`synced_transactions`), so where they cover a charge, "captured iff a settled transaction
// matches it" is the rule and the date arithmetic is not consulted. SETTLEMENT_LAG_DAYS was
// DEMOTED, not deleted: it is the fallback for every charge with no evidence — manual accounts,
// new connections, and any due date the backfill has not reached. See `isCapturedInBalance`.

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
  // nothing — a silent, whole-surface behavior change from one empty string.
  const raw = basis.lastSyncedAt || basis.balanceUpdatedAt || null;
  const anchor = raw ? toDateOnly(raw) : basis.today;
  return anchor > basis.today ? basis.today : anchor;
}

/**
 * What settled transactions say about one month-0 charge. §1A Stage C.
 *
 * Built by `buildCaptureEvidence` in `transaction-matching.ts`; kept as a plain shape here so
 * `sync-cutoff.ts` stays dependency-free and the matcher can depend on it rather than the reverse.
 */
export interface CaptureEvidence {
  /**
   * Do synced transactions cover this charge's whole match window on its account? False for a
   * manual account, an un-backfilled connection, or a due date the sync has not reached yet.
   * Only a TRUE here licenses concluding anything from the ABSENCE of a match.
   */
  hasTxnCoverage: boolean;
  /** Did a settled transaction confidently match this charge? */
  matched: boolean;
}

/**
 * Is a month-0 OUTFLOW due on `dueDate` already reflected in the stored balance?
 *
 * `balanceAsOf` is `resolveSyncCutoffDate`'s answer; the settlement lag is applied here, so it
 * touches debits only and never the income gates that share that date.
 *
 * §1A Stage C DEMOTES the date heuristic from the rule to the fallback. `evidence` is optional so
 * call sites can be wired one at a time, and omitting it is exactly the pre-Stage-C behavior.
 *
 * - Matched → captured. A settled transaction is the fact the heuristic was approximating.
 * - Covered, unmatched → NOT captured. The charge genuinely has not hit, however old it is. This
 *   is the branch that changes numbers: the heuristic would have assumed an old due date settled.
 * - No coverage → the date heuristic, unchanged. Non-negotiable — manual accounts and connections
 *   still backfilling have no evidence at all, and deleting the heuristic regresses every one.
 *
 * Note `matched` is honoured even without coverage. Coverage requires the WHOLE match window to
 * have been observed, so a real match can land just outside it; a transaction that actually exists
 * outranks a conservatism about window completeness.
 *
 * Strict `<` in the fallback: a charge due ON the (lagged) boundary counts as NOT yet captured and
 * still shows in month 0. Every caller must use this rather than open-coding the comparison — the
 * direction of this one operator was itself a defect (engine `<=` vs hook `<` for the same charge).
 */
export function isCapturedInBalance(
  dueDate: string,
  balanceAsOf: string,
  evidence?: CaptureEvidence,
): boolean {
  if (evidence?.matched) return true;
  if (evidence?.hasTxnCoverage) return false;
  return dueDate < shiftDays(balanceAsOf, -SETTLEMENT_LAG_DAYS);
}

/**
 * Is a projected DEBIT dated `date` still outstanding against a balance synced as of `cutoffDate`?
 *
 * THE GRACE PERIOD (Tre, 2026-09-02: *"my rent hasnt been taken out of my account yet, there
 * should be a grace period. when this type of issue occurs, it can throw off other calculations
 * for days."*).
 *
 * The `getRemainingTransaction*` helpers used to ask a bare `t.date > cutoffDate`, which drops a
 * projected bill the instant the sync date passes its due date — on the DATE ALONE, with no check
 * that the money actually left. His rent is due the 1st and has cleared on the 2nd-4th for seven
 * straight months, so on the 2nd it vanished from remaining expenses while the $2,070 was still
 * sitting in the account and still about to go. That reads cash HIGH, which is the unsafe
 * direction, and it stays wrong until the debit lands: exactly "for days".
 *
 * The same `SETTLEMENT_LAG_DAYS` every other outflow gate in this file already honours fixes it,
 * so a bill keeps being reserved for three days past the cutoff. INCOME MUST NOT USE THIS — the
 * lag exists because money leaves later than it is scheduled to, and a deposit arriving late is
 * not the same risk. `isCapturedInBalance` makes the same debits-only distinction.
 */
export function isDebitStillOutstanding(date: string, cutoffDate: string): boolean {
  // Expressed as the exact complement of the fallback branch of `isCapturedInBalance`, NOT as its
  // own comparison. Written independently it first shipped as `>` against `<`, which disagreed
  // with that function by one day on the boundary — the same operator-direction defect this file
  // already records (engine `<=` vs hook `<` for one charge). A debit is outstanding precisely
  // when it is not yet captured, and there is now one operator deciding that for both.
  return !isCapturedInBalance(date, cutoffDate);
}

/** `YYYY-MM-DD` for a day-of-month within the month key `YYYY-MM` — the shape due days arrive in. */
export function dueDateInMonth(monthKey: string, dayOfMonth: number): string {
  return `${monthKey}-${String(dayOfMonth).padStart(2, '0')}`;
}
