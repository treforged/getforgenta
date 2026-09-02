// The weekly cadence, and the off switch it has to obey.
//
// Two things are being asserted here that the older policy suite could not: that the week has
// room for the engagement notifications added on 2026-09-02 (a lesson, a streak), and that a
// user's per-category opt-out is HONOURED — a notification system that ignores its own off
// switch is a bug and an app-store risk, and it is the failure mode that gets an app's push
// permission revoked at the OS level, permanently.
//
// Would-fail checks: set `MAX_PER_WEEK` back to 3 and "makes room for five in a week" fails; drop
// the `kindAllowed` guard from any candidate and its opt-out case fails; remove the per-kind caps
// and "one overdrawn week cannot spend the whole allowance on bills" fails.

import { describe, it, expect } from 'vitest';
import {
  decideNotification, MAX_PER_WEEK, MIN_HOURS_BETWEEN, MAX_PER_WEEK_BY_KIND, STREAK_RISK_HOUR,
} from '@/lib/notification-policy';
import type { NotificationSignals, NotificationRecord, NotificationGate } from '@/lib/notification-policy';

const WED_10AM = new Date('2026-09-02T10:00:00');
const WED_7PM = new Date('2026-09-02T19:00:00');
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
  nextLesson: null,
  learnStreak: 0,
  learnedToday: false,
  ...over,
});

const sent = (kind: NotificationRecord['kind'], key: string, sentAt: string): NotificationRecord =>
  ({ kind, key, sentAt });

/** A gate with everything on except the named categories. */
const gate = (off: NotificationRecord['kind'][] = [], enabled = true): NotificationGate => ({
  enabled,
  categories: Object.fromEntries(off.map(k => [k, false])),
});

const LESSON = { id: 'what-a-cash-floor-is', title: 'What a cash floor is', minutes: 2 };

describe('the weekly cadence', () => {
  it('makes room for five in a week, not three', () => {
    expect(MAX_PER_WEEK).toBe(5);
    // Still at most one a day once quiet hours are applied on top.
    expect(MIN_HOURS_BETWEEN).toBeGreaterThanOrEqual(16);
  });

  it('one overdrawn week cannot spend the whole allowance on bill warnings', () => {
    // Two bill warnings already sent this week, and a third, different bill is due.
    const history = [
      sent('bill_due', 'bill_due:2026-08-28:Rent', '2026-08-28T10:00:00'),
      sent('bill_due', 'bill_due:2026-08-30:Card', '2026-08-30T10:00:00'),
    ];
    const out = decideNotification(
      signals({
        upcomingBills: [{ name: 'Insurance', amount: 300, dueDate: '2026-09-03' }],
        projectedCashAtNextBill: 100,
      }),
      history,
    );
    // Not a third bill warning — the kind has used its share. Falls through to the next candidate.
    expect(out?.kind).not.toBe('bill_due');
    expect(MAX_PER_WEEK_BY_KIND.bill_due).toBe(2);
  });
});

describe('a lesson is a reason to open the app on a quiet week', () => {
  it('offers the next unread lesson by name and length', () => {
    const out = decideNotification(signals({ nextLesson: LESSON }), []);
    expect(out?.kind).toBe('learn_lesson');
    expect(out?.title).toBe('What a cash floor is');
    expect(out?.body).toContain('2-minute');
    expect(out?.key).toBe('learn_lesson:what-a-cash-floor-is');
  });

  it('never offers the same lesson twice', () => {
    const history = [sent('learn_lesson', 'learn_lesson:what-a-cash-floor-is', '2026-08-30T10:00:00')];
    expect(decideNotification(signals({ nextLesson: LESSON }), history)).toBeNull();
  });

  it('says nothing when there is no lesson left, rather than a generic nudge', () => {
    expect(decideNotification(signals({ nextLesson: null }), [])).toBeNull();
  });

  it('does not outrank a bill the user cannot cover', () => {
    const out = decideNotification(
      signals({
        nextLesson: LESSON,
        upcomingBills: [{ name: 'Rent', amount: 1915, dueDate: '2026-09-03' }],
        projectedCashAtNextBill: 100,
      }),
      [],
    );
    expect(out?.kind).toBe('bill_due');
  });
});

