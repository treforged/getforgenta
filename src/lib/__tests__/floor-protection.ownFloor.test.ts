// THE RESERVE CHAIN GUARANTEES EVERY MONTH ENDS AT OR ABOVE ITS OWN FLOOR (2026-08-25).
//
// `computeFloorProtection`'s backward pass used to reserve against the NEXT month's floor only:
//
//     const nextFloor = floorByMonth[m + 1] ...
//     reserveNeeded[m] = max(0, nextFloor + reserveNeeded[m + 1] - (floorByMonth[m] + netAtMin[m]))
//
// `floorByMonth[m]` appeared in that line solely as the assumed STARTING balance, so the
// requirement it enforced was "month m ends at month m+1's floor". But forecast-engine.ts judges
// every month against ITS OWN floor (`belowSafeMinimum = rawEndingCash < b.monthMinSafe`), and so
// does the sim's cash walk. Wherever a floor STEPS DOWN — Apr 2027's $3,332.12 against May's
// $2,800 on the real 2026-07-20 capture — every earlier month under-reserved by exactly that step.
//
// The "start each month at its own floor" baseline hid it: that is only a safe assumption while
// netAtMin[m] >= 0, and netAtMin is deeply negative in precisely the month a large one-time
// expense lands. The fix adds floorByMonth[m] as a third term of the recurrence, restated as an
// absolute required ENDING balance — the same quantity the forward pass caps to and the same
// quantity the engine's own floor test reads.
//
// WOULD-FAIL CHECK, run 2026-08-25: with the old recurrence restored, `the stepped case is
// protected too` reports the shock month ending $1,098 BELOW its own floor (measured, not
// estimated) while the flat control passes untouched. The control is the whole point of the pair —
// when a month's own floor equals its neighbour's the two readings of the algorithm coincide, so a
// test with flat floors cannot see this defect at all.

import { describe, it, expect } from 'vitest';
import { computeFloorProtection } from '@/lib/floor-protection';
import { PROJECTION_MONTHS } from '@/lib/scheduling';

const INCOME = 6000, EXPENSE = 3800, CCMIN = 300, START = 2800;
/** The month the one-time expense lands in, and its size. Capacity is deliberately ample
 *  (netAtMin = +$1,900/mo for every other month) so nothing here is runway-limited: any shortfall
 *  is structural, not arithmetic. */
const SHOCK_M = 4, SHOCK = 3000;
const BASE_FLOOR = 2800;

interface WalkRow { m: number; pay: number; end: number; ownFloor: number; vsOwnFloor: number }

/** Runs the real algorithm, then walks cash forward exactly as its own forward pass does so the
 *  caps can be judged by the balances they actually produce rather than by their own arithmetic. */
function scenario(ownFloorAtShockMonth: number) {
  const n = PROJECTION_MONTHS;
  const floorByMonth = Array<number>(n).fill(BASE_FLOOR);
  floorByMonth[SHOCK_M] = ownFloorAtShockMonth;
  const oneTimeNetByMonth = Array<number>(n).fill(0);
  oneTimeNetByMonth[SHOCK_M] = -SHOCK;

  const res = computeFloorProtection({
    incomeByMonth: Array<number>(n).fill(INCOME),
    expenseByMonth: Array<number>(n).fill(EXPENSE),
    oneTimeNetByMonth,
    carDownPaymentByMonth: Array<number>(n).fill(0),
    floorByMonth,
    startingBalance: START,
    ccMinTotal: CCMIN,
    ccMinByMonth: Array<number>(n).fill(CCMIN),
    cyclingExcessByMonth: Array<number>(n).fill(0),
    carFunds: [],
    transactions: [],
    ccSourceIds: new Set<string>(),
    now: new Date('2026-07-20T00:00:00Z'),
    formatCurrency: (a: number) => `$${a.toFixed(0)}`,
  });

  let bal = START;
  const walk: WalkRow[] = [];
  for (let m = 0; m <= 6; m++) {
    const f = floorByMonth[m];
    const ot = oneTimeNetByMonth[m];
    const natural = Math.max(CCMIN, Math.max(0, bal + INCOME - EXPENSE + ot - f));
    const pay = Math.min(natural, res.maxDebtPaymentByMonth[m]);
    bal += INCOME - EXPENSE + ot - pay;
    walk.push({ m, pay: Math.round(pay), end: Math.round(bal), ownFloor: f, vsOwnFloor: Math.round(bal - f) });
  }
  return { res, walk };
}

