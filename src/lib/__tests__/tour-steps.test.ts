// The tour is directions. These pin that the directions still lead somewhere.
//
// The tour rotted silently: it sent people to a "Budget Control" tab, a "Savings Goals"
// tab and a "More menu", all three folded away by the redesign, and nothing failed. A
// wrong instruction is worse than no instruction, so the destinations are asserted here
// against the navigation the app actually renders.
import { describe, it, expect } from 'vitest';
import { NEW_USER_STEPS, PREMIUM_STEPS, type TourStep } from '@/lib/tour-steps';

/** The five bottom-bar tabs, as `MobileTopBar`/`Sidebar` label them today. */
const LIVE_SURFACES = ['Home', 'Activity', 'Debt', 'Forecast', 'Garage'];

/** Places the redesign removed. A step naming one of these is sending a user nowhere. */
const DEAD_DESTINATIONS = [
  'More menu',
  'the More tab',
  'Savings Goals tab',
  'Budget Control tab',
  'Accounts tab',
  'Vehicles tab',
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

  it('is one idea per step and short enough to read on a phone', () => {
    expect(NEW_USER_STEPS.length).toBeLessThanOrEqual(8);
    for (const step of allSteps) {
      expect(step.title.length, step.title).toBeLessThanOrEqual(40);
      expect(step.body.length, step.title).toBeLessThanOrEqual(260);
      expect(step.emoji, step.title).toBeTruthy();
    }
  });
});
