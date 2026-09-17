/**
 * THE FIRST-RUN DASHBOARD STACK, and the two refutations that shaped it.
 *
 * Tre, 2026-09-17, on the dashboard: "it seems like the dashboard is getting to the point where
 * it['s an] overload of information when it's supposed to be a quick snappy what needs to be paid
 * next". `transactions_spending` is defaulted OFF; nothing else is.
 *
 * ⚠️ WHY THE REFUTATIONS ARE ASSERTED HERE RATHER THAN LEFT IN A COMMIT BODY. Two other widgets
 * were proposed for the same treatment and both were wrong. The tempting move for a later session
 * is to "finish the job" by adding them, which is exactly what these two cases stop:
 *   · `budget_totals` is on the dashboard BECAUSE TRE ASKED FOR IT (90b39aba, 2026-08-27, with a
 *     screenshot: "i wanted these moved to dashboard"). The proposal's stated ground was that he
 *     had never mentioned it.
 *   · `car_goal` already self-hides — `Dashboard.tsx` case 'car_goal' opens
 *     `if (!carGoalData) return null` — so defaulting it off is a no-op for every user it was
 *     aimed at and a loss for the 2 who have a car goal.
 *
 * ⚠️ AND THE POPULATION IS BOUNDED, so nobody reads this as tidying the CEO's screen. Measured
 * 2026-09-17 over all 33 profiles: 31 carry no saved layout, and the 2 that do are
 * `tre@treforged.com` and `reviewer@treforged.com`. `mergeSavedLayout` preserves a stored flag,
 * so this default reaches those 31 and reaches neither his screen nor the walk account. The
 * preservation case below is the half that guarantees it CANNOT reach them.
 */
import { describe, it, expect } from 'vitest';
import {
  mergeSavedLayout,
  DEFAULT_LAYOUT,
  WIDGET_META,
  type WidgetId,
} from '../dashboard-widgets';

const visibleOf = (id: WidgetId, layout: readonly { id: WidgetId; visible: boolean }[]) =>
  layout.find(w => w.id === id)?.visible;

describe('the first-run stack', () => {
  // POSITIVE CONTROL. Every assertion below is about one id's flag, so a registry that failed to
  // load, or a DEFAULT_LAYOUT built from an empty list, would satisfy them all vacuously —
  // `visibleOf` returns undefined and `toBe(false)` would simply be wrong rather than silent.
  // This pins that the thing under test is populated and matched to the registry first, so
  // "0 widgets examined" can never read the same as "the defaults are correct".
  it('CONTROL: DEFAULT_LAYOUT is populated and covers exactly the registry', () => {
    expect(WIDGET_META.length).toBeGreaterThan(0);
    expect(DEFAULT_LAYOUT).toHaveLength(WIDGET_META.length);
    expect(DEFAULT_LAYOUT.map(w => w.id).sort()).toEqual(WIDGET_META.map(w => w.id).sort());
  });

  it('hides Transactions & Spending for a user who has never customised', () => {
    expect(visibleOf('transactions_spending', DEFAULT_LAYOUT)).toBe(false);
  });

  it('hides EXACTLY ONE widget — a default-off list is opted into, never drifted into', () => {
    const off = DEFAULT_LAYOUT.filter(w => !w.visible).map(w => w.id);
    expect(off).toEqual(['transactions_spending']);
  });

  // The two refutations, asserted rather than remembered.
  it('keeps Budget Totals ON — Tre asked for that card to be here (90b39aba)', () => {
    expect(visibleOf('budget_totals', DEFAULT_LAYOUT)).toBe(true);
  });

  it('keeps Car Goal ON — it already self-hides when there is no car goal', () => {
    expect(visibleOf('car_goal', DEFAULT_LAYOUT)).toBe(true);
  });
});

describe('a saved layout outranks the default', () => {
  // THE LOAD-BEARING CASE. This is what makes the bound above true: the 2 profiles that carry a
  // saved layout must be untouched by any change to `defaultVisible`. Without it, a later edit
  // here could silently take a card off the CEO's own dashboard.
  it('preserves visible:true on a widget the saved layout already knows', () => {
    const saved = WIDGET_META.map(w => ({ id: w.id, visible: true }));
    const merged = mergeSavedLayout(saved);

    expect(visibleOf('transactions_spending', merged)).toBe(true);
    expect(merged.filter(w => !w.visible)).toHaveLength(0);
  });

  it('preserves visible:false too — the default does not switch a hidden card back on', () => {
    const saved = WIDGET_META.map(w => ({ id: w.id, visible: w.id !== 'budget_totals' }));
    expect(visibleOf('budget_totals', mergeSavedLayout(saved))).toBe(false);
  });

  // A widget the saved layout has NEVER seen arrives at its default, including a default of off.
  // That is deliberate: it is how a widget added later can ship off for existing users too.
  it('gives a widget the saved layout has never seen its own default', () => {
    const saved = WIDGET_META
      .filter(w => w.id !== 'transactions_spending')
      .map(w => ({ id: w.id, visible: true }));
    const merged = mergeSavedLayout(saved);

    expect(merged.map(w => w.id)).toContain('transactions_spending');
    expect(visibleOf('transactions_spending', merged)).toBe(false);
  });

  // No saved layout at all is the 31-user case, and it must be the default verbatim.
  it('falls back to the default for a profile with no saved layout', () => {
    expect(mergeSavedLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(visibleOf('transactions_spending', mergeSavedLayout(undefined))).toBe(false);
  });
});
