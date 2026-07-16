// @vitest-environment jsdom
//
// Q7 regression test (2026-07-16): Venture X missed its full Jan 2029 statement live — paid $50
// of a $300 statement, carried a $250 backlog and got charged $4.79 interest in Feb 2029.
//
// Root cause: CardProjectionContext.projectionAssumptions omitted `promotions`, so the SIM never
// saw the scheduled 2027-02-25 salary promotion while the ENGINE did. From the promotion month
// onward the sim underestimated income, its floor look-ahead throttled debt payments into
// save-up mode (base payoff 13 → 36 months), and the convergence loop settled on a degenerate
// fixed point where VX's mandatory cycling payment demoted to the $25 minimum and the Step-5
// pool shorted the Jan 2029 statement. Repro required two other live-vs-harness fidelity gaps
// closed via ProjectionHarnessOverrides: paymentPlans and persistedDebtFundingId.
//
// Self-skips when the gitignored live fixtures are absent (same pattern as manualISB).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import { renderProjectionFromFixture } from './fixtures/projection-harness';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.live-2026-07-16.json');
const PLANS_FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.payment-plans-2026-07-16.json');
const maybeIt = existsSync(FIXTURE) && existsSync(PLANS_FIXTURE) ? it : it.skip;

// Live localStorage `tre:debt:fundingAccount` at capture time.
const LIVE_FUNDING_ID = '933cbc10-bceb-4c20-8227-4a02e6db728a';

describe('runDebtCashConvergence — sim/engine promotion parity (Q7 regression)', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('with promotions visible to the sim, every cycling statement is paid in full', () => {
    const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(capturedAt));

    // Scenario precondition: the fixture must carry the scheduled promotion whose omission from
    // the sim produced the Q7 miss — otherwise this test silently stops covering the scenario.
    const promos = (inputs.assumptions as { promotions?: unknown[] }).promotions ?? [];
    expect(promos.length, 'fixture must carry a scheduled promotion').toBeGreaterThanOrEqual(1);

    const base = renderProjectionFromFixture(inputs, {
      persistedDebtFundingId: LIVE_FUNDING_ID,
      paymentPlans: JSON.parse(readFileSync(PLANS_FIXTURE, 'utf8')) as unknown[],
    });
    const out = runDebtCashConvergence(base, inputs);
    expect(out.converged, 'convergence loop must settle within the pass budget').toBe(true);

    // Q7 shape: Venture X (annual-spike cycling card) shorted its Jan 2029 (m30) statement —
    // backlog $249.99, $4.79 interest charged the next month. With sim/engine promotion parity
    // the converged plan pays every VX statement in full, so any VX backlog or cycling interest
    // is a regression. (Other cards may legitimately underpay pre-payoff when cash-constrained —
    // the honest-outflow design — so this stays scoped to the card the bug shorted.)
    const cp = out.cardProjection;
    const vx = cp.perCardPayments.find(p => p.name === 'Venture X');
    expect(vx, 'fixture must carry the Venture X card').toBeTruthy();
    const backlog = cp.monthlyCyclingBacklog.get(vx!.id) ?? [];
    const interest = cp.monthlyCyclingInterest.get(vx!.id) ?? [];
    expect(backlog.length, 'VX must have a cycling backlog series').toBeGreaterThan(30);
    for (let m = 1; m < backlog.length; m++) {
      expect(backlog[m], `VX carries cycling backlog at m${m}`).toBeLessThanOrEqual(0.01);
      expect(interest[m] ?? 0, `VX accrues cycling interest at m${m}`).toBeLessThanOrEqual(0.01);
    }
  });

  it('CardProjectionContext threads promotions into the sim assumptions (static tripwire)', () => {
    // The projection harness can't render the context, so the exact Q7 omission — the context's
    // projectionAssumptions dropping a field the engine's assumptions carry — is guarded here at
    // the source level. If this fails, the sim and engine have diverging income models again.
    const src = readFileSync(join(__dirname, '..', '..', 'contexts', 'CardProjectionContext.tsx'), 'utf8');
    expect(src).toMatch(/promotions:\s*assumptions\.promotions/);
  });
});
