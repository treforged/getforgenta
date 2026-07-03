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
// Baseline note: the CC Debt Free milestone now fires on the SIM's TRUE revolving-$0 month
// (cardProjectionData.simRevolvingPayoffMonth), not the earlier "surplus covers the balance"
// month. History: the byte-identical Stage-2 extraction reproduced Feb 2027; the P0 debt fixes
// plus the sim balloon/displayCCBalance fixes moved the surplus-covers month to Apr 2027; the
// Phase-3 milestone-timing fix then repointed the milestone at simRevolvingPayoffMonth (~1 month
// later, when Discover — the last interest-bearing card — actually reaches $0), so a Discover
// payment no longer shows after the milestone.
//
// This test derives the expected milestone month FROM the fixture's own frozen
// simRevolvingPayoffMonth (so it survives fixture refreshes) AND pins the human-readable calendar
// month as a secondary anchor. On the current (post-balloon-fix) fixture captured 2026-07-03,
// simRevolvingPayoffMonth = 11 → data index 10 → May 2027 (month 0 = Jul 2026).

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

  maybeIt('CC Debt Free milestone fires on the SIM true revolving-$0 month, Discover last', () => {
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

    // Phase-3 invariant: the milestone lands on the SIM's true all-revolving-clear month
    // (simRevolvingPayoffMonth, 1-based → data index simRevolvingPayoffMonth - 1), derived from the
    // fixture's own frozen cardProjectionData so it survives fixture refreshes.
    const payoffMonth = inputs.cardProjectionData?.simRevolvingPayoffMonth
      ?? inputs.cardProjectionData?.forecastRevolvingPayoffMonth;
    expect(payoffMonth, 'fixture must carry a revolving payoff signal').toBeTruthy();
    const expectedIdx = (payoffMonth as number) - 1;

    const ccFree = result.milestones.find((m) => m.event.startsWith('CC Debt Free'));
    expect(ccFree, 'CC Debt Free milestone should fire within the horizon').toBeTruthy();
    expect(ccFree!.month).toBe(result.data[expectedIdx].month);
    // Secondary human-readable anchor for the current fixture (re-pin if the fixture is refreshed).
    expect(ccFree!.month).toBe('May 2027');

    // Mechanism sanity: the displayed CC liability falls materially from month 0 to the payoff month.
    const idx = result.data.findIndex((r) => r.month === ccFree!.month);
    expect(idx).toBe(expectedIdx);
    expect(result.data[0].ccDisplayBalance).toBeGreaterThan(1000);
    expect(result.data[idx].ccDisplayBalance).toBeLessThan(result.data[0].ccDisplayBalance);
  });
});
