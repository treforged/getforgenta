// @vitest-environment jsdom
//
// Option B regression (handoff 2026-07-22, session 22): full internal consistency of the month-0
// augmented-floor cap. Option A only overrode the payment LEDGER the engine reads for cash — the
// sim itself still paid the raw, un-floor-capped month-0 amount, so its month-0 sim balances /
// per-card payments ran ~$176 richer than the recommendation (Discover projected balance understated
// downstream). Option B pins each card's month 0 to its perCardAdjustedFinal amount so the sim
// ACTUALLY pays the floor-capped plan.
//
// Invariant this guards: the SIM-derived month-0 per-card payments sum to the floor-capped ledger
// total (and to month0.safeToPayTotal). Under Option A the sim total diverged from the ledger; under
// Option B they agree, i.e. no month-0 balance drift. Self-skips when the gitignored fixture is
// absent (same pattern as forecast-convergence.realData.test.ts).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '@/hooks/useCardProjection';
import { PROJECTION_MONTHS } from '@/lib/credit-card-engine';
import { generateScheduledEvents } from '@/lib/scheduling';
import { reviveForecastCapture } from '@/lib/__tests__/fixtures/forecast-fixture-io';
import { loadRealPaymentPlans } from '@/lib/__tests__/fixtures/projection-harness';

const FIXTURE = join(__dirname, '..', '..', 'lib', '__tests__', 'fixtures', 'forecast-inputs.real.json');
const hasFixture = existsSync(FIXTURE);
const maybeIt = hasFixture ? it : it.skip;

describe('useCardProjection — month-0 floor pin makes the sim pay the plan (Option B)', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('sim-derived month-0 per-card payments sum to the floor-capped ledger total', () => {
    const { clock, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
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
      paymentPlans: (fx.paymentPlans as never) ?? (loadRealPaymentPlans() as never),
    } as unknown as UseCardProjectionParams));

    const base = result.current;
    expect(base).not.toBeNull();

    // The floor-capped ledger the engine reads and the recommendation the popup shows already agreed
    // under Option A.
    expect(base!.paymentLedger[0].total).toBe(base!.month0.safeToPayTotal);

    // Option B: the SIM itself paid that amount. perCardPayments are the sim-derived month-0 payments;
    // their sum must equal the ledger total (± $1 rounding). Under Option A this sum was the raw,
    // un-floor-capped payment and diverged from the ledger by the floor buffer.
    const simMonth0Total = base!.perCardPayments.reduce((s, pc) => s + (pc.payments[0] ?? 0), 0);
    expect(Math.abs(simMonth0Total - base!.paymentLedger[0].total)).toBeLessThanOrEqual(1);
  });
});
