// The tour is directions. These pin that the directions still lead somewhere.
//
// The tour rotted silently: it sent people to a "Budget Control" tab, a "Savings Goals"
// tab and a "More menu", all three folded away by the redesign, and nothing failed. A
// wrong instruction is worse than no instruction, so the destinations are asserted here
// against the navigation the app actually renders.
import { describe, it, expect } from 'vitest';
import { NEW_USER_STEPS, PREMIUM_STEPS, stepsFor, type TourStep } from '@/lib/tour-steps';
import { PRIMARY_NAV } from '@/lib/primary-nav';

/**
 * The bottom-bar tabs, DERIVED from the nav. This list used to be hand-written
 * (Home, Activity, Debt, Forecast, Garage) and went stale twice without a red: Activity was
 * renamed Transactions on 08-27 and Plan took Garage's slot on 10-06, so the test kept
 * demanding the tour name two places the bar no longer has. 2026-10-09 growth pass.
 */
const LIVE_SURFACES = PRIMARY_NAV.map((d) => d.label);

/** Places the redesign removed. A step naming one of these is sending a user nowhere. */
const DEAD_DESTINATIONS = [
  'More menu',
  'the More tab',
  'Savings Goals tab',
  'Budget Control tab',
  'Accounts tab',
  'Vehicles tab',
  // Renamed or folded by 10-06; each was still in the tour on 10-09.
  'Activity \u2192',
  'Budget Control',
  'menu at the top left',
  'the Forecast tab',
];

const allSteps: TourStep[] = [...NEW_USER_STEPS, ...PREMIUM_STEPS];

describe('AppTour steps', () => {
  it('never sends a user to a screen the redesign removed', () => {
    for (const step of allSteps) {
      for (const dead of DEAD_DESTINATIONS) {
        expect(`${step.title} ${step.body}`.toLowerCase(), step.title)
          .not.toContain(dead.toLowerCase());
      }
    }
  });

  it('walks the user through every tab there is, and no tab there is not', () => {
    const text = NEW_USER_STEPS.map(s => `${s.title} ${s.body}`).join(' ');
    // Coverage, not per-step: the closing step is about the Guide button, which lives on
    // every panel rather than in one tab, and forcing a tab name into it would be a lie.
    for (const surface of LIVE_SURFACES) {
      expect(text, `no step mentions ${surface}`).toContain(surface);
    }
  });

  it('mentions quick add, and drops it where the + is a Premium door', () => {
    const live = stepsFor(NEW_USER_STEPS, { quickAdd: true });
    const gated = stepsFor(NEW_USER_STEPS, { quickAdd: false });
    expect(live.some((s) => s.body.includes('+'))).toBe(true);
    expect(gated.some((s) => s.body.includes('quick add'))).toBe(false);
    // Control: the filter removes ONLY the gated step.
    expect(live.length - gated.length).toBe(1);
  });

  it('is one idea per step and short enough to read on a phone', () => {
    expect(NEW_USER_STEPS.length).toBeLessThanOrEqual(8);
    for (const step of allSteps) {
      expect(step.title.length, step.title).toBeLessThanOrEqual(40);
      expect(step.body.length, step.title).toBeLessThanOrEqual(260);
      expect(step.emoji, step.title).toBeTruthy();
    }
  });
});
