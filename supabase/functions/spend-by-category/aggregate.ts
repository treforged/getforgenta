/**
 * Month-to-date spending by bank category, built from `synced_transactions` rows (ask fbc5671a,
 * for Leo's "how much did I spend on food this month"). Pure, so vitest covers it.
 *
 * The contract agreed with Vera (forged-glass Leo), and it is SEPARATE from money-glance on
 * purpose: Leo's money_glance.py accepts only that endpoint's exact 7 keys.
 *
 *   {month: "YYYY-MM", categories: [{name, spent_cents}], computed_at: "...Z"}
 *
 * - `name` is the bank's category key, upper snake case (Plaid's personal_finance_category
 *   primary, e.g. FOOD_AND_DRINK). FOOD_AND_DRINK holds groceries AND restaurants; the bank does
 *   not separate them, so neither can this.
 * - `spent_cents` is NET: a refund in a category lowers it. A category whose net is zero or less
 *   is left out, so every listed figure is money that actually went out.
 * - Sorted by spent_cents, largest first. Pending rows count (they are real spending), but a
 *   pending row whose posted copy is also present is counted once.
 *
 * What is NOT spending, and why: money moving between the user's own accounts (TRANSFER_IN /
 * TRANSFER_OUT), paying a card or loan (LOAN_PAYMENTS: the purchases on the card are already
 * counted, so counting the payment too would count them twice), borrowing (LOAN_DISBURSEMENTS)
 * and income.
 */

export type SpendRow = {
  amount: number | string | null;
  date: string | null;
  category: string | null;
  pending: boolean | null;
  provider_transaction_id: string | null;
  pending_transaction_id: string | null;
};

export type SpendBody = {
  month: string;
  categories: { name: string; spent_cents: number }[];
  computed_at: string;
};

export const NOT_SPENDING = new Set([
  "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS", "LOAN_DISBURSEMENTS", "INCOME",
  // Legacy Plaid category[0] spellings of the same things.
  "TRANSFER", "PAYMENT",
]);

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" when valid, else null. */
export function parseMonth(raw: string | null | undefined): string | null {
  return raw && MONTH.test(raw) ? raw : null;
}

/** The first day of `month` and the first day of the month after, as YYYY-MM-DD. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

/** Same folding as src/lib/plaid-category-map.ts normalizeProviderCategory. */
export function normalizeCategory(raw: string | null | undefined): string {
  const key = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return key || "OTHER";
}

export function aggregateSpend(rows: SpendRow[], month: string, now: Date): SpendBody {
  const { from, to } = monthRange(month);
  const postedFromPending = new Set(
    rows.filter((r) => !r.pending && r.pending_transaction_id).map((r) => r.pending_transaction_id),
  );
  const cents = new Map<string, number>();
  for (const r of rows) {
    if (!r.date || r.date < from || r.date >= to) continue;
    if (r.pending && r.provider_transaction_id && postedFromPending.has(r.provider_transaction_id)) continue;
    const name = normalizeCategory(r.category);
    if (NOT_SPENDING.has(name)) continue;
    const amount = Number(r.amount);
    if (r.amount === null || !Number.isFinite(amount)) continue;
    // Plaid sign: positive is money out of the account, negative is money in (a refund).
    cents.set(name, (cents.get(name) ?? 0) + Math.round(amount * 100));
  }
  const categories = [...cents.entries()]
    .filter(([, c]) => c > 0)
    .map(([name, spent_cents]) => ({ name, spent_cents }))
    .sort((a, b) => b.spent_cents - a.spent_cents || a.name.localeCompare(b.name));
  return { month, categories, computed_at: now.toISOString() };
}
