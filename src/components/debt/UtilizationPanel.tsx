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

  // ⚠️ RENDERED INSIDE THE SUMMARY CARD, BELOW ITS TILES (Tre, 2026-10-01: "unecessary/duplicate
  // info"). It used to be its own card whose first tile, "Overall Utilization", printed the same
  // percentage as the summary's "Utilization" tile directly above it. The three figures it adds
  // are the BREAKDOWN of that percentage, so they now sit under it as one strip.
  return (
    <div className="mt-4 pt-3 border-t border-border/50 space-y-2" data-testid="utilization-breakdown">
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Interest-Bearing</p>
          <p className="text-sm sm:text-base font-display font-bold mt-0.5 text-destructive-text">
            {formatCurrency(summary.interestBearingBalance)}
          </p>
        </div>
        <div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">On 0% Plans</p>
          <p className="text-sm sm:text-base font-display font-bold mt-0.5 text-primary">
            {formatCurrency(summary.utilizationOnlyBalance)}
          </p>
        </div>
        <div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Open Limit</p>
          <p className="text-sm sm:text-base font-display font-bold mt-0.5">{formatCurrency(summary.totalLimit)}</p>
        </div>
      </div>

      {summary.utilizationOnlyBalance > 0 && (
        <p className="text-[10px] sm:text-[11px] text-muted-foreground">
          0% plans lower utilization when paid down but save no interest. Paying interest-bearing
          balance does both.
        </p>
      )}

      {summary.futureCards.length > 0 && (
        <div className="flex items-start gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground">
          <AlertTriangle size={12} className="shrink-0 mt-0.5 text-primary" />
          <span>
            Not counted yet:{' '}
            {summary.futureCards.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ', '}
                {c.name} ({formatCurrency(c.creditLimit)} limit, opens in {c.opensInMonths} mo)
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
