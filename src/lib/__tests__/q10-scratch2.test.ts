// @vitest-environment jsdom
// SCRATCH (Q10): does the 07-16 live fixture reproduce Prime Visa's persistent $0.04
// revolving dust under current code? Delete before commit.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import { renderProjectionFromFixture } from './fixtures/projection-harness';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.live-2026-07-16.json');
const PLANS_FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.payment-plans-2026-07-16.json');
const maybeIt = existsSync(FIXTURE) && existsSync(PLANS_FIXTURE) ? it : it.skip;
const LIVE_FUNDING_ID = '933cbc10-bceb-4c20-8227-4a02e6db728a';

describe('q10 scratch2 — PV dust on live fixture', () => {
  afterEach(() => vi.useRealTimers());
  maybeIt('print PV revolving tail', () => {
    const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(capturedAt));
    const base = renderProjectionFromFixture(inputs, {
      persistedDebtFundingId: LIVE_FUNDING_ID,
      paymentPlans: JSON.parse(readFileSync(PLANS_FIXTURE, 'utf8')) as unknown[],
    });
    const out = runDebtCashConvergence(base, inputs);
    const cp = out.cardProjection;
    for (const pc of cp.perCardPayments) {
      const rev = cp.monthlyRevolvingBalances.get(pc.id) ?? [];
      const bal = cp.monthlyBalances.get(pc.id) ?? [];
      console.log(pc.name, '| rev m10-16:', rev.slice(10, 17), '| bal m10-16:', bal.slice(10, 17));
    }
    console.log('simRevolvingPayoffMonth:', cp.simRevolvingPayoffMonth,
      '| forecastRevolvingPayoffMonth:', cp.forecastRevolvingPayoffMonth,
      '| converged:', out.converged);
    expect(out.converged).toBe(true);
  });
});
