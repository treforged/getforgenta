// @vitest-environment jsdom
//
// e3566eab residue - an account-paid expense its account cannot cover now raises a WARNING
// milestone, because the chart's endingCash does not carry the unfunded dollars.
//
// A DISCRIMINATING PAIR on two real captures of the same day:
//   NOW-2026-09-29d: the move-fund split applied (the fund pays the $3,830 lease fee in Mar 2027
//     but holds only ~$1,830), measured 2,001.33 unfunded in Mar 2027 -> the warning must fire.
//   CTRL-2026-09-29d (the golden since 0b33c4a4): the fee is paid from checking, 0 unfunded -> it
//     must NOT fire. Without this arm, a milestone that fired every month would pass.
// Self-skips when the gitignored fixtures are absent, like every realData test here.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import type { ForecastInputs } from '@/lib/forecast-engine';
import { classifyMilestoneTone } from '@/lib/next-milestone';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import { renderProjectionFromFixture } from './fixtures/projection-harness';

const SPLIT = join(__dirname, 'fixtures', 'forecast-inputs.real.NOW-2026-09-29d.json');
const CONTROL = join(__dirname, 'fixtures', 'forecast-inputs.real.CTRL-2026-09-29d.json');
const maybeIt = existsSync(SPLIT) && existsSync(CONTROL) ? it : it.skip;
const MARKER = 'more than its account holds';

function run(path: string) {
  const { clock, inputs } = reviveForecastCapture(readFileSync(path, 'utf8'));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
  const out = runDebtCashConvergence(renderProjectionFromFixture(inputs as ForecastInputs), inputs as ForecastInputs);
  return out.projections;
}

describe('unfunded account-paid expense raises a warning milestone', () => {
  afterEach(() => { vi.useRealTimers(); });

  maybeIt('fires in the month the account cannot pay, and only there', () => {
    const split = run(SPLIT);
    const unfundedMonths = split.data.filter(r => (r.unfundedAccountOutflow ?? 0) > 0.005).map(r => r.month);
    expect(unfundedMonths, 'the split capture must actually carry an unfunded outflow').toContain('Mar 2027');
    const hits = split.milestones.filter(m => m.event.includes(MARKER));
    expect(hits.map(m => m.month)).toEqual(unfundedMonths);
    const mar = split.data.find(r => r.month === 'Mar 2027')!;
    const hit = hits.find(m => m.month === 'Mar 2027')!;
    expect(hit.event).toContain(`$${Math.ceil(mar.unfundedAccountOutflow!).toLocaleString('en-US')}`);
    expect(classifyMilestoneTone(hit.event), 'renders as a warning, not in the calm colour').toBe('negative');
  }, 900000);

  // f3c0cdf5 - THE UNFUNDED DOLLARS ARE PAID FROM CHECKING, SO THE SIM CANNOT SPEND THEM ON CARDS.
  // Before the fix the engine never debited them, the sim paid the cards with money that did not
  // exist, and this capture read payoff Jul 2028. Measured after: Sep 2028. (Still earlier than the
  // golden's May 2029, honestly: the split saves less into the fund, so more reaches the cards.)
  maybeIt('the split capture pays its unfunded fee from checking, so the payoff is not falsely early', () => {
    const split = run(SPLIT);
    const payoff = split.milestones.find(m => m.event.startsWith('CC Debt Free'))?.month;
    expect(payoff, 'Jul 2028 was the false date from unpaid dollars').toBe('Sep 2028');
  }, 900000);

  maybeIt('control: the golden (fee paid from checking) raises none', () => {
    const ctrl = run(CONTROL);
    expect(ctrl.data.every(r => (r.unfundedAccountOutflow ?? 0) <= 0.005)).toBe(true);
    expect(ctrl.milestones.filter(m => m.event.includes(MARKER))).toEqual([]);
  }, 900000);
});
