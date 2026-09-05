// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import LiabilityTrajectoryChart from '../LiabilityTrajectoryChart';
import type { LiabilityTrajectoryInput } from '@/lib/liability-trajectory';

/**
 * MOBILE TAP MUST SELECT A POINT THE SAME WAY A MOUSE HOVER DOES ON DESKTOP.
 *
 * ROOT CAUSE (node_modules/recharts/es6/state/touchEventsMiddleware.js): Recharts wires
 * `setMouseOverAxisIndex` to the `touchmove` DOM event ONLY — `RechartsWrapper.js`'s own
 * `onTouchStart` handler never reads position at all, it only forwards to a caller-supplied
 * `onTouchStart` prop (`externalEventsMiddleware.js`). A stationary tap — the normal way
 * anyone touches a chart on a phone — is a `touchstart` immediately followed by a `touchend`
 * with no `touchmove` in between, so nothing is ever selected on mobile. A mouse gets the same
 * first contact for free, because merely entering the chart already fires `mousemove`, and
 * that alone is what recharts listens for (`mouseEventsMiddleware.js`).
 *
 * THE FIX (`LiabilityTrajectoryChart.tsx`'s `selectPointOnTouch`): replay the tap's own touch
 * list as a real `touchmove` DOM event on the same element, the moment `touchstart` fires —
 * `onTouchStart` is Recharts' own documented chart prop, so this stays inside Recharts' public
 * event API rather than reaching into its Redux internals. This test asserts exactly that
 * replay happens: fire a touchstart with no touchmove, and check that the wrapper element also
 * receives a genuine `touchmove` carrying the same touch, which is the point at which Recharts'
 * OWN (already-shipping, real-browser-verified) drag-to-select machinery takes over.
 *
 * WHY THE TEST DOES NOT GO ONE LEVEL DEEPER AND CHECK THE RENDERED TOOLTIP CONTENT: jsdom has no
 * SVG layout engine at all — `SVGElement.prototype.getBBox`, `getComputedTextLength` and
 * `getScreenCTM` do not exist (verified directly against jsdom 30, this repo's installed
 * version). Recharts' own axis/scale math depends on that geometry, and WITHOUT it even a plain
 * `fireEvent.mouseMove` — real mouse hover, the behaviour already shipping today — does not
 * select a point in this harness either; this was confirmed empirically against an unmodified
 * copy of this exact component before writing this fix. Recharts point-selection has no
 * existing component-level test anywhere in this repo for the same reason: it is not something
 * jsdom can exercise. The mechanism above is what live-browser verification cannot be swapped
 * out for automatically, so it is what this suite locks down; the `dev-signin` skill's live
 * Chrome check is the way to see the tooltip itself appear.
 */

const STUDENT_LOAN: LiabilityTrajectoryInput = {
  id: 'debt:nelnet',
  name: 'Nelnet',
  balances: Array.from({ length: 60 }, (_, i) => Math.max(0, 8000 - i * 140)),
};

beforeAll(() => {
  class ResizeObserverStub {
    observe() { /* ResponsiveContainer reads getBoundingClientRect() itself right after construction */ }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);

  // ResponsiveContainer needs a non-zero box to mount a `<LineChart>` at all, mouse or touch.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, width: 600, height: 220, top: 0, left: 0, right: 600, bottom: 220,
    toJSON: () => {},
  } as DOMRect);
});

afterEach(cleanup);

describe('LiabilityTrajectoryChart — touch selection', () => {
  it('replays a stationary tap as a touchmove, so Recharts selects a point the way it does on mouse hover', () => {
    const { container } = render(
      <LiabilityTrajectoryChart title="Student Loan Payoff Trajectory" debts={[STUDENT_LOAN]} storageKey="test:touch:chart-years" />,
    );
    const wrapper = container.querySelector('.recharts-wrapper');
    expect(wrapper).not.toBeNull();

    let touchMoveSeen: { clientX: number; clientY: number } | null = null;
    wrapper!.addEventListener('touchmove', (e) => {
      const t = (e as TouchEvent).touches[0];
      touchMoveSeen = { clientX: t.clientX, clientY: t.clientY };
    });

    // A tap: contact and release, no drag — this is the assertion that fails on the
    // un-patched component, since Recharts itself never reads `touchstart` for selection.
    fireEvent.touchStart(wrapper!, { touches: [{ clientX: 300, clientY: 110, identifier: 0 }] });

    expect(touchMoveSeen).not.toBeNull();
    expect(touchMoveSeen!).toEqual({ clientX: 300, clientY: 110 });
  });

  it('does nothing on a tap with no touches (e.g. a trailing touchend) — no phantom selection', () => {
    const { container } = render(
      <LiabilityTrajectoryChart title="Student Loan Payoff Trajectory" debts={[STUDENT_LOAN]} storageKey="test:touch:chart-years-empty" />,
    );
    const wrapper = container.querySelector('.recharts-wrapper')!;
    let touchMoveSeen = false;
    wrapper.addEventListener('touchmove', () => { touchMoveSeen = true; });

    fireEvent.touchStart(wrapper, { touches: [] });

    expect(touchMoveSeen).toBe(false);
  });
});
