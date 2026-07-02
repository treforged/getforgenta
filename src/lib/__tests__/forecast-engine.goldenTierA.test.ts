// Tier-A golden test for the unified Forecast engine (docs/forecast-engine-plan.md, Stage 1/2).
//
// This is the byte-identical guard for the pure Stage-2 extraction: it runs calculateForecast
// against a snapshot of the REAL inputs the running app feeds it (captured from Supabase project
// mdtosrbfkextcaezuclh via the dev-only window.__forecastInputs dump) and asserts the current
// baseline the extraction must preserve.
//
// IMPORTANT — the fixture holds real personal financial data and this repo is PUBLIC, so
// forecast-inputs.real.json is gitignored (kept local only). When it is absent the test
// self-skips (CI stays green without the snapshot); when present it hard-asserts.
//
// Baseline note: on the captured data (07-01) the milestone lands on **Feb 2027**, not the
// Jun-2027 figure from the original plan. That shift is data-driven (a second 0% "upfront"
// payment plan on Prime Visa tipped its whole balance into the CC sim's installment bucket, and
// a due-day-1 statement carve-out on Discover), NOT the refactor — the extracted body is
// byte-identical to the pre-extraction useMemo. When the due-day-1 fix (roadmap item) lands it
// will deliberately move this anchor; update it there as a reviewed behavior change.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { calculateForecast } from '@/lib/forecast-engine';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const hasFixture = existsSync(FIXTURE);
const maybeIt = hasFixture ? it : it.skip;

describe('forecast-engine — Tier A golden (real data)', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('reproduces the captured baseline: CC Debt Free = Feb 2027, surplus-driven, Discover last', () => {
    const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));

    // The engine reads new Date() internally, so anchor the clock to the capture instant —
    // otherwise the projection horizon (and the CC-Debt-Free month) shifts with the run date.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(capturedAt));

    const result = calculateForecast(inputs);

    // Anchors / preconditions: Venture X & Apple Card already $0; Discover & Prime carry balances,
    // so among cards with balances Discover is the last revolving debt to clear.
    const bal = (name: string) => Number(inputs.accounts.find((a) => a.name === name)?.balance ?? NaN);
    expect(bal('Venture X')).toBe(0);
    expect(bal('Apple Card')).toBe(0);
    expect(bal('Discover it Card')).toBeGreaterThan(0);

    // Core invariant the extraction must preserve: the CC Debt Free milestone month.
    const ccFree = result.milestones.find((m) => m.event.startsWith('CC Debt Free'));
    expect(ccFree, 'CC Debt Free milestone should fire within the horizon').toBeTruthy();
    expect(ccFree!.month).toBe('Feb 2027');

    // Mechanism sanity: the milestone is reached by cumulative step-3 surplus covering the sim's
    // revolving balance, and the displayed CC liability falls materially from month 0 to then.
    const idx = result.data.findIndex((r) => r.month === ccFree!.month);
    expect(idx).toBeGreaterThan(0);
    expect(result.data[0].ccDisplayBalance).toBeGreaterThan(1000);
    expect(result.data[idx].revolving3Extra).toBeGreaterThan(4000);
    expect(result.data[idx].ccDisplayBalance).toBeLessThan(result.data[0].ccDisplayBalance);
  });
});
