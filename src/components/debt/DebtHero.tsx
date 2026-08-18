import { formatCurrency } from '@/lib/calculations';

/**
 * /debt's hero: the one number the page is about, at hero scale (DIRECTION.md rule 2 — "a number
 * is the hero or it isn't shown"). "Now" is what the cards charge this month; "at plan" is what
 * they charge next month once the recommended payments land.
 *
 * `interestAtPlan` is null when there is no plan to read — the debt-cash convergence has not
 * settled yet. That half then renders as an ABSENCE, never $0: a gauge reading zero and a gauge
 * that failed to read must never look the same (DIRECTION.md rule 3).
 *
 * Numbers are foreground, not gold — gold is reserved for money in motion and primary actions.
 */

type Props = {
  /** Interest the cards charge this month, summed across projections. */
  interestThisMonth: number;
  /** Interest next month under the recommended-payment plan, or null when there is no reading. */
  interestAtPlan: number | null;
};

export const DEBT_HERO_AT_PLAN_ABSENT =
  "at plan: no reading yet — the payoff plan hasn't finished calculating";

export default function DebtHero({ interestThisMonth, interestAtPlan }: Props) {
  return (
    <div className="card-forged p-4 sm:p-6">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Interest this month</p>
      <p className="text-4xl sm:text-5xl font-display font-bold tracking-tight text-foreground leading-none mt-1.5">
        {formatCurrency(interestThisMonth, true)}
      </p>
      {interestAtPlan === null ? (
        <p className="text-xs text-muted-foreground mt-2">{DEBT_HERO_AT_PLAN_ABSENT}</p>
      ) : (
        <p className="text-xs text-muted-foreground mt-2">
          at plan:{' '}
          <span className="font-display font-semibold text-foreground">
            {formatCurrency(interestAtPlan, true)}
          </span>{' '}
          next month
        </p>
      )}
    </div>
  );
}
