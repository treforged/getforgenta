import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { weekStart, type LeaderboardMetric } from '@/lib/leaderboard-metrics';
import {
  buildLeaderboardRows,
  type LeaderboardFriendInput,
  type LeaderboardRow,
} from '@/lib/leaderboard-ranking';

/**
 * Reads friends' published buckets for one metric.
 *
 * **The RLS policy is what makes this safe, not this hook.** `leaderboard_snapshots` only returns a
 * row when the reader is an active friend AND the owner opted that metric in AND the row is for the
 * current week. So a query that asked for everything would still get only what the owner published.
 * The filters below are stated anyway, matching every other read in the app - and because asking
 * for less is cheaper than being refused more.
 *
 * ⚠️ **A FRIEND MISSING FROM THE RESULT IS NOT A FRIEND WITH NOTHING.** They may have opted out,
 * or never published. `buildLeaderboardRows` turns that absence into a `private` ROW rather than a
 * gap, so a shorter list can never leak who is sharing.
 */

export const FRIEND_LEADERBOARD_QUERY_KEY = 'leaderboard_snapshots';

const SNAPSHOT_COLUMNS = 'user_id, metric, bucket_value, week' as const;

export interface FriendLeaderboardState {
  rows: LeaderboardRow[];
  loading: boolean;
  error: Error | null;
  /** The Monday the board is for, so the UI can say which week it is showing. */
  week: string;
}

export function useFriendLeaderboard(
  friends: ReadonlyArray<LeaderboardFriendInput>,
  metric: LeaderboardMetric,
): FriendLeaderboardState {
  const { user } = useAuth();
  const { isDemo } = useDemo();

  // Read once per render pass rather than per row, and keep it out of the query key: a key that
  // changed at midnight on Sunday would refetch every open tab at the same instant.
  const week = useMemo(() => weekStart(new Date()), []);

  const friendIds = useMemo(() => friends.map((f) => f.userId).sort(), [friends]);

  const query = useQuery({
    queryKey: [FRIEND_LEADERBOARD_QUERY_KEY, isDemo ? 'demo' : user?.id, metric, friendIds.join(',')],
    // Nothing to ask for until there is a friendship, so an empty list costs no request.
    enabled: !isDemo && !!user && friendIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leaderboard_snapshots')
        .select(SNAPSHOT_COLUMNS)
        .in('user_id', friendIds)
        .eq('metric', metric);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo(
    () =>
      buildLeaderboardRows(
        friends,
        (query.data ?? []).map((s) => ({
          userId: s.user_id,
          metric: s.metric as LeaderboardMetric,
          bucketValue: s.bucket_value,
          week: s.week,
        })),
        metric,
        week,
      ),
    [friends, query.data, metric, week],
  );

  return {
    rows,
    loading: query.isLoading,
    error: query.error as Error | null,
    week,
  };
}
