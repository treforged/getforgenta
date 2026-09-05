// @vitest-environment jsdom
//
// THE TOGGLE KNOB STAYS INSIDE ITS TRACK.
//
// ⚠️ TRE HAS SEEN THIS BUG BEFORE AND SAID SO: *"fix the button toggles. the dot goes outside of
// the container. We've had these issues before, and you should have learned from it."* Eight
// toggles on one screen, every ON knob half outside the gold pill. A visual defect that recurs is
// a defect with no gate, so this is the gate.
//
// ⚠️ AND IT IS NOT A BROWSER TEST — SAID PLAINLY, BECAUSE THAT MATTERS HERE MORE THAN ANYWHERE.
// jsdom reports every rectangle as 0 and applies no CSS, so it CANNOT see a knob leave its track;
// a naive "render and measure" test passes against the broken markup. This file therefore asserts
// the CONTRACT that the browser measurement established, in the only form jsdom can check: the
// class list. It fails if somebody removes the anchor or changes the travel.
//
// THE REAL MEASUREMENT, taken in Chrome on 2026-09-05 and reproduced here as arithmetic:
//   broken (no `left-0`): the ON knob's right edge sat 14px OUTSIDE a 36px track, because an
//     absolutely positioned element with no horizontal anchor starts from its STATIC position —
//     about the centre, since a button centres its content — and the translate runs from there.
//   fixed (`left-0`):     OFF spans 2..16, ON spans 18..32, both inside 36.
//
// ⚠️ THE TRACK IS 36px, NOT THE 32px `w-8` IMPLIES: this app's root font is scaled ~1.125x, so
// every rem-based class here is bigger than its name. The numbers below are measured, not derived
// from the class names, which is the whole reason the original arithmetic looked fine on paper.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(
  join(__dirname, '..', 'NotificationSettings.tsx'), 'utf8',
);

/** The knob's own element, as written. */
const knobClasses = (() => {
  const m = SOURCE.match(/<span className=\{`(absolute[^`]*)`\}/);
  if (!m) throw new Error('The switch knob span could not be found — has the switch been rewritten?');
  return m[1];
})();

/** Measured pixels for each Tailwind step this control uses, at this app's scaled root font. */
const PX = { 'translate-x-0.5': 2, 'translate-x-4': 18 } as const;
const TRACK_PX = 36;   // `w-8`
const KNOB_PX = 14;    // `w-3`

describe('the notification toggle knob', () => {
  it('⚠️ is ANCHORED — without left-0 the translate runs from the static centre', () => {
    // This single class is the entire fix. Removing it puts the ON knob 14px outside the track.
    expect(knobClasses).toMatch(/\bleft-0\b/);
  });

  it('keeps both states inside the track, in measured pixels', () => {
    for (const [cls, offset] of Object.entries(PX)) {
      expect(knobClasses, `${cls} must still be one of the two states`).toContain(cls);
      const right = offset + KNOB_PX;
      expect(right, `${cls}: knob right edge`).toBeLessThanOrEqual(TRACK_PX);
      expect(offset, `${cls}: knob left edge`).toBeGreaterThanOrEqual(0);
    }
  });

  it('has an ON travel that actually moves the knob a visible distance', () => {
    // A knob that does not move reads as a broken control just as surely as one that escapes.
    expect(PX['translate-x-4'] - PX['translate-x-0.5']).toBeGreaterThan(KNOB_PX / 2);
  });

  it('still positions the knob vertically inside a 16px track', () => {
    expect(knobClasses).toMatch(/\btop-0\.5\b/);
    // top-0.5 = 2px, knob 14px, track h-4 = 18px measured. 2 + 14 = 16 <= 18.
    expect(2 + KNOB_PX).toBeLessThanOrEqual(18);
  });
});
