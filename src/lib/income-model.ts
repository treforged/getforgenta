// Shared per-month income model — the single source of truth for the bonus and tax-return
// components of projected monthly income. Extracted so the forecast engine (forecast-engine.ts)
// and the credit-card look-ahead sim (useCardProjection.ts) compute identical income instead of
// diverging (the sim historically omitted the tax-return estimator entirely and computed the
// bonus off annual NET rather than annual GROSS — which over-accreted the sim's cash walk vs the
// engine's authoritative one and, in a tax-owed month, oversized the mandatory cycling pool).
//
// Pure functions, no React. Depends only on pay-schedule + tax-estimator.

import type { PayScheduleConfig } from '@/lib/pay-schedule';
import { estimateTaxReturn, estimateFederalWithheld, STATE_TAX_RATES, type FilingStatus } from '@/lib/tax-estimator';

/** The bonus + tax-return assumption fields the income model reads. The engine's AssumptionsType
 *  supplies all of them; the sim's assumptions may omit the tax-identity fields (filing status,
 *  dependents, state, federal withheld), which default to the same values as DEFAULT_ASSUMPTIONS. */
export interface BonusTaxAssumptions {
  bonusEnabled: boolean;
  bonusAmount: number;
  bonusMode: string;
  bonusMonth: number;
  bonusRecurring: boolean;
  taxReturnEnabled: boolean;
  taxReturnMonth: number;
  taxReturnAmountOverride?: number;
  taxReturnFilingStatus?: FilingStatus;
  taxReturnDependents?: number;
  taxReturnState?: string;
  taxReturnFederalWithheld?: number;
}

export interface BonusTaxParams {
  /** payConfig.weeklyGross * 52 * incomeMultiplier — the projected annual GROSS for this month. */
  annualGrossHere: number;
  /** First-of-month Date for the month being projected. */
  monthDate: Date;
  assumptions: BonusTaxAssumptions;
  /** True when this is the first occurrence of a NON-recurring bonus (ignored when recurring). */
  isFirstBonusOccurrence: boolean;
  /** Annualized "Federal Withholding" budget deduction; used before the estimator's own fallback. */
  annualFederalWithheldFromBudget: number;
}

/** Bonus (flat or % of annual GROSS) and the annual tax-return injection (override, else the
 *  estimator — a positive refund or a negative amount-owed). Mirrors forecast-engine.ts exactly so
 *  both models agree. taxReturnIncome is 0 unless it is the configured tax-return month. */
export function computeBonusAndTax(params: BonusTaxParams): { bonusIncome: number; taxReturnIncome: number } {
  const { annualGrossHere, monthDate, assumptions: a, isFirstBonusOccurrence, annualFederalWithheldFromBudget } = params;

  const grossBonusAmt = a.bonusMode === 'pct'
    ? annualGrossHere * (a.bonusAmount / 100)
    : a.bonusAmount;
  const isBonusMonth =
    a.bonusEnabled &&
    a.bonusAmount > 0 &&
    monthDate.getMonth() + 1 === a.bonusMonth &&
    (a.bonusRecurring ? true : isFirstBonusOccurrence);
  const bonusIncome = isBonusMonth ? grossBonusAmt : 0;

  let taxReturnIncome = 0;
  if (a.taxReturnEnabled && monthDate.getMonth() + 1 === a.taxReturnMonth) {
    try {
      const filingStatus = a.taxReturnFilingStatus ?? 'single';
      const dependents = a.taxReturnDependents ?? 0;
      const stateCode = a.taxReturnState ?? 'FL';
      const refundAmt = (a.taxReturnAmountOverride ?? 0) > 0
        ? (a.taxReturnAmountOverride ?? 0)
        : (() => {
            if (!annualGrossHere || annualGrossHere <= 0) return 0;
            const federalWithheld = (a.taxReturnFederalWithheld ?? 0)
              || annualFederalWithheldFromBudget
              || estimateFederalWithheld(annualGrossHere, filingStatus, dependents);
            const stateRate = STATE_TAX_RATES[stateCode] ?? 0;
            const stateWithheld = Math.round(annualGrossHere * stateRate);
            return estimateTaxReturn({
              annualGrossIncome: annualGrossHere,
              federalWithheld,
              filingStatus,
              dependentsUnder17: dependents,
              stateCode,
              stateWithheld,
            }).totalRefund;
          })();
      taxReturnIncome = refundAmt; // positive = refund income; negative = amount owed outflow
    } catch { /* skip refund if estimator throws */ }
  }

  return { bonusIncome, taxReturnIncome };
}

/** Annualize the "Federal Withholding" paycheck deduction from Budget Control, if the user set one.
 *  Shared by useForecastEngineInputs (engine input) and useCardProjection (sim) so both feed the
 *  tax estimator the same withholding figure. */
export function computeAnnualFederalWithheld(
  payConfig: PayScheduleConfig | null | undefined,
  paycheckDeductions: { value: number; mode: string; label?: string }[] | null | undefined,
): number {
  if (!payConfig) return 0;
  if (!paycheckDeductions || paycheckDeductions.length === 0) return 0;
  const fedDed = paycheckDeductions.find(d => d.label != null && /federal.*withholding|^withholding$/i.test(d.label));
  if (!fedDed || !fedDed.value) return 0;
  const paycheckGross = payConfig.frequency === 'biweekly' ? payConfig.weeklyGross * 2
    : payConfig.frequency === 'monthly' ? payConfig.weeklyGross * 52 / 12
    : payConfig.weeklyGross;
  const perPaycheck = fedDed.mode === 'pct' ? paycheckGross * (fedDed.value / 100) : fedDed.value;
  const paychecksPerYear = payConfig.frequency === 'biweekly' ? 26 : payConfig.frequency === 'monthly' ? 12 : 52;
  return Math.round(perPaycheck * paychecksPerYear);
}
