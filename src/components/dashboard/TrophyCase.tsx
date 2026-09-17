import { Trophy } from 'lucide-react';
import { useAchievements } from '@/hooks/useAchievements';
import { iconFor } from '@/lib/achievement-icons';
import { TOTAL_LESSON_BADGES } from '@/lib/achievements';
import { useMilestoneAchievements } from '@/hooks/useMilestoneAchievements';
import { useDemo } from '@/contexts/DemoContext';

/**
 * WHERE THE BADGES LIVE.
 *
 * ⚠️ THIS DID NOT EXIST UNTIL 2026-09-06. Tre: *"where is the achievements section?"* — he had
 * earned `lesson:what-a-cash-floor-is` that evening and had held `follow_instagram` since 09-03,
 * and the only trace anywhere in the app was a checkmark on one lesson row. **A reward you cannot
 * go and look at is not much of a reward**, and the app knew about both and never showed him
 * either.
 *
 * ⚠️ IT SHOWS EVERY BADGE, INCLUDING ONES THIS CODE DOES NOT RECOGNISE. `resolveAchievement`
 * marks an unknown id `known: false` and it is rendered with its raw id rather than dropped or
 * given an invented name. A trophy case that quietly omits something somebody earned is wrong in
 * the way that is hardest to notice.
 *
 * ⚠️ THE LAYOUT WAS RE-CUT ON 2026-09-17, AND THE COMPLAINT WAS MEASURABLE. Tre: *"format the
 * achievements better give them better icon/images and space the amount so there's a less intense
 * space ... there's a lot of blank space in those boxes"*. What he was looking at: every "Still to
 * earn" row was `justify-between`, so the name sat hard left and `0/1` hard right with **640px of
 * nothing between them at 1440 and 230px at 390** — measured, not judged. The count was not
 * spaced, it was STRANDED. A progress bar now occupies that run, so the width carries the one
 * thing the row was missing, and both lists are two columns from `sm:` up instead of one tall
 * ladder of thin rows.
 *
 * ⚠️ CORNER CONCENTRICITY WAS CHECKED AND DOES NOT BIND HERE. The card's radius is `--radius`
 * (12px) against 16px of padding, so `gap >= r_outer` and the child's corner sits entirely clear
 * of the parent's curve — the rule is degenerate at those values, not satisfied by luck. Squaring
 * the tiles on the arithmetic alone would have been the cry-wolf application the rule itself warns
 * against.
 *
 * The lesson counter deliberately counts ONLY lessons: social badges are a fixed pair and
 * `og_founder` is a cohort nobody can decide to join, so a progress figure over them would invent
 * a denominator.
 */

function earnedOn(iso: string): string {
  // Textual month, so it reads the same in every locale — the app renders `Sep 5, 2026` rather
  // than a numeric date anywhere it can be misread as day-first.
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TrophyCase() {
  const { data, loading } = useAchievements();
  // Calling this is what GRANTS a milestone — the server checks the thresholds and inserts. It is
  // idempotent, so mounting the trophy case is a safe place to do it.
  const { data: milestones } = useMilestoneAchievements();
  const { isDemo } = useDemo();

  if (loading) return null;

  // Only the ones still to be earned. The earned ones already arrive through `useAchievements`,
  // which reads the table, so listing them here too would show every milestone twice.
  const upcoming = milestones.filter(m => !m.earned);

  const lessonCount = data.filter(a => a.kind === 'lesson').length;

  return (
    <div className="card-forged p-4 space-y-3" data-testid="trophy-case">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Trophy className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
          Achievements
        </h2>
        {data.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {data.length} earned{lessonCount > 0 && ` · ${lessonCount}/${TOTAL_LESSON_BADGES} lessons`}
          </span>
        )}
      </div>

      {isDemo ? (
        // Honest rather than decorative: inventing a trophy case would be a claim about somebody
        // else's history, on a screen whose whole job is to report theirs.
        <p className="text-[11px] text-muted-foreground">
          Achievements are tied to a real account. Sign up and your first badge is one lesson away.
        </p>
      ) : data.length === 0 && upcoming.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No badges yet. Finish a lesson in Learn and the first one lands here.
        </p>
      ) : (
        // Two columns from `sm:` up. One badge per full-width row left most of the row empty,
        // which is half of what "blank space in those boxes" was describing.
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {data.map(a => {
            const Icon = iconFor(a.id, a.kind);
            return (
              <li key={a.id} className="flex items-start gap-2.5 rounded-lg bg-muted/30 p-2.5">
                <div
                  className="p-1.5 bg-primary/10 border border-primary/20 shrink-0"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  <Icon className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium">
                    {a.name}
                    {!a.known && (
                      // Ugly on purpose — a prompt to add the definition, not a finished state.
                      <span className="ml-2 text-[10px] text-muted-foreground">(no description yet)</span>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-snug">{a.description}</p>
                  <p className="text-[10px] text-muted-foreground/70">Earned {earnedOn(a.earnedAt)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!isDemo && upcoming.length > 0 && (
        <div className="pt-1 border-t border-border/40 space-y-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Still to earn
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2" data-testid="trophy-case-upcoming">
            {upcoming.map(m => {
              const Icon = iconFor(m.id, 'milestone');
              // Guarded rather than trusted: a threshold of 0 would make this NaN and render a
              // bar of width "NaN%", which browsers quietly drop — a silently missing bar.
              const reached = Math.min(m.progress, m.threshold);
              const pct = m.threshold > 0 ? Math.round((reached / m.threshold) * 100) : 0;
              return (
                <li key={m.id} className="flex items-center gap-2">
                  <Icon className="w-3 h-3 text-muted-foreground shrink-0" aria-hidden="true" />
                  <span className="text-[11px] text-muted-foreground truncate shrink-0 max-w-[45%]">{m.name}</span>
                  {/* The bar sits BETWEEN the name and the count, on the same line. That is the
                      whole fix: the run of empty pixels the count used to be stranded across is
                      now the only thing on the row that carries information, and the row stays
                      one line tall rather than buying the space back in height. It draws the
                      SAME figure as the count rather than a second number that could disagree. */}
                  <div className="h-1 flex-1 min-w-[2rem] rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary/60" style={{ width: `${pct}%` }} />
                  </div>
                  {/* The threshold is the server's own number, returned by the same call that
                      decided this is unearned — so the target shown can never disagree with the
                      target checked. */}
                  <span className="text-[10px] text-muted-foreground/70 shrink-0 tabular-nums">
                    {reached}/{m.threshold}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
