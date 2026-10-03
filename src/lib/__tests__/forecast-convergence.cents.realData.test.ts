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
    const { clock, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));

    // Pin ONLY Date (the sim/engine read new Date() internally) — leave real timers for
    // @testing-library's render machinery.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);

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
    const livePayoff = Number(base!.forecastRevolvingPayoffMonth);
    const capturedPayoff = Number(snapshot?.forecastRevolvingPayoffMonth);
    console.log('[repro] live sim payoff month:', livePayoff,
      '| captured snapshot payoff month:', capturedPayoff);

    // ⚠️ THIS CONTROL WAS PRINTED AND NEVER ASSERTED (ask 18fbdbf7), so the comment above it -
    // "if this drifts, the repro is not faithful and the numbers below can't be trusted" - was a
    // claim nothing enforced. Measured 2026-09-18 it is ALREADY DRIFTING: live 24 against the
    // captured 26.
    //
    // It is pinned as a CEILING rather than as equality on purpose. Equality would be red today
    // and an always-red gate stops being read - and shrinking drift is the repro getting BETTER,
    // which must not fail. What this catches is the drift WIDENING, which is the direction that
    // silently turns every number below into a fact about a stale fixture.
    //
    // ⚠️ DO NOT RAISE THIS NUMBER TO MAKE A RUN GREEN. A wider drift is the finding; raising
    // the bar is how a shrink-guard becomes a constant compared against a constant.
    const MAX_PAYOFF_DRIFT_MONTHS = 2;
    expect(Number.isFinite(livePayoff) && Number.isFinite(capturedPayoff),
      'both payoff months must be numbers, or this control is measuring nothing').toBe(true);
    expect(Math.abs(livePayoff - capturedPayoff),
      `repro fidelity: the fresh sim landed on month ${livePayoff} where the capture recorded `
      + `${capturedPayoff}. Widening drift means the numbers below describe a stale fixture.`)
      .toBeLessThanOrEqual(MAX_PAYOFF_DRIFT_MONTHS);

    const { calculateForecast } = await import('@/lib/forecast-engine');
    const out = runDebtCashConvergence(base!, inputs as ForecastInputs, { engine: calculateForecast });
    const proj = out.cardProjection;
    // Ask 4066ff23 (Tre, 10-03: "lets just use the decimals. that way theres no rounding issues").
    // Measured before the fix on this fixture: month 2 showed card payments summing to $1,203.00
    // while the forecast deducted $1,203.45 (the payment ledger), and month 4 printed $1,204.
    // Three readings of one payment. Each month must now agree to the cent.
    const gaps: string[] = [];
    let compared = 0;
    for (let m = 1; m < proj.paymentLedger.length && m < out.projections.data.length; m++) {
      const ledger = proj.paymentLedger[m]?.total;
      if (typeof ledger !== 'number' || !Number.isFinite(ledger)) continue;
      const shown = proj.perCardPaymentsScaled.reduce((s, c) => s + (c.payments[m] ?? 0), 0);
      const engine = out.projections.data[m].debtPayment;
      compared++;
      if (Math.abs(shown - ledger) > 0.005 || Math.abs(engine - ledger) > 0.005) {
        gaps.push(`m${m}: shown ${shown.toFixed(2)}, deducted ${ledger.toFixed(2)}, forecast row ${engine}`);
      }
    }
    // Positive control: a zero from an empty loop is not agreement.
    expect(compared, 'months compared').toBeGreaterThanOrEqual(12);
    expect(gaps, 'card payments shown vs deducted vs printed, to the cent').toEqual([]);
  });
});
