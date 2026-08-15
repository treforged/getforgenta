import { useMemo } from 'react';
import { formatCurrency } from '@/lib/calculations';
import { PROJECTION_MONTHS } from '@/lib/credit-card-engine';
import { getMonthNetIncome, type PayScheduleConfig } from '@/lib/pay-schedule';
import { estimateTaxReturn, estimateFederalWithheld, STATE_TAX_RATES } from '@/lib/tax-estimator';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';

/**
 * "Projected Estimates" — the year-by-year take-home / bonus / refund tiles at the foot of
 * the assumptions panel, with the projection that feeds them.
 *
 * Split out of `ForecastAssumptionsPanel` only to keep both files inside the house size
 * limit; the maths and the markup are the ones that were in `Forecast.tsx`.
 */
type Props = {
  assumptions: AssumptionsType;
  payConfig: PayScheduleConfig;
  annualFederalWithheldFromBudget: number;
};

export default function ForecastYearlySummary({ assumptions, payConfig, annualFederalWithheldFromBudget }: Props) {
  const yearlyProjections = useMemo(() => {
    if (!payConfig) return [];
    const nowDate = new Date();
    let multiplier = 1;
    const sortedPromotions = [...(assumptions.promotions ?? [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    let nextPromotionIdx = 0;
    const results: { year: number; monthlyTakeHome: number; bonus: number; taxReturn: number; raiseApplied: boolean }[] = [];

    for (let i = 1; i <= PROJECTION_MONTHS; i++) {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() + i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      while (nextPromotionIdx < sortedPromotions.length && sortedPromotions[nextPromotionIdx].effectiveDate.slice(0, 7) <= monthKey) {
        const annualBase = payConfig.weeklyGross * 52;
        if (annualBase > 0) multiplier = sortedPromotions[nextPromotionIdx].newAnnualSalary / annualBase;
        nextPromotionIdx++;
      }
      let raiseApplied = false;
      if (assumptions.incomeGrowthEnabled && assumptions.incomeGrowth > 0 && d.getMonth() + 1 === assumptions.raiseMonth) {
        if (assumptions.raiseMode === 'flat') {
          const currentAnnual = payConfig.weeklyGross * 52 * multiplier;
          if (currentAnnual > 0) multiplier *= (1 + assumptions.incomeGrowth / currentAnnual);
        } else {
          multiplier *= (1 + assumptions.incomeGrowth / 100);
        }
        raiseApplied = true;
      }

      if (i % 12 === 0) {
        const adjustedConfig = { ...payConfig, weeklyGross: payConfig.weeklyGross * multiplier };
        const monthlyTakeHome = getMonthNetIncome(adjustedConfig, d.getFullYear(), d.getMonth());
        const annualGross = payConfig.weeklyGross * 52 * multiplier;

        const bonus = assumptions.bonusEnabled && assumptions.bonusAmount > 0
          ? (assumptions.bonusMode === 'pct' ? annualGross * (assumptions.bonusAmount / 100) : assumptions.bonusAmount)
          : 0;

        let taxReturn = 0;
        if (assumptions.taxReturnEnabled) {
          try {
            if (assumptions.taxReturnAmountOverride > 0) {
              taxReturn = assumptions.taxReturnAmountOverride;
            } else if (annualGross > 0) {
              const federalWithheld = assumptions.taxReturnFederalWithheld || annualFederalWithheldFromBudget || estimateFederalWithheld(annualGross, assumptions.taxReturnFilingStatus, assumptions.taxReturnDependents);
              const stateRate = STATE_TAX_RATES[assumptions.taxReturnState] ?? 0;
              taxReturn = estimateTaxReturn({
                annualGrossIncome: annualGross,
                federalWithheld,
                filingStatus: assumptions.taxReturnFilingStatus,
                dependentsUnder17: assumptions.taxReturnDependents,
                stateCode: assumptions.taxReturnState,
                stateWithheld: Math.round(annualGross * stateRate),
              }).totalRefund;
            }
          } catch { /* estimate unavailable for this year — the tile simply omits the refund line */ }
        }

        results.push({ year: i / 12, monthlyTakeHome, bonus, taxReturn, raiseApplied: i <= 12 ? raiseApplied : true });
      }
    }
    return results;
  }, [payConfig, assumptions, annualFederalWithheldFromBudget]);

  if (yearlyProjections.length === 0) return null;

  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Projected Estimates</p>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {yearlyProjections.map(yr => (
          <div key={yr.year} className="card-forged px-2.5 py-2 space-y-1">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Year {yr.year}</p>
            <div>
              <p className="text-[9px] text-muted-foreground">Monthly Take-Home</p>
              <p className="text-xs font-display font-bold text-foreground">{formatCurrency(yr.monthlyTakeHome, false)}</p>
            </div>
            {yr.bonus > 0 && (
              <div>
                <p className="text-[9px] text-muted-foreground">Bonus</p>
                <p className="text-xs font-display font-bold text-success">{formatCurrency(yr.bonus, false)}</p>
              </div>
            )}
            {yr.taxReturn !== 0 && (
              <div>
                <p className="text-[9px] text-muted-foreground">{yr.taxReturn > 0 ? 'Tax Return' : 'Tax Owed'}</p>
                <p className={`text-xs font-display font-bold ${yr.taxReturn > 0 ? 'text-primary' : 'text-destructive'}`}>{formatCurrency(Math.abs(yr.taxReturn), false)}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
