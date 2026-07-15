// @vitest-environment jsdom
//
// Q4 DIAGNOSTIC (temporary, not a regression test yet): reproduce the live post-Q5 forecast
// divergence offline. The golden fixture (captured 2026-07-03) predates Tre setting Prime
// Visa's manual statement_balance (1164.79 via the Q3 UI), so the shipped realData harness
// never exercises Q5's synthetic-pin path — it passes while live diverges (payoff 36 vs 12,
// Aug 2026 floor breach $339). This clone injects the manual ISB before rendering the hook.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '@/hooks/useCardProjection';
import { PROJECTION_MONTHS } from '@/lib/credit-card-engine';
import { generateScheduledEvents } from '@/lib/scheduling';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import type { ForecastInputs } from '@/lib/forecast-engine';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const hasFixture = existsSync(FIXTURE);
const maybeIt = hasFixture ? it : it.skip;

function runScenario(label: string, mutateClockDays: number) {
  const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));

  vi.useFakeTimers({ toFake: ['Date'] });
  const clock = new Date(capturedAt);
  clock.setDate(clock.getDate() + mutateClockDays);
  vi.setSystemTime(clock);

  // Inject the live manual interest-saving balance onto Prime Visa (immutably — new arrays/objects).
  const fx = inputs as unknown as Record<string, unknown>;
  const accounts = (fx.accounts as Record<string, unknown>[]).map(a =>
    a.name === 'Prime Visa' ? { ...a, statement_balance: 1164.79 } : a
  );

  const a = inputs.assumptions as Record<string, unknown>;
  const projectionAssumptions = {
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

  const { result } = renderHook(() => useCardProjection({
    accounts,
    transactions: fx.transactions,
    rules: fx.rules,
    debts: fx.debts,
    goals: fx.goals,
    carFunds: fx.carFunds,
    profile: fx.profile,
    debtPayoffOptions: { strategy: 'avalanche', paymentMode: 'variable', cashFloor: inputs.cashFloor, overrides: {} },
    payConfig: inputs.payConfig,
    scheduledEvents: generateScheduledEvents(fx.rules as never, accounts as never, PROJECTION_MONTHS),
    pauseSavings: Boolean(fx.pauseSavings),
    forecastFundingAccountId: fx.forecastFundingAccountId ?? null,
    debtStrategy: 'avalanche',
    persistedDebtFundingId: null,
    assumptions: projectionAssumptions,
    syncCutoffDate: fx.syncCutoffDate,
    paymentPlans: (fx.paymentPlans as never) ?? [],
  } as unknown as UseCardProjectionParams));

  const base = result.current;
  expect(base).not.toBeNull();
  console.log(`[q4 ${label}] manualIsbPins:`, JSON.stringify(base!.manualIsbPins),
    '| simCards:', base!.simCards.map(c =>
      `${c.name} pref=${c.paymentPreference} isb=${c.statementBalance} bal=${c.balance} due=${c.dueDay}`).join(' | '));

  return { base: base!, inputs: { ...inputs, accounts } as unknown as ForecastInputs };
}

describe('Q4 diagnostic — golden fixture + Prime Visa manual statement_balance (Q5 path)', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('clock=capturedAt (due day 7 NOT passed → dueMonth=0)', async () => {
    const { base, inputs } = runScenario('dueMonth=0', 0);
    const runs: import('@/lib/forecast-engine').ForecastResult[] = [];
    const { calculateForecast } = await import('@/lib/forecast-engine');
    const engine = (inp: ForecastInputs) => { const r = calculateForecast(inp); runs.push(r); return r; };
    const out = runDebtCashConvergence(base, inputs, { engine });
    for (let k = 1; k < runs.length; k++) {
      const prev = runs[k - 1], cur = runs[k];
      let maxGap = 0, argMonth = -1;
      cur.data.forEach((row, m) => {
        const g = Math.abs(row.debtPayment - prev.data[m].debtPayment);
        if (g > maxGap) { maxGap = g; argMonth = m; }
      });
      console.log(`[q4 m0] run ${k}: maxGap=${maxGap.toFixed(0)} @m${argMonth}`,
        `prevPay=${prev.data[argMonth]?.debtPayment} curPay=${cur.data[argMonth]?.debtPayment}`,
        `prevTarget=${prev.data[argMonth]?.revolvingDebtCash} curTarget=${cur.data[argMonth]?.revolvingDebtCash}`);
    }
    const ccFree = out.projections.milestones.find(m => m.event.startsWith('CC Debt Free'));
    const floorBreaches = out.projections.milestones.filter(m => m.event.includes('below safe minimum'));
    console.log('[q4 m0] converged:', out.converged, '| passes:', out.passes,
      '| CC Debt Free:', ccFree?.month ?? '(never)',
      '| floor breaches:', floorBreaches.map(m => m.month).join(', ') || '(none)');
  });

  maybeIt('clock=capturedAt+11d = 2026-07-14 (due day 7 passed → dueMonth=1, mirrors live)', async () => {
    const { base, inputs } = runScenario('dueMonth=1', 11);
    const runs: import('@/lib/forecast-engine').ForecastResult[] = [];
    const { calculateForecast } = await import('@/lib/forecast-engine');
    const engine = (inp: ForecastInputs) => { const r = calculateForecast(inp); runs.push(r); return r; };
    const out = runDebtCashConvergence(base, inputs, { engine });
    for (let k = 1; k < runs.length; k++) {
      const prev = runs[k - 1], cur = runs[k];
      let maxGap = 0, argMonth = -1;
      cur.data.forEach((row, m) => {
        const g = Math.abs(row.debtPayment - prev.data[m].debtPayment);
        if (g > maxGap) { maxGap = g; argMonth = m; }
      });
      console.log(`[q4 m1] run ${k}: maxGap=${maxGap.toFixed(0)} @m${argMonth}`,
        `prevPay=${prev.data[argMonth]?.debtPayment} curPay=${cur.data[argMonth]?.debtPayment}`,
        `prevTarget=${prev.data[argMonth]?.revolvingDebtCash} curTarget=${cur.data[argMonth]?.revolvingDebtCash}`);
    }
    const ccFree = out.projections.milestones.find(m => m.event.startsWith('CC Debt Free'));
    const floorBreaches = out.projections.milestones.filter(m => m.event.includes('below safe minimum'));
    console.log('[q4 m1] converged:', out.converged, '| passes:', out.passes,
      '| CC Debt Free:', ccFree?.month ?? '(never)',
      '| floor breaches:', floorBreaches.map(m => m.month).join(', ') || '(none)');
  });
});
