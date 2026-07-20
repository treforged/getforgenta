// @vitest-environment jsdom
//
// Anomaly B regression test: a user month-pin (CreditCardEngine's override) must survive the
// full debt-cash convergence loop. withPaymentOverrides bakes the pins into both the base sim
// AND its resimulateWithDebtCash closure, so every resim pass replays them — this test proves
// the pinned card's payment at the pinned month comes back (within rounding) as the pin after
// runDebtCashConvergence, i.e. the loop's FROM-BASE resims did not drop it.
//
// Harness cloned from forecast-convergence.realData.test.ts; self-skips when the gitignored
// fixture is absent (same pattern as forecast-engine.goldenTierA).

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
const maybeIt = hasFixture ? it : it.skip;

describe('runDebtCashConvergence — user payment pin survives every resim pass', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('keeps the pinned payment on the converged projection', () => {
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
      paymentPlans: (fx.paymentPlans as never) ?? (loadRealPaymentPlans() as never),
    } as unknown as UseCardProjectionParams));

    const base = result.current;
    expect(base).not.toBeNull();
    expect(base!.withPaymentOverrides, 'freshly rendered hook must expose withPaymentOverrides').toBeTruthy();

    // Pick a pinnable card+month from the UNPINNED converged run: month 1..12 where the card
    // still carries a revolving balance at start of month (> $500, so a $25 reduction can't
    // cross payoff) and the converged payment sits at least $50 above the contract minimum —
    // pin = payment − 25 then lies strictly between min and available cash, so the sim's clamp
    // never fires and the converged payment must equal the pin exactly (± rounding).
    const unpinned = runDebtCashConvergence(base!, inputs as ForecastInputs).cardProjection;
    let pick: { id: string; name: string; month: number; pin: number } | null = null;
    for (const pc of unpinned.perCardPayments) {
      const mins = unpinned.perCardMinPayments.get(pc.id) ?? [];
      const revBals = unpinned.monthlyRevolvingBalances.get(pc.id) ?? [];
      for (let m = 1; m <= 12 && !pick; m++) {
        const startBal = revBals[m - 1] ?? 0;
        if (startBal > 500 && (pc.payments[m] ?? 0) >= (mins[m] ?? 0) + 50) {
          pick = { id: pc.id, name: pc.name, month: m, pin: pc.payments[m] - 25 };
        }
      }
      if (pick) break;
    }
    expect(pick, 'fixture must offer a card+month with headroom to pin').toBeTruthy();
    console.log('[pin] card:', pick!.name, '| month:', pick!.month, '| pin:', pick!.pin);

    const pinnedBase = base!.withPaymentOverrides!({ [pick!.id]: { [pick!.month]: pick!.pin } });
    const out = runDebtCashConvergence(pinnedBase, inputs as ForecastInputs);
    console.log('[pin] converged:', out.converged, '| passes:', out.passes);

    expect(out.converged, 'pinned convergence loop must settle within the pass budget').toBe(true);
    const pinnedPayments = out.cardProjection.perCardPayments.find(p => p.id === pick!.id)?.payments ?? [];
    // perCardPayments are rounded ints; ±$1 tolerance. Equality here proves the pin survived
    // every FROM-BASE resim pass of the loop — the whole point of Anomaly B.
    expect(Math.abs(pinnedPayments[pick!.month] - pick!.pin),
      `pinned payment at month ${pick!.month} must survive convergence`).toBeLessThanOrEqual(1);
  });
});
