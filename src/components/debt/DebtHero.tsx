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

/**
 * Shown when interest at plan is HIGHER than this month's. Interest is a flat APR/12 of the
 * balance (credit-card-engine.ts), so it rises only when the balance does - and the balance rises
 * only when this month's remaining payments are smaller than the interest and charges it adds.
 * That sentence is therefore true of every cause, and it does not name one it cannot see.
 * Measured case (2026-09-28, walk account): the card's due day had already passed, so the engine
 * pays $0 more this month (by design, credit-card-engine.ts manualStmtDueNow) and one month of
 * interest lands on the balance: $4,200 -> $4,266.46, interest $66.46 -> $67.52.
 */
export const DEBT_HERO_AT_PLAN_RISING =
  "Higher next month: the payments left this month are smaller than the interest and charges it adds, so the balance grows first.";

/** Half a cent: two figures that print the same must never read as "rising". */
function isInterestRising(interestThisMonth: number, interestAtPlan: number | null): boolean {
  return interestAtPlan !== null && interestAtPlan - interestThisMonth >= 0.005;
}

export default function DebtHero({ interestThisMonth, interestAtPlan, unconditionalShortfall }: Props) {
  const rising = isInterestRising(interestThisMonth, interestAtPlan);
  const note = interestAtPlan === null
    ? (unconditionalShortfall ? DEBT_HERO_AT_PLAN_UNCONDITIONAL : DEBT_HERO_AT_PLAN_ABSENT)
    : rising ? DEBT_HERO_AT_PLAN_RISING : null;
  return (
    <div className="card-forged p-4 sm:p-6">
      {/* The plan figure shares the big number's row (aaafa7ee: the card was a full-width box
          holding one short figure, 158px of empty width at 390). The explanation sits under both
          on a phone, and from lg up it moves INTO the gap between them (Tre, 2026-10-03, ask
          1be673ad: a 1296px card held its figure at the left edge, the plan figure at the right
          and an empty middle - 14.6% filled). Same sentence, never trimmed; only its cell moves. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-4 gap-y-2 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-x-10">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Interest this month</p>
          <p className="text-4xl sm:text-5xl font-display font-bold tracking-tight text-foreground leading-none mt-1.5">
            {formatCurrency(interestThisMonth, true)}
          </p>
        </div>
        {interestAtPlan !== null && (
          <p className="text-xs text-muted-foreground text-right whitespace-nowrap lg:col-start-3 lg:row-start-1">
            at plan:{' '}
            <span className="block text-lg font-display font-semibold text-foreground leading-tight">
              {formatCurrency(interestAtPlan, true)}
            </span>{' '}
            next month
          </p>
        )}
        {note !== null && (
          <p className="col-span-2 text-xs text-muted-foreground lg:col-span-1 lg:col-start-2 lg:row-start-1">
            {note}
          </p>
        )}
      </div>
    </div>
  );
}
