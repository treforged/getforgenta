/**
 * Seeding `accounts.balance_tranches` from provider data: the mapping, and the rule about when
 * it is allowed to be written at all.
 *
 * Deliberately free of Deno APIs, network calls and environment access so it can be unit tested
 * directly — same reasoning as akoya-normalize.ts: the provider payload shape is the part most
 * likely to surprise us against real institution data.
 *
 * WHAT PLAID GIVES AND WHAT IT DOES NOT.
 * Each entry carries `apr_type` (`purchase_apr`, `balance_transfer_apr`, `cash_apr`, `special`),
 * `apr_percentage`, and `balance_subject_to_apr` — the amount actually sitting at that rate. It
 * does NOT carry a promo END date, and there is no way to derive one. `promo_end_date` is therefore
 * a user-entered field only, and nothing produced here ever sets it: the key is OMITTED, which
 * `parseTranches` reads as null, so a later sync can never clear or overwrite what the user typed.
 *
 * The `purchase_apr` entry is NOT a tranche. It is the account-level standard rate — the rate the
 * remainder pays and the rate a tranche reprices to — and it is already written to `accounts.apr`.
 * Emitting it as a tranche as well would double-count the whole purchase balance.
 */

import type { SeededTranche } from "./types.ts";

export type { SeededTranche };

/** Human labels for the apr_type values Plaid documents. */
const APR_TYPE_LABELS: Record<string, string> = {
  balance_transfer_apr: "Balance transfer",
  cash_apr: "Cash advance",
  special: "Promotional rate",
};

/**
 * A label a person would recognise on their statement.
 *
 * Unknown apr_types are humanised rather than dropped — Plaid's enum has grown before, and a
 * balance sitting at its own rate is worth showing under an imperfect name. It is never shown as
 * a blank label, because parseTranches would silently substitute "Promo balance" for it.
 */
export function trancheLabelForAprType(aprType: string): string {
  const known = APR_TYPE_LABELS[aprType];
  if (known) return known;
  const humanised = aprType
    .replace(/_apr$/i, "")
    .replace(/_/g, " ")
    .trim();
  if (!humanised) return "Promotional rate";
  return humanised.charAt(0).toUpperCase() + humanised.slice(1);
}

/** Plaid sends numerics as numbers, but strings have been seen; both must parse or be rejected. */
function toFiniteNumber(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * The tranches implied by one card's `aprs[]`.
 *
 * An entry becomes a tranche only when it is not the purchase rate, carries a usable
 * `apr_percentage`, AND reports a POSITIVE `balance_subject_to_apr`. That last condition is the
 * important one: most cards return a `balance_transfer_apr` row with a zero or absent balance, and
 * seeding those would litter the card with $0 rows the user then has to delete. An absent balance
 * is not a zero — it is "no reading" — and neither is worth writing.
 *
 * `newId` is injected so tests get deterministic ids; production passes nothing and gets uuids.
 */
export function tranchesFromPlaidAprs(
  aprs: unknown,
  newId: () => string = () => crypto.randomUUID(),
): SeededTranche[] {
  if (!Array.isArray(aprs)) return [];

  const out: SeededTranche[] = [];
  for (const entry of aprs) {
    if (typeof entry !== "object" || entry === null) continue;
    const r = entry as Record<string, unknown>;

    const aprType = typeof r.apr_type === "string" ? r.apr_type : "";
    if (!aprType || aprType === "purchase_apr") continue;

    const apr = toFiniteNumber(r.apr_percentage);
    if (apr == null || apr < 0) continue;

    const balance = toFiniteNumber(r.balance_subject_to_apr);
    if (balance == null || balance <= 0) continue;

    out.push({
      id: newId(),
      label: trancheLabelForAprType(aprType),
      balance,
      apr,
    });
  }
  return out;
}

/**
 * May a sync write this seed onto the account's `balance_tranches`?
 *
 * ONLY when the column is genuinely empty. Tranches are the user's data — a promo end date and a
 * label they typed — and the aggregator has no promo end date to re-supply, so overwriting one
 * destroys information that cannot be recovered from any provider. Refreshing the BALANCE on an
 * existing tranche is a real and wanted thing, and is deliberately NOT done here: it needs a way to
 * match a provider rate to a user's row, which is its own change with its own tests.
 *
 * An `existingRaw` that is neither null nor an array is an unrecognised shape, and the safe reading
 * of "I do not understand what is in this column" is to leave it exactly where it is.
 */
export function shouldSeedTranches(
  existingRaw: unknown,
  seed: readonly SeededTranche[],
): boolean {
  if (seed.length === 0) return false;
  if (existingRaw == null) return true;
  if (!Array.isArray(existingRaw)) return false;
  return existingRaw.length === 0;
}
