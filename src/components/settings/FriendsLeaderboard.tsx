import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useFriendLeaderboard } from '@/hooks/useFriendLeaderboard';
import { hasComparableField, isEmptyRoom } from '@/lib/leaderboard-ranking';
import type { LeaderboardFriendInput } from '@/lib/leaderboard-ranking';
import type { LeaderboardMetric } from '@/lib/leaderboard-metrics';

/**
 * The leaderboard itself, inside the Friends card.
 *
 * ⚠️ **THE EMPTY STATE IS THE SCREEN EVERY USER WILL ACTUALLY SEE**, so it is written first and
 * with more care than the ranking. As of 2026-09-11 there are 0 friendships, 0 opt-ins and 0
 * published snapshots across the whole app; a board that treated "nobody is sharing" as an error,
 * or drew an empty table, would be the honest result rendered as a broken one.
 *
 * ⚠️ **RANKS ARE NOT NUMBERED 1, 2, 3.** Buckets are 5% wide, so there are only 21 possible values
 * and ties are the common case rather than the edge case. A numbered list would present whatever
 * order the rows arrived in as if it were a measurement. `buildLeaderboardRows` gives tied rows the
 * same rank and flags them; this component says "tied" out loud.
 *
 * A friend who has not opted this metric in shows as a row reading "Private" - never as 0, and
 * never by being left out, because a shorter list would itself say who is not sharing.
 */

const METRIC_LABELS: Record<LeaderboardMetric, string> = {
  goal_progress: 'Savings goal progress',
  debt_payoff: 'Debt paid down',
  budget_adherence: 'Budget adherence',
  savings_streak: 'Savings streak',
};

function formatValue(metric: LeaderboardMetric, value: number): string {
  if (metric === 'savings_streak') {
    return value === 1 ? '1 week' : `${value} weeks`;
  }
  return `${value}%`;
}

export function FriendsLeaderboard({ friends }: { friends: ReadonlyArray<LeaderboardFriendInput> }) {
  const [metric, setMetric] = useState<LeaderboardMetric>('goal_progress');
  const { rows, loading, error, week } = useFriendLeaderboard(friends, metric);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" /> Loading the leaderboard
      </div>
    );
  }

  if (error) {
    // Not drawn as an empty board: "nobody is sharing" and "we could not read it" are different
    // facts, and showing the first when the second is true is a claim about your friends.
    return (
      <p className="text-xs text-muted-foreground italic">
        Could not load the leaderboard just now.
      </p>
    );
  }

  const comparable = hasComparableField(rows);
  const empty = isEmptyRoom(rows);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(METRIC_LABELS) as LeaderboardMetric[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMetric(m)}
            aria-pressed={m === metric}
            className={`px-2.5 py-1 text-xs font-medium border transition-colors btn-press ${
              m === metric
                ? 'border-primary/40 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary'
            }`}
            style={{ borderRadius: 'var(--radius)' }}
          >
            {METRIC_LABELS[m]}
          </button>
        ))}
      </div>

      {empty && (
        <p className="text-xs text-muted-foreground">
          Nobody is sharing {METRIC_LABELS[metric].toLowerCase()} yet. You each choose which of
          these to share, and none of them is on until you turn it on.
        </p>
      )}

      {!empty &&
        rows.map((row) => (
          <div
            key={row.userId}
            className="flex items-center justify-between gap-3 bg-secondary/40 border border-border px-3 py-2.5"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {/* A position is only shown when there is something to compare against, and a tie
                  says so rather than being silently ordered. */}
              {comparable && row.rank !== null && (
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                  {row.tied ? `=${row.rank}` : row.rank}
                </span>
              )}
              <p className="text-xs font-medium truncate">{row.label}</p>
            </div>
            <span className="text-xs shrink-0">
              {row.state === 'private' && <span className="text-muted-foreground">Private</span>}
              {row.state === 'stale' && (
                <span className="text-muted-foreground">Not updated this week</span>
              )}
              {row.state === 'value' && row.value !== null && (
                <span className="font-medium">
                  {formatValue(metric, row.value)}
                  {row.tied && <span className="text-muted-foreground"> (tied)</span>}
                </span>
              )}
            </span>
          </div>
        ))}

      {!empty && !comparable && (
        <p className="text-xs text-muted-foreground italic">
          Only one of you is sharing this, so there is nothing to compare yet.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Week of {week}. Figures are rounded and update once a week.
      </p>
    </div>
  );
}
