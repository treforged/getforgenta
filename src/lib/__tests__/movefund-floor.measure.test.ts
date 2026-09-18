// @vitest-environment jsdom
//
// A MEASUREMENT, NOT A GATE. It asserts almost nothing; it prints the months the move-fund
// save-up pushes under the floor, so ask c067a189 can be answered with a number.
//
// Tre, 2026-09-17: "I don't think it's realistic to have the move fund be paying so much right
// now or like splitting it evenly across all the dates since we have so much credit cards debt
// to pay off ... right now the next three months October, November, and December it seem to be
// dropping below that safe level so I can't do the move for the save up fund without sacrificing
// some other things."
//
// THE GOAL, from his own captured data: "Move fund, then emergency fund", target $5,730 by
// 2027-07-03, current $106.44, monthly_contribution $510, auto_extra on, surplus_share 50.
// $5,623.56 still to find over the ~10 months to the target date is ~$562/mo, so $510 flat IS
// very close to the even split he is describing.
//
// ⚠️ IT RUNS UNDER TWO ZONES AND PRINTS BOTH, AND THAT IS NOT DECORATION. This repo has measured
// this exact capture - 2026-09-01T00:20:11Z - swinging a money figure fifteen-fold between
// America/New_York and UTC, because that instant is 31 August in Eastern and 1 September in UTC,
// so anything indexed by month lands in a different month. CI runs in UTC and Tre does not, so a
// figure measured in one zone is not a fact about the other. The zone is read back from the
// process rather than assumed, because `TZ=` has silently failed on this machine before and two
// clocks agreeing is proof the conversion did NOT happen.
//
// MEASURED 2026-09-18 on forecast-inputs.real.json (captured 2026-09-01), floor 2500:
//   Aug 2026  ending 2558  savings 510  debt    0
//   Sep 2026  ending 2381  savings   0  debt  760   <-- UNDER, and it is a ONE-TIME expense
//   Oct 2026  ending 2712  savings 510  debt  810
//   Nov 2026  ending 2500  savings 279  debt  760   <-- pinned ON the floor, save-up CUT 510->279
//   Dec 2026  ending 2502  savings 510  debt  771   <-- pinned ON the floor
//   Jan 2027  ending 2502  savings 510  debt 1438   <-- pinned ON the floor
//
// ⚠️ HIS WORDS ARE NOT LITERALLY REPRODUCED AND THE SUBSTANCE IS. He said Oct, Nov and Dec
// "seem to be dropping below that safe level". On this capture only SEPTEMBER goes below, and
// Oct/Nov/Dec sit AT 2712 / 2500 / 2502 against a 2500 floor - the engine is holding the line
// exactly, and the thing it sacrifices to do it is the move-fund contribution, cut from 510 to
// 279 in November. That IS "I can't do the move for the save up fund without sacrificing some
// other things", measured. Do not "correct" him and do not report the three months as clean.
//
// ⚠️ BOTH ZONES AGREE TO THE DOLLAR, and that is not luck: `reviveForecastCapture` replays
// at the capture's WALL CLOCK (Aug 31 local under both TZs), so the 31-Aug-Eastern /
// 1-Sep-UTC split this repo has measured elsewhere is already neutralised here. The zone print
// stays because that is what proves it rather than assuming it.
//
// ⚠️ THE HARNESS FIDELITY CONTROL DOES NOT FULLY PASS: the freshly rendered sim lands on
// payoff month 25 where the capture recorded 26. Everything above is therefore CLOSE TO, not
// identical to, what his app computed on 1 September. Treat the shape as evidence and the exact
// dollars as approximate. (forecast-convergence.realData.test.ts prints the same control and
// never asserts it, so it has been green over the same drift.)
//
// ⚠️ AND THE CAPTURE IS 17 DAYS OLD. He described "right now" on 17 September. Before any
// fix is designed, take a FRESH capture - the sub-floor months may have moved.
//
// ⚠️ CORRECTING MYSELF, MEASURED 2026-09-18 AFTER THE FIRST COMMIT OF THIS FILE. I wrote that
// passing the capture's `cashFloor: 0` made the first run "meaningless" and "green about a
// question it had never asked". THAT IS OVERSTATED AND THE CLAIM IS WITHDRAWN.
//
// The engine does NOT use the flat `cashFloor` as the safe minimum. It derives `monthMinSafe`
// per month from essential expenses, and at `cashFloor: 0` that reads 2294 / 2390 / 2444 - not
// zero - and it STILL flags Sep 2026 as `belowSafeMinimum`. So the run was measuring a real
// floor the whole time. What was actually wrong was MY TABLE: it compared `endingCash` against
// the flat input instead of against `monthMinSafe`, so it printed a floor of 0 and NaN endings.
// An instrument error in the printing, not a meaningless run.
//
// ⚠️ AND THAT MEANS THE OVERRIDE BELOW IS NOT OBVIOUSLY THE FAITHFUL CHOICE. His profile
// carries `cash_floor: 2500` with `cash_floor_is_manual: FALSE`, which reads as a DERIVED
// display value rather than an input the app feeds the engine - and forcing 2500 moves
// `monthMinSafe` (2294 -> 2500) and moves November's trimmed contribution (232 -> 279). The
// harness fidelity control moves too, from 24-vs-26 to 25-vs-26, so the override is one month
// closer and still not exact. WHICH INPUT THE APP ACTUALLY USES IS UNRESOLVED; do not quote
// either set of dollars as "what his app shows" without settling that first.
//
// ✅ THE FINDING SURVIVES BOTH WAYS, which is why the visibility fix shipped anyway: November's
// contribution is trimmed under either floor (232 at the captured value, 279 at 2500) and
// September breaches under both. The SHAPE is robust; only the exact dollars depend on the
// unresolved input.
//
// ⚠️ ALSO WITHDRAWN: I suspected forecast-convergence.realData.test.ts asserts "no floor
// breaches" vacuously because it runs at `cashFloor: 0`. Measured, that is WRONG for the same
// reason - `monthMinSafe` is non-zero there and breaches do fire. That assertion is meaningful.
// Its UNASSERTED harness fidelity control (ask 18fbdbf7) is a separate and still-real issue.
//
// Self-skips when the gitignored real fixture is absent.
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

