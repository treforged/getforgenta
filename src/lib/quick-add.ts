/**
 * QUICK ADD — the pure half of the bottom-bar `+` sheet (ask 661548f5).
 *
 * Tre pointed at Fincend: a saved $36 groceries expense in 5 taps (`+`, Groceries, 3, 6, "Add $36").
 * Ours was 7 taps + 2 keystrokes from the Transactions tab, and none from Home
 * (docs/quick-add-comparison-2026-10-07.md). The sheet lives in `QuickAddSheet.tsx`; everything it
 * DECIDES lives here so the rules are tested without a DOM.
 */
import { CATEGORIES, type Category } from '@/lib/types';

/** Whole-dollar digits allowed before the decimal point. $9,999,999.99 is plenty for one entry. */
export const QUICK_ADD_MAX_INT_DIGITS = 7;

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back';

/**
 * One key press on the in-sheet keypad, as a STRING, never a number: "3." and "3.0" are real
 * intermediate states a float would collapse, and the user would watch their decimal point vanish.
 * Rules: no leading zeros ("05" -> "5"), one decimal point, at most two decimals, and a press that
 * would break a rule is ignored rather than rewriting what is already there.
 */
export function pressKeypad(amount: string, key: KeypadKey): string {
  if (key === 'back') return amount.slice(0, -1);
  const [whole, frac] = amount.split('.');
  if (key === '.') {
    if (amount.includes('.')) return amount;
    return amount === '' ? '0.' : `${amount}.`;
  }
  if (frac !== undefined) return frac.length >= 2 ? amount : `${amount}${key}`;
  if (whole === '0') return key;
  if (whole.length >= QUICK_ADD_MAX_INT_DIGITS) return amount;
  return `${amount}${key}`;
}

/** The keypad string as dollars. "" and "0." are 0, which the save button refuses. */
export function keypadValue(amount: string): number {
  const n = parseFloat(amount);
  return Number.isFinite(n) ? n : 0;
}

/**
 * What the hero shows while typing. Grouped whole part, and the decimals exactly as typed, so
 * "1234.5" reads "$1,234.5" until the next digit rather than jumping to "$1,234.50".
 */
export function formatKeypadAmount(amount: string): string {
  if (amount === '') return '$0';
  const [whole, frac] = amount.split('.');
  const grouped = Number(whole || '0').toLocaleString('en-US', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
  return frac === undefined ? `$${grouped}` : `$${grouped}.${frac}`;
}

/** The save button's label, Fincend's convention: it says the amount ("Add $36", "Add $4.50"). */
export function quickAddSaveLabel(amount: string): string {
  const v = keypadValue(amount);
  if (v <= 0) return 'Add';
  const cents = Math.round(v * 100) % 100 !== 0;
  return `Add ${v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;
}

/** Shown before the user has any history: the everyday categories, in the picker's own order. */
export const DEFAULT_EXPENSE_CHIPS: readonly Category[] = ['Groceries', 'Dining', 'Gas', 'Shopping', 'Bills'];

interface CategorisedRow {
  type: string;
  category: string;
  date: string;
  created_at?: string | null;
}

const KNOWN = new Set<string>(CATEGORIES);

/**
 * The chip row: the user's most-used EXPENSE categories (count, then most recent, then name), topped
 * up from the defaults so there are always `n` chips. Only categories the app knows: a stray string
 * in an old row must not become a chip that saves an unknown category. Income and Other are never
 * chips: income has its own toggle, and Other is the fallback rather than an answer.
 */
export function topExpenseCategories(rows: readonly CategorisedRow[], n = 5): Category[] {
  const stats = new Map<string, { count: number; last: string }>();
  for (const r of rows) {
    if (r.type !== 'expense' || !KNOWN.has(r.category) || r.category === 'Income' || r.category === 'Other') continue;
    const s = stats.get(r.category) ?? { count: 0, last: '' };
    s.count += 1;
    if (r.date > s.last) s.last = r.date;
    stats.set(r.category, s);
  }
  const ranked = [...stats.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].last.localeCompare(a[1].last) || a[0].localeCompare(b[0]))
    .map(([c]) => c as Category);
  for (const d of DEFAULT_EXPENSE_CHIPS) if (!ranked.includes(d)) ranked.push(d);
  return ranked.slice(0, n);
}

/**
 * The chip that starts selected: the category of the most recently ENTERED expense, but only when it
 * is one of the chips on screen, so the selection is always visible. null otherwise, and a save with
 * nothing selected files under Other — the same default the full form starts on.
 */
export function lastUsedChip(rows: readonly CategorisedRow[], chips: readonly string[]): string | null {
  let best: CategorisedRow | null = null;
  for (const r of rows) {
    if (r.type !== 'expense') continue;
    if (!best || (r.created_at ?? r.date) > (best.created_at ?? best.date)) best = r;
  }
  return best && chips.includes(best.category) ? best.category : null;
}

interface SourcedRow {
  type: string;
  date: string;
  created_at?: string | null;
  payment_source?: string | null;
}

/**
 * The account the sheet starts on: the payment source of the user's most recently ENTERED expense,
 * when it is still one of the options on offer (a deleted card must not come back as the default).
 * Otherwise '' — the same "unassigned" the full form starts on.
 */
export function lastUsedPaymentSource(rows: readonly SourcedRow[], options: readonly { value: string }[]): string {
  const valid = new Set(options.map(o => o.value));
  let best: SourcedRow | null = null;
  for (const r of rows) {
    if (r.type !== 'expense' || !r.payment_source || !valid.has(r.payment_source)) continue;
    if (!best || (r.created_at ?? r.date) > (best.created_at ?? best.date)) best = r;
  }
  return best?.payment_source ?? '';
}

export interface QuickAddDraft {
  type: 'expense' | 'income';
  amount: string;
  category: string;
  date: string;
  paymentSource: string;
  note: string;
}

/**
 * The row the sheet writes — the SAME shape the full Add Transaction form writes for a one-off
 * (`Transactions.tsx` handleSave), so a quick-added row is indistinguishable from a long-form one.
 * Income always saves as category Income, which is what the full form's picker leads with.
 * Returns null for anything the save button should not have allowed.
 */
export function quickAddPayload(d: QuickAddDraft) {
  const amount = Math.round(keypadValue(d.amount) * 100) / 100;
  if (!(amount > 0)) return null;
  const category = d.type === 'income' ? 'Income' : d.category;
  if (!KNOWN.has(category)) return null;
  return {
    date: d.date,
    type: d.type,
    amount,
    category,
    account: 'Checking',
    note: d.note || 'Transaction',
    payment_source: d.paymentSource,
  };
}

/**
 * Whether quick add ADDS (true) or is a Premium door (false). Free on web, gated in the native app
 * (Tre, 2026-10-09). Used by first-run copy that describes the `+`, so a pointer never promises a
 * press that lands on /premium. It is the SAME rule as `QuickAddContext`'s `canQuickAdd` and as
 * `canAddTransactions` on claude/add-tx-free-web; once that branch is on main, fold this into it
 * (the provider was left untouched here so the two branches do not conflict).
 */
export function quickAddIsOpen(o: { isPremium: boolean; isDemo: boolean; native: boolean }): boolean {
  return o.isPremium || o.isDemo || !o.native;
}
