import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { LEARN_LESSONS, LESSON_COUNT, nextUnreadLesson, lessonById } from '@/lib/learn-lessons';
import type { LearnLesson } from '@/lib/learn-lessons';
import { computeStreak, hasReadToday } from '@/lib/learn-streak';

/**
 * The Learn track's state: which lessons this account has read, and everything derived from that.
 *
 * ONE SOURCE, DERIVED EVERYTHING. Streak, badge count and next lesson are all computed from the
 * same `achievements` rows rather than stored separately, because a stored badge count that
 * disagrees with the rows that earned it forces the UI to pick a winner, and it will pick wrong.
 *
 * THE TABLE IS `achievements`, NOT `learn_progress`. It was renamed when the OG badge and the
 * social-follow badges arrived — they are the same shape, and three parallel tables would mean
 * three sets of grants to get right instead of one. Lesson rows are namespaced `lesson:<slug>`,
 * which is also what the RLS INSERT policy allows a client to write: `lesson:%` and the two
 * social follows, and nothing else. `og_founder` is deliberately not writable from here, because
 * it is worth a free year.
 *
 * DEMO MODE READS AND WRITES NOTHING. A demo session has no user, so marking a lesson read would
 * either fail against RLS or write to whoever happens to be signed in. It gets an empty, honest
 * state instead.
 */

export const LEARN_PROGRESS_QUERY_KEY = 'achievements';

/** Lesson achievement ids are namespaced, so one table can hold badges that are not lessons. */
export const LESSON_PREFIX = 'lesson:';
export const lessonAchievementId = (lessonId: string): string => `${LESSON_PREFIX}${lessonId}`;

export interface LearnProgressRow {
  achievement_id: string;
  earned_at: string;
}

export interface LearnProgress {
  loading: boolean;
  /** Lesson ids this account has finished, unordered. */
  readIds: readonly string[];
  readCount: number;
  totalCount: number;
  /** Consecutive local days ending today, or yesterday when nothing has been read today. */
  streak: number;
  readToday: boolean;
  /** The first unread lesson in teaching order, or null when the catalogue is finished. */
  next: LearnLesson | null;
  /** Badges earned, newest first — one per lesson read, derived from the rows. */
  achievements: readonly { lesson: LearnLesson; readAt: string }[];
  /** True once the account can no longer write (demo, or signed out). */
  readOnly: boolean;
}

export function useLearnProgress(): LearnProgress {
  const { user } = useAuth();
  const { isDemo } = useDemo();

  const query = useQuery({
    queryKey: [LEARN_PROGRESS_QUERY_KEY, isDemo ? 'demo' : user?.id],
    enabled: !isDemo && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<LearnProgressRow[]> => {
      if (!user) return [];
      // RLS already restricts this to the caller's rows; the filter is stated anyway, matching
      // every other read in the app.
      const { data, error } = await supabase
        .from('achievements')
        .select('achievement_id, earned_at')
        .eq('user_id', user.id)
        // Lessons only. The OG and social badges live in the same table and are shown elsewhere;
        // counting them here would put the Learn ring at 14/12.
        .like('achievement_id', `${LESSON_PREFIX}%`)
        .order('earned_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);

  return useMemo(() => {
    const readIds = rows.map(r => r.achievement_id.slice(LESSON_PREFIX.length));
    const timestamps = rows.map(r => r.earned_at);
    const now = new Date();

    const achievements = rows
      .map(row => {
        const lesson = lessonById(row.achievement_id.slice(LESSON_PREFIX.length));
        return lesson ? { lesson, readAt: row.earned_at } : null;
      })
      // A row for a retired lesson is history, not an error — it is simply not shown.
      .filter((a): a is { lesson: LearnLesson; readAt: string } => a !== null);

    return {
      loading: query.isLoading,
      readIds,
      // Counted from the resolvable badges, so the ring cannot read 13/12 after a lesson is retired.
      readCount: achievements.length,
      totalCount: LESSON_COUNT,
      streak: computeStreak(timestamps, now),
      readToday: hasReadToday(timestamps, now),
      next: nextUnreadLesson(readIds),
      achievements,
      readOnly: isDemo || !user,
    };
  }, [rows, query.isLoading, isDemo, user]);
}

/**
 * Mark a lesson read. Idempotent by the `(user_id, achievement_id)` unique index rather than by a
 * read-then-write, so a double tap cannot mint a second badge or move an earlier `earned_at`.
 */
export function useMarkLessonRead() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (lessonId: string): Promise<{ alreadyRead: boolean }> => {
      if (isDemo || !user) throw new Error('Sign in to save your progress.');
      if (!LEARN_LESSONS.some(l => l.id === lessonId)) throw new Error('Unknown lesson.');

      const { error } = await supabase
        .from('achievements')
        .insert({ user_id: user.id, achievement_id: lessonAchievementId(lessonId) });

      // 23505 is the unique violation: the lesson was already read. That is a success from the
      // reader's point of view, and surfacing it as a failure would make a second tap look broken.
      if (error && error.code !== '23505') throw error;
      return { alreadyRead: !!error };
    },
    onSuccess: (result, lessonId) => {
      void qc.invalidateQueries({ queryKey: [LEARN_PROGRESS_QUERY_KEY] });
      if (result.alreadyRead) return;
      const lesson = lessonById(lessonId);
      if (lesson) toast.success(`Achievement unlocked — ${lesson.achievement.name}`);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not save your progress.');
    },
  });
}
