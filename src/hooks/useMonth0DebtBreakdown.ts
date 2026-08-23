import { useMemo } from 'react';
import { useCardProjectionContext } from '@/contexts/CardProjectionContext';
import { buildMonth0DebtBreakdown } from '@/lib/month0-debt-breakdown';
import type { MonthlyDebtBreakdown } from '@/lib/credit-card-engine';

/**
 * The one current-month debt breakdown every surface reads.
 *
 * Backed by the converged `cardProjection.month0` the Debt Payoff tab and
 * Forecast already use, so Dashboard, Budget Control and Savings Goals can no
 * longer report a different payment than /debt for the same card. Replaces the
 * legacy `getMonthlyDebtBreakdown` / `getCurrentMonthDebtRecommendations` calls.
 *
 * Must be used inside `CardProjectionProvider` (mounted by DashboardLayout).
 */
export function useMonth0DebtBreakdown(): MonthlyDebtBreakdown {
  const { cardProjection, debtStrategy, syncCutoffDate, carFunds } = useCardProjectionContext();

  return useMemo(
    () => buildMonth0DebtBreakdown({
      month0: cardProjection?.month0,
      simCards: cardProjection?.simCards ?? [],
      debtStrategy,
      syncCutoffDate,
      // `perCardPaymentsScaled` first for the same reason /debt's month0Recs prefers it: it is
      // the cash-floor-constrained figure — what the plan can actually send, not what it would
      // like to. Absent series stay absent; the builder renders those as "Not modelled".
      nextMonthSource: cardProjection?.perCardPaymentsScaled ?? cardProjection?.perCardPayments,
      carFunds,
    }),
    [cardProjection, debtStrategy, syncCutoffDate, carFunds],
  );
}
