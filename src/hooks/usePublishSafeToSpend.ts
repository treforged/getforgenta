import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { SafeToSpendResult } from '@/lib/safe-to-spend';
import { SETTLE_MS, shouldWrite, snapshotKey, toSnapshotRow } from '@/lib/safe-to-spend-snapshot';

/**
 * Publishes the dashboard's Safe to Spend figure for Leo (see `src/lib/safe-to-spend-snapshot.ts`
 * for when and why). Fire-and-forget: a failed write is logged and retried on the next change,
 * and never touches what the user sees.
 *
 * The effect is keyed on the figure's CONTENT, not on the result object: the object is rebuilt on
 * many renders with the same numbers, and keying on identity would restart the settle timer each time.
 */
export function usePublishSafeToSpend(args: {
  result: SafeToSpendResult | null;
  userId: string | null | undefined;
  /** Demo or partner view: the figure on screen is not this user's own. */
  disabled: boolean;
}): void {
  const { result, userId, disabled } = args;
  const last = useRef<{ key: string; at: number } | null>(null);
  const probe = toSnapshotRow(result, userId, new Date(0));
  const contentKey = disabled || !probe ? null : snapshotKey(probe);
  const latest = useRef({ result, userId });
  // Updated after every commit (never during render), so the timer always reads the newest figure.
  useEffect(() => { latest.current = { result, userId }; });

  useEffect(() => {
    if (contentKey === null) return;
    // Wait for the figure to settle: any change before SETTLE_MS cancels this write.
    const timer = window.setTimeout(() => {
      const now = new Date();
      const row = toSnapshotRow(latest.current.result, latest.current.userId, now);
      if (!row || !shouldWrite(row, last.current, now.getTime())) return;
      last.current = { key: snapshotKey(row), at: now.getTime() };
      void supabase
        .from('safe_to_spend_snapshot')
        .upsert(row, { onConflict: 'user_id' })
        .then(({ error }) => {
          if (error) {
            console.warn('[safe-to-spend] snapshot write failed:', error.code ?? error.message);
            last.current = null;
          }
        });
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [contentKey]);
}