describe('a streak is only worth warning about when it exists', () => {
  it('warns late in the day when two or more days are at stake', () => {
    const out = decideNotification(
      signals({ now: WED_7PM, learnStreak: 4, learnedToday: false, nextLesson: null }),
      [],
    );
    expect(out?.kind).toBe('streak_risk');
    expect(out?.title).toContain('4-day streak');
  });

  it('says nothing about a one-day "streak" the reader has not built yet', () => {
    const out = decideNotification(
      signals({ now: WED_7PM, learnStreak: 1, learnedToday: false, nextLesson: null }),
      [],
    );
    expect(out).toBeNull();
  });

  it('says nothing while the day is still young', () => {
    expect(WED_10AM.getHours()).toBeLessThan(STREAK_RISK_HOUR);
    const out = decideNotification(
      signals({ now: WED_10AM, learnStreak: 4, learnedToday: false, nextLesson: null }),
      [],
    );
    expect(out).toBeNull();
  });

  it('says nothing once a lesson has been read today — the streak is safe', () => {
    const out = decideNotification(
      signals({ now: WED_7PM, learnStreak: 4, learnedToday: true, nextLesson: null }),
      [],
    );
    expect(out).toBeNull();
  });
});

describe('the off switch is obeyed', () => {
  it('master off silences everything, including a bill warning', () => {
    const out = decideNotification(
      signals({
        upcomingBills: [{ name: 'Rent', amount: 1915, dueDate: '2026-09-03' }],
        projectedCashAtNextBill: 100,
      }),
      [],
      gate([], false),
    );
    expect(out).toBeNull();
  });

  it('silencing the recap does not silence the week', () => {
    const quiet = decideNotification(
      signals({ now: SUN_10AM, netWorth: 41000, monthEndCash: 3200, nextLesson: null }),
      [],
      gate(['weekly_checkin']),
    );
    expect(quiet).toBeNull();

    // Same Sunday, same opt-out, but a lesson is waiting: the week still reaches the user.
    const still = decideNotification(
      signals({ now: SUN_10AM, netWorth: 41000, monthEndCash: 3200, nextLesson: LESSON }),
      [],
      gate(['weekly_checkin']),
    );
    expect(still?.kind).toBe('learn_lesson');
  });

  it('silencing the lessons leaves the money warnings alone', () => {
    const out = decideNotification(
      signals({
        nextLesson: LESSON,
        upcomingBills: [{ name: 'Rent', amount: 1915, dueDate: '2026-09-03' }],
        projectedCashAtNextBill: 100,
      }),
      [],
      gate(['learn_lesson', 'streak_risk']),
    );
    expect(out?.kind).toBe('bill_due');
  });

  it('every category can be silenced individually', () => {
    // Each candidate, offered on its own with its own category off, must produce nothing.
    expect(decideNotification(
      signals({ upcomingBills: [{ name: 'Rent', amount: 1915, dueDate: '2026-09-03' }], projectedCashAtNextBill: 100 }),
      [], gate(['bill_due']),
    )).toBeNull();

    expect(decideNotification(
      signals({ nextMonthProjectedEndingCash: 100, nextMonthFloor: 2500 }),
      [], gate(['floor_risk']),
    )).toBeNull();

    expect(decideNotification(
      signals({ newMilestones: [{ event: 'cleared the card', month: '2026-09' }] }),
      [], gate(['milestone']),
    )).toBeNull();

    expect(decideNotification(
      signals({ lastAccountSyncAt: null }),
      [], gate(['stale_accounts']),
    )).toBeNull();

    expect(decideNotification(
      signals({ now: SUN_10AM, netWorth: 41000, monthEndCash: 3200 }),
      [], gate(['weekly_checkin']),
    )).toBeNull();

    expect(decideNotification(
      signals({ nextLesson: LESSON }),
      [], gate(['learn_lesson']),
    )).toBeNull();

    expect(decideNotification(
      signals({ now: WED_7PM, learnStreak: 3 }),
      [], gate(['streak_risk']),
    )).toBeNull();
  });
});
