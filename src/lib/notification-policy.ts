/**
 * Notification policy for a personal finance app. The rules are evaluated in strict precedence:
 * 1. Bill due notifications are the highest priority because they are the only ones that
 *    represent actionable money the user can still act on.
 * 2. Weekly check-ins must contain real numbers to avoid being muted by the user.
 */

export type NotificationKind =
  | 'bill_due'
  | 'floor_risk'
  | 'milestone'
  | 'weekly_checkin'
  | 'stale_accounts'
  | 'learn_lesson'
  | 'streak_risk';

export interface NotificationSignals {
  now: Date;
  upcomingBills: { name: string; amount: number; dueDate: string }[];
  projectedCashAtNextBill: number;
  cashFloor: number;
  nextMonthProjectedEndingCash: number | null;
  nextMonthFloor: number | null;
  newMilestones: { event: string; month: string }[];
  lastAccountSyncAt: string | null;
  netWorth: number | null;
  monthEndCash: number | null;
  /**
   * The next unread Learn lesson, or null when there is none (all read, or the catalogue could
   * not be resolved). Absent means the candidate does not apply — never "send a generic nudge".
   */
  nextLesson: { id: string; title: string; minutes: number } | null;
  /** Consecutive days ending yesterday or today on which a lesson was read. 0 when none. */
  learnStreak: number;
  /** True when a lesson has already been read today, which is what saves the streak. */
  learnedToday: boolean;
}

export interface NotificationRecord {
  kind: NotificationKind;
  key: string;
  sentAt: string;
}

export interface NotificationDecision {
  kind: NotificationKind;
  key: string;
  title: string;
  body: string;
}

export const QUIET_HOURS_START = 21;
export const QUIET_HOURS_END = 8;

/**
 * THE WEEKLY CADENCE.
 *
 * Three a week was chosen when the only candidates were alarms — a bill you cannot cover, a month
 * under the floor. Alarms are all this app had to say, so three was generous. The goal now is
 * consistent USE, and consistency comes from a reason to open the app on an ordinary week when
 * nothing is on fire, which three alarm slots could never provide.
 *
 * Five a week, at most one a day. Not more: a finance app that speaks daily is a finance app that
 * gets muted at the OS level, and a muted app has a cadence of zero forever. `MIN_HOURS_BETWEEN`
 * is 16 rather than 24 so a Sunday recap at 9am does not push Monday's bill warning to Tuesday —
 * combined with quiet hours the effective floor is still about a day.
 *
 * The per-kind caps below are what make the five slots a WEEK rather than five bill warnings on
 * the same overdrawn Tuesday. Each kind can only take its share, so an ordinary week reaches the
 * user as: one recap, one lesson, and up to three things that are actually about their money.
 */
export const MAX_PER_WEEK = 5;
export const MIN_HOURS_BETWEEN = 16;
export const MAX_TITLE_LENGTH = 40;

/** How many of the weekly slots any one kind may take. Absent means "no cap beyond the weekly one". */
export const MAX_PER_WEEK_BY_KIND: Readonly<Partial<Record<NotificationKind, number>>> = {
  bill_due: 2,
  floor_risk: 1,
  milestone: 2,
  weekly_checkin: 1,
  stale_accounts: 1,
  learn_lesson: 2,
  streak_risk: 2,
};

/** Hour after which a streak is genuinely at risk — before this, the day is not nearly over. */
export const STREAK_RISK_HOUR = 18;

/**
 * A user's answer about what they want to hear. `decideNotification` is given the whole object
 * rather than a boolean because a master switch alone forces an all-or-nothing choice, and the
 * user who mutes the weekly recap to keep the bill warnings is the user who stays.
 */
export interface NotificationGate {
  enabled: boolean;
  categories: Partial<Record<NotificationKind, boolean>>;
}

/** Not-chosen reads as on, here and in `notification-prefs.ts`. Master off wins over everything. */
function allows(gate: NotificationGate | undefined, kind: NotificationKind): boolean {
  if (!gate) return true;
  if (!gate.enabled) return false;
  return gate.categories[kind] !== false;
}

