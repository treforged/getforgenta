// @vitest-environment jsdom
// TEMPORARY diagnostic — deleted before hand-off.
import { describe, it, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import { renderProjectionFromFixture } from './fixtures/projection-harness';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const maybeIt = existsSync(FIXTURE) ? it : it.skip;

describe('DIAG', () => {
  afterEach(() => vi.useRealTimers());
  maybeIt('dump', () => {
    const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(capturedAt));
    const base = renderProjectionFromFixture(inputs);
    // eslint-disable-next-line no-console
    console.log('PINS', JSON.stringify(base.manualIsbPins));
    // eslint-disable-next-line no-console
    console.log('MAXDEBT[0..5]', JSON.stringify(base.maxDebtPaymentByMonth.slice(0, 6)));
    // eslint-disable-next-line no-console
    console.log('SAVEUP', JSON.stringify([...base.saveUpMonths].slice(0, 12)));
    // eslint-disable-next-line no-console
    console.log('M0', JSON.stringify({
      safeToPayTotal: base.month0.safeToPayTotal,
      revolvingPayment: base.month0.revolvingPayment,
      cyclingPayment: base.month0.cyclingPayment,
      maxCapacity: base.month0.maxCapacity,
      holdback: base.month0.holdback,
      m0SafeFloor: base.month0.m0SafeFloor,
      endCash: base.month0.endCash,
      perCard: base.month0.perCardAdjusted,
    }));
    // eslint-disable-next-line no-console
    console.log('LEDGER0', JSON.stringify(base.paymentLedger[0]));
    const out = runDebtCashConvergence(base, inputs);
    const cc = out.projections.milestones.find(m => m.event.startsWith('CC Debt Free'));
    // eslint-disable-next-line no-console
    console.log('CONV', JSON.stringify({ converged: out.converged, passes: out.passes, ccFree: cc?.month ?? null,
      breaches: out.projections.milestones.filter(m => m.event.includes('below safe minimum')).map(m => m.month) }));
    // eslint-disable-next-line no-console
    console.log('ENGINE_M0_DEBT', JSON.stringify(out.projections.data.slice(0, 4).map(d => ({ m: d.month, debtPayment: d.debtPayment, endingCash: d.endingCash }))));
  }, 300000);
});
