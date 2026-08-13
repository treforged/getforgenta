// §1B Stage 7A — merchant memory, joined to the app's data. The rules themselves are pure
// (`@/lib/merchant-memory`); this only supplies the rows and remembers what the user switched off.
//
// ⚠️ SUPPRESSION IS THE ONE THING NOT DERIVABLE FROM THE DATABASE, so it is the one thing stored
// locally. A rule IS the user's recorded `category_override`, read back by merchant — so "remember
// this merchant" needs no storage at all. "STOP remembering it" has no such record: the decisions
// that formed the rule are still there and still correct about the charges they were made on. The
// only truthful ways to express it are a new table (a migration, forbidden here — see `AGENT.md`)
// or a local preference, and a local preference is what this is. Consequences, stated rather than
// hidden: it is PER DEVICE, and it survives a reload but not a different browser. The same trade
// `useDismissedDuplicates` already makes, for the same reason.
import { useCallback, useMemo, useState } from 'react';
import { useAllSyncedTransactions, useSyncedTransactionReviewsQuery } from '@/hooks/useSupabaseData';
import {
  deriveMerchantRules, planRetroactivePass, type MerchantReview, type MerchantRule, type RetroPass,
} from '@/lib/merchant-memory';

const STORAGE_KEY = 'forgenta.merchantMemory.suppressed.v1';

function readSuppressed(): Record<string, true> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, true> = {};
    for (const key of Object.keys(parsed as Record<string, unknown>)) out[key] = true;
    return out;
  } catch {
    // A corrupt or unavailable store must not take the page down with it. Remembering every
    // merchant is the safe direction to fail: the user sees suggestions they can still undo, rather
    // than a blank page.
    return {};
  }
}

export interface MerchantMemory {
  /** Every rule the user's own decisions imply, keyed by normalised merchant. Includes suppressed. */
  rules: Record<string, MerchantRule>;
  /** What applying them to the backlog would do right now. */
  pass: RetroPass;
  suppressed: Record<string, true>;
  setSuppressed: (key: string, off: boolean) => void;
  isLoading: boolean;
}

export function useMerchantMemory(): MerchantMemory {
  const { data: synced = [], isLoading: loadingSynced } = useAllSyncedTransactions();
  const { data: reviews = [], isLoading: loadingReviews } = useSyncedTransactionReviewsQuery();
  const [suppressed, setSuppressedState] = useState<Record<string, true>>(readSuppressed);

  const reviewsByCharge = useMemo(() => {
    const map: Record<string, MerchantReview[]> = {};
    for (const r of reviews) (map[r.synced_transaction_id] ??= []).push(r);
    return map;
  }, [reviews]);

  const rules = useMemo(() => deriveMerchantRules(synced, reviewsByCharge), [synced, reviewsByCharge]);
  const pass = useMemo(
    () => planRetroactivePass(synced, reviewsByCharge, rules, suppressed),
    [synced, reviewsByCharge, rules, suppressed],
  );

  const setSuppressed = useCallback((key: string, off: boolean) => {
    setSuppressedState(current => {
      const next = { ...current };
      if (off) next[key] = true; else delete next[key];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* see readSuppressed */ }
      return next;
    });
  }, []);

  return {
    rules,
    pass,
    suppressed,
    setSuppressed,
    // Both queries, because a pass that counts 4 and then grows to 181 once the reviews land is
    // wrong in the direction users notice. Same reasoning as the review queue's own isLoading.
    isLoading: loadingSynced || loadingReviews,
  };
}
