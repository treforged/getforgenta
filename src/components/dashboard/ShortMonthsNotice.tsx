import { Link } from 'react-router';
import { X } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import type { MonthShortfall } from '@/lib/breach-levers';

/**
 * One quiet line under the Dashboard hero when a month in the next year ends below the cash
 * floor, linking to the Forecast card that ranks what would cover it (ShortfallLevers).
 *
 * Sam, 2026-09-29: "one line, only when a breach is within 12 months, and dismissible for the
 * month. A money warning that shows every day stops being read." So a dismissal holds for the
 * CURRENT calendar month and the line returns on the 1st if the shortfall is still there.
 */
type Props = {
  shortMonths: MonthShortfall[];
  /** 'YYYY-MM' of today, local time. */
  currentMonth: string;
  dismissedMonth: string;
  onDismiss: (month: string) => void;
};

export default function ShortMonthsNotice({ shortMonths, currentMonth, dismissedMonth, onDismiss }: Props) {
  if (shortMonths.length === 0 || dismissedMonth === currentMonth) return null;
  const [first] = shortMonths;
  const more = shortMonths.length - 1;

  return (
    <div className="card-forged px-3 py-2.5 flex items-start gap-2" role="status">
      <p className="flex-1 min-w-0 text-xs text-foreground">
        {first.month} ends {formatCurrency(first.shortfall)} below your cash floor
        {more > 0 && <>, and {more} more {more === 1 ? 'month' : 'months'} in the next year</>}.{' '}
        <Link to="/transactions?tab=forecast" className="font-semibold text-primary whitespace-nowrap">
          See what would cover it
        </Link>
      </p>
      <button
        type="button"
        onClick={() => onDismiss(currentMonth)}
        aria-label="Hide for this month"
        className="shrink-0 p-1 -m-1 text-muted-foreground hover:text-foreground"
      >
        <X size={14} />
      </button>
    </div>
  );
}
