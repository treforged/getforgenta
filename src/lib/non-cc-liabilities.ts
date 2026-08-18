// Non-credit-card liabilities: ONE projection, read by both the total and the itemised rows.
//
// Why this file exists (2026-08-18). The forecast used to compute the same debt twice from two
// different tables. `totalLiabilityBal` summed the `debts` rows (manual balance, amortized with
// the row's own apr/target_payment) while the month drawer itemised the `accounts` rows (linear,
// `startBalance - payment * i`, no interest). Three ways that diverged, all of them silent:
//
//   1. A liability ACCOUNT with no matching `debts` row was itemised but counted as $0 — the
//      total understated a debt the popup was showing (a Plaid `auto_loan` is exactly this: no
//      `min_payment`, no `debts` row).
//   2. A `debts` row with no matching account was counted but never shown — the total exceeded
//      the sum of its own rows with nothing on screen to explain the gap.
//   3. Even when both existed, the row and the total amortized differently, so they drifted apart
//      month by month.
//
// A total that does not equal the rows under it is the "confident number you cannot stand behind"
// this codebase refuses to print, so both now come from `buildNonCCLiabilities` and reconcile by
// construction.
//
// The account wins the balance when a pair exists — Tre, 2026-08-18: "if an account is connected
// the manual amount should be disregarded and not used." The `debts` row still supplies the apr
// and the target payment, because only it has them.
//
// Vehicle loans linked to an account stay OUT of both halves: `car_funds` carries that row (see
// `vehicle-loan-link.ts` for why the car fund is the survivor there and the account is the
// survivor in `net-worth.ts`).

export interface LiabilityAccountInput {
  id: string;
  name: string;
  account_type: string;
  balance: number | null;
}

export interface LiabilityDebtInput {
  id?: string | null;
  name: string;
  balance: number | null;
  apr?: number | null;
  target_payment?: number | null;
}

export interface NonCCLiabilityRow {
  id: string;
  name: string;
  account_type: string;
  /** Opening balance for each projected month; index 0 is the current month. */
  balances: number[];
}

export interface NonCCLiabilities {
  rows: NonCCLiabilityRow[];
  /** Sum of every row's balance, per month. Equals the rows by construction. */
  totalByMonth: number[];
}

const norm = (name: string | null | undefined): string => (name ?? '').trim().toLowerCase();

/** Opening balances for `months` months, amortized at apr with a fixed payment. */
function projectBalances(start: number, apr: number, payment: number, months: number): number[] {
  const monthlyRate = (Number(apr) || 0) / 1200;
  const pay = Number(payment) || 0;
  const out = new Array<number>(months).fill(0);
  let bal = Number.isFinite(start) ? start : 0;
  for (let m = 0; m < months; m++) {
    out[m] = Math.max(0, bal);
    bal = monthlyRate > 0
      ? Math.max(0, bal * (1 + monthlyRate) - pay)
      : Math.max(0, bal - pay);
  }
  return out;
}

/**
 * One row per real non-CC liability, and the total that sums exactly those rows.
 *
 * @param accounts    Active liability accounts, credit cards already removed.
 * @param debts       Raw `debts` rows (apr / target_payment live here).
 * @param creditCardAccountNames Names of credit-card accounts — a `debts` row mirroring one of
 *                    them belongs to the card projection, not here.
 * @param excludedAccountIds Accounts a `car_funds` loan is linked to; the car fund carries them.
 */
export function buildNonCCLiabilities(params: {
  accounts: LiabilityAccountInput[];
  debts: LiabilityDebtInput[];
  creditCardAccountNames?: string[];
  excludedAccountIds?: Set<string>;
  months: number;
}): NonCCLiabilities {
  const { accounts, debts, months } = params;
  const excludedIds = params.excludedAccountIds ?? new Set<string>();
  const ccNames = new Set((params.creditCardAccountNames ?? []).map(norm));
  const excludedNames = new Set(
    accounts.filter(a => excludedIds.has(a.id)).map(a => norm(a.name)),
  );

  const rows: NonCCLiabilityRow[] = [];
  const claimedDebts = new Set<LiabilityDebtInput>();

  for (const a of accounts) {
    if (excludedIds.has(a.id)) continue;
    const matched = debts.find(d => !claimedDebts.has(d) && norm(d.name) === norm(a.name));
    if (matched) claimedDebts.add(matched);
    rows.push({
      id: a.id,
      name: a.name,
      account_type: a.account_type,
      // The connected account's balance is the truth; the debts row only lends apr/payment.
      balances: projectBalances(
        Number(a.balance) || 0,
        Number(matched?.apr ?? 0),
        Number(matched?.target_payment ?? 0),
        months,
      ),
    });
  }

  for (const d of debts) {
    if (claimedDebts.has(d)) continue;
    const n = norm(d.name);
    // A debt named after a credit card is the card's; a debt named after a linked vehicle-loan
    // account is the car fund's. Neither is a row this file may invent.
    if (ccNames.has(n) || excludedNames.has(n)) continue;
    rows.push({
      id: `debt:${d.id ?? n}`,
      name: d.name,
      account_type: 'other_liability',
      balances: projectBalances(
        Number(d.balance) || 0,
        Number(d.apr ?? 0),
        Number(d.target_payment ?? 0),
        months,
      ),
    });
  }

  const totalByMonth = new Array<number>(months).fill(0);
  for (const r of rows) {
    for (let m = 0; m < months; m++) totalByMonth[m] += r.balances[m];
  }

  return { rows, totalByMonth };
}
