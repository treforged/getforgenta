/**
 * THE POLICY MUST USE THE USER'S HOUR WHEN THE CALLER IS NOT IN IT.
 *
 * `decideNotification` read `now.getHours()`, which is the clock of whatever is executing. On a
 * device that is the reader's own clock and is correct. On the push sender it is UTC, and both
 * time-based rules land in the wrong place for everyone outside it:
 *
 *   - QUIET_HOURS_START is 21. In UTC that begins at 4pm in New York, so an evening notification
 *     is refused for five hours it should have been allowed.
 *   - STREAK_RISK_HOUR is 18 — late enough that "ends tonight" is true. In UTC that is 2pm in
 *     New York: the warning arrives four hours early about a streak in no danger.
 *
 * `signals.localHour` is the fix, and the case that matters most is the LAST one: absent, the
 * behaviour is byte-identical to before, because the app must keep using the device clock.
 *
 * Would-fail check: revert to `now.getHours()` and the first two cases fail under TZ=UTC while
 * passing under TZ=America/New_York — the exact shape of a bug a single-zone run hides, which is
 * why this repo runs its suite in three.
 */
import { describe, it, expect } from 'vitest';
import {
  decideNotification, QUIET_HOURS_START, STREAK_RISK_HOUR,
  type NotificationSignals,
} from '@/lib/notification-policy';

const signals = (over: Partial<NotificationSignals> = {}): NotificationSignals => ({
  now: new Date('2026-09-02T10:00:00'),
  upcomingBills: [],
  projectedCashAtNextBill: Number.POSITIVE_INFINITY,
  cashFloor: 0,
  nextMonthProjectedEndingCash: null,
  nextMonthFloor: null,
  newMilestones: [],
  // Recent, so 'stale_accounts' does not outrank the candidate under test. Worth noting: a
  // NULL here fires stale_accounts, which is precisely why the sender declares that kind OFF in
  // its gate rather than trusting an inert signal to keep it quiet.
  lastAccountSyncAt: '2026-09-02T06:00:00',
  netWorth: null,
  monthEndCash: null,
  nextLesson: { id: 'what-a-cash-floor-is', title: 'What a cash floor is', minutes: 2 },
  learnStreak: 0,
  learnedToday: false,
  ...over,
});

describe('localHour — the user\'s clock, not the runtime\'s', () => {
  it('refuses during the USER\'s quiet hours even when the runtime is mid-morning', () => {
    // The runtime clock says a perfectly sendable hour; the reader is asleep.
    const decision = decideNotification(
      signals({ now: new Date('2026-09-02T10:00:00'), localHour: QUIET_HOURS_START + 1 }),
      [],
    );
    expect(decision).toBeNull();
  });

  it('allows during the USER\'s waking hours even when the runtime is inside quiet hours', () => {
    const decision = decideNotification(
      signals({ now: new Date('2026-09-02T23:00:00'), localHour: 10 }),
      [],
    );
    // The lesson is the only candidate available, and it is allowed.
    expect(decision?.kind).toBe('learn_lesson');
  });

  it('gates the streak warning on the USER\'s evening, not the runtime\'s', () => {
    const atRisk = { learnStreak: 4, learnedToday: false, nextLesson: null };

    // Runtime evening, user's early afternoon — too early for "ends tonight" to be true.
    expect(decideNotification(
      signals({ ...atRisk, now: new Date('2026-09-02T22:00:00'), localHour: STREAK_RISK_HOUR - 4 }),
      [],
    )?.kind).not.toBe('streak_risk');

    // Runtime morning, user's evening — exactly when it IS true.
    expect(decideNotification(
      signals({ ...atRisk, now: new Date('2026-09-02T09:00:00'), localHour: STREAK_RISK_HOUR + 1 }),
      [],
    )?.kind).toBe('streak_risk');
  });

  it('is byte-identical to the device clock when absent — the app must not change', () => {
    // No localHour: the policy falls back to now.getHours(), which under any TZ the suite runs
    // is 10am local for this Date, because the string carries no zone.
    const decision = decideNotification(signals({ now: new Date('2026-09-02T10:00:00') }), []);
    expect(decision?.kind).toBe('learn_lesson');

    const quiet = decideNotification(signals({ now: new Date('2026-09-02T22:00:00') }), []);
    expect(quiet).toBeNull();
  });
});

describe('the gate the push sender builds', () => {
  it('silences a kind the server cannot compute, whatever the signals say', () => {
    // This is what the sender does: the five forecast-derived kinds are declared off, so even a
    // signal that accidentally became non-empty could not raise one.
    const decision = decideNotification(
      signals({
        upcomingBills: [{ name: 'Rent', amount: 1800, dueDate: '2026-09-03' }],
        projectedCashAtNextBill: 100,
        cashFloor: 2500,
      }),
      [],
      { enabled: true, categories: { bill_due: false, floor_risk: false } },
    );
    expect(decision?.kind).not.toBe('bill_due');
    expect(decision?.kind).not.toBe('floor_risk');
  });

  it('honours a user who turned everything off, before any candidate is considered', () => {
    const decision = decideNotification(signals(), [], { enabled: false, categories: {} });
    expect(decision).toBeNull();
  });
});
