// Where you stand against everyone who opted in — as a percentage, never as a list of people.
//
// Tre, 2026-09-13: "I did talk to Sam about a global slash, uh, country based leaderboard and all
// that... I did want that processed again whenever you get the chance." And the constraint he gave
// in the same breath: "Make sure it's secure, and nobody else can just really gonna be accessed
// anybody's else as, like, information or universal status."
//
// ⚠️ THE CLIENT CANNOT READ ANOTHER USER'S ROW HERE, BY CONSTRUCTION RATHER THAN BY POLITENESS.
// This calls one SECURITY DEFINER function (`20260913_leaderboard_global_stats.sql`) that returns
// counts and percentages only. No RLS policy was widened, no extra row was granted, and there is no
// query in this file against `leaderboard_snapshots` at all. If someone later wants a named global
// board, that is a new design decision and not a small edit to this hook.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import type { LeaderboardMetric } from '@/lib/leaderboard-metrics';

/**
 * Which cohort a standing is measured against.
 *
 * ⚠️ THE SERVER REFUSES ANYTHING ELSE RATHER THAN FALLING BACK TO 'global', and this type exists so
 * the client cannot casually send a third value. A scope that quietly widens would put a heading
 * saying "your country" over a number that is not about their country, and nothing on screen would
 * ever reveal the substitution.
 */
export type LeaderboardScope = 'global' | 'country';

export interface GlobalStanding {
  /** How many people opted this metric in AND have a bucket this week. */
  cohortSize: number;
  /** How many are needed before any statistic is shown at all. */
  minCohort: number;
  /** The caller's own bucket, or null when they are not participating. Already theirs. */
  yourBucket: number | null;
  /**
   * Share of the cohort strictly below the caller, 0-100, or null when the cohort is too small.
   *
   * ⚠️ NULL MEANS "NOT ENOUGH PEOPLE", NEVER "YOU ARE LAST". A caller that renders null as 0 would
   * turn a privacy floor into a demoralising score, which is the exact shape of confident-zero
   * failure this codebase keeps finding.
   */
  betterThanPct: number | null;
  /** The cohort's median band, or null below the floor. */
  medianBucket: number | null;
}

/** True when the cohort is large enough for the server to have returned any statistic. */
export function hasEnoughPeople(s: GlobalStanding | null | undefined): boolean {
  return !!s && s.betterThanPct !== null;
}

export function useGlobalLeaderboard(metric: LeaderboardMetric, scope: LeaderboardScope = 'global') {
  const { user } = useAuth();
  const { isDemo } = useDemo();

  return useQuery({
    // Demo serves no global standing: every figure behind it would be fabricated, and unlike the
    // fixture feeds elsewhere this one would be a claim about OTHER REAL PEOPLE.
    enabled: !isDemo && !!user,
    // ⚠️ `scope` IS IN THE KEY. Without it, switching Global -> Your country would re-render the
    // PREVIOUS cohort's numbers under the new heading until the refetch landed — a cached global
    // percentage labelled as a country one, which is the same lie as a silently widened scope.
    queryKey: ['leaderboard_global_stats', user?.id, metric, scope],
    queryFn: async (): Promise<GlobalStanding | null> => {
      const { data, error } = await supabase.rpc('leaderboard_global_stats', {
        p_metric: metric,
        p_scope: scope,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;
      return {
        cohortSize: Number(row.cohort_size ?? 0),
        minCohort: Number(row.min_cohort ?? 0),
        yourBucket: row.your_bucket === null || row.your_bucket === undefined ? null : Number(row.your_bucket),
        betterThanPct:
          row.better_than_pct === null || row.better_than_pct === undefined ? null : Number(row.better_than_pct),
        medianBucket:
          row.median_bucket === null || row.median_bucket === undefined ? null : Number(row.median_bucket),
      };
    },
  });
}
