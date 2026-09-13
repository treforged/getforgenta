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

/**
 * The one wording of the gap, so /debt and the Dashboard widget cannot say it two ways.
 *
 * It names the AMOUNT, not a feeling — "$412 short this month" is actionable, "may not fit" is
 * not, and Sam's ruling was explicitly that the shortfall must be a number.
 */
export function unconditionalShortfallLabel(shortfall: number): string {
  return `${formatCurrency(shortfall, false)} short this month`;
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
export function unconditionalDesired(card: CardData): number {
  if (card.paymentUnconditional !== true) return 0;
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
): { byCard: Map<string, UnconditionalSettlement>; remaining: number } {
  const byCard = new Map<string, UnconditionalSettlement>();
  let remaining = Number.isFinite(pool) ? pool : 0;
  for (const card of cards) {
    const desired = unconditionalDesired(card);
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
