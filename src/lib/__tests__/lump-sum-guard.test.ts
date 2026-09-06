// A CONTROL THAT APPEARS TO DO NOTHING IS THE BUG — NOT A DOUBLE-COUNT.
//
// ⚠️ Tre's rule was "lump sum transfers should only be available when the auto extra goal is
// disabled", and he gave the reason: a double-count. `forecast-engine.lumpSumDoubleCount.test.ts`
// MEASURED that reason and it does not hold — auto-extra drops by exactly the lump amount and
// ending cash is unchanged to the cent, so the goal receives the same total either way.
//
// The rule is kept for the reason he did not give: with auto-extra on, entering a lump sum
// changes neither cash nor the goal's total, so the control is INERT. That is the same "control
// that lies" shape this repo keeps finding, arriving from the other direction.
//
// ⚠️ AND THE GUARD WAS ON ONLY ONE OF THE TWO SURFACES. `LumpSumPanel` (vehicles) had it;
// `GoalLumpSumPanel` on the Savings Goals page did not, and that page did not mention
// `auto_extra` anywhere at all.

import { describe, it, expect } from 'vitest';
import { lumpSumsBlocked, LUMP_SUM_AUTO_EXTRA_NOTE } from '@/lib/lump-sum-guard';

describe('lumpSumsBlocked', () => {
  it('blocks manual lump sums when the sweep is on', () => {
    expect(lumpSumsBlocked(true)).toBe(true);
  });

  it('leaves them available when it is off', () => {
    expect(lumpSumsBlocked(false)).toBe(false);
  });

  it('⚠️ a MISSING flag leaves the control AVAILABLE, never silently removed', () => {
    // Taking a control away on the strength of a value we could not read is the worse error:
    // the person loses a feature and is told a reason that is not true of their goal.
    expect(lumpSumsBlocked(undefined)).toBe(false);
    expect(lumpSumsBlocked(null)).toBe(false);
  });
});

describe('the note', () => {
  it('says where the money already goes, and where to change it', () => {
    // Disabling a control without saying why is the failure this replaces, not a smaller version
    // of it — the person is left with a dead button and no explanation.
    expect(LUMP_SUM_AUTO_EXTRA_NOTE).toMatch(/automatically/i);
    expect(LUMP_SUM_AUTO_EXTRA_NOTE).toMatch(/Where the extra money goes/);
  });
});
