import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  offerableUndos, parseUndoSteps,
  type AppliedActionKind, type AppliedActionRow, type UndoStep,
} from '@/lib/applied-actions';

/**
 * Reading and writing `public.applied_actions` — the undo that outlives the component.
 *
 * See `src/lib/applied-actions.ts` for the shapes and `supabase/migrations/20260913_applied_actions.sql`
 * for why this is a table. The short version: every undo this app had lived in React state, so
 * navigating away lost it, and the batch panel's copy promises the user otherwise.
 *
 * ⚠️ THIS HOOK NEVER APPLIES THE STEPS ITSELF. It records what was done and marks it reversed; the
 * surface that owns the mutations replays them. Putting the replay here would mean this file
 * needing every mutation in the app, and it would separate the write from the error handling that
 * already knows how to report a partial failure.
 */

/** The key both the list and its invalidations use. Exported so a caller cannot misspell it. */
export const APPLIED_ACTIONS_KEY = 'applied_actions';

export interface RecordAppliedInput {
  kind: AppliedActionKind;
  /** What to show a human: "Categorized 28 charges from merchants you have labeled before". */
  label: string;
  /** The reversal plan, computed NOW while the previous values are still known. */
  steps: readonly UndoStep[];
}

export function useAppliedActions() {
  const { user } = useAuth();
  const userId = user?.id;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [APPLIED_ACTIONS_KEY, userId],
    enabled: !!userId,
    queryFn: async (): Promise<AppliedActionRow[]> => {
      const { data, error } = await supabase
        .from('applied_actions')
        .select('id, kind, label, steps, created_at, undone_at')
        .is('undone_at', null)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as AppliedActionRow[];
    },
  });

  const record = useMutation({
    mutationFn: async (input: RecordAppliedInput): Promise<AppliedActionRow | null> => {
      if (!userId) return null;
      // ⚠️ AN EMPTY PLAN IS NOT RECORDED. A row offering an undo that would do nothing is worse
      // than no row: the user presses it, nothing changes, and the app looks broken at exactly the
      // moment they are already unsure something worked.
      if (input.steps.length === 0) return null;
      const { data, error } = await supabase
        .from('applied_actions')
        .insert({
          user_id: userId,
          kind: input.kind,
          label: input.label,
          steps: input.steps as unknown as never,
        })
        .select('id, kind, label, steps, created_at, undone_at')
        .single();
      if (error) throw error;
      return data as AppliedActionRow;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [APPLIED_ACTIONS_KEY, userId] }); },
  });

  const markUndone = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from('applied_actions')
        .update({ undone_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [APPLIED_ACTIONS_KEY, userId] }); },
  });

  return {
    /** Recent, still-reversible actions, newest first. */
    actions: offerableUndos(query.data ?? []),
    /** The most recent one worth offering, or null. */
    latest: offerableUndos(query.data ?? [])[0] ?? null,
    isLoading: query.isLoading,
    record,
    markUndone,
    /** The validated steps of a stored row. */
    stepsOf: (row: AppliedActionRow): UndoStep[] => parseUndoSteps(row.steps),
  };
}
