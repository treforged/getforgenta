import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import type { CardData } from '@/lib/credit-card-engine';
import { summarizeUtilization } from '@/lib/credit-utilization';

type Props = {
  cards: CardData[];
};

/**
 * Where the card debt stands right now: overall utilization, how much of it is actually charging
 * interest, and the open limit behind it.
 *
 * ⚠️ THE "PAY-DOWN ORDER FOR SCORE" TABLE WAS DELETED ON 2026-08-27, along with `PaydownPlanPanel`.
 * Tre: *"delete these from the credit card section. its complicated and not easy to understand for
 * users."* A score-order ranking that disagrees with the interest order the engine actually pays,
 * with a per-dollar point preview beside it, asked the user to arbitrate between two plans — the
 * page already states one plan and its date. The four figures below are kept because each is a
 * plain fact about the accounts rather than a second opinion about them.
 */
export default function UtilizationPanel({ cards }: Props) {
  const now = useMemo(() => new Date(), []);

  const summary = useMemo(() => summarizeUtilization(cards, now), [cards, now]);

  if (cards.length === 0) return null;

  return (
    <div className="card-forged p-3 sm:p-4 space-y-3 sm:space-y-4">
      <span className="text-[10px] sm:text-[11px] text-muted-foreground uppercase font-medium tracking-wider">
        Utilization — a second goal alongside interest
      </span>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Overall Utilization</p>
          <p className="text-base sm:text-lg font-display font-bold mt-0.5">
            {summary.utilizationPct != null ? `${summary.utilizationPct.toFixed(1)}%` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Interest-Bearing</p>
          <p className="text-base sm:text-lg font-display font-bold mt-0.5 text-destructive">
            {formatCurrency(summary.interestBearingBalance, false)}
          </p>
        </div>
        <div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Utilization-Only (0%)</p>
          <p className="text-base sm:text-lg font-display font-bold mt-0.5 text-primary">
            {formatCurrency(summary.utilizationOnlyBalance, false)}
          </p>
        </div>
        <div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Open Limit</p>
          <p className="text-base sm:text-lg font-display font-bold mt-0.5">{formatCurrency(summary.totalLimit, false)}</p>
        </div>
      </div>

      {summary.utilizationOnlyBalance > 0 && (
        <p className="text-[10px] sm:text-[11px] text-muted-foreground">
          {formatCurrency(summary.utilizationOnlyBalance, false)} of the balance above is on 0%-interest
          installment plans — paying it down lowers utilization (and your score) but saves no interest.
          Paying down interest-bearing balance does both.
        </p>
      )}

      {summary.futureCards.length > 0 && (
        <div className="flex items-start gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground">
          <AlertTriangle size={12} className="shrink-0 mt-0.5 text-primary" />
          <span>
            Not counted in the utilization above yet:{' '}
            {summary.futureCards.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ', '}
                {c.name} ({formatCurrency(c.creditLimit, false)} limit, opens in {c.opensInMonths} mo)
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
