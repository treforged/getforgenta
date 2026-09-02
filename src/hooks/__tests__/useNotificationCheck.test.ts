// THE SIGNAL MAPPING, which is where a wrong field silently becomes a wrong notification.
//
// The policy and the service are tested elsewhere. What is untested until here is the boring
// middle: turning dashboard figures into the shape the policy reads. That mapping is exactly where
// a money app tells someone they cannot cover a bill they can, so it is pinned rather than trusted.
//
// Would-fail check: swap `cashPreDebt` for month-end cash and the "does not substitute" case
// fails; return 0 instead of Infinity when there is no projection and the "silent on absent data"
// case fails while everything else stays green - which is the shape that would have shipped a
// false alarm.

import { describe, it, expect } from 'vitest';
import { buildNotificationSignals, type NotificationCheckInputs } from '@/hooks/useNotificationCheck';
import { decideNotification } from '@/lib/notification-policy';

const NOW = new Date('2026-09-02T10:00:00');

const inputs = (over: Partial<NotificationCheckInputs> = {}): NotificationCheckInputs => ({
  monthMinSafe: 2390,
  floorItems: [
    { name: 'Rent (incl. internet, smart home, water)', amount: 2070, dueDay: 1 },
    { name: 'Electricity', amount: 170, dueDay: 1 },
  ],
  cashPreDebt: 5000,
  netWorth: 12345,
  monthEndCash: 2393,
  lastAccountSyncAt: '2026-09-02T09:00:00Z',
  enabled: true,
  nextLesson: null,
  learnStreak: 0,
  learnedToday: false,
  ...over,
});

describe('buildNotificationSignals', () => {
  it('turns each floor item into a dated bill in the current month', () => {
    const s = buildNotificationSignals(inputs(), NOW);
    expect(s.upcomingBills).toEqual([
      { name: 'Rent (incl. internet, smart home, water)', amount: 2070, dueDate: '2026-09-01' },
      { name: 'Electricity', amount: 170, dueDate: '2026-09-01' },
    ]);
  });

  it('clamps a due day past the end of a short month instead of rolling into the next one', () => {
    // Day 31 in September does not exist. Rolling it forward would silently move the bill into
    // October and stop it ever being warned about.
    const feb = new Date('2026-02-10T10:00:00');
    const s = buildNotificationSignals(inputs({ floorItems: [{ name: 'X', amount: 10, dueDay: 31 }] }), feb);
    expect(s.upcomingBills[0].dueDate).toBe('2026-02-28');
  });

  it('uses cashPreDebt and does NOT substitute month-end cash for it', () => {
    const s = buildNotificationSignals(inputs({ cashPreDebt: 1200, monthEndCash: 9999 }), NOW);
    expect(s.projectedCashAtNextBill).toBe(1200);
    // month-end cash still travels, but in its own field, for the weekly check-in.
    expect(s.monthEndCash).toBe(9999);
  });

  it('is SILENT rather than alarming when there is no projection at all', () => {
    // The failure this guards: a 0 here reads as "you have nothing" and fires a bill warning at
    // someone whose projection simply had not loaded.
    const s = buildNotificationSignals(inputs({ cashPreDebt: null }), NOW);
    expect(s.projectedCashAtNextBill).toBe(Number.POSITIVE_INFINITY);
    expect(decideNotification(s, [])).toBeNull();
  });

  it('leaves the signals the dashboard cannot source absent, never zeroed', () => {
    const s = buildNotificationSignals(inputs(), NOW);
    // Zeros here would light up a floor-risk warning out of data that does not exist.
    expect(s.nextMonthProjectedEndingCash).toBeNull();
    expect(s.nextMonthFloor).toBeNull();
    expect(s.newMilestones).toEqual([]);
  });

  it('feeds the policy an unaffordable bill correctly, end to end', () => {
    // Rent due the 1st, today the 2nd... so it is behind us; use a bill due in two days instead,
    // which is the window the policy actually acts on.
    const s = buildNotificationSignals(
      inputs({ floorItems: [{ name: 'Rent', amount: 2070, dueDay: 4 }], cashPreDebt: 1200 }),
      NOW,
    );
    const out = decideNotification(s, []);
    expect(out?.kind).toBe('bill_due');
    expect(out?.body).toContain('$2,070');
    expect(out?.body).toContain('$1,200');
  });
});
