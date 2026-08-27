import type { CarFund } from './types';

/**
 * The bank's number wins over the typed one — for a vehicle loan the user has explicitly
 * linked to a live `accounts` row.
 *
 * A `car_funds` loan stores no outstanding balance; it is amortized forward from
 * `loan_amount`, the figure typed at activation. That is the only thing available for an
 * unlinked loan, and it is fine on day one — but nothing ever re-anchors it, so it drifts
 * monotonically away from what is actually owed (Tre's 2004 C5 read ~16,247 against a synced
 * 16,254.49 after a single payment). When the same loan is ALSO tracked as a connected
 * account, that account carries the real outstanding principal, refreshed by Plaid, and there
 * is no reason to prefer the estimate over the fact.
 *
 * The linking rule is deliberately identical to the one `net-worth.ts` already implements —
 * read that file's header (lines ~30-55) before changing anything here. In short:
 *
 *  1. **Only the explicit FK.** `car_funds.linked_loan_account_id` is a fact the user stated.
 *     There is NO name heuristic in this file and there must never be one: net-worth can
 *     afford `sharesDistinctiveToken` because a false positive there merely drops a row from
 *     a total, whereas a false positive here would silently rewrite a loan's balance — and
 *     the pair that motivated all of this ("FIXED RATE LOAN" vs "2004 Chevorlet C5") shares
 *     no token at all, so a heuristic would not have helped anyway.
 *  2. **Only a live account.** An inactive account counts on neither side, exactly as in
 *     net-worth's `liveLiabilityAccountIds`, so a loan linked to a deactivated account must
 *     fall back to its manual amortization rather than lose its balance.
 *
 * A missing/blank/non-finite balance also falls back, for the same reason the app never
 * draws a confident zero: "no reading" is not "$0 owed".
 */

/** The `accounts` shape this resolver needs. Structurally satisfied by the app's account rows
 * and by the demo fixtures; kept minimal so pure tests do not have to build a whole account. */
export interface LinkableLoanAccount {
  id: string;
  balance: number | null;
  active?: boolean | null;
}

/**
 * Today's outstanding principal for `carFund` according to the account it is linked to, or
 * `null` when the manual amortization should stand (unlinked, link target missing, link
 * target inactive, or no usable balance).
 *
 * The returned figure is a positive outstanding principal. Liability balances are stored
 * positive in this app; a negative one is treated as no reading rather than silently
 * sign-flipped, because guessing at a sign convention is how a debt becomes an asset.
 */
export function resolveLinkedLoanBalance(
  carFund: Pick<CarFund, 'linked_loan_account_id'>,
  accounts: readonly LinkableLoanAccount[] | null | undefined,
): number | null {
  const linkedId = carFund.linked_loan_account_id;
  if (!linkedId) return null;

  const account = (accounts ?? []).find(a => a.id === linkedId);
  if (!account) return null;
  // `active` is optional on the input shape but never absent on a real row; an explicit
  // `false` is the only thing that unlinks, so an undefined/null flag reads as live.
  if (account.active === false) return null;

  const balance = Number(account.balance);
  if (!Number.isFinite(balance) || balance <= 0) return null;

  return Math.round(balance * 100) / 100;
}

/**
 * Returns NEW car-fund rows carrying `current_balance_override` where a live linked account
 * supplies one. Applied once, at the data layer (`useCarFunds`), so that every existing
 * consumer of a `CarFund` gets the corrected projection with no signature change and there is
 * exactly one seam where accounts and car funds meet — see the note on
 * `getActiveCarLoanPayments`, which deliberately does NOT take an `accounts` argument because
 * several of its pure callers have no accounts to give.
 */
export function applyLinkedLoanBalances(
  carFunds: readonly CarFund[] | null | undefined,
  accounts: readonly LinkableLoanAccount[] | null | undefined,
): CarFund[] {
  return (carFunds ?? []).map(cf => {
    const resolved = resolveLinkedLoanBalance(cf, accounts);
    return resolved === null ? cf : { ...cf, current_balance_override: resolved };
  });
}

/**
 * The ids of accounts that are the other half of a live vehicle-loan link, i.e. accounts whose
 * balance is already represented by an amortizing car-fund row.
 *
 * ⚠️ The forecast engine drops the ACCOUNT and keeps the CAR FUND — the opposite survivor from
 * `net-worth.ts`, and that is not an inconsistency to "fix". The two agree on the *number*
 * (both read the live balance in month 0). They differ on which row carries it because only
 * the car fund has a rate, a term and a payment: the connected account has `min_payment` null,
 * which is exactly why it renders as a flat line for all 60 months today. Net worth reports a
 * balance as of one instant, so the row the user maintains wins; forecast projects forward, so
 * the row that can move has to be the one that survives.
 *
 * ⚠️ A LINK CLAIMS THE ACCOUNT EVEN WHEN THE BALANCE DOES NOT RESOLVE (2026-08-27). This used to
 * require {@link resolveLinkedLoanBalance} to return a number, so a fund linked to a LIVE account
 * carrying a null, zero or negative balance claimed nothing and the same loan was represented
 * twice. That was nearly invisible while the second representation could only add a row of zeros;
 * it stopped being invisible when `auto_loan` joined `DEBT_SERVICE_ACCOUNT_TYPES`, because the
 * second representation now takes CASH as well. The fund amortizes its own manual `loan_amount`
 * when the balance does not resolve — still the same loan, so the account is still claimed.
 *
 * The account must exist and be live, and that condition is unchanged: a loan linked to a
 * deactivated account falls back to its manual amortization, and the deactivated account is on no
 * forecast surface to double it.
 */
export function linkedLoanAccountIds(
  carFunds: readonly Pick<CarFund, 'linked_loan_account_id'>[] | null | undefined,
  accounts: readonly LinkableLoanAccount[] | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const cf of carFunds ?? []) {
    const linkedId = cf.linked_loan_account_id;
    if (!linkedId) continue;
    const account = (accounts ?? []).find(a => a.id === linkedId);
    if (!account || account.active === false) continue;
    ids.add(linkedId);
  }
  return ids;
}
