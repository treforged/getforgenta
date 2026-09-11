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

  const { enabled, goals, weeklyNetWorthDeltas, revolvingPeak, revolvingCurrent, budgetCategories } =
    inputs;

  useEffect(() => {
    if (!enabled || isDemo || !user || sharesLoading) return;
    // Nothing opted in: no row, no round trip. This is the common case and must cost nothing.
    if (enabledMetrics.length === 0) return;

    const week = weekStart(new Date());
    const key = `${user.id}:${week}`;
    if (attempted.current === key) return;

    const plan = buildPublishPlan(
      { goals, weeklyNetWorthDeltas, revolvingPeak, revolvingCurrent, budgetCategories },
      enabledMetrics,
      week,
    );
    if (plan.length === 0) return;

    attempted.current = key;

    void (async () => {
      const { error } = await supabase.from('leaderboard_snapshots').upsert(
        plan.map((r) => ({
          user_id: user.id,
          metric: r.metric,
          bucket_value: r.bucketValue,
          week: r.week,
        })),
        { onConflict: 'user_id,metric,week' },
      );
      if (error) {
        // Allow a retry on the next mount rather than staying silent for the rest of the week.
        // Nothing is shown to the user: a friend simply sees last week's row or a private row,
        // both of which are honest. Failing loudly here would interrupt somebody's dashboard over
        // a social feature they may not even have opened.
        attempted.current = null;
        console.warn('leaderboard snapshot publish failed:', error.message);
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
