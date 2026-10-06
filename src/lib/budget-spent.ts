import { suggestCategory } from './plaid-category-map';

export interface SpentBankRow {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number | string; // OUTFLOW POSITIVE, inflow negative; may arrive as a numeric string
  category: string | null; // provider primary
  pending?: boolean | null;
}
export interface SpentLedgerRow {
  date: string;
  amount: number | string; // always positive
  category: string;
  type: string; // 'expense' | 'income' | ...
  origin?: string | null; // 'manual' | 'synced' | null
}
export interface MonthSpentInput {
  bank: readonly SpentBankRow[];
  ledger: readonly SpentLedgerRow[];
  from: string; // inclusive YYYY-MM-DD
  to: string; // inclusive YYYY-MM-DD
  matchedCategory: ReadonlyMap<string, string>; // bank row id -> category of the budget rule it paid
  overrides: ReadonlyMap<string, string>; // bank row id -> category the user chose
  transferLegIds: ReadonlySet<string>; // bank row ids that are one half of a move between own accounts
}
export interface MonthSpent {
  totalCents: number;
  byCategory: Readonly<Record<string, number>>; // cents, every value > 0
  countedRows: number;
}
export const NOT_SPENDING_PROVIDER: ReadonlySet<string> = new Set([
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'LOAN_PAYMENTS',
  'INCOME',
]);
// 'Debt Payments' pays down EARLIER spending, so counting it here would count a purchase twice, and the
// plan side (BudgetControl passes fixed + variable rules minus this category) leaves it out to match.
// Measured 2026-10-05: Tre had set a $198.17 loan payment to 'Debt Payments' himself.
export const NOT_SPENDING_CATEGORIES: ReadonlySet<string> = new Set([
  'Debt Payments',
  'Income',
  'Savings',
  'Investing',
]);

export function resolveBankCategory(
  row: SpentBankRow,
  input: Pick<MonthSpentInput, 'matchedCategory' | 'overrides'>,
): string | null {
  const { matchedCategory, overrides } = input;

  const matched = matchedCategory.get(row.id);
  if (matched != null) {
    return matched;
  }

  const overridden = overrides.get(row.id);
  if (overridden != null) {
    return overridden;
  }

  if (row.category) {
    const provider = row.category.toUpperCase().trim();
    if (NOT_SPENDING_PROVIDER.has(provider)) {
      return null;
    }
  }

  return suggestCategory(row.category ?? undefined);
}

export function computeMonthSpent(input: MonthSpentInput): MonthSpent {
  const byMap = new Map<string, number>();
  let countedRows = 0;

  // Helper to safely convert amount to cents
  const toCents = (val: number | string): number => {
    const n = Number(val);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  };

  // Process bank rows
  for (const row of input.bank) {
    if (row.pending === true) continue;
    if (input.transferLegIds.has(row.id)) continue;
    if (row.date < input.from || row.date > input.to) continue;

    const category = resolveBankCategory(row, {
      matchedCategory: input.matchedCategory,
      overrides: input.overrides,
    });
    if (category == null) continue;
    if (NOT_SPENDING_CATEGORIES.has(category)) continue;

    const cents = toCents(row.amount);
    if (cents === 0) continue;

    countedRows++;
    byMap.set(category, (byMap.get(category) ?? 0) + cents);
  }

  // Process ledger rows
  for (const row of input.ledger) {
    if (row.type !== 'expense') continue;
    if (row.origin === 'synced') continue;
    if (NOT_SPENDING_CATEGORIES.has(row.category)) continue;
    if (row.date < input.from || row.date > input.to) continue;

    const cents = toCents(row.amount);
    if (cents === 0) continue;

    countedRows++;
    const absCents = Math.abs(cents);
    byMap.set(row.category, (byMap.get(row.category) ?? 0) + absCents);
  }

  // Build result, dropping non‑positive categories
  const byCategory: Record<string, number> = {};
  let totalCents = 0;

  for (const [cat, val] of byMap.entries()) {
    if (val > 0) {
      byCategory[cat] = val;
      totalCents += val;
    }
  }

  return {
    totalCents,
    byCategory,
    countedRows,
  };
}

/**
 * Planned (rules, this month) beside spent, one row per category. Planned rows lead, largest first;
 * spending with no plan behind it follows, so an unbudgeted category is never hidden.
 */
export interface SpentRow { category: string; plannedCents: number; spentCents: number; }
export function buildSpentRows(planned: readonly { category: string; amount: number }[], spentByCategory: Readonly<Record<string, number>>): { rows: SpentRow[]; plannedCents: number; spentCents: number } {
  const plannedSum = planned.reduce((acc, item) => {
    const n = Number(item.amount);
    const cents = Number.isFinite(n) ? Math.round(n * 100) : 0;
    acc[item.category] = (acc[item.category] || 0) + (cents > 0 ? cents : 0);
    return acc;
  }, {} as Record<string, number>);

  const categories = new Set([...Object.keys(plannedSum), ...Object.keys(spentByCategory)]);
  const rows: SpentRow[] = [];

  for (const category of categories) {
    const plannedCents = plannedSum[category] || 0;
    const spentCents = spentByCategory[category] || 0;
    if (plannedCents > 0 || spentCents > 0) {
      rows.push({ category, plannedCents, spentCents });
    }
  }

  rows.sort((a, b) => {
    const aPlanned = a.plannedCents;
    const bPlanned = b.plannedCents;
    if (aPlanned > 0 && bPlanned > 0) {
      return bPlanned - aPlanned || a.category.localeCompare(b.category);
    }
    if (aPlanned > 0) return -1;
    if (bPlanned > 0) return 1;
    return b.spentCents - a.spentCents || a.category.localeCompare(b.category);
  });

  const totalPlanned = rows.reduce((sum, r) => sum + r.plannedCents, 0);
  const totalSpent = rows.reduce((sum, r) => sum + r.spentCents, 0);
  return { rows, plannedCents: totalPlanned, spentCents: totalSpent };
}
