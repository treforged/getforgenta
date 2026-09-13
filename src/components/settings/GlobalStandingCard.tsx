// "How am I doing against everyone else?" — answered as a percentage, or answered honestly as
// "not enough people yet".
//
// ⚠️ THE EMPTY STATE IS THE FEATURE TODAY, NOT A PLACEHOLDER. Measured 2026-09-13: 49 accounts
// exist and exactly ONE has opted any metric in. With a cohort of one, a median IS that person's
// own number and "better than 0%" names them. So this card will say "not enough people yet" for
// everybody until participation grows, and that sentence is the privacy guarantee working rather
// than a feature failing. Saying so plainly is the difference between a user trusting the floor and
// a user thinking the app is broken.
import { Globe } from 'lucide-react';
import { useGlobalLeaderboard, hasEnoughPeople } from '@/hooks/useGlobalLeaderboard';
import { isMetricSourced, type LeaderboardMetric } from '@/lib/leaderboard-metrics';

export function GlobalStandingCard({ metric, label }: { metric: LeaderboardMetric; label: string }) {
  const { data, isLoading, error } = useGlobalLeaderboard(metric);

  // A metric nothing computes has no standing to report — see `UNSOURCED_METRICS`.
  if (!isMetricSourced(metric)) return null;
  if (isLoading) return null;

  if (error) {
    // Said out loud rather than drawn as a zero. A standing that could not be read is not a low one.
    return (
      <p className="text-xs text-muted-foreground italic">
        Could not load how you compare right now.
      </p>
    );
  }

  if (!data) return null;

  const enough = hasEnoughPeople(data);

  return (
    <div
      className="bg-secondary/40 border border-border px-3 py-2.5 space-y-1"
      style={{ borderRadius: 'var(--radius)' }}
    >
      <div className="flex items-center gap-2">
        <Globe size={12} className="text-primary shrink-0" />
        <p className="text-xs font-medium">Everyone on Forgenta</p>
      </div>

      {enough ? (
        <>
          <p className="text-xs text-muted-foreground">
            You are ahead of <span className="text-foreground font-semibold">{data.betterThanPct}%</span>{' '}
            of the {data.cohortSize} people sharing {label.toLowerCase()} this week.
          </p>
          {data.medianBucket !== null && (
            <p className="text-xs text-muted-foreground">Half of them are at {data.medianBucket}% or below.</p>
          )}
        </>
      ) : (
        /* ⚠️ NOT RENDERED AS 0%. A null standing means the floor has not been reached; drawing it as
           a score would invent a number and a bad one. The count is shown because it explains the
           wait, and a count of opted-in people is not anybody's financial data. */
        <p className="text-xs text-muted-foreground">
          {data.cohortSize === 0
            ? 'Nobody is sharing this yet, so there is nothing to compare against.'
            : `Only ${data.cohortSize} ${data.cohortSize === 1 ? 'person is' : 'people are'} sharing this so far.`}{' '}
          We wait until {data.minCohort} are taking part before showing where you stand, so that no
          one number can point back at one person.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Nobody sees your name, your amounts or your accounts here — only these percentages.
      </p>
    </div>
  );
}
