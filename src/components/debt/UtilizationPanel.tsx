import { AlertTriangle } from 'lucide-react';
import MoreInfo from '@/components/shared/MoreInfo';
import { formatCurrency } from '@/lib/calculations';
import type { OverallUtilization } from '@/lib/credit-utilization';

type Props = {
  summary: OverallUtilization;
};

/**
 * Where the card debt stands right now: overall utilization, how much of it is actually charging
 * interest, and the open limit behind it.
 *
 * ⚠️ THE "PAY-DOWN ORDER FOR SCORE" TABLE WAS DELETED ON 2026-08-27, along with `PaydownPlanPanel`.
 * Tre: *"delete these from the credit card section. its complicated and not easy to understand for
 * users."* A score-order ranking that disagrees with the interest order the engine actually pays,
 * with a per-dollar point preview beside it, asked the user to arbitrate between two plans — the
 * page already states one plan and its date.
 *
 * ⚠️ THE THREE FIGURES NOW SIT INSIDE THE SUMMARY TILES THEY BREAK DOWN (Tre, 2026-10-03: "stuff
 * still looks misaligned"). As a second 3-column strip they never lined up with the 4-column row
 * above them. Interest-bearing and 0%-plan balances are the split of Total CC Balance, and the open
 * limit is the denominator of Utilization, so `CreditCardEngine` prints each under its parent.
 * What is left here is the two notes, which span the card and share the tiles' left edge.
 */
export default function UtilizationPanel({ summary }: Props) {
  const hasPlanNote = summary.utilizationOnlyBalance > 0;
  const hasFutureNote = summary.futureCards.length > 0;
  if (!hasPlanNote && !hasFutureNote) return null;

  return (
    <div className="mt-4 pt-3 border-t border-border/50 space-y-1.5" data-testid="utilization-breakdown">
      {hasPlanNote && (
        <MoreInfo label="0% plans and utilization" testId="zero-plan-note">
          0% plans lower utilization when paid down but save no interest. Paying interest-bearing
          balance does both.
        </MoreInfo>
      )}

      {hasFutureNote && (
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
