// @vitest-environment jsdom
//
// Q9 DIAGNOSTIC (temporary — delete before commit or promote to regression test).
// User report 2026-07-16: "discover doesnt pull payments back enough for prime visa to always
// pay its full interest saving balance and maintain cash floor in future months."
// Dumps the converged plan's early months on the live 2026-07-16 fixture: per-card payments,
// cash vs floor, ISB pin, caps, and breach milestones.

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

describe('Q9 diagnostic — ISB pin month funding on live fixture', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('dump converged early months', () => {
    const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(capturedAt));

    const base = renderProjectionFromFixture(inputs, {
      persistedDebtFundingId: LIVE_FUNDING_ID,
      paymentPlans: JSON.parse(readFileSync(PLANS_FIXTURE, 'utf8')) as unknown[],
    });
    console.log('manualIsbPins:', JSON.stringify(base.manualIsbPins));
    console.log('simCards mins:', base.simCards.map(c => `${c.name}: min=${c.minPayment} manual=${c.minPaymentIsManual} pref=${c.paymentPreference} bal=${c.balance} apr=${c.apr}`));
    console.log('ccMinTotal (sum):', base.simCards.reduce((s, c) => s + Number(c.minPayment || 0), 0));
    console.log('base maxDebtPaymentByMonth[0..6]:', base.maxDebtPaymentByMonth.slice(0, 7));

    const out = runDebtCashConvergence(base, inputs);
    console.log('converged:', out.converged, 'passes:', out.passes);

    const cp = out.cardProjection;
    console.log('converged SIM maxDebtPaymentByMonth[0..6]:', cp.maxDebtPaymentByMonth.slice(0, 7));
    console.log('converged ENGINE maxDebtPaymentByMonth[0..9]:', out.projections.maxDebtPaymentByMonth.slice(0, 10));
    const names = cp.perCardPayments.map(p => p.name);
    console.log('cards:', names.join(', '));

    console.log('ENGINE caps[0..14]:', out.projections.maxDebtPaymentByMonth.slice(0, 15).map(v => isFinite(v) ? v.toFixed(0) : 'Inf').join(', '));
    const nextFloorShorts: string[] = [];
    for (let m = 0; m <= 14; m++) {
      const row = out.projections.data[m];
      const nextFloor = out.projections.data[m + 1]?.monthMinSafe ?? row.monthMinSafe;
      const delta = row.endingCash - nextFloor;
      if (delta < -0.5) nextFloorShorts.push(`m${m} ${row.month}: ${delta.toFixed(0)}`);
      const per = cp.perCardPayments.map(p => `${p.name}=$${(p.payments[m] ?? 0).toFixed(2)}`).join(' ');
      console.log(
        `m${m} ${row.month}: endCash=$${row.endingCash} floor=$${row.monthMinSafe}` +
        ` nextFloor=$${nextFloor} (Δ${delta.toFixed(0)})` +
        ` debtPay=$${row.debtPayment} revDebtCash=$${row.revolvingDebtCash} | ${per}`,
      );
    }
    console.log('endCash-below-NEXT-floor months:', nextFloorShorts.length ? nextFloorShorts.join(' | ') : 'NONE');
    // Penny-level check on UNROUNDED values (rounded endingCash hides sub-dollar misses).
    const pennyShorts: string[] = [];
    for (let m = 0; m < out.projections.data.length - 1; m++) {
      const row = out.projections.data[m];
      const rawFloor = Math.max(row.rawMonthMinSafe, out.projections.data[m + 1]?.rawMonthMinSafe ?? row.rawMonthMinSafe);
      const rawDelta = row.rawEndingCash - rawFloor;
      if (rawDelta < 0) pennyShorts.push(`m${m} ${row.month}: raw=$${row.rawEndingCash.toFixed(2)} floor=$${rawFloor.toFixed(2)} Δ${rawDelta.toFixed(2)}`);
    }
    console.log('RAW penny-level floor misses:', pennyShorts.length ? pennyShorts.join(' | ') : 'NONE');
    // Rounded-display misses (what Forecast.tsx:1128 turns red): rounded endCash < rounded floor.
    const displayShorts: string[] = [];
    for (let m = 0; m < out.projections.data.length; m++) {
      const row = out.projections.data[m];
      if (row.endingCash < row.monthMinSafe) displayShorts.push(`m${m} ${row.month}: $${row.endingCash} < $${row.monthMinSafe} (raw=$${row.rawEndingCash.toFixed(2)})`);
    }
    console.log('DISPLAY (rounded) floor misses:', displayShorts.length ? displayShorts.join(' | ') : 'NONE');
    for (const p of cp.perCardPayments) {
      const rev = cp.monthlyRevolvingBalances.get(p.id) ?? [];
      console.log(`${p.name} revBal[0..6]:`, rev.slice(0, 7).map(v => v.toFixed(2)).join(', '));
    }
    console.log('milestones:', JSON.stringify(out.projections.milestones.slice(0, 12)));
    const breaches = out.projections.milestones.filter(mm => mm.event.includes('below safe minimum'));
    console.log('floor breaches:', JSON.stringify(breaches));
    expect(true).toBe(true);
  });
});
