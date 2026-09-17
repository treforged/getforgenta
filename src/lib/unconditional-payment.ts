/**
 * "Always pay this, no matter what" — the ONE derivation of what an unconditional
 * card wants and what it does not get.
 *
 * ⚠️ WHY THIS FILE EXISTS. The setting shipped in three parts — column (`cb513215`),
 * engine (`fc38deef`), writer (2026-09-13) — and every one of them landed on the
 * ONE-SHOT path (`getPayoffRecommendations`). The SIM path
 * (`useCardProjection` → `month0.perCardAdjusted` → `buildCardRecRows`) is what
 * /debt, the Dashboard widget and Forecast actually render, and it did not read
 * `paymentUnconditional` anywhere: measured 2026-09-13, zero occurrences in
 * `useCardProjection.ts`, `cardProjectionResim.ts` and `month0-debt-breakdown.ts`.
 *
 * So the toggle a user pressed changed a number no screen showed, while three green
 * gates said the feature worked. Putting the derivation here — and calling it from
 * BOTH paths — is what stops the two drifting apart again, the same reason
 * `buildCardRecRows` is a single construction.
 *
 * THE RULE (Sam's ruling, already given): if an unmissable obligation and the cash
 * available cannot both be satisfied, the obligation wins and the gap is REPORTED.
 * Never resolve it silently. A payment that quietly shrinks to fit the month is the
 * app lying about what it will send.
 */
import type { CardData } from '@/lib/credit-card-engine';
import { formatCurrency } from '@/lib/calculations';
import { firstPaymentDueMonthOffset } from '@/lib/first-payment-due';

/**
 * The one wording of the gap, so /debt and the Dashboard widget cannot say it two ways.
 *
 * It names the AMOUNT, not a feeling — "$412 short this month" is actionable, "may not fit" is
 * not, and Sam's ruling was explicitly that the shortfall must be a number.
 */
export function unconditionalShortfallLabel(shortfall: number): string {
  return `${formatCurrency(shortfall, false)} short this month`;
}

/**
 * The cash warning, decided once for every surface that shows one.
 *
 * ⚠️ IT TAKES TWO REASONS BECAUSE THE OLD ONE COULD NOT SEE THE SECOND, AND A BROWSER FOUND IT.
 * On 2026-09-13, on the demo persona's genuinely tight month — $2,526 liquid against a $3,223 safe
 * minimum — turning this setting on moved **Safe to Pay from $0 to $7,991 with no warning at all**.
 * The old predicate is `availableCash − minimumsDue < 0`, and an unconditional card is settled in
 * FULL, so it is never a minimum left unmet: the subtraction came out large and positive while the
 * tile labelled *Safe* to Pay reported three times the cash on hand.
 *
 * ⚠️ AND THE WORDING HAS TO CHANGE WITH THE REASON. "Safe to Pay is less than minimum payments due"
 * is simply untrue in the second case — the minimums are covered; the problem is that the plan has
 * been told to send more than the month holds. A banner that fires with the wrong explanation is
 * how a real warning gets dismissed as a glitch.
 *
 * Returns null when there is nothing to warn about.
 */
export function cashWarningMessage(
  availableCash: number,
  minimumsDue: number,
  /** The per-card shortfalls on this month's rows. Only positives matter. */
  shortfalls: readonly (number | undefined)[] = [],
): string | null {
  const short = shortfalls.reduce<number>((s, v) => s + (v && v > 0 ? v : 0), 0);
  if (short > 0) {
    return `This plan sends ${formatCurrency(availableCash, false)} because a card is set to always `
      + `pay in full, which is ${formatCurrency(short, false)} more than this month covers. `
      + `The payment is not being reduced — something else has to give.`;
  }
  if (Math.ceil(availableCash - minimumsDue) < 0) {
    return `Safe to Pay (${formatCurrency(availableCash, false)}) is less than minimum payments due `
      + `(${formatCurrency(minimumsDue, false)}). Not all minimums can be covered. Review cash flow urgently.`;
  }
  return null;
}

