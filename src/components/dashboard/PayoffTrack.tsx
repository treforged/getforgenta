import { useId } from 'react';
import { formatCurrency } from '@/lib/calculations';
import type { PayoffTrajectory } from '@/lib/payoff-trajectory';

/**
 * The payoff run, drawn.
 *
 * The milestone used to be a date and a count — true, and inert. This is the same plan the
 * date comes from, shown as the curve it actually is, so the hero reads like the build
 * thread the audience already keeps: where the balance is now, where it lands, and the
 * shape in between.
 *
 * ⚠️ It draws ONLY what `buildPayoffTrajectory` published. There is no interpolation, no
 * smoothing and no synthetic endpoint: the last point is the engine's own figure for the
 * payoff month. When the trajectory is null the caller renders nothing at all — a flat line
 * on the axis and a chart that failed to read look identical.
 *
 * Gold is the stroke because a balance falling to zero is money in motion, which is the one
 * thing DIRECTION.md reserves the colour for. The hero NUMBER stays `text-foreground`.
 *
 * Inline SVG rather than the charting library: this is four dozen points with no axes, no
 * tooltip and no interaction, and recharts costs ~400 kB in the first-paint chunk.
 */
export default function PayoffTrack({
  trajectory,
  endLabel,
}: {
  trajectory: PayoffTrajectory;
  /** The month the run ends, already formatted by the caller ("Jun 2028"). */
  endLabel: string;
}) {
  const gradientId = useId();
  const { points, startBalance } = trajectory;

  // preserveAspectRatio="none" stretches the box to whatever width the card gives it; the
  // stroke is kept honest with vector-effect rather than by guessing an aspect ratio.
  const W = 100;
  const H = 28;
  const lastIndex = points.length - 1;
  const coords = points.map((p, i) => {
    const x = lastIndex === 0 ? 0 : (i / lastIndex) * W;
    const y = H - Math.min(1, Math.max(0, p.balance / startBalance)) * H;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <div className="mt-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-12"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.28" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          points={`0,${H} ${coords.join(' ')} ${W},${H}`}
          fill={`url(#${gradientId})`}
        />
        <polyline
          points={coords.join(' ')}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* The curve is decoration without these: they are what make it a reading. */}
      <div className="flex items-baseline justify-between mt-1.5 text-xs text-muted-foreground">
        <span>{formatCurrency(startBalance, false)} today</span>
        <span>$0 · {endLabel}</span>
      </div>
    </div>
  );
}
