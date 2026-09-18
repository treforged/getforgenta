import { Loader2 } from 'lucide-react';
import { ToggleSwitch } from '@/components/shared/ToggleSwitch';
import { useLeaderboardShares } from '@/hooks/useLeaderboardShares';
import { isMetricSourced, type LeaderboardMetric } from '@/lib/leaderboard-metrics';

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
    id: 'achievements',
    label: 'Badges earned',
    shows: 'how many badges you have earned - never which ones you hold',
  },
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
        // ⚠️ A SWITCH NOTHING CAN FILL IS NOT OFFERED. Measured 2026-09-13: Tre had all four on and
        // only two had ever published, because nothing computes the other two. A control that saves
        // a preference the app can never act on is worse than an absent one — it reads as a broken
        // feature rather than an unfinished one, which is exactly how he reported it.
        const sourced = isMetricSourced(m.id);
        return (
          <div
            key={m.id}
            // A test INVENTORIES the rows off this rather than counting switches or re-typing the
            // labels: five switches and five metrics agree just as happily when one is missing and
            // another is drawn twice. On the row rather than on the control, so an assertion can be
            // scoped to one metric's own copy.
            data-metric={m.id}
            className="flex items-start justify-between gap-3 bg-secondary/40 border border-border px-3 py-2.5"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <div className="min-w-0">
              <p className="text-xs font-medium">{m.label}</p>
              <p className="text-xs text-muted-foreground">Friends see {m.shows}.</p>
              {!sourced && (
                <p className="text-xs text-muted-foreground italic mt-0.5">
                  Not ready yet — we are not measuring this one, so it would stay empty.
                </p>
              )}
            </div>
            {/* ⚠️ A SWITCH, NOT A BUTTON (Tre, 2026-09-13): "they are weird to understand as is.
                they dont look like normal buttons." It used to read "Sharing" / "Off" inside a
                bordered box, so knowing what a press would do meant reading the word and then
                deciding whether it described the current state or the action. These are PRIVACY
                controls — they publish his financial progress to another person — so an ambiguous
                state is least affordable here of anywhere in the app.

                The shared `ToggleSwitch` is the same control Notifications already uses, which is
                the point: one implementation, same on every tab. */}
            <div className="flex items-center gap-2 shrink-0">
              {setEnabled.isPending && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
              <ToggleSwitch
                checked={sourced && on}
                disabled={readOnly || !sourced || setEnabled.isPending}
                onPress={() => setEnabled.mutate({ metric: m.id, enabled: !on })}
                // ⚠️ NOT "with followers". Sharing here is governed by `active_friend_ids()`, which
                // requires a MUTUAL follow - somebody who follows you without being followed back
                // sees nothing. On a control that publishes one person's financial progress to
                // another, naming the wrong audience is the expensive kind of wrong.
                label={`Share ${m.label} with people you follow back`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
