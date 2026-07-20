// Shared real-data test harness: rebuild a LIVE CardProjectionResult (with a working
// resimulateWithDebtCash closure) by rendering the real useCardProjection hook from the golden
// fixture's raw Supabase rows — the same call shape CardProjectionContext.tsx uses. Callers must
// pin the clock (vi.setSystemTime) BEFORE calling, since the sim reads new Date() internally.
//
// Known fidelity gaps (2026-07-16): ForecastInputs fixtures do not capture debtPayoffOptions
// (overrides run as {} here), paymentPlans (usePaymentPlans rows), or persistedDebtFundingId
// (localStorage `tre:debt:fundingAccount`). The latter two can be supplied per-test via
// ProjectionHarnessOverrides — both were required to reproduce the Q7 live fixed point.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams, type CardProjectionResult } from '@/hooks/useCardProjection';
import { PROJECTION_MONTHS } from '@/lib/credit-card-engine';
import { generateScheduledEvents } from '@/lib/scheduling';
import type { ForecastInputs } from '@/lib/forecast-engine';

const REAL_PLANS_FIXTURE = join(__dirname, 'forecast-inputs.real.payment-plans-2026-07-16.json');

/** Real payment-plan rows captured 2026-07-16 (contemporaneous with the 07-15 golden fixture).
 * Fallback for golden captures that predate ForecastInputs.paymentPlans: without the raw rows
 * the sim's planCashExpensesEarly is all zeros, so its cash walk runs richer than the engine's
 * and ISB-pinned months surface the drift as phantom floor breaches (Q12 Aug-2026). Gitignored
 * real data — returns [] when absent, matching the pre-fallback behavior. */
export function loadRealPaymentPlans(): unknown[] {
  return existsSync(REAL_PLANS_FIXTURE)
    ? JSON.parse(readFileSync(REAL_PLANS_FIXTURE, 'utf8')) as unknown[]
    : [];
}

export function buildProjectionAssumptions(inputs: ForecastInputs) {
  const a = inputs.assumptions as Record<string, unknown>;
  return {
    incomeGrowthEnabled: Boolean(a?.incomeGrowthEnabled),
    incomeGrowth: Number(a?.incomeGrowth ?? 0),
    raiseMonth: Number(a?.raiseMonth ?? 1),
    raiseMode: (a?.raiseMode as string) ?? 'pct',
    bonusEnabled: Boolean(a?.bonusEnabled),
    bonusAmount: Number(a?.bonusAmount ?? 0),
    bonusMode: (a?.bonusMode as string) ?? 'flat',
    bonusMonth: Number(a?.bonusMonth ?? 12),
    bonusRecurring: Boolean(a?.bonusRecurring ?? true),
    taxReturnEnabled: Boolean(a?.taxReturnEnabled),
    taxReturnAmountOverride: Number(a?.taxReturnAmountOverride ?? 0),
    taxReturnMonth: Number(a?.taxReturnMonth ?? 2),
    taxReturnFilingStatus: (a?.taxReturnFilingStatus as 'single' | 'mfj' | 'mfs' | 'hoh') ?? 'single',
    taxReturnDependents: Number(a?.taxReturnDependents ?? 0),
    taxReturnState: (a?.taxReturnState as string) ?? 'FL',
    taxReturnFederalWithheld: Number(a?.taxReturnFederalWithheld ?? 0),
    promotions: (a?.promotions as { id: string; effectiveDate: string; newAnnualSalary: number }[]) ?? [],
  };
}

export interface ProjectionHarnessOverrides {
  /** Live app reads this from localStorage `tre:debt:fundingAccount`; fixtures don't capture it. */
  persistedDebtFundingId?: string | null;
  /** Live app passes usePaymentPlans() rows; ForecastInputs fixtures don't capture them. */
  paymentPlans?: unknown[];
}

/** Render the real sim hook from the fixture's raw rows; returns the live CardProjectionResult. */
export function renderProjectionFromFixture(
  inputs: ForecastInputs,
  overrides: ProjectionHarnessOverrides = {},
): CardProjectionResult {
  const fx = inputs as unknown as Record<string, unknown>;
  const { result } = renderHook(() => useCardProjection({
    accounts: fx.accounts,
    transactions: fx.transactions,
    rules: fx.rules,
    debts: fx.debts,
    goals: fx.goals,
    carFunds: fx.carFunds,
    profile: fx.profile,
    debtPayoffOptions: { strategy: 'avalanche', paymentMode: 'variable', cashFloor: inputs.cashFloor, overrides: {} },
    payConfig: inputs.payConfig,
    scheduledEvents: generateScheduledEvents(fx.rules as never, fx.accounts as never, PROJECTION_MONTHS),
    pauseSavings: Boolean(fx.pauseSavings),
    forecastFundingAccountId: fx.forecastFundingAccountId ?? null,
    debtStrategy: 'avalanche',
    persistedDebtFundingId: overrides.persistedDebtFundingId ?? null,
    assumptions: buildProjectionAssumptions(inputs),
    syncCutoffDate: fx.syncCutoffDate,
    paymentPlans: (overrides.paymentPlans as never) ?? (fx.paymentPlans as never) ?? (loadRealPaymentPlans() as never),
  } as unknown as UseCardProjectionParams));
  if (!result.current) throw new Error('useCardProjection returned null on the golden fixture');
  return result.current;
}
