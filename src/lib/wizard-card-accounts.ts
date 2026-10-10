/**
 * Cards entered during setup become CREDIT-CARD ACCOUNTS (Sam/Tre, 2026-10-09).
 *
 * WHY: the payoff engine builds cards from `accounts` only (`buildCardData` filters
 * `account_type === 'credit_card'`); the `debts` table is "a separate legacy table for
 * mortgage/auto/student debts" (credit-card-engine.ts). The wizard's Debts step used to write every row
 * to `debts`, so a card entered at setup never produced the "Credit cards paid off" date - the selling
 * point it was entered for. Card rows now become account rows carrying every field the step collects
 * (balance, APR, limit, minimum, due day - the due day was not saved at all before). Loan rows stay
 * `debts` rows, as before.
 *
 * NO DUPLICATES: a card whose name matches an existing credit-card account (trimmed, case-insensitive;
 * e.g. one a bank link just created) is not inserted again. Only the existing account's EMPTY fields
 * are filled; its balance is never touched (a synced balance beats a typed one).
 */
import type { DebtEntry } from '@/components/onboarding/types';

export interface CardAccountInsert {
  name: string;
  account_type: 'credit_card';
  balance: number;
  apr: number | null;
  credit_limit: number | null;
  min_payment: number | null;
  payment_due_day: number | null;
}

export interface ExistingCardAccount {
  id: string;
  name: string;
  apr: number | null;
  credit_limit: number | null;
  min_payment: number | null;
  payment_due_day: number | null;
}

const num = (s: string | undefined): number | null => {
  const n = parseFloat(s ?? '');
  return Number.isFinite(n) ? n : null;
};
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Is this setup row a credit card? The step's own toggle decides. A draft saved before the toggle
 * existed has no `kind`: it counts as a card only when it has a credit limit (loans have none), so an
 * old "Car loan" draft keeps going to `debts` as it always did.
 */
export function isCardEntry(d: Pick<DebtEntry, 'creditLimit'> & { kind?: 'card' | 'loan' }): boolean {
  if (d.kind) return d.kind === 'card';
  return (num(d.creditLimit) ?? 0) > 0;
}

/** A setup card row as an account insert; null without a name and a positive balance. */
export function cardAccountFromEntry(d: DebtEntry): CardAccountInsert | null {
  const name = d.name.trim();
  const balance = num(d.balance);
  if (!name || balance == null || balance <= 0) return null;
  const apr = num(d.apr);
  const limit = num(d.creditLimit);
  const min = num(d.minPayment);
  const due = num(d.dueDate);
  return {
    name,
    account_type: 'credit_card',
    balance: cents(balance),
    // Unknown is null, never 0: a 0% card would rank last under avalanche as if interest-free.
    apr: apr != null && apr >= 0 ? apr : null,
    credit_limit: limit != null && limit > 0 ? cents(limit) : null,
    min_payment: min != null && min > 0 ? cents(min) : null,
    payment_due_day: due != null && Number.isInteger(due) && due >= 1 && due <= 31 ? due : null,
  };
}

const key = (name: string) => name.trim().toLowerCase();

/** What to insert and what to fill in, given the user's existing credit-card accounts. */
export function planCardAccountWrites(
  cards: readonly CardAccountInsert[],
  existing: readonly ExistingCardAccount[],
): { inserts: CardAccountInsert[]; updates: { id: string; patch: Partial<CardAccountInsert> }[] } {
  const byName = new Map(existing.map(e => [key(e.name), e]));
  const seen = new Set<string>();
  const inserts: CardAccountInsert[] = [];
  const updates: { id: string; patch: Partial<CardAccountInsert> }[] = [];
  for (const c of cards) {
    const k = key(c.name);
    if (seen.has(k)) continue; // the same card typed twice is one card
    seen.add(k);
    const match = byName.get(k);
    if (!match) { inserts.push(c); continue; }
    const patch: Partial<CardAccountInsert> = {};
    if (match.apr == null && c.apr != null) patch.apr = c.apr;
    if (match.credit_limit == null && c.credit_limit != null) patch.credit_limit = c.credit_limit;
    if (match.min_payment == null && c.min_payment != null) patch.min_payment = c.min_payment;
    if (match.payment_due_day == null && c.payment_due_day != null) patch.payment_due_day = c.payment_due_day;
    if (Object.keys(patch).length > 0) updates.push({ id: match.id, patch });
  }
  return { inserts, updates };
}