describe('move fund vs the cash floor - measurement for ask c067a189', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('reports which months the save-up pushes under the floor', async () => {
    const { clock, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));

    // Print the zone this run is actually in, rather than trusting whatever TZ was passed.
    const offsetMin = new Date(clock).getTimezoneOffset();
    console.log(`[zone] TZ=${process.env.TZ ?? '(unset)'} offsetMinutes=${offsetMin} `
      + `localDate=${new Date(clock).toString().slice(0, 15)} utcDate=${new Date(clock).toISOString().slice(0, 10)}`);

    // ⚠️ THE CAPTURE'S TOP-LEVEL `cashFloor` IS 0 WHILE HIS PROFILE SAYS 2500, and passing the
    // 0 is why my first run reported no breaches at all: a floor of zero cannot be breached by a
    // positive balance, so the run was green about a question it had not asked. Take the floor
    // from the profile, which is what the app itself reads.
    const profileFloor = Number((inputs as unknown as Record<string, Record<string, unknown>>)
      .profile?.cash_floor ?? 0);
    const capturedFloor = Number(inputs.cashFloor ?? 0);
    console.log(`[floor] captured inputs.cashFloor=${capturedFloor} profile.cash_floor=${profileFloor} - using ${profileFloor}`);
    expect(profileFloor, 'a floor of 0 cannot be breached, so this run would prove nothing').toBeGreaterThan(0);
    (inputs as unknown as Record<string, unknown>).cashFloor = profileFloor;

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

    // HARNESS FIDELITY CONTROL, copied from forecast-convergence.realData.test.ts rather than
    // reinvented: if the freshly rendered sim does not land where the capture landed, the repro
    // is not faithful and nothing below is a fact about his app.
    const snapshot = inputs.cardProjectionData;
    console.log('[control] live sim payoff month:', base!.forecastRevolvingPayoffMonth,
      '| captured snapshot:', snapshot?.forecastRevolvingPayoffMonth);

    const { calculateForecast } = await import('@/lib/forecast-engine');
    const out = runDebtCashConvergence(base!, inputs as ForecastInputs, { engine: calculateForecast });
    console.log('[repro] converged:', out.converged, '| passes:', out.passes,
      '| cashFloor:', inputs.cashFloor);

    console.log('[all-milestones] ' + out.projections.milestones.map(m => `${m.month}=${m.event}`).join(' | '));
    const breaches = out.projections.milestones.filter(m => m.event.includes('below safe minimum'));
    console.log('[repro] floor-breach milestones:', breaches.map(m => `${m.month} (${m.event})`).join(' | ') || '(none)');

    // Per-month picture for the first eight months, which is the window he is talking about.
    // `belowSafeMinimum` is the engine's own single source of truth - the milestone and the red
    // row in MonthlyBreakdownTable both read it - so this reports it rather than re-deriving a
    // comparison that could disagree with what he sees on screen.
    console.log('');
    console.log('month  label       endingCash  monthMinSafe  below?   savingsContrib  debtPayment  goalItems');
    out.projections.data.slice(0, 8).forEach((row, m) => {
      const items = (row.savingsGoalItems ?? []).map(g => `${g.name}:${Math.round(g.amount)}`).join(' ');
      console.log(
        `${String(m).padStart(3)}    ${row.month.padEnd(11)}`
        + `${row.endingCash.toFixed(0).padStart(10)}`
        + `${row.monthMinSafe.toFixed(0).padStart(14)}`
        + `${(row.belowSafeMinimum ? '  UNDER' : '      -').padStart(9)}`
        + `${row.savingsContrib.toFixed(0).padStart(16)}`
        + `${row.debtPayment.toFixed(0).padStart(13)}`
        + `  ${items}`);
    });
    const under = out.projections.data.map((r, m) => ({ m, r })).filter(x => x.r.belowSafeMinimum);
    console.log('');
    console.log(`[repro] months below safe minimum: ${under.map(x => x.r.month).join(', ') || '(none)'}`);

    // Deliberately no assertion on the breach set: this run exists to REPORT the months, and a
    // pin here would freeze whatever today's data happens to say into a gate nobody chose.
    expect(out.projections.data.length).toBeGreaterThan(0);
  }, 120_000);
});
