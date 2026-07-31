// ─── Date-Aware Scheduling Engine ────────────────────────
// Generates upcoming events from recurring rules and accounts

import type { Tables } from '@/integrations/supabase/types';

type RuleRow = Partial<Tables<'recurring_rules'>> & {
  id: string; name: string; amount: number; rule_type: string; frequency: string; active: boolean;
};
type AccountRow = Partial<Tables<'accounts'>>;

export type ScheduledEvent = {
  date: string;
  name: string;
  amount: number;
  type: 'income' | 'expense';
  source?: string;
  ruleId?: string;
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Format a Date as YYYY-MM-DD in LOCAL time. Using `toISOString()` here formats in UTC, which
 * shifts the calendar day forward for evening loads in negative-offset timezones (e.g.
 * America/New_York, UTC-4/-5): a Jul 31 9pm ET payday becomes "2026-08-01", leaking end-of-month
 * events into the next month and dropping them from the current month's forecast. Every consumer
 * of these date strings (monthKey, syncCutoffDate comparisons) already works in local time, so
 * local formatting is the correct, consistent choice and matches the user's real pay calendar. */
export function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Shared length of the debt-payoff/forecast simulation window, in months. The single source of
 * truth for "how far ahead do we project" — every array/loop bound representing this window
 * across the engine, the hook that drives it, and the Forecast/Debt-Payoff UI should import this
 * rather than hardcoding a literal. Lives here (a zero-dependency leaf module) rather than
 * credit-card-engine.ts so that file can import it without a circular dependency (it already
 * imports countRuleOccurrencesInMonth from this file, and re-exports this constant). */
export const PROJECTION_MONTHS = 60;

/** Maps a 1-indexed "year slot" (1-5, matching the Forecast/Debt-Payoff year filters) to the
 * [startIdx, endIdx) month-index range that falls within that REAL calendar year — not a rolling
 * 12-month window from today. Month index 0 is always the current month, so Year 1 runs from
 * today through December of the current calendar year (shorter than 12 months unless today is
 * January); Years 2-5 each run a full January-December. Both Forecast.tsx and
 * CreditCardEngine.tsx's accordion use this so "Year N" means the same real year (e.g. Jan 2029
 * always falls in the year containing it) in both places, instead of two slightly different
 * rolling-window definitions. The trailing few months beyond Year 5 (Jan-current month of the
 * 6th calendar year) are intentionally not covered by any slot — Forecast's separate "All" option
 * is the only way to reach them, kept consistent with Debt Payoff having no such escape hatch.
 */
export function getCalendarYearMonthRange(yearSlot: number, now: Date = new Date()): [number, number] {
  const nowMonth = now.getMonth();
  const start = Math.max(0, (yearSlot - 1) * 12 - nowMonth);
  const end = Math.max(start, yearSlot * 12 - nowMonth);
  return [start, end];
}

/** The real calendar year (e.g. 2026) that "Year N" (yearSlot) refers to, for button labels. */
export function getCalendarYearLabel(yearSlot: number, now: Date = new Date()): number {
  return now.getFullYear() + (yearSlot - 1);
}

// Get next N Fridays (or any day) from a start date
export function getNextWeekdays(dayOfWeek: number, count: number, from: Date = new Date()): Date[] {
  const dates: Date[] = [];
  const d = new Date(from);
  // Move to next occurrence
  while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
  for (let i = 0; i < count; i++) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return dates;
}

// Generate scheduled events for the next N months from recurring rules
export function generateScheduledEvents(
  rules: RuleRow[],
  accounts: AccountRow[],
  months: number = PROJECTION_MONTHS,
  from: Date = new Date()
): ScheduledEvent[] {
  const events: ScheduledEvent[] = [];
  const endDate = new Date(from);
  endDate.setMonth(endDate.getMonth() + months);

  for (const rule of rules) {
    if (!rule.active) continue;

    const startDate = rule.start_date ? new Date(rule.start_date) : from;
    const ruleEnd = rule.end_date ? new Date(rule.end_date) : endDate;
    const effectiveEnd = ruleEnd < endDate ? ruleEnd : endDate;

    const accountName = rule.deposit_account
      ? accounts.find(a => a.id === rule.deposit_account)?.name
      : rule.payment_source
        ? accounts.find(a => a.id === rule.payment_source)?.name
        : undefined;

    if (rule.frequency === 'weekly') {
      const dayOfWeek = rule.due_day ?? 5;
      const dates = getNextWeekdays(dayOfWeek, months * 5, new Date(Math.max(from.getTime(), startDate.getTime())));
      for (const d of dates) {
        if (d > effectiveEnd) break;
        events.push({
          date: toLocalDateStr(d),
          name: rule.name,
          amount: Number(rule.amount),
          type: rule.rule_type as ScheduledEvent['type'],
          source: accountName,
          ruleId: rule.id,
        });
      }
    } else if (rule.frequency === 'biweekly') {
      const dayOfWeek = rule.due_day ?? 5;
      const d = new Date(Math.max(from.getTime(), startDate.getTime()));
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d <= effectiveEnd) {
        events.push({
          date: toLocalDateStr(d),
          name: rule.name,
          amount: Number(rule.amount),
          type: rule.rule_type as ScheduledEvent['type'],
          source: accountName,
          ruleId: rule.id,
        });
        d.setDate(d.getDate() + 14);
      }
    } else if (rule.frequency === 'monthly') {
      const d = new Date(Math.max(from.getTime(), startDate.getTime()));
      d.setDate(rule.due_day || 1);
      if (d < from) d.setMonth(d.getMonth() + 1);
      while (d <= effectiveEnd) {
        events.push({
          date: toLocalDateStr(d),
          name: rule.name,
          amount: Number(rule.amount),
          type: rule.rule_type as ScheduledEvent['type'],
          source: accountName,
          ruleId: rule.id,
        });
        d.setMonth(d.getMonth() + 1);
      }
    } else if (rule.frequency === 'yearly') {
      const d = new Date(Math.max(from.getTime(), startDate.getTime()));
      // Zero the day BEFORE setMonth. `d` still carries today's day-of-month here, so on a
      // day-29/30/31 clock setMonth() into a shorter month overflows into the next one — from
      // Jul 30, due_month 2 (Feb) becomes "Feb 30" => Mar 2, and the setDate below then pins a
      // February bill in MARCH. That displaces the actual charge, not just its label, every year,
      // and is invisible on days 1-28. Same defect class as the month-label fix in
      // credit-card-engine.ts. Covered by scheduling.yearlyDueMonthOverflow.test.ts — do not remove.
      d.setDate(1);
      d.setMonth((rule.due_month ?? 1) - 1);
      d.setDate(rule.due_day || 1);
      if (d < from) d.setFullYear(d.getFullYear() + 1);
      while (d <= effectiveEnd) {
        events.push({
          date: toLocalDateStr(d),
          name: rule.name,
          amount: Number(rule.amount),
          type: rule.rule_type as ScheduledEvent['type'],
          source: accountName,
          ruleId: rule.id,
        });
        d.setFullYear(d.getFullYear() + 1);
      }
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

// Count how many times a given weekday (0=Sun…6=Sat) falls in a calendar month
export function countWeekdayInMonth(year: number, month: number, dayOfWeek: number): number {
  const d = new Date(year, month, 1);
  while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
  let count = 0;
  while (d.getMonth() === month) { count++; d.setDate(d.getDate() + 7); }
  return count;
}

/**
 * Count how many times a recurring rule fires in a given calendar month.
 * Biweekly uses the same cycle anchor as generateScheduledEvents — max(today, rule.start_date),
 * advance to first matching dayOfWeek, then every 14 days — so both systems agree.
 * Returns 1/12 for yearly (amortized). Returns 0 if rule is outside start/end bounds.
 */
export function countRuleOccurrencesInMonth(
  rule: { frequency: string; due_day?: number | null; start_date?: string | null; end_date?: string | null },
  year: number,
  month: number,
  today: Date = new Date(),
): number {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  if (rule.start_date && new Date(rule.start_date + 'T00:00:00') > monthEnd) return 0;
  if (rule.end_date && new Date(rule.end_date + 'T00:00:00') < monthStart) return 0;
  if (rule.frequency === 'monthly') return 1;
  if (rule.frequency === 'semi_monthly') return 2;
  if (rule.frequency === 'yearly') return 1 / 12;
  const dayOfWeek = rule.due_day ?? 5;
  if (rule.frequency === 'weekly') return countWeekdayInMonth(year, month, dayOfWeek);
  if (rule.frequency === 'biweekly') {
    const ruleStart = rule.start_date ? new Date(rule.start_date + 'T00:00:00') : today;
    const ref = new Date(Math.max(today.getTime(), ruleStart.getTime()));
    while (ref.getDay() !== dayOfWeek) ref.setDate(ref.getDate() + 1);
    // Advance ref to first occurrence on or after monthStart
    if (ref < monthStart) {
      const diffDays = Math.floor((monthStart.getTime() - ref.getTime()) / 86400000);
      ref.setDate(ref.getDate() + Math.floor(diffDays / 14) * 14);
      if (ref < monthStart) ref.setDate(ref.getDate() + 14);
    }
    if (ref > monthEnd) return 0;
    let count = 0;
    const d = new Date(ref);
    while (d <= monthEnd) { count++; d.setDate(d.getDate() + 14); }
    return count;
  }
  return 0;
}

// Get upcoming events within the next N days
export function getUpcomingEvents(events: ScheduledEvent[], days: number = 7): ScheduledEvent[] {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + days);
  const nowStr = toLocalDateStr(now);
  const cutoffStr = toLocalDateStr(cutoff);
  return events.filter(e => e.date >= nowStr && e.date <= cutoffStr);
}

// Get next paycheck date
export function getNextPayday(paycheckDay: number = 5): Date {
  const d = new Date();
  while (d.getDay() !== paycheckDay) d.setDate(d.getDate() + 1);
  return d;
}

// Aggregate events by month for forecast
export function aggregateByMonth(events: ScheduledEvent[]): Record<string, { income: number; expenses: number }> {
  const months: Record<string, { income: number; expenses: number }> = {};
  for (const e of events) {
    const key = e.date.substring(0, 7); // YYYY-MM
    if (!months[key]) months[key] = { income: 0, expenses: 0 };
    if (e.type === 'income') months[key].income += e.amount;
    else months[key].expenses += e.amount;
  }
  return months;
}

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function getDayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] || 'Fri';
}
