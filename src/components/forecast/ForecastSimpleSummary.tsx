import { formatCurrency } from '@/lib/calculations';
import type { LowPoint } from '@/lib/forecast-low-point';

/**
 * The Simple view's two answers under the milestone (ask 5b166e10): the lowest cash the forecast
 * reaches and when, and how many of the next 12 months end below the floor. Both are read from
 * figures the page already has - no new money maths. Advanced shows `ShortfallLevers` here instead.
 *
 * A null low point (no rows yet) shows nothing rather than a confident $0.
 */
type Props = {
  lowPoint: LowPoint | null;
  shortMonthCount: number;
};

export default function ForecastSimpleSummary({ lowPoint, shortMonthCount }: Props) {
  if (!lowPoint) return null;
  const one = shortMonthCount === 1;
  return (
    <div className="card-forged p-4 sm:p-5 grid grid-cols-2 gap-4" data-testid="forecast-simple-summary">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Lowest point</p>
        <p className="font-display font-bold text-lg mt-1">{formatCurrency(lowPoint.endingCash)}</p>
        <p className="text-xs text-muted-foreground">{lowPoint.month}</p>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Below your floor</p>
        <p className={`font-display font-bold text-lg mt-1 ${shortMonthCount > 0 ? 'text-destructive-text' : ''}`}>
          {shortMonthCount} {one ? 'month' : 'months'}
        </p>
        <p className="text-xs text-muted-foreground">in the next 12</p>
      </div>
    </div>
  );
}
