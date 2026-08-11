/**
 * Retirement projection math — single source of truth used by
 * NetWorth, Forecast, and useRetirementAutoUpdate.
 */

/**
 * Future value of a retirement account given:
 *   currentBalance  — starting balance
 *   monthlyContrib  — contribution added each month
 *   apyRate         — annual percentage yield (e.g. 7 for 7%)
 *   months          — number of months to project
 */
export function projectBalance(
  currentBalance: number,
  monthlyContrib: number,
  apyRate: number,
  months: number,
): number {
  if (months <= 0) return currentBalance;
  const r = apyRate / 100 / 12; // monthly rate
  if (r === 0) return currentBalance + monthlyContrib * months;
  const growth = Math.pow(1 + r, months);
  return currentBalance * growth + monthlyContrib * ((growth - 1) / r);
}

/**
 * Project milestones at 1, 5, 10, and 20 years.
 */
export function projectMilestones(
  currentBalance: number,
  monthlyContrib: number,
  apyRate: number,
): { year1: number; year5: number; year10: number; year20: number } {
  return {
    year1:  projectBalance(currentBalance, monthlyContrib, apyRate, 12),
    year5:  projectBalance(currentBalance, monthlyContrib, apyRate, 60),
    year10: projectBalance(currentBalance, monthlyContrib, apyRate, 120),
    year20: projectBalance(currentBalance, monthlyContrib, apyRate, 240),
  };
}

/**
 * The subset of forecast assumptions that drive income growth. Field names match
 * the Assumptions object handed to the forecast engine (useCardProjection.ts).
 */
export interface IncomeGrowthAssumptions {
  incomeGrowthEnabled: boolean;
  incomeGrowth: number;
  raiseMonth: number;
  raiseMode?: string;
  promotions?: { effectiveDate: string; newAnnualSalary: number }[];
}

/**
 * Per-month income multiplier series, mirroring the forecast engine's loop
 * (forecast-engine.ts promotion snap + annual-raise step). Promotions snap the
 * multiplier to newAnnualSalary / annualBaseSalary the first month their
 * effective date is reached (including month 0 for past dates); the annual
 * raise steps the multiplier in raiseMonth, skipping month 0 exactly as the
 * engine does. If these two rules ever diverge from the engine, the milestones
 * panel and the forecast chart disagree about the same raise.
 */
export function incomeMultipliersByMonth(
  assumptions: IncomeGrowthAssumptions,
  annualBaseSalary: number,
  startDate: Date,
  months: number,
): number[] {
  const sortedPromotions = [...(assumptions.promotions ?? [])].sort((a, b) =>
    a.effectiveDate.localeCompare(b.effectiveDate),
  );
  const multipliers: number[] = [];
  let multiplier = 1;
  let nextPromotionIdx = 0;
  for (let i = 0; i < months; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    while (
      nextPromotionIdx < sortedPromotions.length &&
      sortedPromotions[nextPromotionIdx].effectiveDate.slice(0, 7) <= monthKey
    ) {
      if (annualBaseSalary > 0) {
        multiplier = sortedPromotions[nextPromotionIdx].newAnnualSalary / annualBaseSalary;
      }
      nextPromotionIdx++;
    }
    if (
      assumptions.incomeGrowthEnabled &&
      assumptions.incomeGrowth > 0 &&
      i > 0 &&
      d.getMonth() + 1 === assumptions.raiseMonth
    ) {
      if (assumptions.raiseMode === 'flat') {
        const currentAnnual = annualBaseSalary * multiplier;
        if (currentAnnual > 0) multiplier *= 1 + assumptions.incomeGrowth / currentAnnual;
      } else {
        multiplier *= 1 + assumptions.incomeGrowth / 100;
      }
    }
    multipliers.push(multiplier);
  }
  return multipliers;
}

/**
 * Project milestones at 1, 5, 10, and 20 years where the pct-mode share of the
 * contribution scales with income (raises/promotions) while the flat share
 * stays flat — the same split the forecast engine applies to paycheck
 * deductions. `multipliers` must cover 240 months; with every multiplier at 1
 * this reproduces projectMilestones exactly.
 */
export function projectMilestonesWithGrowth(
  currentBalance: number,
  flatMonthlyContrib: number,
  pctMonthlyContrib: number,
  apyRate: number,
  multipliers: number[],
): { year1: number; year5: number; year10: number; year20: number } {
  const r = apyRate / 100 / 12;
  const checkpoints: Record<number, number> = {};
  let bal = currentBalance;
  for (let m = 0; m < 240; m++) {
    const mult = multipliers[m] ?? multipliers[multipliers.length - 1] ?? 1;
    bal = bal * (1 + r) + flatMonthlyContrib + pctMonthlyContrib * mult;
    if (m === 11 || m === 59 || m === 119 || m === 239) checkpoints[m] = bal;
  }
  return {
    year1: checkpoints[11],
    year5: checkpoints[59],
    year10: checkpoints[119],
    year20: checkpoints[239],
  };
}

/**
 * Compound a principal over an elapsed number of days at a given APY.
 * Used by the auto-update hook to apply growth between paycheck cycles.
 */
export function compoundGrowth(
  principal: number,
  apyRate: number,
  days: number,
): number {
  if (days <= 0 || apyRate === 0) return principal;
  return principal * Math.pow(1 + apyRate / 100, days / 365);
}

/**
 * Compute the monthly contribution for a retirement account from paycheck deductions.
 * Accepts the raw paycheck_deductions JSONB array and the pay frequency.
 */
export function monthlyContribForAccount(
  deductions: { value: number; mode: 'flat' | 'pct'; accountId?: string }[],
  accountId: string,
  paycheckGross: number,
  paychecksPerYear: number,
): number {
  const split = monthlyContribSplitForAccount(deductions, accountId, paycheckGross, paychecksPerYear);
  return split.flat + split.pct;
}

/**
 * Same as monthlyContribForAccount, split into the flat-mode and pct-mode
 * shares. The pct share is the part that scales with income growth (a pct
 * deduction is a percentage of gross, so a raise raises it); the flat share
 * does not.
 */
export function monthlyContribSplitForAccount(
  deductions: { value: number; mode: 'flat' | 'pct'; accountId?: string }[],
  accountId: string,
  paycheckGross: number,
  paychecksPerYear: number,
): { flat: number; pct: number } {
  let flat = 0;
  let pct = 0;
  for (const d of deductions) {
    if (d.accountId !== accountId) continue;
    if (d.mode === 'pct') {
      pct += paycheckGross * (d.value / 100) * (paychecksPerYear / 12);
    } else {
      flat += d.value * (paychecksPerYear / 12);
    }
  }
  return { flat, pct };
}