export function decideNotification(
  signals: NotificationSignals,
  history: readonly NotificationRecord[],
  gate?: NotificationGate,
): NotificationDecision | null {
  const now = signals.now;
  const nowHours = now.getHours();

  // Gate G0: the user's own switch. Checked before anything else so that an account which has
  // said no cannot be reached by a new candidate someone adds below without thinking about it.
  if (gate && !gate.enabled) {
    return null;
  }

  // Gate G1: Quiet hours
  if (nowHours >= QUIET_HOURS_START || nowHours < QUIET_HOURS_END) {
    return null;
  }

  // Gate G2: Rate limit
  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const recentNotifications = history.filter(record => new Date(record.sentAt) >= oneWeekAgo);
  if (recentNotifications.length >= MAX_PER_WEEK) {
    return null;
  }

  // Gate G3: Spacing
  const minHoursAgo = new Date(now);
  minHoursAgo.setHours(minHoursAgo.getHours() - MIN_HOURS_BETWEEN);
  const recentBySpacing = history.some(record => new Date(record.sentAt) >= minHoursAgo);
  if (recentBySpacing) {
    return null;
  }

  /**
   * Gate G4, applied per candidate rather than up front: is this KIND allowed right now?
   * Both halves matter — the category the user silenced, and the share of the week this kind has
   * already used. A candidate that fails this falls through to the next one, so silencing the
   * recap does not silence the week.
   */
  const kindAllowed = (kind: NotificationKind): boolean => {
    if (!allows(gate, kind)) return false;
    const cap = MAX_PER_WEEK_BY_KIND[kind];
    if (cap === undefined) return true;
    return recentNotifications.filter(record => record.kind === kind).length < cap;
  };

  // Candidate C1: Bill due
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const upcomingBills = signals.upcomingBills.filter(bill => {
    const dueDate = parseLocalDate(bill.dueDate);
    const daysUntilDue = daysBetween(today, dueDate);
    return daysUntilDue >= 0 && daysUntilDue <= 2;
  });

  if (kindAllowed('bill_due') && upcomingBills.length > 0 && signals.projectedCashAtNextBill < signals.cashFloor) {
    const soonestBill = upcomingBills.reduce((a, b) => {
      const aDueDate = parseLocalDate(a.dueDate);
      const bDueDate = parseLocalDate(b.dueDate);
      const aDays = daysBetween(today, aDueDate);
      const bDays = daysBetween(today, bDueDate);
      if (aDays < bDays) return a;
      if (aDays > bDays) return b;
      return a.amount >= b.amount ? a : b;
    });

    const dueDate = parseLocalDate(soonestBill.dueDate);
    const daysUntilDue = daysBetween(today, dueDate);
    let dueText: string;
    if (daysUntilDue === 0) {
      dueText = 'today';
    } else if (daysUntilDue === 1) {
      dueText = 'tomorrow';
    } else {
      dueText = `in ${daysUntilDue} days`;
    }

    const key = `bill_due:${soonestBill.dueDate}:${soonestBill.name}`;
    if (!history.some(record => record.key === key)) {
      return {
        kind: 'bill_due',
        key,
        title: truncateTitle(`${soonestBill.name} due ${dueText}`),
        body: `${formatMoney(soonestBill.amount)} due ${dueText}. Projected cash ${formatMoney(signals.projectedCashAtNextBill)} is below floor of ${formatMoney(signals.cashFloor)}.`,
      };
    }
  }

  // Candidate C2: Floor risk
  if (kindAllowed('floor_risk') && signals.nextMonthProjectedEndingCash !== null && signals.nextMonthFloor !== null && signals.nextMonthProjectedEndingCash < signals.nextMonthFloor) {
    const nextMonth = new Date(now);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const key = `floor_risk:${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
    if (!history.some(record => record.key === key)) {
      const shortfall = signals.nextMonthFloor - signals.nextMonthProjectedEndingCash;
      return {
        kind: 'floor_risk',
        key,
        title: `Next month's shortfall`,
        body: `Projected cash ${formatMoney(signals.nextMonthProjectedEndingCash)} is below floor of ${formatMoney(signals.nextMonthFloor)} by ${formatMoney(shortfall)}.`,
      };
    }
  }

  // Candidate C3: Milestone
  if (kindAllowed('milestone') && signals.newMilestones.length > 0) {
    const milestone = signals.newMilestones[0];
    const key = `milestone:${milestone.month}:${milestone.event}`;
    if (!history.some(record => record.key === key)) {
      return {
        kind: 'milestone',
        key,
        title: `Milestone reached`,
        body: `Congratulations on ${milestone.event} in ${milestone.month}!`,
      };
    }
  }

  // Candidate C4: Stale accounts
  const lastSyncDate = signals.lastAccountSyncAt ? new Date(signals.lastAccountSyncAt) : null;
  const daysSinceSync = lastSyncDate ? daysBetween(lastSyncDate, now) : null;
  if (kindAllowed('stale_accounts') && (daysSinceSync === null || daysSinceSync > 7)) {
    const key = `stale_accounts:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (!history.some(record => record.key === key)) {
      const body = daysSinceSync === null ? 'You have never synced your accounts.' : `Your accounts have not been synced in ${daysSinceSync} days.`;
      return {
        kind: 'stale_accounts',
        key,
        title: 'Sync your accounts',
        body,
      };
    }
  }

  // Candidate C5: Weekly check-in
  const sixDaysAgo = new Date(now);
  sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
  const checkedInRecently = history.some(
    record => record.kind === 'weekly_checkin' && new Date(record.sentAt) >= sixDaysAgo,
  );
  if (kindAllowed('weekly_checkin') && now.getDay() === 0 && !checkedInRecently && signals.netWorth !== null && signals.monthEndCash !== null) {
    const key = `weekly_checkin:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (!history.some(record => record.key === key)) {
      return {
        kind: 'weekly_checkin',
        key,
        title: 'Weekly check-in',
        body: `Your net worth is ${formatMoney(signals.netWorth)} and month-end cash is ${formatMoney(signals.monthEndCash)}.`,
      };
    }
  }

  // Candidate C6: A lesson is ready.
  //
  // LAST OF THE "SOMETHING IS WRONG" CANDIDATES ON PURPOSE. A lesson is the only thing here that
  // is worth sending on a week where nothing is wrong, which is most weeks — and most weeks are
  // exactly when an app is forgotten. It names the lesson and its length, because "come back and
  // learn something" is a nudge and "Why your emergency fund is 3 months, 2 min" is a reason.
  if (kindAllowed('learn_lesson') && signals.nextLesson) {
    const key = `learn_lesson:${signals.nextLesson.id}`;
    if (!history.some(record => record.key === key)) {
      return {
        kind: 'learn_lesson',
        key,
        title: truncateTitle(signals.nextLesson.title),
        body: `${signals.nextLesson.minutes}-minute lesson, and a badge when you finish it.`,
      };
    }
  }

  // Candidate C7: A streak about to break.
  //
  // ONLY WHEN THERE IS SOMETHING REAL TO LOSE: two or more days already banked, nothing read
  // today, and late enough in the day that it is true. Sent to someone with no streak it is a
  // guilt-trip about a thing they never had, which is how an app gets muted.
  if (
    kindAllowed('streak_risk') &&
    signals.learnStreak >= 2 &&
    !signals.learnedToday &&
    nowHours >= STREAK_RISK_HOUR
  ) {
    const key = `streak_risk:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (!history.some(record => record.key === key)) {
      return {
        kind: 'streak_risk',
        key,
        title: `${signals.learnStreak}-day streak ends tonight`,
        body: 'One lesson keeps it alive. It takes two minutes.',
      };
    }
  }

  return null;
}

export function formatMoney(n: number): string {
  const absN = Math.abs(n);
  const rounded = Math.round(absN);
  const formatted = rounded.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? `-${formatted}` : formatted;
}

export function daysBetween(a: Date, b: Date): number {
  const aDate = new Date(a);
  aDate.setHours(0, 0, 0, 0);
  const bDate = new Date(b);
  bDate.setHours(0, 0, 0, 0);
  const diffTime = bDate.getTime() - aDate.getTime();
  // ROUND, not floor. Both ends are local midnight, so the difference is a whole number of days
  // EXCEPT across a daylight-saving boundary, where it is 23 or 25 hours. Flooring 0.958 gives 0
  // and a bill due tomorrow reads as due today, twice a year, for every user in a DST timezone.
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Parse a `yyyy-mm-dd` date as LOCAL midnight.
 *
 * `new Date('2026-09-04')` is parsed as UTC midnight by spec, which in any negative UTC offset is
 * the EVENING OF THE 3RD locally. Every due-date comparison would then be a day early for every
 * user in the Americas. Appending a time makes the parse local, and it is the same fix already
 * used elsewhere in this codebase for `planned_purchase_date`.
 */
function parseLocalDate(isoDate: string): Date {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Notification titles are truncated by the OS; a bill named past the cap should lose its own
 *  name's tail, not the "due tomorrow" that makes the notification worth opening. */
function truncateTitle(title: string): string {
  return title.length <= MAX_TITLE_LENGTH ? title : `${title.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}
