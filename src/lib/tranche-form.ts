// Form state <-> `accounts.balance_tranches` (jsonb). Pure, no I/O.
//
// The edit form keeps every field as a string (see `emptyForm` in Accounts.tsx), so a tranche row
// is strings too — that is what an <input> gives back, and it is what lets a half-typed "5037." sit
// in the box without being rounded away under the cursor. This module is the only place those
// strings become numbers, and it validates with `parseTranches` from balance-tranches.ts rather
// than repeating its rules: one validator, so the UI can never accept a shape the reader drops.

import { parseTranches, type BalanceTranche } from './balance-tranches';

/** One editable row. All strings — mirrors the rest of the account form's state. */
export interface TrancheFormRow {
  id: string;
  label: string;
  balance: string;
  apr: string;
  /** `YYYY-MM-DD`, or '' for a rate with no expiry. */
  promo_end_date: string;
  /** The contractual instalment this tranche must receive monthly, or '' for none.
   * See `BalanceTranche.min_payment` — absent, null and 0 all mean "no schedule". */
  min_payment: string;
  /** A flat MONTHLY fee in dollars, or '' for none. See `BalanceTranche.monthly_fee`. */
  monthly_fee: string;
  /** True when the plan's term cannot be shortened by paying more. See `BalanceTranche.fixed_term`. */
  fixed_term: boolean;
}

/**
 * What actually goes into the jsonb column. `promo_end_date` and `min_payment` are ABSENT (not
 * `''`, not `null`) when unset — the stored shape stays the minimal one the SQL-seeded rows use.
 *
 * ⚠️ EVERY FIELD `parseTranches` READS MUST APPEAR HERE, or the form silently destroys it.
 * `min_payment` did not, from `ef75f6d5` until 2026-08-22: the reader parsed it, `tranchesToRows`
 * dropped it one line later, and `rowsToTranches` could not write it back — so saving a card for
 * ANY reason (a rename, a balance edit) binned its instalment schedule. Tre's Prime Visa carried
 * $524.40/mo of Chase Equal Pay minimums through that whole window on luck alone.
 *
 * ⚠️ **AND IT HAPPENED AGAIN, IN THIS FILE, TO TWO MORE FIELDS.** `monthly_fee` and `fixed_term`
 * were added to `BalanceTranche`, parsed by `parseTranches`, normalised, and given their own test
 * file — and never added here, so a Pay Over Time fee could not be entered and would have been
 * **erased by any save** if one were ever written by hand. Fixed 2026-09-06.
 * **A warning in a comment did not prevent the repeat, so there is now a TEST**:
 * `tranche-form.roundTrip.test.ts` asserts the round trip preserves every field the reader
 * produces, and fails when a new one is added to `BalanceTranche` and not to `TranchePayload`.
 */
// A `type`, not an `interface`, on purpose: only a type alias gets the implicit index signature
// that makes it assignable to the generated `Json` column type in integrations/supabase/types.ts.
export type TranchePayload = {
  id: string;
  label: string;
  balance: number;
  apr: number;
  promo_end_date?: string;
  min_payment?: number;
  monthly_fee?: number;
  fixed_term?: boolean;
};

export const DEFAULT_TRANCHE_LABEL = 'Promo balance';

export function newTrancheRow(): TrancheFormRow {
  return { id: crypto.randomUUID(), label: '', balance: '', apr: '', promo_end_date: '', min_payment: '', monthly_fee: '', fixed_term: false };
}

/** Stored jsonb -> editable rows. Anything `parseTranches` rejects never reaches the form. */
export function tranchesToRows(raw: unknown): TrancheFormRow[] {
  return parseTranches(raw).map((t: BalanceTranche) => ({
    id: t.id || crypto.randomUUID(),
    label: t.label,
    balance: String(t.balance),
    apr: String(t.apr),
    promo_end_date: t.promo_end_date ?? '',
    min_payment: t.min_payment != null && t.min_payment > 0 ? String(t.min_payment) : '',
    monthly_fee: t.monthly_fee != null && t.monthly_fee > 0 ? String(t.monthly_fee) : '',
    fixed_term: t.fixed_term === true,
  }));
}

export interface TrancheRowsResult {
  /** null means "no tranches" — a single-APR card, which is what the column stores as NULL. */
  tranches: TranchePayload[] | null;
  /** 1-based positions of rows the validator rejected. Never dropped quietly; the caller reports them. */
  invalidRows: number[];
}

/**
 * Editable rows -> what to write to `balance_tranches`.
 *
 * A rejected row is REPORTED, not skipped: `parseTranches` drops a blank or negative balance on the
 * floor, and a save that silently binned a row the user typed would be indistinguishable from one
 * that worked. The caller refuses to save while `invalidRows` is non-empty.
 */
export function rowsToTranches(rows: readonly TrancheFormRow[]): TrancheRowsResult {
  const out: TranchePayload[] = [];
  const invalidRows: number[] = [];

  rows.forEach((row, i) => {
    // A blank APR would reach `parseTranches` as Number('') === 0 and save as a real 0% rate — and
    // 0% is a legitimate promo, so the reader cannot tell "unfilled" from "genuinely 0". Blank is
    // rejected here, at the boundary, before it can become a number.
    if (row.apr.trim() === '') { invalidRows.push(i + 1); return; }
    const [parsed] = parseTranches([{
      id: row.id,
      label: row.label.trim() || DEFAULT_TRANCHE_LABEL,
      balance: row.balance,
      apr: row.apr,
      promo_end_date: row.promo_end_date.trim(),
      min_payment: row.min_payment.trim(),
      monthly_fee: row.monthly_fee.trim(),
      fixed_term: row.fixed_term,
    }]);
    if (!parsed) { invalidRows.push(i + 1); return; }
    out.push({
      id: parsed.id,
      label: parsed.label,
      balance: parsed.balance,
      apr: parsed.apr,
      // Absent, not null and not '' — see TranchePayload.
      ...(parsed.promo_end_date ? { promo_end_date: parsed.promo_end_date } : {}),
      ...(parsed.min_payment != null && parsed.min_payment > 0 ? { min_payment: parsed.min_payment } : {}),
      ...(parsed.monthly_fee != null && parsed.monthly_fee > 0 ? { monthly_fee: parsed.monthly_fee } : {}),
      // `false` is the default for every existing row, so writing it would add a key to every
      // tranche on the card for no information. Only `true` is worth storing.
      ...(parsed.fixed_term === true ? { fixed_term: true } : {}),
    });
  });

  return { tranches: out.length > 0 ? out : null, invalidRows };
}

/** Sum of the rows that carry a usable balance. Blank/garbage rows contribute nothing. */
export function trancheRowsTotal(rows: readonly TrancheFormRow[]): number {
  return rows.reduce((sum, row) => {
    const n = Number(row.balance);
    return Number.isFinite(n) && n > 0 ? sum + n : sum;
  }, 0);
}

/**
 * Tranches are SUB-balances of the account balance, so summing past it is a contradiction — but a
 * soft one. It happens honestly mid-edit and again after a payment lands, and the reader
 * (`trancheInterestBreakdown`) already clamps it, so this only ever feeds a note. Null = nothing to
 * say, which includes "no balance typed yet" — a missing balance is not an overage.
 */
export function trancheOverage(
  rows: readonly TrancheFormRow[],
  accountBalance: string,
): { total: number; balance: number } | null {
  const balance = Number(accountBalance);
  if (accountBalance.trim() === '' || !Number.isFinite(balance) || balance <= 0) return null;
  const total = trancheRowsTotal(rows);
  return total > balance ? { total, balance } : null;
}
