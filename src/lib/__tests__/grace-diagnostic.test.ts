// @vitest-environment jsdom
//
// GRACE DIAGNOSTIC (temporary — delete before commit).
// Session 54: the session-52 handoff claimed the ISB pin being single-month (GAP 1) is why
// Prime Visa never pays its interest-saving balance after month 1. But Step 5b already caps
// statement cards at cascadeTarget (= startBal - instBal + interest), which is EXACTLY the
// expression :1616 uses to re-arm grace — and avalanche puts Prime Visa (27.49%) first.
// So plain avalanche should already preserve grace. Measure it before building a tier that
// may be a no-op: dump per-month interest (>0 means grace was LOST) and payment vs target.

import { describe, it, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import { renderProjectionFromFixture } from './fixtures/projection-harness';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const maybeIt = existsSync(FIXTURE) ? it : it.skip;
const LIVE_FUNDING_ID = '933cbc10-bceb-4c20-8227-4a02e6db728a';

describe('grace diagnostic — does Prime Visa hold grace past the pin month?', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('dump per-month interest and payments', () => {
    const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(capturedAt));

    const base = renderProjectionFromFixture(inputs, { persistedDebtFundingId: LIVE_FUNDING_ID });
    const out = runDebtCashConvergence(base, inputs);
    const cp = out.cardProjection;

    console.log('capturedAt:', capturedAt, 'converged:', out.converged, 'passes:', out.passes);
    console.log('manualIsbPins:', JSON.stringify(cp.manualIsbPins ?? base.manualIsbPins));
    for (const c of cp.simCards) {
      console.log(`CARD ${c.name}: bal=${c.balance} apr=${c.apr} pref=${c.paymentPreference}` +
        ` isb=${c.statementBalance} instBal=${c.installmentBalance} instPmt=${c.installmentMonthlyPayment}` +
        ` min=${c.minPayment} target=${c.targetPayment}`);
    }

    const interest = cp.monthlyInterest;
    for (const c of cp.simCards) {
      if (c.paymentPreference !== 'statement' || c.balance <= 0) continue;
      const arr = interest?.get(c.id) ?? [];
      const bal = cp.monthlyBalances?.get(c.id) ?? [];
      const pay = cp.perCardPayments.find(p => p.id === c.id)?.payments ?? [];
      console.log(`\n=== ${c.name} (statement pref) ===`);
      for (let m = 0; m < 15; m++) {
        const i = arr[m] ?? 0;
        // startBal(m) = end balance of m-1; instBal amortizes by the upfront plan payment.
        const startBal = m === 0 ? c.balance : (bal[m - 1] ?? 0);
        const instBal = Math.max(0, (c.installmentBalance ?? 0) - (c.installmentMonthlyPayment ?? 0) * m);
        const target = Math.max(0, startBal - instBal + i);
        const p = pay[m] ?? 0;
        console.log(`  m${m}: startBal=$${startBal.toFixed(0)} instBal=$${instBal.toFixed(0)}` +
          ` target=$${target.toFixed(2)} pay=$${p.toFixed(2)} short=$${(target - p).toFixed(2)}` +
          ` interest=$${i.toFixed(2)}${i > 0.005 ? '  <-- GRACE LOST' : ''}`);
      }
      const total12 = arr.slice(0, 12).reduce((s, v) => s + v, 0);
      console.log(`  >>> ${c.name} interest over first 12 months: $${total12.toFixed(2)}`);
    }
  }, 120000);
});
