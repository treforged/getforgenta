import { GraduationCap, Flame, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useLearnProgress } from '@/hooks/useLearnProgress';
import { LESSON_PARAM } from '@/lib/notification-routes';
import { useDemo } from '@/contexts/DemoContext';

/**
 * ONE LINE OF LEARN ON THE DASHBOARD, AND NOTHING MORE.
 *
 * ⚠️ WHY THE WHOLE CARD LEFT. Tre, 2026-09-17: *"we should put the learn section in the accounts
 * tab as its own section instead of having it on the home overview dashboard maybe like the most
 * or the next up learning task but not like the whole tab section because it seems like the
 * dashboard is getting to the point where it['s an] overload of information when it's supposed to
 * be a quick snappy what needs to be paid next"*. So `LearnCard` — 312 lines carrying a ring, a
 * streak, a reward, an inline reader and the full lesson list — is now the Learn SECTION of
 * /account, and what stays here is the one thing a dashboard owes the loop: the NEXT STEP, named,
 * with its cost, and a way to get to it.
 *
 * ⚠️ IT IS NOT A WIDGET. `learn` was removed from `dashboard-widgets.ts` in the same commit. A
 * removable "next up" line would reintroduce the hole this row exists to keep closed — see the
 * deep-link note below — and it is one line, so there is nothing to customise away.
 *
 * ⚠️ THE STREAK IS SHOWN ONLY WHEN THERE IS ONE, for the reason `LearnCard` already states: a
 * zero dressed up as a stat is the same lie as a gauge reading zero because it failed to load.
 *
 * ⚠️ TAPPING GOES TO /account CARRYING `?lesson=`, WHICH IS WHERE THE READER NOW LIVES.
 * `routeForNotificationKey` was changed in the same commit for the same reason: a `learn_lesson`
 * tap that still landed on /dashboard would land somewhere with no reader to consume the param —
 * the exact "the link works and does nothing visible" hole that file recorded and closed once
 * already. Moving the card without moving the link would have re-opened it silently.
 */
export default function NextLessonRow() {
  const progress = useLearnProgress();
  const { isDemo } = useDemo();
  const navigate = useNavigate();

  // Demo has no learn rows by construction (`useLearnProgress` is disabled without a user), so
  // this renders nothing there rather than inventing a lesson somebody has not been offered.
  if (isDemo || progress.loading) return null;

  const lesson = progress.next;
  // Every lesson read is a finished state, not an empty one — and the dashboard is not the place
  // to celebrate it. The trophy case is.
  if (!lesson) return null;

  return (
    <button
      type="button"
      onClick={() => navigate(`/account?${LESSON_PARAM}=${encodeURIComponent(lesson.id)}`)}
      className="card-forged btn-press w-full p-3 flex items-center gap-3 text-left"
      data-testid="next-lesson-row"
    >
      <GraduationCap className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Next lesson</p>
        <p className="text-xs font-medium truncate">{lesson.title}</p>
      </div>
      {progress.streak > 0 && (
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0 tabular-nums">
          <Flame className="w-3 h-3" aria-hidden="true" />
          {progress.streak}
        </span>
      )}
      <span className="text-[10px] text-muted-foreground/70 shrink-0 tabular-nums">{lesson.minutes} min</span>
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
    </button>
  );
}
