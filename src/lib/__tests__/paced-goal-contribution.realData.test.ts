// @vitest-environment jsdom
//
// 585ec24a — DEBT-AWARE PACING, gated on Tre's real data as a DISCRIMINATING PAIR.
//
// Tre, 2026-09-18: "keep the date but we need to transfer less initially. it doesnt need to be
// consistently the same every month. the goals is to save on interest when there is credit card
// debt." The same fixture is run twice through the real sim + real engine + convergence loop:
// FLAT (the old fixed monthly_contribution) and PACED. Every acceptance line in the ask is asserted
// against the flat arm, so a green here means "better than before", not merely "plausible".
//
// ⚠️ THE POSITIVE CONTROL MOVED 2026-09-23 (ask 34fe4e5d). The flat arm's Sep 2026 one-time floor
// dip used to be it. Month 0 now honours floor protection's look-ahead, so the flat arm holds
// back enough for that one-off too, and the dip is gone on BOTH arms. On this fixture that is the
// only change (payoff Sep 2028 both arms; card totals within $3). The control is now a THIRD run:
// the flat arm's converged inputs plus a $40,000 one-off in Jan 2027 that no save-up can absorb,
// which the engine must flag. It does not depend on any defect, so it cannot vanish when one is
// fixed. Without it the "no breaches" assertions would pass on a filter that matches nothing.
//
// Self-skips when the gitignored fixture is absent, like every realData test here.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import { calculateForecast, type ForecastInputs, type ForecastMonthRow } from '@/lib/forecast-engine';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import { renderProjectionFromFixture } from './fixtures/projection-harness';
import {
  pacedContributionSchedule, accountOutflowsFrom, setPacedContributionsForTest, type PacedGoal,
} from '@/lib/paced-goal-contribution';
import { PROJECTION_MONTHS } from '@/lib/credit-card-engine';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const maybeIt = existsSync(FIXTURE) ? it : it.skip;

