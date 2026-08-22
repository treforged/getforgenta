import { describe, it, expect } from 'vitest';
import {
  nextPaymentDueDate, formatNextDue, NEXT_DUE_UNKNOWN,
} from '../next-card-payment';

// The /debt "Recommended this month" row now quotes a FUTURE month's due date, so the two ways
// this can lie are both arithmetic: the old `MONTHS[(now.getMonth() + 1) % 12]` rendered 'Jan' in
// December with no year to say WHICH January, and a due day of 31 has no 31st to land on in a
// 30-day month. Both are covered here rather than by mounting a 2200-line panel.

describe('nextPaymentDueDate', () => {
  it('resolves next month on the card due day', () => {
    const d = nextPaymentDueDate(7, 1, new Date(2026, 7, 22));
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(8);
    expect(d!.getDate()).toBe(7);
    expect(formatNextDue(d)).toBe('due Sep 7');
  });

  it('handles a day-1 due date (the case that rendered $0 beside "Due Sep 1st")', () => {
    const d = nextPaymentDueDate(1, 1, new Date(2026, 7, 22));
    expect(formatNextDue(d)).toBe('due Sep 1');
  });

  it('rolls the YEAR over in December, not just the month name', () => {
    const d = nextPaymentDueDate(5, 1, new Date(2026, 11, 20));
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2027);
    expect(d!.getMonth()).toBe(0);
    expect(formatNextDue(d)).toBe('due Jan 5');
  });

  it('clamps a due day past the end of a short month', () => {
    const d = nextPaymentDueDate(31, 1, new Date(2026, 7, 22));
    expect(d).not.toBeNull();
    expect(d!.getMonth()).toBe(8);
    expect(d!.getDate()).toBe(30);
    expect(formatNextDue(d)).toBe('due Sep 30');
  });

  it('returns null when the card has no due day recorded', () => {
    expect(nextPaymentDueDate(null, 1, new Date(2026, 7, 22))).toBeNull();
    expect(formatNextDue(null)).toBe(NEXT_DUE_UNKNOWN);
  });

  it('resolves the CURRENT month at offset 0', () => {
    const d = nextPaymentDueDate(28, 0, new Date(2026, 7, 22));
    expect(d).not.toBeNull();
    expect(d!.getMonth()).toBe(7);
    expect(d!.getDate()).toBe(28);
    expect(formatNextDue(d)).toBe('due Aug 28');
  });
});
