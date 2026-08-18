/**
 * The single net-worth definition.
 *
 * Four surfaces used to compute net worth their own way and disagreed with each
 * other on live data:
 *
 *  - the snapshot recorder counted **only** credit cards as liabilities, so an
 *    `auto_loan` account was added to net worth as an *asset*;
 *  - the Dashboard NET WORTH tile counted cc/student/auto/other but not
 *    `mortgage`, and ignored manual asset/liability rows entirely;
 *  - the Dashboard breakdown list *below that tile* counted mortgage and the
 *    manual rows, so the list never summed to the tile above it;
 *  - the Accounts tiles used a third account-type allowlist and were live-only.
 *
 * Everything now goes through {@link buildNetWorthBreakdown}; the totals are a
 * reduction of the very rows that get itemised, so a tile can no longer drift
 * from the list under it.
 *
 * Rules: an account is a liability iff its type is in
 * {@link LIABILITY_ACCOUNT_TYPES}; every other active account is an asset (the
 * historic "everything else is an asset" behavior, kept so an unmapped or new
 * account type is never silently dropped). Inactive accounts count on neither
 * side. Manual rows are added unless their name already matches a live account
 * on the same side, case-insensitively.
 *
 * Widening the liability set is a correction, not a refactor: recorded snapshot
 * history was computed under the old credit-card-only rule, so any user with a
 * loan account will see a step change where the two rules meet.
 *
 * Vehicle loans live in `car_funds`, not in `accounts`, and store no outstanding
 * balance — they are amortized. They are passed in as a fourth input (already
 * amortized, from `getActiveCarLoanPayments`) so that a financed car stops being
 * invisible to net worth. Because the same vehicle is frequently represented
 * twice — once as an `auto_loan` account *or manual liability row* and once as a
 * `car_funds` loan, with *different* balances (the demo RAV4 is $26,500 vs
 * $27,110) — the row the user already maintains wins and the matching
 * `car_funds` loan is dropped.
 *
 * "Matching" is decided two ways, tried in order:
 *
 *  1. `car_funds.linked_loan_account_id`, an explicit FK to the `accounts` row
 *     this loan IS (set from the Vehicles page). When present it is trusted
 *     outright — no name comparison, no fallback — because it is a fact the
 *     user stated, not a guess.
 *  2. {@link sharesDistinctiveToken}, a name-matching heuristic, for rows the
 *     user has not linked. It is strict (two names must share a distinctive
 *     word) because a false positive silently drops real debt from net worth,
 *     but it can still miss real pairs — e.g. "FIXED RATE LOAN" vs "2004
 *     Chevorlet C5" share no token and were double-counted in Tre's own data
 *     until the account was linked explicitly (2026-08-13). That failure mode
 *     is exactly what step 1 exists to close; it is not a hole to patch with a
 *     cleverer heuristic, because there is no name heuristic that cannot be
 *     fooled by an unrelated pair of names that happen to share a word or an
 *     actual pair that happens not to.
 *
 * Snapshot history is deliberately NOT backfilled when linking an account
 * changes what a loan matches (Tre, 2026-08-13, same call as the mortgage
 * widening above): `net_worth_snapshots` is a log of what was actually
 * computed on each date, and every prior surface here has kept that log
 * intact through a rule change rather than rewriting history to what the
 * corrected rule would have produced. The newly-linked pair therefore shows
 * as a real step down in liabilities on the date it was linked — expected,
 * and the same shape of change a user creating any account link produces.
 *
 * Re-checked 2026-08-13 after the link turned out to have been inert for a day,
 * since a day of wrong live numbers is exactly the thing that would reopen it.
 * It does not: `useNetWorthSnapshotRecorder` writes at most one row per seven
 * days, the last row is `2026-08-11` and the next is not due until `2026-08-18`,
 * so **the broken window produced no snapshot rows to correct**. The 08-11 row
 * also predates the link existing in the database at all, making it a faithful
 * record of the pre-link rule rather than a casualty of the bug. Decision stands
 * unchanged, now on evidence rather than on principle alone.
 */

/** Account types that reduce net worth. Everything else is an asset. */
export const LIABILITY_ACCOUNT_TYPES = [
  'credit_card',
  'mortgage',
  'student_loan',
  'auto_loan',
  'other_liability',
] as const;

const LIABILITY_TYPE_SET: ReadonlySet<string> = new Set(LIABILITY_ACCOUNT_TYPES);

export const isLiabilityAccountType = (accountType: string): boolean =>
  LIABILITY_TYPE_SET.has(accountType);

/** Display grouping for the breakdown list, shared with the Accounts labels. */
export const ACCOUNT_TYPE_GROUP: Record<string, string> = {
  checking: 'Checking',
  savings: 'Savings',
  high_yield_savings: 'Savings',
  business_checking: 'Checking',
  cash: 'Cash',
  brokerage: 'Brokerage',
  '401k': 'Retirement',
  roth_ira: 'Retirement',
  ira: 'Retirement',
  hsa: 'Retirement',
  credit_card: 'Credit Card',
  mortgage: 'Mortgage',
  student_loan: 'Student Loan',
  auto_loan: 'Auto Loan',
  other_liability: 'Other Liability',
  other_asset: 'Other Asset',
};

