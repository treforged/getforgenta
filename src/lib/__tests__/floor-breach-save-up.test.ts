// "Save $X/mo to cover it" on a one-time floor breach (Sam's conditions, 2026-09-28): the gap is to
// the FLOOR, not to zero; it is spread over the whole months between now and the breach; month 0
// is the current, partly spent month, so saving starts in month 1. Tre's case: the lease-break fee
// breaches March 2027 (index 6 from Sep 2026), so Oct 2026 - Feb 2027 is five months.
import { describe, it, expect } from 'vitest';
import { floorBreachSaveUp, formatSaveUpSuffix } from '@/lib/floor-breach-save-up';

const LABELS = ['Sep 2026', 'Oct 2026', 'Nov 2026', 'Dec 2026', 'Jan 2027', 'Feb 2027', 'Mar 2027'];

describe('floorBreachSaveUp', () => {
  it("Tre's forecast 2026-09-29: Oct 2026-Jan 2027 already below the floor, so NO set-aside plan is offered", () => {
    // Engine replay of his live rows after the GF income ends in March: Mar 2027 ends -$786 against
    // a $150 floor, and Oct, Nov, Dec and Jan each end below their own floor. The old line said
    // "set aside $188/mo from Oct 2026", which he could not do.
    const below = [true, true, true, true, true, false];
    const s = floorBreachSaveUp({ breachIndex: 6, endingCash: -786, floor: 150, monthLabels: LABELS, belowFloor: below });
    expect(s?.blockedMonths).toEqual(['Oct 2026', 'Nov 2026', 'Dec 2026', 'Jan 2027']);
    expect(formatSaveUpSuffix(s!)).toBe(' - $936 short, and Oct 2026 to Jan 2027 are already below the floor, so there is no spare cash to set aside');
  });

  it('one blocked month reads in the singular, and month 0 never counts as blocked', () => {
    const s = floorBreachSaveUp({ breachIndex: 6, endingCash: 0, floor: 100, monthLabels: LABELS, belowFloor: [true, false, false, true, false, false] });
    expect(s?.blockedMonths).toEqual(['Dec 2026']);
    expect(formatSaveUpSuffix(s!)).toBe(' - $100 short, and Dec 2026 is already below the floor, so there is no spare cash to set aside');
  });

  it("Tre's live case (read 2026-09-28): Mar 2027 ends -$29.31 against ITS floor of $150.40 -> $36/mo from Oct 2026", () => {
    // Values read from the app's own Mar 2027 breakdown drawer. The floor is March's, NOT today's
    // $2,256 - a hand estimate using today's floor said ~$457/mo, twelve times too much.
    const s = floorBreachSaveUp({ breachIndex: 6, endingCash: -29.31, floor: 150.4, monthLabels: LABELS });
    expect(s).toEqual({ shortfall: 179.71, months: 5, perMonth: 36, startLabel: 'Oct 2026', blockedMonths: [] });
    expect(formatSaveUpSuffix(s!)).toBe(' - set aside $36/mo from Oct 2026 to cover it');
  });

  it('a larger floor scales the plan: -$29 against $2,256 in month 6 is $2,285 over 5 months = $457/mo', () => {
    const s = floorBreachSaveUp({ breachIndex: 6, endingCash: -29, floor: 2256, monthLabels: LABELS });
    expect(s).toEqual({ shortfall: 2285, months: 5, perMonth: 457, startLabel: 'Oct 2026', blockedMonths: [] });
    expect(formatSaveUpSuffix(s!)).toBe(' - set aside $457/mo from Oct 2026 to cover it');
  });

  it('measures the gap to the floor, not to zero', () => {
    // Ending cash is POSITIVE here, so a to-zero rule would say nothing is needed.
    const s = floorBreachSaveUp({ breachIndex: 3, endingCash: 1000, floor: 1500, monthLabels: LABELS });
    expect(s?.shortfall).toBe(500);
    expect(s?.perMonth).toBe(250);
  });

  it('rounds the monthly amount UP so the plan always covers the gap', () => {
    const s = floorBreachSaveUp({ breachIndex: 4, endingCash: 0, floor: 100, monthLabels: LABELS });
    expect(s?.perMonth).toBe(34); // 100 / 3 = 33.33; 33 x 3 = 99 would leave a dollar short
    expect(s!.perMonth * s!.months).toBeGreaterThanOrEqual(s!.shortfall);
  });

  it('with no whole month left, says how short it is instead of inventing a plan', () => {
    const s = floorBreachSaveUp({ breachIndex: 1, endingCash: 50.4, floor: 300, monthLabels: LABELS });
    expect(s).toMatchObject({ months: 0, startLabel: null });
    expect(formatSaveUpSuffix(s!)).toBe(' - $250 short, no months left to save');
  });

  it('returns null for float residue and for non-finite input', () => {
    expect(floorBreachSaveUp({ breachIndex: 6, endingCash: 2444.3999999999996, floor: 2444.4, monthLabels: LABELS })).toBeNull();
    expect(floorBreachSaveUp({ breachIndex: 6, endingCash: NaN, floor: 2256, monthLabels: LABELS })).toBeNull();
  });
});
