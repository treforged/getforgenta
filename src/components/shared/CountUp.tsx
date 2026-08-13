import { useEffect, useState } from 'react';
import { animate, useMotionValue } from 'framer-motion';
import { MOTION_DURATION, EASE_OUT } from '@/lib/motion';
import { usePrefersReducedMotion } from '@/hooks/use-reduced-motion';

interface CountUpProps {
  /** The true value. Whatever happens visually, this is what the number means. */
  value: number;
  /** Renders a number as the string the user reads. Must be pure. */
  format: (n: number) => string;
  /**
   * Decimal places the display is quantised to. Drives how often the component
   * re-renders — there is no point re-rendering for a change the formatter
   * rounds away. Match it to what `format` actually shows.
   */
  decimals?: number;
  /** Count up from zero the first time this mounts. */
  animateOnMount?: boolean;
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
}

function quantise(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * A figure that counts to its value instead of snapping to it.
 *
 * Used where a number *changes in response to something the user just did* —
 * ticking an item complete on a build, logging a service — because the movement
 * is what connects the action to its consequence. A total that silently becomes
 * a different total makes the user re-read the screen to find what changed.
 *
 * ## The honesty problem, and how this handles it
 *
 * ⚠️ A counting number is, for a fraction of a second, **showing figures that
 * are not true**. This is a financial app whose standing rule is never to
 * display a number it cannot stand behind, so that tension is resolved
 * explicitly rather than ignored:
 *
 * - **The accessibility tree only ever holds the real value.** The animated
 *   text is `aria-hidden`; the `aria-label` on the wrapper is the formatted
 *   final value, updated the instant `value` changes. A screen reader, and
 *   anything else reading the DOM semantically, never sees an intermediate.
 * - **`data-count-value` carries the true value** for tests and for anyone
 *   debugging a figure on screen.
 * - **It is short** (`MOTION_DURATION.count`), and it always lands exactly on
 *   `value` — the final frame is an assignment, not the tail of an easing
 *   curve, so no rounding drift can leave a cent behind.
 * - **It is never used for a number that is still loading.** Counting up from
 *   zero to a placeholder would be the exact "confident zero" the project
 *   forbids. Callers render a skeleton until the real figure exists.
 *
 * With reduced motion requested, the number simply *is* its value — no count,
 * no delay, nothing to re-read.
 */
export default function CountUp({
  value,
  format,
  decimals = 0,
  animateOnMount = true,
  duration = MOTION_DURATION.count,
  className,
  style,
}: CountUpProps) {
  const reduced = usePrefersReducedMotion();

  // Reduced motion, or a value that cannot be tweened toward at all (a NaN from
  // a bad computation upstream): there is nothing to animate, so `value` is
  // rendered directly. Deriving this rather than pushing it into state from the
  // effect is what keeps the non-animating path a plain render — no cascading
  // re-render, and no window in which the wrong number is on screen.
  const canAnimate = !reduced && Number.isFinite(value);

  const motionValue = useMotionValue(animateOnMount ? 0 : value);
  const [tweened, setTweened] = useState(() => (animateOnMount ? 0 : value));

  useEffect(() => {
    if (!canAnimate) return;

    const unsubscribe = motionValue.on('change', latest => {
      // Quantising means React bails out of the re-render whenever the change
      // is smaller than the formatter would show, so a 60fps tween costs only
      // as many renders as there are visibly distinct numbers.
      setTweened(quantise(latest, decimals));
    });

    const controls = animate(motionValue, value, {
      duration,
      ease: EASE_OUT,
      // Land on the exact value rather than wherever the curve finished.
      onComplete: () => setTweened(value),
    });

    return () => {
      controls.stop();
      unsubscribe();
    };
  }, [value, canAnimate, decimals, duration, motionValue]);

  const display = canAnimate ? tweened : value;

  return (
    <span
      className={className}
      style={style}
      aria-label={format(value)}
      data-count-value={String(value)}
      data-testid="count-up"
    >
      <span aria-hidden="true">{format(display)}</span>
    </span>
  );
}
