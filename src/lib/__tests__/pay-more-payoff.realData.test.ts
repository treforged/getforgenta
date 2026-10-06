// @vitest-environment jsdom
//
// payMoreReport on Tre's own 2026-09-29 capture (gitignored, so this skips in CI).
//
// The page runs each option through runDebtCashConvergence against the card projection rendered
// ONCE from the untouched rows. That shortcut is only honest if it matches a full re-render, so this
// test asserts BOTH for every amount: measured 2026-10-05, identical at +$0/100/250/500.
// A synthetic income RULE was tried first and moved nothing (cash identical to the dollar): income
// reaches the engine through forecastMonthEvents, not rules, which is why the lever edits those.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import type { ForecastInputs } from '@/lib/forecast-engine';
import { payoffMonth } from '@/lib/breach-levers';
import { payMoreReport, withExtraMonthly } from '@/lib/pay-more-payoff';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import { renderProjectionFromFixture } from './fixtures/projection-harness';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.LEVERS-2026-09-29.json');
const maybeIt = existsSync(FIXTURE) ? it : it.skip;

describe('payMoreReport on the 2026-09-29 capture', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('moves the debt-free month by the engine, and the shortcut equals a full re-render', () => {
    const { clock, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
    const base = renderProjectionFromFixture(inputs);
    const run = (i: ForecastInputs) => runDebtCashConvergence(base, i).projections;

    const r = payMoreReport(inputs, run);
    expect(r.basePayoff).toBe('Aug 2029');
    expect(r.options).toEqual([
      { extraMonthly: 100, payoffMonth: 'May 2029', monthsSooner: 3 },
      { extraMonthly: 250, payoffMonth: 'Oct 2028', monthsSooner: 10 },
      { extraMonthly: 500, payoffMonth: 'Jun 2028', monthsSooner: 14 },
    ]);

    for (const o of r.options) {
      const i = withExtraMonthly(inputs, o.extraMonthly);
      const full = payoffMonth(runDebtCashConvergence(renderProjectionFromFixture(i), i).projections);
      expect(full).toBe(o.payoffMonth);
    }
  }, 300_000);
});