/** Postgres `numeric` columns arrive as strings, so money is widened here. */
type Money = number | string;

export interface NetWorthAccount {
  id?: string;
  name: string;
  account_type: string;
  balance: Money;
  active: boolean;
}

export interface NetWorthManualAsset {
  id?: string;
  name: string;
  type?: string;
  value: Money;
}

export interface NetWorthManualLiability {
  id?: string;
  name: string;
  type?: string;
  balance: Money;
}

export interface NetWorthAssetRow {
  id: string;
  name: string;
  type: string;
  value: number;
  isLive: boolean;
}

export interface NetWorthLiabilityRow {
  id: string;
  name: string;
  type: string;
  balance: number;
  isLive: boolean;
}

/**
 * An amortized vehicle loan. Structurally satisfied by `CarLoanPaymentInfo` from
 * `vehicle-loan-engine`, so callers pass `getActiveCarLoanPayments(carFunds)`
 * straight through — deliberately no adapter, so the liability shown here is the
 * exact number the Vehicles page shows and the two can never drift.
 *
 * Because there is no adapter, every field name here must be spelled exactly as
 * `CarLoanPaymentInfo` spells it, and none of them may be optional. An optional
 * field is structurally satisfied by an object that does not have it at all, so
 * a name that drifts apart compiles clean and reads `undefined` forever — which
 * is precisely what happened to `linkedAccountId` vs `linkedLoanAccountId`
 * (PR #97, merged and inert for a day; fixed 2026-08-13). Required fields make
 * that class of drift a `tsc` error instead.
 */
export interface NetWorthVehicleLoan {
  carFundId: string;
  vehicleName: string;
  remainingBalance: number;
  /** `car_funds.linked_loan_account_id`, when the user explicitly linked this loan to an
   * `accounts` row; `null` when they have not. Preferred over {@link sharesDistinctiveToken} —
   * see buildNetWorthBreakdown. Required, not optional: see the note above. */
  linkedLoanAccountId: string | null;
}

export interface NetWorthBreakdown {
  assets: NetWorthAssetRow[];
  liabilities: NetWorthLiabilityRow[];
}

export interface NetWorthTotals {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

const namesOf = (rows: readonly { name: string }[]): ReadonlySet<string> =>
  new Set(rows.map(r => r.name.toLowerCase()));

/**
 * Words that carry no identity for a vehicle, so they can't be used to decide
 * that two rows describe the same car. Without this, every `auto_loan` account
 * would match every vehicle on the word "loan".
 */
const VEHICLE_NAME_STOPWORDS: ReadonlySet<string> = new Set([
  'auto', 'car', 'loan', 'vehicle', 'owned', 'financed', 'lease', 'leased',
  'payment', 'payments', 'the', 'my', 'and', 'new', 'used',
]);

/**
 * Identity-bearing words in a vehicle or account name: >=3 chars, not a
 * stopword, and containing at least one letter. The letter requirement exists so
 * a model year can't create a match on its own — "2024 Honda Civic" and
 * "Auto Loan - 2024 Toyota" share "2024" and are obviously different cars.
 */
const distinctiveTokens = (name: string): ReadonlySet<string> =>
  new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(t => t.length >= 3 && /[a-z]/.test(t) && !VEHICLE_NAME_STOPWORDS.has(t)),
  );

/**
 * Whether two names plausibly describe the same vehicle, e.g. the account
 * "Auto Loan - RAV4" and the car fund "Toyota RAV4 (Owned)" both reduce to
 * "rav4".
 *
 * Trade-off, deliberately chosen: a false *positive* drops the car_funds loan
 * and net worth is overstated by one vehicle; a false *negative* counts the same
 * car twice and net worth is understated by a whole loan balance. Requiring a
 * shared distinctive token is strict enough that unrelated vehicles don't
 * collide, while still catching the common case where one row is named for the
 * model and the other for the loan.
 */
export const sharesDistinctiveToken = (a: string, b: string): boolean => {
  const tokensB = distinctiveTokens(b);
  for (const token of distinctiveTokens(a)) {
    if (tokensB.has(token)) return true;
  }
  return false;
};

/**
 * Every asset and liability that counts toward net worth, itemised.
 *
 * Manual rows keep their own `type` label; live accounts are grouped through
 * {@link ACCOUNT_TYPE_GROUP}. Ids are namespaced so a live account and a manual
 * row can never collide as React keys.
 */
