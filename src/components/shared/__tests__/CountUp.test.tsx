// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import CountUp from '../CountUp';
import { staggerFor, STAGGER_MAX_TOTAL } from '@/lib/motion';

// This file guards two separate promises.
//
// The accessibility one: a counting number is briefly showing figures that are
// not true, in an app whose standing rule is never to display a number it
// cannot stand behind. The resolution is that the *accessible* value is always
// the real one, and that reduced motion removes the animation entirely. If
// either regresses, the animation stops being polish and becomes a defect — so
// both are pinned here rather than left to a code review.
//
// The correctness one: however the tween behaves, the number must LAND on the
// exact value. A count-up that finishes a cent short of a total is worse than
// no animation at all.
//
// 🔬 `usePrefersReducedMotion` is mocked rather than driven through a fake
// `matchMedia`, and that was measured rather than preferred: framer-motion
// resolves its reduced-motion state ONCE and caches it globally, so whichever
// value the first test in the file established leaked into every test after it
// and the reduced-motion cases silently asserted nothing. Mocking the seam this
// codebase owns tests the branch this component actually contains; that the
// hook reads the media query correctly is framer-motion's own contract.

let reduced = false;

vi.mock('@/hooks/use-reduced-motion', () => ({
  usePrefersReducedMotion: () => reduced,
}));

const money = (n: number) => `$${n.toLocaleString()}`;

beforeEach(() => {
  reduced = false;
});

afterEach(() => {
  cleanup();
});

describe('CountUp — the accessible value is always the true one', () => {
  it('exposes the final value on aria-label from the very first frame', () => {
    render(<CountUp value={12400} format={money} />);

    // Before any time has passed the visible text may well read "$0" — that is
    // the animation starting. What must never be true is that assistive tech
    // sees $0, because a screen reader user would be told the build cost
    // nothing.
    const el = screen.getByTestId('count-up');
    expect(el.getAttribute('aria-label')).toBe('$12,400');
    expect(el.getAttribute('data-count-value')).toBe('12400');
  });

  it('hides the animating text from assistive tech', () => {
    render(<CountUp value={999} format={money} />);
    const inner = screen.getByTestId('count-up').querySelector('[aria-hidden="true"]');
    expect(inner).not.toBeNull();
  });

  it('updates the accessible value immediately when the true value changes', () => {
    const { rerender } = render(<CountUp value={100} format={money} />);
    rerender(<CountUp value={250} format={money} />);

    // Not after the tween — immediately. The label is the truth, not a preview.
    expect(screen.getByTestId('count-up').getAttribute('aria-label')).toBe('$250');
  });
});

describe('CountUp — prefers-reduced-motion', () => {
  it('renders the final value synchronously, with no animation at all', () => {
    reduced = true;
    render(<CountUp value={8250} format={money} />);

    // Nothing awaited. With reduced motion the number simply IS its value, so
    // there is nothing to wait for and nothing to re-read.
    expect(screen.getByTestId('count-up').textContent).toBe('$8,250');
  });

  it('still shows the truth when the value changes', () => {
    reduced = true;
    const { rerender } = render(<CountUp value={10} format={money} />);
    rerender(<CountUp value={4321} format={money} />);
    expect(screen.getByTestId('count-up').textContent).toBe('$4,321');
  });

  it('animates when reduced motion is NOT requested — so the test above is meaningful', () => {
    // Without this, both reduced-motion tests would still pass if the component
    // stopped animating entirely, and they would be pinning nothing.
    reduced = false;
    render(<CountUp value={8250} format={money} />);
    expect(screen.getByTestId('count-up').textContent).not.toBe('$8,250');
  });
});

describe('CountUp — it lands exactly', () => {
  it('finishes on the exact value, to the cent', async () => {
    const cents = (n: number) => `$${n.toFixed(2)}`;
    render(<CountUp value={1234.56} format={cents} decimals={2} duration={0.05} />);

    // The risk this pins: an easing curve that asymptotes, leaving a total a
    // fraction short forever. The component assigns the exact value on
    // completion rather than trusting the last frame of the tween. The real
    // tween runs here — it is not mocked — so this also proves the animation
    // actually completes rather than stalling.
    await waitFor(() => {
      expect(screen.getByTestId('count-up').textContent).toBe('$1234.56');
    });
  });

  it('does not animate away from a value it cannot tween toward', () => {
    // A NaN upstream must not flicker "$NaN" toward nothing; it should fail
    // visibly and immediately rather than animate.
    render(<CountUp value={Number.NaN} format={n => (Number.isNaN(n) ? '—' : money(n))} />);
    expect(screen.getByTestId('count-up').textContent).toBe('—');
  });

  it('does not count up from zero when told not to', () => {
    render(<CountUp value={500} format={money} animateOnMount={false} />);
    expect(screen.getByTestId('count-up').textContent).toBe('$500');
  });
});

describe('staggerFor — a long list still lands quickly', () => {
  it('gives the first child no delay', () => {
    expect(staggerFor(0, 10)).toBe(0);
  });

  it('never lets the last child arrive after the cap, however long the list', () => {
    // The bug this prevents: a fixed per-child delay looks charming on five
    // rows and means the eightieth row of a service history arrives seconds
    // after the first.
    for (const count of [2, 5, 40, 500]) {
      expect(staggerFor(count - 1, count)).toBeLessThanOrEqual(STAGGER_MAX_TOTAL + 1e-9);
    }
  });

  it('is monotonic — later rows never arrive before earlier ones', () => {
    const delays = Array.from({ length: 12 }, (_, i) => staggerFor(i, 12));
    const sorted = [...delays].sort((a, b) => a - b);
    expect(delays).toEqual(sorted);
  });

  it('treats a single-item list as instant', () => {
    expect(staggerFor(0, 1)).toBe(0);
  });
});
