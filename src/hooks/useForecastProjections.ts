import { useCardProjectionContext } from '@/contexts/CardProjectionContext';

/**
 * Shared forecast pipeline. The derivation now lives in useForecastEngineInputs and the single
 * authoritative engine run (with the Phase 2 Option C debt-cash convergence loop) lives in
 * CardProjectionProvider, so BOTH the Forecast page and the Debt Payoff page read the exact same
 * converged projection from context. This hook is a thin reader preserving the original return
 * shape for its callers.
 */
export function useForecastProjections() {
  const { projections, engineInputs, forecastInputsBundle } = useCardProjectionContext();
  const {
    monthlyAggregates,
    debtPaymentsByMonth,
    debtBalancesByMonth,
    oneTimeByMonth,
    ccOneTimeByMonth,
    ccScheduledByMonth,
    currentMonthRecommendedDebt,
    forecastMonthEvents,
    planExpensesByMonth,
    annualFederalWithheldFromBudget,
    prePaycheckBillsInfo,
  } = forecastInputsBundle;

  return {
    projections,
    engineInputs,
    monthlyAggregates,
    debtPaymentsByMonth,
    debtBalancesByMonth,
    oneTimeByMonth,
    ccOneTimeByMonth,
    ccScheduledByMonth,
    currentMonthRecommendedDebt,
    forecastMonthEvents,
    planExpensesByMonth,
    annualFederalWithheldFromBudget,
    prePaycheckBillsInfo,
  };
}