export function buildNetWorthBreakdown(
  accounts: readonly NetWorthAccount[],
  manualAssets: readonly NetWorthManualAsset[],
  manualLiabilities: readonly NetWorthManualLiability[],
  vehicleLoans: readonly NetWorthVehicleLoan[] = [],
): NetWorthBreakdown {
  const active = accounts.filter(a => a.active);
  const liveAssetAccounts = active.filter(a => !isLiabilityAccountType(a.account_type));
  const liveLiabilityAccounts = active.filter(a => isLiabilityAccountType(a.account_type));

  const liveAssets: NetWorthAssetRow[] = liveAssetAccounts.map(a => ({
    id: `live:${a.id ?? a.name}`,
    name: a.name,
    type: ACCOUNT_TYPE_GROUP[a.account_type] || 'Other',
    value: Number(a.balance || 0),
    isLive: true,
  }));

  const liveLiabilities: NetWorthLiabilityRow[] = liveLiabilityAccounts.map(a => ({
    id: `live:${a.id ?? a.name}`,
    name: a.name,
    type: ACCOUNT_TYPE_GROUP[a.account_type] || 'Other Liability',
    balance: Number(a.balance || 0),
    isLive: true,
  }));

  const liveAssetNames = namesOf(liveAssets);
  const liveLiabilityNames = namesOf(liveLiabilities);

  const manualAssetRows: NetWorthAssetRow[] = manualAssets
    .filter(a => !liveAssetNames.has(a.name.toLowerCase()))
    .map(a => ({
      id: `manual:${a.id ?? a.name}`,
      name: a.name,
      type: a.type || 'Other',
      value: Number(a.value || 0),
      isLive: false,
    }));

  const manualLiabilityRows: NetWorthLiabilityRow[] = manualLiabilities
    .filter(l => !liveLiabilityNames.has(l.name.toLowerCase()))
    .map(l => ({
      id: `manual:${l.id ?? l.name}`,
      name: l.name,
      type: l.type || 'Other Liability',
      balance: Number(l.balance || 0),
      isLive: false,
    }));

  // A row the user already maintains for this vehicle wins, whether it is an
  // `auto_loan` account or a manual liability — the demo RAV4 is the latter, and
  // scoping this to accounts alone silently double-counted it ($26,500 + $27,110
  // = $53,610 of debt for one car). The amortized car_funds loan is therefore
  // only added when the vehicle is not represented anywhere else. Settled loans
  // (remainingBalance <= 0) are dropped outright.
  const existingLiabilityNames = [
    ...liveLiabilityAccounts.filter(a => a.account_type === 'auto_loan').map(a => a.name),
    ...manualLiabilityRows.map(l => l.name),
  ];
  // Only a *live* account can be the other half of an explicit link — an inactive account
  // already counts on neither side, so a car_funds loan linked to one must fall through and be
  // added from here instead of silently vanishing along with it.
  const liveLiabilityAccountIds = new Set(
    liveLiabilityAccounts.map(a => a.id).filter((id): id is string => !!id),
  );

  const vehicleLoanRows: NetWorthLiabilityRow[] = vehicleLoans
    .filter(v => Number(v.remainingBalance) > 0)
    .filter(v =>
      v.linkedLoanAccountId
        ? !liveLiabilityAccountIds.has(v.linkedLoanAccountId)
        : !existingLiabilityNames.some(name => sharesDistinctiveToken(name, v.vehicleName)),
    )
    .map(v => ({
      id: `vehicle:${v.carFundId}`,
      name: v.vehicleName,
      type: ACCOUNT_TYPE_GROUP.auto_loan,
      balance: Number(v.remainingBalance),
      isLive: true,
    }));

  return {
    assets: [...liveAssets, ...manualAssetRows],
    liabilities: [...liveLiabilities, ...vehicleLoanRows, ...manualLiabilityRows],
  };
}

/** Totals over exactly the rows {@link buildNetWorthBreakdown} itemises. */
export function totalsFromBreakdown({ assets, liabilities }: NetWorthBreakdown): NetWorthTotals {
  const totalAssets = assets.reduce((sum, a) => sum + a.value, 0);
  const totalLiabilities = liabilities.reduce((sum, l) => sum + l.balance, 0);
  return { totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities };
}

/**
 * Outstanding debt that is NOT a credit card — loans, mortgages, manual liabilities.
 *
 * Exists so the Dashboard hero can tell "your cards clear in Jul 2028" apart from "you are
 * debt free": the revolving engine projects cards only, and an auto loan running past that
 * date makes the unqualified claim false. Reads the breakdown's own `type`, which is
 * {@link ACCOUNT_TYPE_GROUP}'s label, so a new liability account type is counted here the
 * day it is added rather than being silently treated as a card.
 */
export function nonCardLiabilityTotal({ liabilities }: NetWorthBreakdown): number {
  return liabilities
    .filter(l => l.type !== ACCOUNT_TYPE_GROUP.credit_card)
    .reduce((sum, l) => sum + Math.max(0, l.balance), 0);
}

/** Total assets, liabilities and net worth across live accounts plus manual rows. */
export function aggregateNetWorth(
  accounts: readonly NetWorthAccount[],
  manualAssets: readonly NetWorthManualAsset[],
  manualLiabilities: readonly NetWorthManualLiability[],
  vehicleLoans: readonly NetWorthVehicleLoan[] = [],
): NetWorthTotals {
  return totalsFromBreakdown(
    buildNetWorthBreakdown(accounts, manualAssets, manualLiabilities, vehicleLoans),
  );
}