async function runArm(paced: boolean) {
  setPacedContributionsForTest(paced);
  const { clock, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
  const base = renderProjectionFromFixture(inputs as ForecastInputs);
  const out = runDebtCashConvergence(base, inputs as ForecastInputs);
  return { out, inputs: inputs as ForecastInputs, clock };
}

const monthsOf = (label: string | undefined) => {
  const t = label ? Date.parse(`1 ${label}`) : NaN;
  return Number.isNaN(t) ? NaN : new Date(t).getFullYear() * 12 + new Date(t).getMonth();
};
const acctBalance = (row: ForecastMonthRow, id: string) =>
  row.assetBreakdown.filter(a => a.id === id).reduce((s, a) => s + a.balance, 0);

describe('585ec24a paced goal contribution — flat vs paced on the real fixture', () => {
  afterEach(() => { setPacedContributionsForTest(null); vi.useRealTimers(); });

  maybeIt('transfers less early, funds more of the goal, never overdraws its account, and compares interest only when both arms fund it', async () => {
    const flat = await runArm(false);
    const paced = await runArm(true);

    // The fixture must actually exercise the feature: exactly one goal qualifies.
    const goals = (paced.inputs.goals ?? []) as PacedGoal[];
    const outflows = accountOutflowsFrom(paced.inputs.transactions as never);
    const qualifying = goals.filter(g => pacedContributionSchedule(g, new Date(paced.clock), PROJECTION_MONTHS, outflows));
    expect(qualifying.map(g => g.id), 'the move goal is the one paced goal on this fixture').toHaveLength(1);
    const goal = qualifying[0];
    const acct = goal.linked_account as string;

    const fd = flat.out.projections.data, pd = paced.out.projections.data;
    const ms = (o: typeof flat.out, s: string) => o.projections.milestones.filter(m => m.event.includes(s)).map(m => m.month);

    // ── POSITIVE CONTROL: the filters can find a floor milestone at all (see the header).
    const shockKey = '2027-01';
    const prior = flat.inputs.oneTimeByMonth[shockKey] ?? { income: 0, expense: 0 };
    const shocked = calculateForecast({
      ...flat.inputs,
      cardProjectionData: flat.out.cardProjection,
      oneTimeByMonth: { ...flat.inputs.oneTimeByMonth, [shockKey]: { ...prior, expense: prior.expense + 40_000 } },
    });
    const shockedMs = shocked.milestones.filter(m => m.event.includes('One-time expense caused floor breach')).map(m => m.month);
    expect(shockedMs, 'control: an unabsorbable one-off must be flagged').toContain('Jan 2027');
    // ── The flat arm, pinned. RE-PINNED 2026-09-30 on the 09-29 capture: its March 2027 lease fee
    // ($3,830 from checking) lands on the floor, so the counterfactual arm dips there. The paced arm
    // (what ships) is asserted free of one-time breaches in (e).
    expect(ms(flat.out, 'One-time expense caused floor breach'), 'flat arm').toEqual(['Mar 2027']);
    expect(ms(flat.out, 'CC Debt Free')).toEqual(['Feb 2029']); // 09-29 capture (was Sep 2028 on 09-23)

    // ── Both arms converge.
    expect(flat.out.converged && paced.out.converged).toBe(true);

    // ── Did each arm fund the goal? Read on the row BEFORE the goal's target month, because the
    // goal's money leaves at the start of that month.
    const target = Number(goal.target_amount);
    const tgt = new Date(`${goal.target_date}T00:00:00`);
    const tgtLabel = tgt.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    const tgtIdx = fd.findIndex(r => r.month === tgtLabel);
    expect(target, 'the goal carries a target').toBeGreaterThan(0);
    expect(tgtIdx, `target month ${tgtLabel} is inside the horizon`).toBeGreaterThan(0);
    const flatHeld = acctBalance(fd[tgtIdx - 1], acct);
    const pacedHeld = acctBalance(pd[tgtIdx - 1], acct);
    const flatFunded = flatHeld >= target - 0.01;
    const pacedFunded = pacedHeld >= target - 0.01;

    // ── RESTATED 2026-09-30. Interest, (a) and (b), is compared ONLY when BOTH arms fund the goal
    // by its date. Otherwise the arm that saves less wins on interest simply by saving less, and
    // the comparison rewards missing the goal. On the 09-29 capture neither arm reaches it: measured
    // Jun 2027 flat 4,084, paced 5,563 of 5,730. Paced pays the cards more (67,542 vs 67,163)
    // because it moves ~$1,765 more into the goal. (Ask bd05e063 was filed and retracted on exactly
    // this misreading.) So in that case assert what pacing is for: it funds MORE of the goal, and
    // the flat arm does not fund it.
    const sum = (d: ForecastMonthRow[]) => d.reduce((s, r) => s + r.debtPayment, 0);
    if (flatFunded && pacedFunded) {
      // (a) The card clears no later than it did with the flat 510.
      const flatFree = ms(flat.out, 'CC Debt Free')[0];
      const pacedFree = ms(paced.out, 'CC Debt Free')[0];
      expect(monthsOf(pacedFree), `paced payoff ${pacedFree} vs flat ${flatFree}`).toBeLessThanOrEqual(monthsOf(flatFree));
      // (b) It saves interest: less total paid to the cards over the horizon, and a lower card
      // balance on the goal's own date. Measured 2026-09-23: 66423 -> 66002, and 15464 -> 14660.
      expect(sum(pd), 'paced must pay the cards less in total (less interest)').toBeLessThan(sum(fd) - 100);
      expect(pd[tgtIdx].ccDebtBalance).toBeLessThan(fd[tgtIdx].ccDebtBalance - 500);
    } else {
      expect(flatFunded, `flat funds the goal (${flatHeld.toFixed(0)} of ${target}) while paced does not (${pacedHeld.toFixed(0)})`).toBe(false);
      expect(pacedHeld, `paced must fund more of the goal than flat (${pacedHeld.toFixed(0)} vs ${flatHeld.toFixed(0)})`).toBeGreaterThan(flatHeld + 500);
    }

    // ── (c) "Transfer less initially": month 0's goal draw is below the flat 510.
    const draw = (r: ForecastMonthRow) => r.savingsGoalItems.filter(i => i.goalId === goal.id).reduce((s, i) => s + i.amount, 0);
    expect(draw(fd[0])).toBeCloseTo(510, 2);
    expect(draw(pd[0])).toBeLessThan(200);

    // ── (d) The account covers the outflows it actually carries: it never goes negative. The
    // old "May >= 5,730" was the June-outflow shape. On the 09-29 capture the lease fee is paid from
    // checking in March, and the goal account's money leaves on 1 Jul 2027 (movers).
    for (const r of pd) expect(acctBalance(r, acct), `${r.month} move account`).toBeGreaterThanOrEqual(-0.01);

    // ── (e) THE FLOOR STILL BINDS: no one-time breach in the paced arm, and the only convergence
    // breach is Oct 2026, which is genuinely under the floor on this capture (the same pin as
    // forecast-convergence.realData).
    expect(ms(paced.out, 'below safe minimum')).toEqual(['Oct 2026']);
    expect(ms(paced.out, 'One-time expense caused floor breach')).toEqual([]);
  });
});
