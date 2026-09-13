/**
 * A durable record of something the app applied, and the plan that reverses it.
 *
 * Tre, 2026-09-12: "There's no easy way to undo this action." The app LOOKED like it had undo —
 * it had three, and every one lived in React state, so navigating away lost all of them. See
 * `supabase/migrations/20260913_applied_actions.sql` for why this is a table and why it blocks the
 * auto-apply work rather than following it.
 *
 * This file is the PURE half: the shapes, the boundary validation, and the wording. It performs no
 * I/O, so every rule below is testable without a database.
 */

/** Which surface applied the action. Text in the DB so a new kind needs no migration. */
export type AppliedActionKind = 'deck_decision' | 'merchant_retro_pass' | 'link_confirm';

/** Put a charge's category back to what it was. `null` clears it, which is what `setCategory` does. */
export interface SetCategoryStep {
  write: 'setCategory';
  chargeId: string;
  category: string | null;
}

/** Delete every review row for a charge, returning it to the queue unanswered. */
export interface RemoveReviewsStep {
  write: 'removeReviews';
  chargeId: string;
}

/** Delete a ledger row an import created. */
export interface DeleteTransactionStep {
  write: 'deleteTransaction';
  chargeId: string;
  transactionId: string;
}

export type UndoStep = SetCategoryStep | RemoveReviewsStep | DeleteTransactionStep;

/** A row of `public.applied_actions`, as the client sees it. */
export interface AppliedActionRow {
  id: string;
  kind: string;
  label: string;
  steps: unknown;
  created_at: string;
  undone_at: string | null;
}

/**
 * The undo steps in a stored row, dropping anything that is not a step this app understands.
 *
 * ⚠️ THIS IS A TRUST BOUNDARY AND IS VALIDATED LIKE ONE. `steps` is `jsonb` written by a client,
 * and it comes back as `unknown`. A malformed or hand-edited row must produce FEWER steps, never a
 * throw and never a step with a missing field that quietly becomes `undefined` inside a mutation.
 * RLS confines a forged row to its own author's data, so the blast radius is their own ledger —
 * but "you can only corrupt your own records" is not a reason to skip parsing them.
 *
 * ⚠️ ORDER IS PRESERVED EXACTLY. `planDeckUndo` puts the ledger delete BEFORE the review removal
 * on purpose: reversed, a failure halfway leaves spending counted twice AND the charge importable
 * again. Sorting or de-duplicating here would silently undo that decision.
 */
export function parseUndoSteps(raw: unknown): UndoStep[] {
  if (!Array.isArray(raw)) return [];
  const out: UndoStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const step = item as Record<string, unknown>;
    const chargeId = step.chargeId;
    if (typeof chargeId !== 'string' || !chargeId) continue;

    if (step.write === 'removeReviews') {
      out.push({ write: 'removeReviews', chargeId });
    } else if (step.write === 'setCategory') {
      const category = step.category;
      // `null` is meaningful here — it CLEARS the category — so it is accepted and `undefined` is
      // not. A missing field must not become "clear this", which is a silent data change.
      if (category === null || typeof category === 'string') {
        out.push({ write: 'setCategory', chargeId, category });
      }
    } else if (step.write === 'deleteTransaction') {
      const transactionId = step.transactionId;
      if (typeof transactionId === 'string' && transactionId) {
        out.push({ write: 'deleteTransaction', chargeId, transactionId });
      }
    }
  }
  return out;
}

/** True when this action can still be taken back. `undone_at` is set once and never cleared. */
export function isReversible(row: Pick<AppliedActionRow, 'undone_at' | 'steps'>): boolean {
  return row.undone_at === null && parseUndoSteps(row.steps).length > 0;
}

/**
 * How long an applied action stays offered as an undo, in hours.
 *
 * ⚠️ CHOSEN, NOT MEASURED, and it governs an OFFER rather than the data — the row is kept forever
 * either way, so an expired action is still auditable and can still be reversed by hand. The point
 * is that a list of every action ever taken is not an undo affordance, it is a log; "undo" means
 * the thing you just did.
 */
export const UNDO_OFFER_WINDOW_HOURS = 24;

/** The reversible actions worth putting in front of someone right now, newest first. */
export function offerableUndos(
  rows: readonly AppliedActionRow[],
  now: Date = new Date(),
): AppliedActionRow[] {
  const cutoff = now.getTime() - UNDO_OFFER_WINDOW_HOURS * 3600_000;
  return rows
    .filter(isReversible)
    .filter(r => {
      const at = Date.parse(r.created_at);
      // An unparseable timestamp is still OFFERED rather than hidden. Hiding an undo because a
      // date failed to parse would be the app silently withdrawing something it promised.
      return Number.isNaN(at) || at >= cutoff;
    })
    .slice()
    .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
}

/**
 * What to call an action in a list.
 *
 * Falls back to the count rather than to a generic word: "1 change" tells someone nothing, but it
 * is honest, whereas inventing a description for a row whose label is missing is not.
 */
export function describeApplied(row: AppliedActionRow): string {
  if (row.label.trim()) return row.label.trim();
  const n = parseUndoSteps(row.steps).length;
  return `${n} ${n === 1 ? 'change' : 'changes'}`;
}
