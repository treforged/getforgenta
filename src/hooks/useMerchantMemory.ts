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
import {
  deriveMerchantLinks, type MerchantLinkReview, type MerchantLinkRule,
} from '@/lib/merchant-link-memory';

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
  /** Every rule the user's own decisions imply, keyed by normalized merchant. Includes suppressed. */
  rules: Record<string, MerchantRule>;
  /**
   * The RULE each merchant's charges keep getting linked to — the second kind of memory the link
   * path implies, which `rules` structurally cannot hold because a link row may carry no
   * `category_override`. See `merchant-link-memory.ts`. Includes suppressed, same as `rules`.
   */
  linkRules: Record<string, MerchantLinkRule>;
  /** What applying them to the backlog would do right now. */
  pass: RetroPass;
  /**
   * Every review row, keyed by charge. Exposed so a caller can ask what a CHARGE already says
   * rather than inferring it from the rule — the distinction the Settings re-label depends on.
   */
  reviewsByCharge: Record<string, MerchantReview[]>;
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

  // The same rows, read for a different column. Derived here rather than in a second hook so both
  // kinds of memory are computed from ONE pair of queries — a second hook would double the fetch and
  // could show the user two memories that disagree because one had loaded and the other had not.
  const linkReviewsByCharge = useMemo(() => {
    const map: Record<string, MerchantLinkReview[]> = {};
    for (const r of reviews) (map[r.synced_transaction_id] ??= []).push(r);
    return map;
  }, [reviews]);

  const rules = useMemo(() => deriveMerchantRules(synced, reviewsByCharge), [synced, reviewsByCharge]);
  const linkRules = useMemo(
    () => deriveMerchantLinks(synced, linkReviewsByCharge),
    [synced, linkReviewsByCharge],
  );
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
    linkRules,
    pass,
    reviewsByCharge,
    suppressed,
    setSuppressed,
    // Both queries, because a pass that counts 4 and then grows to 181 once the reviews land is
    // wrong in the direction users notice. Same reasoning as the review queue's own isLoading.
    isLoading: loadingSynced || loadingReviews,
  };
}
