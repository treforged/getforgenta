import { Trophy, GraduationCap, Share2, Crown, HelpCircle } from 'lucide-react';
import { useAchievements } from '@/hooks/useAchievements';
import { TOTAL_LESSON_BADGES, type AchievementKind } from '@/lib/achievements';
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
 * The lesson counter deliberately counts ONLY lessons: social badges are a fixed pair and
 * `og_founder` is a cohort nobody can decide to join, so a progress figure over them would invent
 * a denominator.
 */

const ICONS: Record<AchievementKind, typeof Trophy> = {
  lesson: GraduationCap,
  social: Share2,
  founder: Crown,
  unknown: HelpCircle,
};

function earnedOn(iso: string): string {
  // Textual month, so it reads the same in every locale — the app renders `Sep 5, 2026` rather
  // than a numeric date anywhere it can be misread as day-first.
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TrophyCase() {
  const { data, loading } = useAchievements();
  const { isDemo } = useDemo();

  if (loading) return null;

  const lessonCount = data.filter(a => a.kind === 'lesson').length;

  return (
    <div className="card-forged p-5 space-y-4" data-testid="trophy-case">
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
      ) : data.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No badges yet. Finish a lesson in Learn and the first one lands here.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.map(a => {
            const Icon = ICONS[a.kind];
            return (
              <li key={a.id} className="flex items-start gap-3">
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
                  <p className="text-[10px] text-muted-foreground">{a.description}</p>
                  <p className="text-[10px] text-muted-foreground/70">Earned {earnedOn(a.earnedAt)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
