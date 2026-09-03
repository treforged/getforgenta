import { useState } from 'react';
import { GraduationCap, Flame, Check, Trophy, ChevronDown } from 'lucide-react';
import { useLearnProgress, useMarkLessonRead } from '@/hooks/useLearnProgress';
import SocialFollowRow from '@/components/dashboard/SocialFollowRow';
import { LEARN_LESSONS } from '@/lib/learn-lessons';
import type { LearnLesson } from '@/lib/learn-lessons';

/**
 * Learn — financial teachings on the dashboard, one achievement per lesson read.
 *
 * THE LOOP, stated plainly so it can be argued with: a visible next step (one named lesson, with
 * its length), a small cost to complete it (two minutes, one tap), an immediate reward (a named
 * badge and a toast), and a reason to come back tomorrow (the streak, and the ring that is not
 * full yet). Each of those is a separate thing on the card, because dropping any one of them
 * turns the other three into decoration.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not fake progress, and it does not manufacture
 * urgency. An account with no reads shows 0 and says so; the streak line is absent rather than
 * showing "0 days", because a zero dressed up as a stat is the same lie as a gauge reading zero
 * when it failed to load. The streak notification (`streak_risk` in notification-policy.ts) only
 * fires when there is a real streak of two or more to lose.
 *
 * The reader is INLINE, not a modal: this UI kit has no dialog, and a lesson that expands in
 * place keeps the ring and the streak on screen while it is read — which is the point.
 */
export default function LearnCard() {
  const progress = useLearnProgress();
  const markRead = useMarkLessonRead();
  const [openLessonId, setOpenLessonId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  if (progress.loading) return null;

  const readSet = new Set(progress.readIds);
  const openLesson = openLessonId ? LEARN_LESSONS.find(l => l.id === openLessonId) ?? null : null;
  const pct = progress.totalCount === 0 ? 0 : Math.round((progress.readCount / progress.totalCount) * 100);
  // The next lesson already has its own row above, with its summary. Listing it again below —
  // which is what the first live press of this card showed — reads as two different lessons with
  // the same name. The list is therefore everything EXCEPT the one being offered.
  const rest = LEARN_LESSONS.filter(lesson => lesson.id !== progress.next?.id);
  const visible = showAll ? rest : rest.slice(0, 4);

  return (
    <div className="card-forged p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <GraduationCap className="w-3.5 h-3.5" aria-hidden="true" />
            Learn
          </h2>
          <p className="text-[11px] text-muted-foreground mt-1">
            Short money lessons. One badge for each one you finish.
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-semibold leading-none">
            {progress.readCount}<span className="text-muted-foreground text-xs">/{progress.totalCount}</span>
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">{pct}% complete</p>
        </div>
      </div>

      <div className="h-1.5 bg-secondary rounded-full overflow-hidden" role="progressbar"
        aria-valuenow={progress.readCount} aria-valuemin={0} aria-valuemax={progress.totalCount}
        aria-label="Lessons completed">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      {/* Absent, not zero. A "0 day streak" is a stat that says nothing and costs trust. */}
      {progress.streak > 0 && (
        <p className="text-[11px] flex items-center gap-1.5">
          <Flame className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
          <span className="font-medium">{progress.streak}-day streak</span>
          <span className="text-muted-foreground">
            {progress.readToday ? 'kept today' : 'read one today to keep it'}
          </span>
        </p>
      )}

      {progress.next ? (
        <LessonRow
          lesson={progress.next}
          read={false}
          isNext
          open={openLessonId === progress.next.id}
          onToggle={() => setOpenLessonId(openLessonId === progress.next!.id ? null : progress.next!.id)}
        />
      ) : (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
          Every lesson read. New ones are added over time.
        </p>
      )}

      {openLesson && (
        <LessonReader
          lesson={openLesson}
          alreadyRead={readSet.has(openLesson.id)}
          saving={markRead.isPending}
          readOnly={progress.readOnly}
          onMarkRead={() => {
            markRead.mutate(openLesson.id, { onSuccess: () => setOpenLessonId(null) });
          }}
        />
      )}

      <div className="space-y-1.5 pt-1">
        {visible.map(lesson => (
          <LessonRow
            key={lesson.id}
            lesson={lesson}
            read={readSet.has(lesson.id)}
            isNext={false}
            open={openLessonId === lesson.id}
            onToggle={() => setOpenLessonId(openLessonId === lesson.id ? null : lesson.id)}
          />
        ))}
        {rest.length > 4 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showAll ? 'rotate-180' : ''}`} aria-hidden="true" />
            {/* No count in the label: the list excludes the lesson offered above, so any number
                here would disagree with the ring by one exactly when a lesson is being offered. */}
            {showAll ? 'Show fewer' : 'Show all lessons'}
          </button>
        )}
      </div>

      {/* Below the ring and separated by a rule, because these two badges are UNVERIFIABLE and
          must never count toward the lesson progress above them. See social-links.ts. */}
      <SocialFollowRow />
    </div>
  );
}

function LessonRow({ lesson, read, isNext, open, onToggle }: {
  lesson: LearnLesson;
  read: boolean;
  isNext: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius)] transition-colors ${
        isNext ? 'bg-secondary/60 hover:bg-secondary' : 'hover:bg-secondary/40'
      }`}
    >
      <span
        className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${
          read ? 'bg-primary' : 'border border-border'
        }`}
        aria-hidden="true"
      >
        {read && <Check className="w-2.5 h-2.5 text-background" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-[11px] block truncate">{lesson.title}</span>
        {isNext && <span className="text-[10px] text-muted-foreground block truncate">{lesson.summary}</span>}
      </span>
      <span className="text-[10px] text-muted-foreground shrink-0">
        {read ? lesson.achievement.name : `${lesson.minutes} min`}
      </span>
    </button>
  );
}

function LessonReader({ lesson, alreadyRead, saving, readOnly, onMarkRead }: {
  lesson: LearnLesson;
  alreadyRead: boolean;
  saving: boolean;
  readOnly: boolean;
  onMarkRead: () => void;
}) {
  return (
    <div className="border border-border rounded-[var(--radius)] p-4 space-y-3">
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {lesson.track} · {lesson.minutes} min
        </p>
        <h3 className="text-sm font-semibold mt-1">{lesson.title}</h3>
      </div>

      {lesson.body.map((paragraph, i) => (
        <p key={i} className="text-[11px] leading-relaxed text-muted-foreground">{paragraph}</p>
      ))}

      <p className="text-[11px] font-medium">Do this: {lesson.takeaway}</p>

      {alreadyRead ? (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
          <Trophy className="w-3 h-3 text-primary" aria-hidden="true" />
          {lesson.achievement.name} — earned
        </p>
      ) : readOnly ? (
        // Honest rather than hidden: the button would do nothing for a demo or signed-out reader,
        // and a control that silently does nothing is the bug this whole batch started from.
        <p className="text-[10px] text-muted-foreground">Sign in to earn achievements.</p>
      ) : (
        <button
          onClick={onMarkRead}
          disabled={saving}
          className="text-[11px] px-3 py-1.5 rounded-[var(--radius)] bg-primary text-background font-medium disabled:opacity-60"
        >
          {saving ? 'Saving…' : `Mark as read · ${lesson.achievement.name}`}
        </button>
      )}
    </div>
  );
}
