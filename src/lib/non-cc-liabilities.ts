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
//
// 2026-08-24 — the CASH half joins the balance half. `buildNonCCLiabilities` amortizes a balance
// as if a payment were being made, but until now the only non-CC payment that actually LEFT
// projected cash was a mortgage's, hard-coded in two places. A student loan therefore paid itself
// down out of thin air: the balance fell every month and the cash never did.
// {@link sumOtherDebtPayments} is the cash half, and it is ONE function called from both the
// forecast engine and `useCardProjection` precisely because the two previously carried copies of
// the mortgage-only version that had to be kept in lockstep by hand.

import { LIABILITY_ACCOUNT_TYPES } from './net-worth';

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
  /** Read only by {@link sumOtherDebtPayments}, as the fallback when no target is set. */
  min_payment?: number | null;
}

/** The `accounts` shape the cash half needs — no balance, since it only decides who pays. */
export interface DebtServiceAccountInput {
  id: string;
  name: string;
  account_type: string;
  active?: boolean | null;
}

/** The `recurring_rules` shape the dedupe rule below needs. */
export interface DebtServiceRuleInput {
  name: string;
  rule_type: string;
  active: boolean;
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

/**
 * Account types whose paired `debts` row also supplies a monthly CASH payment.
 *
 * Derived from `net-worth.ts`'s single source of truth so a liability type added there is debt-
 * serviced here the same day, minus the two whose payment is owned elsewhere: `credit_card` (the
 * revolving engine decides those) and `auto_loan` (a `car_funds` row carries the payment — see
 * the header note about vehicle loans staying out of both halves).
 */
const DEBT_SERVICE_ACCOUNT_TYPES: ReadonlySet<string> = new Set(
  LIABILITY_ACCOUNT_TYPES.filter(t => t !== 'credit_card' && t !== 'auto_loan'),
);

/**
 * This month's cash going out to non-credit-card debt: the `debts` row paired to each active
 * mortgage / student-loan / other-liability ACCOUNT, at `target_payment` (falling back to
 * `min_payment`).
 *
 * ══ THE DEDUPE RULE ══
 * A debt can be described twice in this app: as a `debts` row (which carries the apr and the
 * payment, and is what amortizes the balance) and as a recurring EXPENSE RULE the user set up to
 * pay the same bill. The rule is already inside `baseExpenses`, so counting the `debts` row too
 * subtracts the same dollars twice.
 *
 * So: when an ACTIVE expense rule's name matches the paired debt/account name — trimmed,
 * case-insensitively — the RULE is the cash side and this function contributes nothing for that
 * debt; the `debts` row still amortizes the balance in `buildNonCCLiabilities`. With no such rule
 * the `debts` row is the cash side as well as the balance side. Either way the payment leaves
 * projected cash exactly once, and the balance falls exactly once.
 *
 * That rule is also the fix for a mortgage: the mortgage-only predecessor of this function had no
 * dedupe at all, so a user with both a mortgage account+debts row and a "Mortgage" expense rule
 * had the payment taken out of projected cash twice.
 *
 * @param accounts Raw account rows; inactive ones and non-debt-serviced types are dropped here.
 * @param debts    Raw `debts` rows. Pairing is by name, one row per account, exactly as
 *                 {@link buildNonCCLiabilities} pairs them, so the two halves agree on which row
 *                 belongs to which account.
 * @param rules    Raw `recurring_rules` rows; only active `expense` ones are consulted.
 * @param excludedAccountIds Accounts a `car_funds` loan is linked to; the car fund pays them.
 */
export function sumOtherDebtPayments(params: {
  accounts: readonly DebtServiceAccountInput[];
  debts: readonly LiabilityDebtInput[];
  rules: readonly DebtServiceRuleInput[];
  excludedAccountIds?: ReadonlySet<string>;
}): number {
  const { accounts, debts, rules } = params;
  const excludedIds = params.excludedAccountIds ?? new Set<string>();
  const expenseRuleNames = new Set(
    rules.filter(r => r.active && r.rule_type === 'expense').map(r => norm(r.name)),
  );

  const claimedDebts = new Set<LiabilityDebtInput>();
  let total = 0;
  for (const a of accounts) {
    if (a.active === false) continue;
    if (!DEBT_SERVICE_ACCOUNT_TYPES.has(a.account_type)) continue;
    if (excludedIds.has(a.id)) continue;
    const n = norm(a.name);
    const matched = debts.find(d => !claimedDebts.has(d) && norm(d.name) === n);
    if (!matched) continue;
    claimedDebts.add(matched);
    if (expenseRuleNames.has(n)) continue;
    total += Number(matched.target_payment || matched.min_payment || 0);
  }
  return total;
}