/** Per-card outcome of an unconditional settlement. */
export interface UnconditionalSettlement {
  /** What the plan will actually send — the full desired amount, NEVER clamped to the pool. */
  payment: number;
  /**
   * `desired − pool` at the moment this card was settled, rounded to cents, floored at 0.
   * A positive value means the month does not contain this payment: it is still sent, and
   * something else in the plan must give. Zero means it fits.
   */
  shortfall: number;
}

/**
 * What an unconditional card wants this month.
 *
 * `statement` wants the balance as it stands; `full` also wants the purchases that will
 * land on it before the statement cuts. Mirrors the engine's own expression exactly — it
 * is imported by `credit-card-engine.ts` rather than restated there, so the two cannot
 * disagree about what "always pay this" means.
 *
 * Returns 0 for a card that is not unconditional, or has nothing to pay.
 */
export function unconditionalDesired(card: CardData, now: Date = new Date()): number {
  if (card.paymentUnconditional !== true) return 0;
  // ⚠️ "ALWAYS PAY THIS" STILL CANNOT DEMAND A PAYMENT THAT IS NOT OWED YET.
  // Tre, 2026-09-17: "Robinhood is charging for this month ... when it doesn't start till
  // October 10. that payment is causing a shortage of my account which is incorrect."
  // The first-payment-due-date rule existed and was wired into the MINIMUM path only
  // (`minSuppressed` in credit-card-engine). An unconditional card is settled OFF THE TOP,
  // before minimums and before the cascade, so it never met that guard: a card opened in
  // August whose first bill lands on 10 October was sending its whole balance in September
  // and REPORTING THE GAP AS A SHORTFALL. The month was declared short because of a payment
  // nobody had asked for.
  // Both callers settle MONTH 0, so "a later month" is the whole test here.
  const firstDueMonth = firstPaymentDueMonthOffset(card.firstDueDate, now);
  if (firstDueMonth !== null && firstDueMonth > 0) return 0;
  const base = Math.max(0, card.balance);
  const desired = card.paymentPreference === 'statement'
    ? base
    : base + (Number.isFinite(card.monthlyNewPurchases) ? card.monthlyNewPurchases : 0);
  return desired > 0 ? desired : 0;
}

/**
 * Settle every unconditional card off the top of `pool`, in the order given.
 *
 * ⚠️ THE POOL IS ALLOWED TO GO NEGATIVE inside this function, and the caller is handed the
 * clamped-at-zero remainder. The overdraw IS the shortfall; swallowing it balances the
 * month on paper, which is the exact failure the setting exists to prevent.
 *
 * ⚠️ NaN-SAFE ON PURPOSE. `pool` derives from a chain of optional inputs and can arrive NaN
 * under a sparse call — measured 2026-09-13 on the engine path, where it made the shortfall
 * NaN and serialised as `null`. A shortfall is money shown to a person, so an unknown pool
 * reads as "no cash established" (shortfall = the whole desired amount) rather than as a
 * broken number.
 *
 * @param cards      Candidates, in the order they should be settled. Non-unconditional
 *                   cards are skipped, so the caller may pass its whole list.
 * @param pool       Cash available to these cards before any of them is paid.
 * @returns          `byCard` holds ONLY the cards that were settled; `remaining` is what is
 *                   left for everything else, never below zero.
 */
export function settleUnconditional(
  cards: readonly CardData[],
  pool: number,
  now: Date = new Date(),
): { byCard: Map<string, UnconditionalSettlement>; remaining: number } {
  const byCard = new Map<string, UnconditionalSettlement>();
  let remaining = Number.isFinite(pool) ? pool : 0;
  for (const card of cards) {
    const desired = unconditionalDesired(card, now);
    if (desired <= 0) continue;
    const available = Math.max(0, remaining);
    byCard.set(card.id, {
      payment: Math.round(desired * 100) / 100,
      shortfall: Math.max(0, Math.round((desired - available) * 100) / 100),
    });
    remaining -= desired;
  }
  return { byCard, remaining: Math.max(0, remaining) };
}
