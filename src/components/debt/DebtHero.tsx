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
  /**
   * True when a card is set to "always pay this, no matter what" and this month cannot cover it.
   *
   * ⚠️ IT CHANGES THE ABSENCE MESSAGE, AND THAT IS THE WHOLE POINT. Measured in a browser on
   * 2026-09-13: with an unconditional card overdrawing the month, the debt-cash convergence does
   * not settle — five reads over 25 seconds, never a figure. The default copy says the plan
   * "hasn't finished calculating", which invites the user to wait for something that is never
   * going to arrive. Saying WHY, and that it is a consequence of a setting they chose, is the
   * difference between an absence and a broken-looking page.
   *
   * ⚠️ THIS DOES NOT FIX THE CONVERGENCE, and the copy does not imply it does. Making the fixed
   * point tolerate a deliberate overdraw is real engine work and is not claimed here.
   */
  unconditionalShortfall?: boolean;
};

export const DEBT_HERO_AT_PLAN_ABSENT =
  "at plan: no reading yet — the payoff plan hasn't finished calculating";

/** The same absence, when the cause IS known. Named so a test cannot drift from the render. */
export const DEBT_HERO_AT_PLAN_UNCONDITIONAL =
  'at plan: no reading — a card is set to always pay in full and this month cannot cover it, '
  + 'so next month\'s interest cannot be projected. The payment is still being sent in full.';

export default function DebtHero({ interestThisMonth, interestAtPlan, unconditionalShortfall }: Props) {
  return (
    <div className="card-forged p-4 sm:p-6">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Interest this month</p>
      <p className="text-4xl sm:text-5xl font-display font-bold tracking-tight text-foreground leading-none mt-1.5">
        {formatCurrency(interestThisMonth, true)}
      </p>
      {interestAtPlan === null ? (
        <p className="text-xs text-muted-foreground mt-2">
          {unconditionalShortfall ? DEBT_HERO_AT_PLAN_UNCONDITIONAL : DEBT_HERO_AT_PLAN_ABSENT}
        </p>
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
