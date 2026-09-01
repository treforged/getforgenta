// NOTIFICATION POLICY — the judgement half of Tre's ASAP retention item (2026-09-02: "app
// WIDGETS and NOTIFICATIONS, so users come back weekly if not daily").
//
// The platform wiring can only be exercised on a device. ALL of the judgement lives in a pure
// module so it can be exercised here instead, which is the point of splitting it that way: a
// notification that fires at 3am, twice for the same bill, or with no numbers in it is the thing
// that gets an app muted, and none of those failures need a phone to catch.

import { describe, it, expect } from 'vitest';
import {
  decideNotification, formatMoney, daysBetween,
  MAX_PER_WEEK, MAX_TITLE_LENGTH,
  type NotificationSignals, type NotificationRecord,
} from '@/lib/notification-policy';

/** A 10am Wednesday: inside the allowed window, and not the Sunday the check-in needs. */
const WED_10AM = new Date('2026-09-02T10:00:00');
const SUN_10AM = new Date('2026-09-06T10:00:00');

const signals = (over: Partial<NotificationSignals> = {}): NotificationSignals => ({
  now: WED_10AM,
  upcomingBills: [],
  projectedCashAtNextBill: 5000,
  cashFloor: 2500,
  nextMonthProjectedEndingCash: null,
  nextMonthFloor: null,
  newMilestones: [],
  lastAccountSyncAt: '2026-09-02T06:00:00',
  netWorth: null,
  monthEndCash: null,
  ...over,
});

const sent = (key: string, kind: NotificationRecord['kind'], sentAt: string): NotificationRecord =>
  ({ key, kind, sentAt });

const MILESTONE = [{ event: 'CC Debt Free', month: 'Jul 2028' }];

describe('notification policy — gates', () => {
  it('says nothing during quiet hours, at both ends', () => {
    const late = signals({ now: new Date('2026-09-02T21:30:00'), newMilestones: MILESTONE });
    const early = signals({ now: new Date('2026-09-02T07:59:00'), newMilestones: MILESTONE });
    expect(decideNotification(late, [])).toBeNull();
    expect(decideNotification(early, [])).toBeNull();
    // 8am exactly is allowed - the boundary is inclusive on the waking side.
    const eight = signals({ now: new Date('2026-09-02T08:00:00'), newMilestones: MILESTONE });
    expect(decideNotification(eight, [])).not.toBeNull();
  });

  it('stops at the weekly cap, counting only the last 7 days', () => {
    const s = signals({ newMilestones: MILESTONE });
    const recent: NotificationRecord[] = [];
    for (let i = 0; i < MAX_PER_WEEK; i++) {
      recent.push(sent(`k${i}`, 'milestone', '2026-08-28T10:00:00'));
    }
    expect(decideNotification(s, recent)).toBeNull();
    // The same count, but all older than a week, does not gate anything.
    const old = recent.map((_, i) => sent(`old${i}`, 'milestone', '2026-07-01T10:00:00'));
    expect(decideNotification(s, old)).not.toBeNull();
  });

  it('keeps 20 hours between notifications', () => {
    const s = signals({ newMilestones: MILESTONE });
    const justSent = [sent('other', 'milestone', '2026-09-02T02:00:00')];
    expect(decideNotification(s, justSent)).toBeNull();
    const longAgo = [sent('other', 'milestone', '2026-08-30T02:00:00')];
    expect(decideNotification(s, longAgo)).not.toBeNull();
  });
});

describe('notification policy — precedence and content', () => {
  const bill = { name: 'Rent', amount: 1915, dueDate: '2026-09-04' };

  it('a bill the user cannot cover outranks every other candidate', () => {
    const s = signals({
      upcomingBills: [bill],
      projectedCashAtNextBill: 1200,
      cashFloor: 2500,
      nextMonthProjectedEndingCash: 100,
      nextMonthFloor: 2500,
      newMilestones: MILESTONE,
      lastAccountSyncAt: null,
    });
    const out = decideNotification(s, []);
    expect(out?.kind).toBe('bill_due');
    // The body must carry the actual money, not a nudge to go and look.
    expect(out?.body).toContain('$1,915');
    expect(out?.body).toContain('$1,200');
    expect(out?.body).toContain('$2,500');
  });

  it('says nothing about a bill the user CAN cover', () => {
    const s = signals({ upcomingBills: [bill], projectedCashAtNextBill: 5000, cashFloor: 2500 });
    expect(decideNotification(s, [])).toBeNull();
  });

  it('ignores a bill further out than two days', () => {
    const s = signals({
      upcomingBills: [{ ...bill, dueDate: '2026-09-06' }],
      projectedCashAtNextBill: 100,
    });
    expect(decideNotification(s, [])).toBeNull();
  });

  it('picks the soonest bill, and the larger one when two land the same day', () => {
    const s = signals({
      projectedCashAtNextBill: 100,
      upcomingBills: [
        { name: 'Internet', amount: 85, dueDate: '2026-09-03' },
        { name: 'Rent', amount: 1915, dueDate: '2026-09-03' },
        { name: 'Later', amount: 9999, dueDate: '2026-09-04' },
      ],
    });
    expect(decideNotification(s, [])?.title).toContain('Rent');
  });

  it('never sends the same fact twice', () => {
    const s = signals({ upcomingBills: [bill], projectedCashAtNextBill: 100 });
    const first = decideNotification(s, []);
    expect(first).not.toBeNull();
    const after = decideNotification(s, [sent(first?.key ?? '', 'bill_due', '2026-08-25T10:00:00')]);
    // Falls THROUGH to the next candidate rather than repeating itself; here nothing else
    // qualifies, so silence is the right answer.
    expect(after).toBeNull();
  });

  it('falls through a suppressed candidate to a lower one', () => {
    const s = signals({
      upcomingBills: [bill],
      projectedCashAtNextBill: 100,
      newMilestones: MILESTONE,
    });
    const billKey = decideNotification(s, [])?.key ?? '';
    const out = decideNotification(s, [sent(billKey, 'bill_due', '2026-08-25T10:00:00')]);
    expect(out?.kind).toBe('milestone');
    expect(out?.body).toContain('Jul 2028');
  });

  it('warns about next month with both figures and the gap', () => {
    const s = signals({ nextMonthProjectedEndingCash: 1800, nextMonthFloor: 2500 });
    const out = decideNotification(s, []);
    expect(out?.kind).toBe('floor_risk');
    expect(out?.key).toBe('floor_risk:2026-10');
    expect(out?.body).toContain('$700');
  });

  it('asks for a sync only once it is genuinely stale, and says how long', () => {
    expect(decideNotification(signals({ lastAccountSyncAt: '2026-08-29T10:00:00' }), [])).toBeNull();
    const stale = decideNotification(signals({ lastAccountSyncAt: '2026-08-20T10:00:00' }), []);
    expect(stale?.kind).toBe('stale_accounts');
    expect(stale?.body).toContain('13');
    const never = decideNotification(signals({ lastAccountSyncAt: null }), []);
    expect(never?.kind).toBe('stale_accounts');
    expect(never?.body).toMatch(/never/i);
  });
});

