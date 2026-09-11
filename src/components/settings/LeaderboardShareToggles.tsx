import { Loader2 } from 'lucide-react';
import { useLeaderboardShares } from '@/hooks/useLeaderboardShares';
import type { LeaderboardMetric } from '@/lib/leaderboard-metrics';

/**
 * The per-metric sharing switches, rendered inside the Friends card.
 *
 * ⚠️ **EVERY SWITCH IS OFF UNTIL IT IS TURNED ON, IN THE DATABASE AND NOT ONLY HERE.** No row in
 * `leaderboard_shares` means share nothing, so a user who never opens this list shares nothing
 * even though they have friends. That is the intended default and the copy says so, because a
 * privacy default nobody can see is one nobody trusts.
 *
 * The copy on each row states what a friend would actually see - a rounded band, never an amount -
 * because "share my goal progress" reads to most people like sharing the goal.
 *
 * Only rendered when the user has at least one friend: switches that publish to nobody are a
 * control that appears to do nothing, which is the failure this repo keeps cataloguing.
 */

const METRICS: ReadonlyArray<{ id: LeaderboardMetric; label: string; shows: string }> = [
  {
    id: 'goal_progress',
    label: 'Savings goal progress',
    shows: 'how far along your best goal is, to the nearest 5% - never the goal or the amount',
  },
  {
    id: 'debt_payoff',
    label: 'Debt paid down',
    shows: 'the share of your highest balance you have cleared, to the nearest 5% - never a balance',
  },
  {
    id: 'budget_adherence',
    label: 'Budget adherence',
    shows: 'how many of your categories are on budget this month, to the nearest 5% - never which',
  },
  {
    id: 'savings_streak',
    label: 'Savings streak',
    shows: 'the number of weeks running your net worth has not fallen - never the figure',
  },
];

export function LeaderboardShareToggles({ readOnly = false }: { readOnly?: boolean }) {
  const { loading, error, isEnabled, setEnabled } = useLeaderboardShares();

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" /> Loading sharing settings
      </div>
    );
  }

  if (error) {
    // Said out loud rather than swallowed: a switch whose real state could not be read must not be
    // drawn in the off position, because that would claim nothing is being shared.
    return (
      <p className="text-xs text-muted-foreground italic">
        Could not load your sharing settings, so they are not shown. Nothing changed.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Everything here is off until you turn it on. Friends never see an amount, a balance, an
        account or a transaction - only a rounded band, updated once a week.
      </p>
      {METRICS.map((m) => {
        const on = isEnabled(m.id);
        return (
          <div
            key={m.id}
            className="flex items-start justify-between gap-3 bg-secondary/40 border border-border px-3 py-2.5"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <div className="min-w-0">
              <p className="text-xs font-medium">{m.label}</p>
              <p className="text-xs text-muted-foreground">Friends see {m.shows}.</p>
            </div>
            <button
              type="button"
              disabled={readOnly || setEnabled.isPending}
              aria-pressed={on}
              aria-label={`${on ? 'Stop sharing' : 'Share'} ${m.label}`}
              onClick={() => setEnabled.mutate({ metric: m.id, enabled: !on })}
              style={{ borderRadius: 'var(--radius)' }}
              className={`px-2.5 py-1 text-xs font-medium border transition-colors btn-press shrink-0 disabled:opacity-50 ${
                on
                  ? 'border-primary/40 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary'
              }`}
            >
              {setEnabled.isPending ? (
                <Loader2 size={10} className="animate-spin" />
              ) : on ? (
                'Sharing'
              ) : (
                'Off'
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
