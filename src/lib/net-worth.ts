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
 * historic "everything else is an asset" behaviour, kept so an unmapped or new
 * account type is never silently dropped). Inactive accounts count on neither
 * side. Manual rows are added unless their name already matches a live account
 * on the same side, case-insensitively.
 *
 * Widening the liability set is a correction, not a refactor: recorded snapshot
 * history was computed under the old credit-card-only rule, so any user with a
 * loan account will see a step change where the two rules meet.
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

  return {
    assets: [...liveAssets, ...manualAssetRows],
    liabilities: [...liveLiabilities, ...manualLiabilityRows],
  };
}

/** Totals over exactly the rows {@link buildNetWorthBreakdown} itemises. */
export function totalsFromBreakdown({ assets, liabilities }: NetWorthBreakdown): NetWorthTotals {
  const totalAssets = assets.reduce((sum, a) => sum + a.value, 0);
  const totalLiabilities = liabilities.reduce((sum, l) => sum + l.balance, 0);
  return { totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities };
}

/** Total assets, liabilities and net worth across live accounts plus manual rows. */
export function aggregateNetWorth(
  accounts: readonly NetWorthAccount[],
  manualAssets: readonly NetWorthManualAsset[],
  manualLiabilities: readonly NetWorthManualLiability[],
): NetWorthTotals {
  return totalsFromBreakdown(buildNetWorthBreakdown(accounts, manualAssets, manualLiabilities));
}