describe('notification policy — the weekly check-in is the habit, so it carries numbers', () => {
  it('fires on Sunday with both real figures in it', () => {
    const s = signals({ now: SUN_10AM, netWorth: 12345, monthEndCash: 2393 });
    const out = decideNotification(s, []);
    expect(out?.kind).toBe('weekly_checkin');
    expect(out?.body).toContain('$12,345');
    expect(out?.body).toContain('$2,393');
  });

  it('does not fire on any other day', () => {
    const s = signals({ now: WED_10AM, netWorth: 12345, monthEndCash: 2393 });
    expect(decideNotification(s, [])).toBeNull();
  });

  it('is skipped entirely when the figures are missing rather than sent empty', () => {
    expect(decideNotification(signals({ now: SUN_10AM, netWorth: null, monthEndCash: 2393 }), [])).toBeNull();
    expect(decideNotification(signals({ now: SUN_10AM, netWorth: 12345, monthEndCash: null }), [])).toBeNull();
  });

  it('does not repeat within six days even if the date key differs', () => {
    const s = signals({ now: SUN_10AM, netWorth: 12345, monthEndCash: 2393 });
    const recent = [sent('weekly_checkin:2026-09-01', 'weekly_checkin', '2026-09-01T10:00:00')];
    expect(decideNotification(s, recent)).toBeNull();
  });
});

describe('notification policy — the two date helpers, which is where this would misfire quietly', () => {
  it('formats money the way the app does, negatives included', () => {
    expect(formatMoney(1234.56)).toBe('$1,235');
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(-20)).toBe('-$20');
    expect(formatMoney(1000000)).toBe('$1,000,000');
  });

  it('counts calendar days, so an evening-to-morning crossing is one day', () => {
    expect(daysBetween(new Date('2026-09-02T23:00:00'), new Date('2026-09-03T01:00:00'))).toBe(1);
    expect(daysBetween(new Date('2026-09-02T01:00:00'), new Date('2026-09-02T23:00:00'))).toBe(0);
    expect(daysBetween(new Date('2026-09-05T10:00:00'), new Date('2026-09-02T10:00:00'))).toBe(-3);
  });

  it('survives a daylight-saving boundary, where a 23-hour day would floor to zero', () => {
    // The hazard is not "a day near the transition" - it is a pair of LOCAL MIDNIGHTS that
    // STRADDLE it, which is the only thing daysBetween ever compares. US DST starts 02:00 on
    // 2026-03-08, so midnight-to-midnight Mar 8 -> Mar 9 is 23 hours: floor(0.958) is 0 and a
    // bill due tomorrow reads as due today. Mar 7 -> Mar 8 is a full 24 and proves nothing,
    // which is what this assertion said before it was measured.
    expect(daysBetween(new Date('2026-03-08T12:00:00'), new Date('2026-03-09T12:00:00'))).toBe(1);
    // DST ends 02:00 on 2026-11-01, so Nov 1 -> Nov 2 is 25 hours.
    expect(daysBetween(new Date('2026-11-01T12:00:00'), new Date('2026-11-02T12:00:00'))).toBe(1);
  });

  it('reads a yyyy-mm-dd due date as a LOCAL date, not a UTC one', () => {
    // `new Date('2026-09-03')` is UTC midnight, which is the evening of the 2nd in any negative
    // offset. If the policy parsed it that way, this bill would read as due TODAY instead of
    // tomorrow, for every user in the Americas.
    const s = signals({
      now: new Date('2026-09-02T10:00:00'),
      upcomingBills: [{ name: 'Rent', amount: 1915, dueDate: '2026-09-03' }],
      projectedCashAtNextBill: 100,
    });
    expect(decideNotification(s, [])?.title).toContain('tomorrow');
  });

  it('keeps the title inside the OS cap even with a long bill name', () => {
    const s = signals({
      upcomingBills: [{ name: 'Lockheed Martin Corporation Salaried Savings Plan Transfer', amount: 100, dueDate: '2026-09-03' }],
      projectedCashAtNextBill: 10,
    });
    const out = decideNotification(s, []);
    expect(out?.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(out?.body).toContain('$100');
  });
});