describe('computeFloorProtection — the reserve targets each month own floor', () => {
  it('protects the control, where the shock month floor equals its neighbours', () => {
    // nextFloor === ownFloor here, so the two possible readings of the algorithm coincide. This
    // case passed before the fix and must still pass after it — it is the guard that the fix did
    // not simply make every month reserve more.
    const { res, walk } = scenario(BASE_FLOOR);

    expect(walk[SHOCK_M].vsOwnFloor).toBeGreaterThanOrEqual(0);
    for (const row of walk) expect(row.vsOwnFloor, `month ${row.m}`).toBeGreaterThanOrEqual(0);

    // Unchanged baseline arithmetic: one save-up month, capped at $1,098 so the month before the
    // shock ends $1,102 clear of its floor.
    expect([...res.saveUpMonths].filter(m => m <= 6)).toEqual([SHOCK_M - 1]);
    expect(Math.round(res.maxDebtPaymentByMonth[SHOCK_M - 1])).toBe(1098);
    expect(walk[SHOCK_M - 1].end).toBe(3902);
  });

  it('protects the stepped case too, where the month own floor is HIGHER than the next', () => {
    // Identical in every respect except that the shock month's own floor is $1,500 higher than its
    // neighbours'. Under the old recurrence this month ended $1,098 below that floor while the
    // control above ended exactly on it — the same algorithm, the same cash, one floor moved.
    const { res, walk } = scenario(BASE_FLOOR + 1500);

    expect(walk[SHOCK_M].vsOwnFloor).toBeGreaterThanOrEqual(0);
    for (const row of walk) expect(row.vsOwnFloor, `month ${row.m}`).toBeGreaterThanOrEqual(0);

    // The reserve is now banked across the TWO months before the shock rather than one, because a
    // single month at the card minimum cannot carry a $1,500 step on top of the $3,000 expense.
    expect([...res.saveUpMonths].filter(m => m <= 6)).toEqual([SHOCK_M - 2, SHOCK_M - 1]);
    expect(Math.round(res.maxDebtPaymentByMonth[SHOCK_M - 1])).toBe(CCMIN);
    expect(walk[SHOCK_M - 1].end).toBe(5402);
    expect(walk[SHOCK_M].end).toBe(BASE_FLOOR + 1500);
  });

  it('reserves more for a higher own floor, by the size of the step', () => {
    // The mechanism, not just the outcome: raising ONLY the shock month's own floor must raise the
    // cash standing at the end of the month before it by the same amount. The old recurrence moved
    // it by $400 for a $1,500 step (it was tracking the step's effect on `endBalAtMin`, not the
    // step itself), which is what left the $1,098 hole.
    const flat = scenario(BASE_FLOOR);
    const stepped = scenario(BASE_FLOOR + 1500);

    expect(stepped.walk[SHOCK_M - 1].end - flat.walk[SHOCK_M - 1].end).toBe(1500);
  });

  it('leaves months with no future need uncapped', () => {
    // A cap is emitted only where this month must end above its own floor. Everything after the
    // shock is flat and cash-positive, so those months keep sending every spare dollar to debt.
    const { res } = scenario(BASE_FLOOR + 1500);

    for (let m = SHOCK_M; m <= 6; m++) {
      expect(res.maxDebtPaymentByMonth[m], `month ${m}`).toBe(Infinity);
    }
    expect(res.maxDebtPaymentByMonth[0]).toBe(Infinity);
  });
});
