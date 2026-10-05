/**
 * Simple | Advanced view (Tre, 2026-10-05, ask 7515c3fa): "a little too much detail that sometimes
 * can make it a little overwhelming ... an advanced version or advanced view for the people who
 * want it like myself". Spec: docs/simple-view/PROPOSAL.md.
 *
 * ⚠️ NULL READS AS ADVANCED. Every account that existed before this shipped keeps the screen it
 * already uses; Simple is opt-in until the new-account default is decided. Anything that is not
 * exactly 'simple' is Advanced, so a bad value can only ever show MORE, never hide a card.
 */
export type ViewMode = 'simple' | 'advanced';

export function resolveViewMode(stored: unknown): ViewMode {
  return stored === 'simple' ? 'simple' : 'advanced';
}

/**
 * The Home widgets Simple keeps, in the user's own order and only if the user has not hidden
 * them. Everything else stays one tap away under Advanced; nothing is deleted.
 * monthly_snapshot renders COMPACT in Simple (Safe to Spend and the header figures, no donut).
 */
export const SIMPLE_HOME_WIDGETS: ReadonlySet<string> = new Set([
  'monthly_snapshot',
  'upcoming_week',
  'debt_recommendations',
  'goal_progress',
]);

export function simpleHomeWidgets<T extends string>(visible: readonly T[]): T[] {
  return visible.filter((id) => SIMPLE_HOME_WIDGETS.has(id));
}
