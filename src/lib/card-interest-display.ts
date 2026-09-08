/**
 * What the TOTAL INTEREST tile is allowed to say.
 *
 * ⚠️ A CARD THAT NEVER PAYS OFF HAS NO TOTAL INTEREST, AND PRINTING ONE IS A LIE THE SIZE OF THE
 * HORIZON. `projectCardVariable` walks `Math.max(months, 360)` months to discover a payoff month.
 * When monthly purchases outrun the payment the balance compounds for thirty years and the sum
 * diverges: **$19,007,108 on a $4,318 card**, found live on the PUBLIC demo by Ruby on 2026-09-08,
 * beside a $25 minimum and $743/month of purchases.
 *
 * The figure was arithmetically honest and completely useless as information — nobody reads
 * nineteen million dollars as "this card is growing", they read it as a broken app. This is the
 * same confident-number failure the codebase refuses elsewhere, in its loudest form.
 *
 * ⚠️ NOT THE SAME BUG AS THE `$132k` ONE, and the difference decides the fix. That card
 * (`credit-card-engine.revolvingDustPayoff.test.ts`) DID pay off — $0.04 of rounding dust defeated
 * the detection, so `payoffMonth` stayed null and the post-window walk compounded a PHANTOM. The
 * fix there was better detection. Here the divergence is REAL: the card genuinely never reaches
 * zero, so there is no better number to find and the only honest output is to say so.
 *
 * The payoff label on the same card already reads "Payoff: N/A" in this state. This tile disagreed
 * with the label sitting next to it, which is how it survived being looked at.
 */

/** The one state where a total cannot be shown, expressed so both callers cannot drift. */
export const NO_PAYOFF_LABEL = 'Never pays off';

export const NO_PAYOFF_EXPLANATION =
  'At this payment and this rate of new purchases, the balance never reaches zero, so there is no total to show.';

/**
 * `null` payoffMonth means the projection never reached zero within its 360-month discovery walk.
 * Returns the label to render, or `null` when the real figure should be formatted and shown.
 */
export function totalInterestLabel(payoffMonth: number | null | undefined): string | null {
  return payoffMonth === null || payoffMonth === undefined ? NO_PAYOFF_LABEL : null;
}

/**
 * The premium-gate bullet, which is the same divergence attached to a SALES claim and therefore
 * worse: "Save $19,007,108 in total interest" is not a benefit, it is an obviously false promise
 * next to a price. A card that never pays off gets the honest offer instead.
 */
export function interestSavingsBullet(
  payoffMonth: number | null | undefined,
  formattedTotal: string,
): string {
  return totalInterestLabel(payoffMonth) === null
    ? `Save ${formattedTotal} in total interest`
    : 'See what it takes to stop this card growing';
}

/**
 * ⚠️ A CARD THAT NEVER PAYS OFF WAS BEING COUNTED AS PAID OFF AT MONTH ZERO.
 *
 * The `/debt` header read `PAYOFF ETA: Paid` while `/dashboard` read `Not within 5 years` for the
 * same data (found by Ruby, 2026-09-08, who froze capture of that card over the contradiction).
 * Three other figures on the card sided against "Paid".
 *
 * Same root as the total-interest divergence above, pointed the other way. The aggregate was
 * `Math.max(0, ...projections.map(p => p.payoffMonth ?? 0))`, and `?? 0` turns "never" into
 * "immediately": a null collapses to 0, `Math.max` keeps the largest, and when every card is null
 * the result is 0, which the caller renders as **Paid**. The most alarming state the app can be in
 * was displayed as the most reassuring one.
 *
 * `'never'` is returned rather than a sentinel number so no caller can accidentally compare it,
 * and `'paid'` is reserved for genuinely having nothing left to pay.
 */
export type PayoffEta = { kind: 'paid' } | { kind: 'never' } | { kind: 'month'; month: number };

export function aggregatePayoffEta(payoffMonths: readonly (number | null | undefined)[]): PayoffEta {
  // Nothing to pay off is genuinely paid — an empty card list is not "never".
  if (payoffMonths.length === 0) return { kind: 'paid' };
  // ONE card that never clears makes the whole picture "never": the debt does not reach zero.
  if (payoffMonths.some(m => m === null || m === undefined)) return { kind: 'never' };
  const max = Math.max(...payoffMonths.map(m => m as number));
  // payoffMonth is 1-INDEXED, so month 1 is this month; 0 or less means nothing was owed.
  return max <= 0 ? { kind: 'paid' } : { kind: 'month', month: max };
}
