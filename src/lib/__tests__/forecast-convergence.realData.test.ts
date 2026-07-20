// @vitest-environment jsdom
//
// Real-data convergence repro/regression test (handoff.md step 4 — the coverage hole that let
// the Stage-3 regression ship: the golden Tier-A test exercises calculateForecast alone on a
// STATIC cardProjectionData snapshot, and forecast-convergence.test.ts uses fake engines, so the
// full loop — real sim (useCardProjection) ↔ real engine (calculateForecast) via
// runDebtCashConvergence — was never run on real data in CI.
//
// This test rebuilds a LIVE CardProjectionResult (with a working resimulateWithDebtCash closure)
// by rendering the real hook from the fixture's raw Supabase rows, then runs the exact provider
// call (CardProjectionContext.tsx: runDebtCashConvergence(cardProjection, engineInputs)) and
// reports the user-facing milestones.
//
// Self-skips when the gitignored fixture is absent (same pattern as forecast-engine.goldenTierA).

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
import { loadRealPaymentPlans } from './fixtures/projection-harness';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const hasFixture = existsSync(FIXTURE);
// Resolved 2026-07-09: the Feb 2027 floor breach was root-caused to the sim's income walk
// diverging from the engine's authoritative one. The sim preferred scheduled-events income
// (`e.income`) which miscounts paydays by ±1 vs the engine's getMonthNetIncome, inflating the
// sim's cash and oversizing the mandatory cycling pool — the engine then executed a payment it
// couldn't afford and breached the floor. Fix: useCardProjection.ts now mirrors the engine's
// i>0 income model exactly (getMonthNetIncome + nonPaycheckIncome). The loop converges in 11
// passes (default maxPasses bumped 8→12), payoff Jun 2027, zero floor breaches.
const maybeIt = hasFixture ? it : it.skip;

describe('runDebtCashConvergence — real sim + real engine on the golden fixture', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('converges without pushing payoff out or breaching the cash floor', async () => {
    const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));

    // Pin ONLY Date (the sim/engine read new Date() internally) — leave real timers for
    // @testing-library's render machinery.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(capturedAt));

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
      persistedDebtFundingId: null,
      assumptions: projectionAssumptions,
      syncCutoffDate: fx.syncCutoffDate,
      // Fixture captures predating ForecastInputs.paymentPlans lack the raw rows — fall back to
      // the contemporaneous 07-16 plans capture so the sim's cash walk matches the engine's
      // (Q12: without them the sim ran $228/mo richer and Aug 2026 showed a phantom breach).
      paymentPlans: (fx.paymentPlans as never) ?? (loadRealPaymentPlans() as never),
    } as unknown as UseCardProjectionParams));

    const base = result.current;
    expect(base).not.toBeNull();

    // Harness fidelity: the freshly rendered sim should land on the same revolving payoff month
    // the fixture captured live (same clock, same rows). If this drifts, the repro is not
    // faithful to what the app computes and the numbers below can't be trusted.
    const snapshot = inputs.cardProjectionData;
    console.log('[repro] live sim payoff month:', base!.forecastRevolvingPayoffMonth,
      '| captured snapshot payoff month:', snapshot?.forecastRevolvingPayoffMonth);

    const runs: import('@/lib/forecast-engine').ForecastResult[] = [];
    const { calculateForecast } = await import('@/lib/forecast-engine');
    const engine = (inp: ForecastInputs) => { const r = calculateForecast(inp); runs.push(r); return r; };
    const out = runDebtCashConvergence(base!, inputs as ForecastInputs, { engine });
    for (let k = 1; k < runs.length; k++) {
      const prev = runs[k - 1], cur = runs[k];
      let maxGap = 0, argMonth = -1;
      cur.data.forEach((row, m) => {
        const g = Math.abs(row.debtPayment - prev.data[m].debtPayment);
        if (g > maxGap) { maxGap = g; argMonth = m; }
      });
      console.log(`[diag] run ${k}: maxGap=${maxGap.toFixed(0)} @m${argMonth}`,
        `prevPay=${prev.data[argMonth]?.debtPayment} curPay=${cur.data[argMonth]?.debtPayment}`,
        `prevTarget=${prev.data[argMonth]?.revolvingDebtCash} curTarget=${cur.data[argMonth]?.revolvingDebtCash}`);
    }
    console.log('[repro] converged:', out.converged, '| passes:', out.passes);
    console.log('[repro] milestones:', JSON.stringify(out.projections.milestones));

    const ccFree = out.projections.milestones.find(m => m.event.startsWith('CC Debt Free'));
    const floorBreaches = out.projections.milestones.filter(m => m.event.includes('below safe minimum'));
    console.log('[repro] CC Debt Free:', ccFree?.month ?? '(never)',
      '| floor-breach months:', floorBreaches.map(m => m.month).join(', ') || '(none)');

    // Expected-good anchors (re-pinned 2026-07-20 with real paymentPlans in the sim — the
    // earlier Jun 2027 pin was measured with paymentPlans=[], which left the sim's cash walk
    // $228/mo richer than the engine's; Jul 2027 verified identical on main and
    // q12-floor-cutoff): loop converges, payoff Jul 2027, zero floor-breach milestones.
    // The payoff month is data-dependent — re-pin it if the fixture is ever recaptured.
    expect(out.converged, 'convergence loop must settle within the pass budget').toBe(true);
    expect(ccFree, 'CC Debt Free milestone should fire within the horizon').toBeTruthy();
    expect(ccFree!.month, 'payoff month regressed').toBe('Jul 2027');
    expect(floorBreaches.map(m => m.month), 'cash-floor breaches after convergence').toEqual([]);
  });
});
