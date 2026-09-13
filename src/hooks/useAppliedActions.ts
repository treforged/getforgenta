import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  offerableUndos, parseUndoSteps, chargesWithUndoneDecision,
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
      /**
       * ⚠️ UNDONE ROWS ARE FETCHED TOO, AND FILTERING THEM OUT HERE WAS A REAL DEFECT.
       *
       * This used to carry `.is('undone_at', null)`, which is right for the undo banner and
       * silently wrong for everything else: `chargesWithUndoneDecision` reads exactly the rows
       * that predicate removed, so it returned an EMPTY set in every case that mattered and the
       * auto-apply guard built on it could never fire. Inert by construction — the same shape as
       * the `MerchantLinkRule.amounts` gate, and it got past unit tests because they inject the
       * set directly. A browser caught it: undo, then the charge re-applied 17 seconds later.
       *
       * The filtering now happens in the lib, where both readers can take the view they need —
       * `offerableUndos` keeps the reversible ones, `chargesWithUndoneDecision` keeps the rest.
       * Fetch wide, narrow at the point of use.
       *
       * The limit is raised because it now spans both populations: a user who has undone a lot
       * would otherwise push their still-reversible actions out of a 20-row window and lose the
       * undo banner — a filter change quietly costing a feature.
       */
      const { data, error } = await supabase
        .from('applied_actions')
        .select('id, kind, label, steps, created_at, undone_at')
        .order('created_at', { ascending: false })
        .limit(50);
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
    /**
     * Charges the user has already taken back, so auto-apply does not redo them.
     *
     * ⚠️ Derived from the RAW rows, not from `actions` above — `offerableUndos` keeps only rows
     * that are still reversible (`undone_at === null`), which is precisely the complement of what
     * this needs. Reading it from `actions` would always yield an empty set and would look like
     * a working guard.
     */
    undoneChargeIds: chargesWithUndoneDecision(query.data ?? []),
    /**
     * True while `undoneChargeIds` may be out of date — first load OR a refetch in flight.
     *
     * ⚠️ `isFetching`, NOT `isLoading`, AND THE DIFFERENCE IS THE WHOLE BUG. `markUndone`
     * invalidates this query, so straight after an undo the cached set is STALE — it still
     * says the charge was never undone. `isLoading` is false then, because data exists; only
     * `isFetching` reports that the answer in hand is the pre-undo one.
     *
     * Measured in a browser 2026-09-13: with the durable guard in place but ungated, the deck
     * re-applied the undone charge anyway, because the auto-apply effect ran on the render
     * between the invalidate and the refetch landing. A guard that consults data which has not
     * arrived yet is not a guard.
     */
    undoneUnknown: query.isFetching || query.isLoading,
    isLoading: query.isLoading,
    record,
    markUndone,
    /** The validated steps of a stored row. */
    stepsOf: (row: AppliedActionRow): UndoStep[] => parseUndoSteps(row.steps),
  };
}
