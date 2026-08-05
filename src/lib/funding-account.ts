/**
 * Funding-account resolution — the single rule for "which account does cash actually come out of".
 *
 * Finding §2.8 (2026-08-05). The debt funding account is persisted in **localStorage**
 * (`tre:debt:fundingAccount`), not in the data. A localStorage id outlives the thing it names: the
 * account can be deleted or disconnected, and the same key is read in demo mode where it holds a
 * real account's UUID that no demo account has.
 *
 * An unvalidated id is strictly worse than no id. Every downstream consumer asks "is this expense
 * paid from the funding account?" — `otherAccountRuleIds` and `monthlyExpenses` in
 * `useCardProjection.ts`, `getMinSafeCash`, `getPrePaycheckNextMonthBills`. When the id matches
 * nothing, every one of those answers "no", so *all* cash expenses drop out of the engine:
 * month-0 expenses read $0 and the cash floor collapses to its base value, while the balance
 * quietly falls back to total liquid cash and looks fine. Resolving to `null` instead disables the
 * exclusion entirely, which is the safe direction — bills are counted, not silently dropped.
 */

import type { Database } from '@/integrations/supabase/types';

type AccountRow = Database['public']['Tables']['accounts']['Row'];

/** Account types cash can be funded from. Savings/investment/credit accounts are not fundable. */
export const FUNDING_ACCOUNT_TYPES: readonly string[] = ['checking', 'business_checking', 'cash'];

/** True when `id` names an active account of a fundable type in `accounts`. */
export function isUsableFundingAccount(
  accounts: readonly Pick<AccountRow, 'id' | 'active' | 'account_type'>[],
  id: string | null | undefined,
): boolean {
  if (!id) return false;
  return accounts.some(
    a => a.id === id && a.active && FUNDING_ACCOUNT_TYPES.includes(a.account_type as string),
  );
}

/**
 * First candidate id that survives {@link isUsableFundingAccount}, or `null` when none does.
 * Candidates are given in priority order (e.g. persisted choice, then profile default).
 */
export function resolveFundingAccountId(
  accounts: readonly Pick<AccountRow, 'id' | 'active' | 'account_type'>[],
  ...candidates: (string | null | undefined)[]
): string | null {
  for (const id of candidates) {
    if (isUsableFundingAccount(accounts, id)) return id as string;
  }
  return null;
}
