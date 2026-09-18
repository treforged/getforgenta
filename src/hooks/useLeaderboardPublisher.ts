import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { weekStart } from '@/lib/leaderboard-metrics';
import { buildPublishPlan, type LeaderboardPublishInputs } from '@/lib/leaderboard-publish';
import { useLeaderboardShares } from './useLeaderboardShares';

/**
 * Writes this week's buckets to `leaderboard_snapshots`.
 *
 * ⚠️ **THE CALLER THAT MAKES THE FEATURE EXIST.** Metrics, ranking and the opt-in switches all
 * shipped before anything wrote a row, so until this hook was mounted a user could switch a metric
 * on and still publish nothing - and the leaderboard would have been permanently empty while
 * looking finished. That is the exact shape `useNotificationCheck`'s own comment was written about,
 * four rows above where this is mounted.
 *
 * **Deliberately thin.** Every decision lives in `leaderboard-publish.ts` as pure functions, so the
 * part that can be wrong is the part that is tested. This hook only supplies the week and performs
 * the write.
 *
 * **Cadence is enforced by the database, not here.** `leaderboard_snapshots` is unique on
 * `(user_id, metric, week)`, so an upsert is idempotent: opening the app five times in a week
 * writes the same row five times and changes nothing a friend sees. There is no scheduling to get
 * wrong, and no timer that a backgrounded tab can miss.
 *
 * **It publishes nothing for a metric whose input is missing** - see `buildPublishPlan`. A zero
 * would land on somebody else's screen, where they cannot tell a real 0 from an unread input.
 */
export function useLeaderboardPublisher(
  inputs: LeaderboardPublishInputs & { enabled: boolean },
): void {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const { enabledMetrics, loading: sharesLoading } = useLeaderboardShares();

  // One write attempt per (user, week) per mount. The upsert is idempotent, so a repeat would be
  // harmless - it would just be a pointless round trip on every dependency change.
  const attempted = useRef<string | null>(null);

  const {
    enabled,
    goals,
    weeklyNetWorthDeltas,
    revolvingPeak,
    revolvingCurrent,
    budgetCategories,
    achievementsEarned,
  } = inputs;

  useEffect(() => {
    if (!enabled || isDemo || !user || sharesLoading) return;
    // Nothing opted in: no row, no round trip. This is the common case and must cost nothing.
    if (enabledMetrics.length === 0) return;

    const week = weekStart(new Date());
    const key = `${user.id}:${week}`;
    if (attempted.current === key) return;

    const plan = buildPublishPlan(
      {
        goals,
        weeklyNetWorthDeltas,
        revolvingPeak,
        revolvingCurrent,
        budgetCategories,
        achievementsEarned,
      },
      enabledMetrics,
      week,
    );
    if (plan.length === 0) return;

    attempted.current = key;

    void (async () => {
      /**
       * ⚠️ UPDATE-THEN-INSERT, NOT UPSERT — THE SAME DEFECT THAT KILLED THE SHARING TOGGLES, ONE
       * TABLE OVER, AND FOUND ONLY BECAUSE THE FIRST ONE WAS CHASED TO ITS CAUSE.
       *
       * `20260826_friend_links.sql` grants `insert (user_id, metric, bucket_value, week,
       * updated_at)` but `update (bucket_value, updated_at)` — the key identifying a row is
       * deliberately not editable. An upsert is INSERT … ON CONFLICT DO UPDATE and PostgREST puts
       * every supplied column into the update, so the conflict path asked to update `user_id`,
       * `metric` and `week` and was refused with `permission denied for table`.
       *
       * Measured 2026-09-13: Tre had a friendship and all four metrics switched on, and
       * `leaderboard_snapshots` held ZERO rows — "the data is not showing on either account, on
       * either side." The toggles were only the first half of that sentence.
       *
       * ⚠️ AND IT FAILED SILENTLY IN THE WORST PLACE. The `console.warn` below is deliberate and
       * stays — a dashboard must not interrupt somebody over a social feature. But it meant a
       * permanently broken publisher looked exactly like a working one with nothing to say.
       * `error.code` is now carried into that line so the next reader sees `42501` rather than a
       * sentence they have to interpret.
       */
      const error = await (async () => {
        const nowIso = new Date().toISOString();
        for (const r of plan) {
          const { data: updated, error: updateError } = await supabase
            .from('leaderboard_snapshots')
            .update({ bucket_value: r.bucketValue, updated_at: nowIso })
            .eq('user_id', user.id)
            .eq('metric', r.metric)
            .eq('week', r.week)
            .select('id');
          if (updateError) return updateError;
          // A row already stood for this (user, metric, week) and now carries the new bucket.
          if ((updated?.length ?? 0) > 0) continue;

          const { error: insertError } = await supabase
            .from('leaderboard_snapshots')
            .insert({
              user_id: user.id,
              metric: r.metric,
              bucket_value: r.bucketValue,
              week: r.week,
              updated_at: nowIso,
            });
          // 23505: another mount inserted it first. The row exists with a value from the same
          // week, which is what this hook was trying to achieve — the idempotence the unique key
          // was chosen for, preserved without the upsert.
          if (insertError && insertError.code !== '23505') return insertError;
        }
        return null;
      })();
      if (error) {
        // Allow a retry on the next mount rather than staying silent for the rest of the week.
        // Nothing is shown to the user: a friend simply sees last week's row or a private row,
        // both of which are honest. Failing loudly here would interrupt somebody's dashboard over
        // a social feature they may not even have opened.
        attempted.current = null;
        console.warn('leaderboard snapshot publish failed:', error.code, error.message);
      }
    })();
  }, [
    enabled,
    isDemo,
    user,
    sharesLoading,
    enabledMetrics,
    goals,
    weeklyNetWorthDeltas,
    revolvingPeak,
    revolvingCurrent,
    budgetCategories,
  ]);
}
