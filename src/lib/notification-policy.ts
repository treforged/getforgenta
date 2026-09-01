/**
 * Notification policy for a personal finance app. The rules are evaluated in strict precedence:
 * 1. Bill due notifications are the highest priority because they are the only ones that
 *    represent actionable money the user can still act on.
 * 2. Weekly check-ins must contain real numbers to avoid being muted by the user.
 */

export type NotificationKind = 'bill_due' | 'floor_risk' | 'milestone' | 'weekly_checkin' | 'stale_accounts';

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
export const MAX_PER_WEEK = 3;
export const MIN_HOURS_BETWEEN = 20;
export const MAX_TITLE_LENGTH = 40;

export function decideNotification(signals: NotificationSignals, history: readonly NotificationRecord[]): NotificationDecision | null {
  const now = signals.now;
  const nowHours = now.getHours();

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

  // Candidate C1: Bill due
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const upcomingBills = signals.upcomingBills.filter(bill => {
    const dueDate = parseLocalDate(bill.dueDate);
    const daysUntilDue = daysBetween(today, dueDate);
    return daysUntilDue >= 0 && daysUntilDue <= 2;
  });

  if (upcomingBills.length > 0 && signals.projectedCashAtNextBill < signals.cashFloor) {
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
    let dueText = '';
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
  if (signals.nextMonthProjectedEndingCash !== null && signals.nextMonthFloor !== null && signals.nextMonthProjectedEndingCash < signals.nextMonthFloor) {
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
  if (signals.newMilestones.length > 0) {
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
  if (daysSinceSync === null || daysSinceSync > 7) {
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
  if (now.getDay() === 0 && !checkedInRecently && signals.netWorth !== null && signals.monthEndCash !== null) {
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
