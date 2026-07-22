import { describe, it, expect } from 'vitest';
import { toLocalDateStr, generateScheduledEvents } from '../scheduling';

// Regression for the timezone date-truncation bug: generateScheduledEvents used to format event
// dates with `d.toISOString().split('T')[0]` (UTC). For evening loads in a negative-offset
// timezone (e.g. America/New_York, UTC-4/-5) this shifted every generated date one calendar day
// forward — pushing an end-of-month payday (e.g. Jul 31) into the next month, where the
// current-month forecast filter (`e.date > syncCutoffDate` within monthKey) then dropped it.
// Real-world symptom: Tre's July current-month breakdown showed 1 paycheck ($849) instead of 2
// ($1,698) whenever the app was opened in the evening, landing Ending Cash below the floor.

describe('toLocalDateStr', () => {
  it('keeps the local calendar day for an evening time (would shift under UTC formatting)', () => {
    // 9:10pm on the last day of July, local time. toISOString() would render "2026-08-01" in any
    // timezone west of UTC; local formatting must stay "2026-07-31".
    expect(toLocalDateStr(new Date(2026, 6, 31, 21, 10))).toBe('2026-07-31');
    expect(toLocalDateStr(new Date(2026, 6, 24, 21, 10))).toBe('2026-07-24');
    expect(toLocalDateStr(new Date(2026, 0, 1, 23, 59))).toBe('2026-01-01');
  });
});

describe('generateScheduledEvents — end-of-month weekly event, evening load', () => {
  it('emits both remaining July Fridays (incl. Jul 31) when generated at 9:10pm local', () => {
    const paycheck = {
      id: 'weekly-paycheck',
      name: 'Weekly Paycheck',
      amount: 848.89,
      rule_type: 'income' as const,
      frequency: 'weekly',
      active: true,
      due_day: 5, // Friday
      start_date: '2026-03-18',
      deposit_account: null,
    };
    // Evening of Tue Jul 21, 2026 — the failing time-of-day from the live repro.
    const from = new Date(2026, 6, 21, 21, 10);
    const events = generateScheduledEvents([paycheck], [], 3, from);
    const julyPaydays = events
      .filter(e => e.ruleId === 'weekly-paycheck' && e.date.startsWith('2026-07'))
      .map(e => e.date);
    expect(julyPaydays).toEqual(['2026-07-24', '2026-07-31']);
    // Jul 31 must NOT have leaked into August.
    expect(events.some(e => e.date === '2026-08-01' && e.ruleId === 'weekly-paycheck')).toBe(false);
  });
});
