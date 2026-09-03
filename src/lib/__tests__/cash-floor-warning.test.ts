// The warning Tre asked for: tell the user the cash floor will not be met, and why.
//
// Would-fail checks: return the WORST month instead of the first and "picks the first" fails,
// which would send someone to month 14 while month 2 is already short; invent a cause when
// saveUpReason is empty and "never invents a cause" fails, which is how a $2,443 reserve came to
// be blamed on a $200 dog-sitting payment.

import { describe, it, expect } from 'vitest';
import { buildCashFloorWarning } from '../cash-floor-warning';

const reason = (m: number, eventName: string) =>
  new Map([[m, { eventName, monthLabel: 'x' }]]);

describe('buildCashFloorWarning', () => {
  it('says nothing when every month clears its floor', () => {
    expect(buildCashFloorWarning({
      months: [{ month: 'Sep 2026' }, { month: 'Oct 2026', belowSafeMinimum: false }],
    })).toBeNull();
  });

  it('names the month and the cause when the engine knows one', () => {
    const w = buildCashFloorWarning({
      months: [{ month: 'Sep 2026' }, { month: 'Oct 2026', belowSafeMinimum: true }],
      saveUpReason: reason(0, "Prime Visa's $2,845 statement, due the 7th"),
    });
    expect(w?.monthLabel).toBe('Oct 2026');
    expect(w?.cause).toBe("Prime Visa's $2,845 statement, due the 7th");
    expect(w?.message).toContain('Oct 2026');
    expect(w?.message).toContain("Prime Visa's $2,845 statement");
    expect(w?.message).toContain('check your cash floor');
  });

  it('tells them paying less to cards will not fix it — that is the point', () => {
    // Without this the natural reaction is to pay less to debt, which cannot help when the
    // outflow is mandatory.
    const w = buildCashFloorWarning({
      months: [{ month: 'Oct 2026', belowSafeMinimum: true }],
      saveUpReason: reason(0, 'a statement'),
    });
    expect(w?.message).toContain('will not fix it');
  });

  it('PICKS THE FIRST SHORT MONTH, not the worst', () => {
    const w = buildCashFloorWarning({
      months: [
        { month: 'Sep 2026' },
        { month: 'Oct 2026', belowSafeMinimum: true },
        { month: 'Nov 2026', belowSafeMinimum: true },
      ],
    });
    expect(w?.monthIndex).toBe(1);
    expect(w?.monthLabel).toBe('Oct 2026');
  });

  it('NEVER INVENTS A CAUSE when the engine has none', () => {
    const w = buildCashFloorWarning({ months: [{ month: 'Oct 2026', belowSafeMinimum: true }] });
    expect(w?.cause).toBeNull();
    expect(w?.message).toBe('Cash is projected below your safe minimum in Oct 2026. Check your cash floor.');
    expect(w?.message).not.toContain('because');
  });

  it('takes the nearest earlier reason, since the save-up month precedes the shortfall', () => {
    const w = buildCashFloorWarning({
      months: [{ month: 'Sep 2026' }, { month: 'Oct 2026' }, { month: 'Nov 2026', belowSafeMinimum: true }],
      saveUpReason: reason(1, '$3,830 Lease break fee'),
    });
    expect(w?.cause).toBe('$3,830 Lease break fee');
  });

  it('ignores a reason recorded AFTER the shortfall', () => {
    const w = buildCashFloorWarning({
      months: [{ month: 'Oct 2026', belowSafeMinimum: true }, { month: 'Nov 2026' }],
      saveUpReason: reason(1, 'something later'),
    });
    expect(w?.cause).toBeNull();
  });

  it('handles an empty projection without throwing', () => {
    expect(buildCashFloorWarning({ months: [] })).toBeNull();
  });
});
