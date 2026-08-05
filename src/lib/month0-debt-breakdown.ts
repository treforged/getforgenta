/**
 * Canonical current-month debt breakdown.
 *
 * There used to be two debt engines. `getMonthlyDebtBreakdown` /
 * `getCurrentMonthDebtRecommendations` in credit-card-engine.ts run their own
 * one-shot recommendation pass, while Debt Payoff, Forecast and the Dashboard
 * debt widget read `useCardProjection`'s converged pass-3 month 0. The two
 * disagreed — different cash floor, save-up reserves, income timing and goal
 * handling — which is what made Budget Control's "matches Debt tab Safe to Pay"
 * claim false and put a different Chase Sapphire payment on /transactions than
 * on /debt.
 *
 * This module derives the same `MonthlyDebtBreakdown` shape the legacy engine
 * returned, but entirely from `cardProjection.month0`, so every surface reads
 * one number. Extracted verbatim from Dashboard's `dashboardDebtRecs`.
 */
import { m0MinDueSettled } from '@/lib/credit-card-engine';
import type { CardData, MonthlyDebtBreakdown } from '@/lib/credit-card-engine';
import type { Month0Result } from '@/lib/debt-model-types';

export interface Month0DebtBreakdownInput {
  /** Converged pass-3 month 0 from useCardProjection; null before the projection resolves. */
  month0: Month0Result | null | undefined;
  /** Cards the sim actually ran on — same list month0.perCardAdjusted indexes. */
  simCards: CardData[];
  debtStrategy: 'avalanche' | 'snowball';
  /** Plaid last-synced date; payments already due before it are treated as settled. */
  syncCutoffDate: string;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

export function emptyMonth0DebtBreakdown(
  debtStrategy: 'avalanche' | 'snowball',
): MonthlyDebtBreakdown {
  return {
    recommendations: [],
    totalMinimumsDue: 0,
    totalRecommended: 0,
    totalAvailableCash: 0,
    autopayTotal: 0,
    strategyLabel: debtStrategy === 'avalanche' ? 'Avalanche' : 'Snowball',
    cashWarning: false,
    interestAvoided: 0,
  };
}

export function buildMonth0DebtBreakdown({
  month0,
  simCards,
  debtStrategy,
  syncCutoffDate,
  now = new Date(),
}: Month0DebtBreakdownInput): MonthlyDebtBreakdown {
  const strategyLabel = debtStrategy === 'avalanche' ? 'Avalanche' : 'Snowball';
  if (!month0 || simCards.length === 0) return emptyMonth0DebtBreakdown(debtStrategy);

  const totalAvailableCash = month0.safeToPayTotal;

  // "Is this card's month-0 minimum already paid?" is exactly what `m0MinDueSettled` decides for
  // the engine. This used to open-code the inverse (`dueDateStr > syncCutoffDate`), so the number
  // shown here could disagree with the number the engine reserved — §1.1 cause C in miniature.
  const totalMinimumsDue = simCards
    .filter(c => !c.autopayFullBalance && c.balance > 0)
    .filter(c => !m0MinDueSettled(c.dueDay, syncCutoffDate, now))
    .reduce((s, c) => s + Math.min(c.minPayment, c.balance), 0);

  const autopayTotal = simCards
    .filter(c => c.autopayFullBalance)
    .reduce((s, c) => s + c.monthlyNewPurchases, 0);

  const recommendations = month0.perCardAdjusted.map(item => {
    const card = simCards.find(c => c.id === item.id);
    let reason: string;
    let isMinimumOnly = false;
    if (card?.autopayFullBalance || (card && card.balance <= 0)) {
      if (card?.paymentPreference === 'statement') reason = 'Statement balance';
      else if (card?.paymentPreference === 'full') reason = 'Full balance';
      else reason = 'Autopay Full Balance';
    } else {
      const min = Math.min(card?.minPayment ?? 0, card?.balance ?? 0);
      isMinimumOnly = item.payment <= min + 0.01;
      reason = isMinimumOnly
        ? 'Minimum payment'
        : debtStrategy === 'avalanche'
          ? 'Avalanche priority'
          : 'Snowball priority';
    }
    return {
      cardId: item.id,
      cardName: item.name,
      color: card?.color ?? '#888',
      payment: item.payment,
      dueDay: card?.dueDay ?? null,
      reason,
      isMinimumOnly,
    };
  });

  const totalRecommended = recommendations.reduce((s, r) => s + r.payment, 0);
  const cashWarning = Math.ceil(totalAvailableCash - totalMinimumsDue) < 0;

  return {
    recommendations,
    totalMinimumsDue,
    totalRecommended,
    totalAvailableCash,
    autopayTotal,
    strategyLabel,
    cashWarning,
    interestAvoided: 0,
  };
}
