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

/** The rule fields biweekly phasing needs. Structural, so every caller's row type satisfies it. */
type BiweeklyRule = {
  due_day?: number | null;
  start_date?: string | null;
  created_at?: string | null;
};

const DAY_MS = 86400000;

/** Local NOON of a date's calendar day. Noon rather than midnight so that adding whole days can
 * never cross a day boundary when a DST change shifts the clock by an hour. */
function atNoon(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

/**
 * The fixed point a biweekly rule's 14-day cycle is measured from.
 *
 * ⚠️ WHY A RULE NEEDS ONE AT ALL. "Every other Friday" is meaningless without saying *which* Friday,
 * and until this existed no biweekly generator in the app had an answer. They restarted the cycle
 * either at the first matching weekday of each month or at `max(today, start_date)` — so occurrences
 * drifted across month boundaries, and the schedule silently re-phased itself every calendar day.
 * See `scheduling.biweeklyAnchor.test.ts` for the measured damage.
 *
 * The anchor is DERIVED, never asked for: `start_date` when the user set one, else the rule's
 * `created_at` — per-rule, stable, already stored on every row, and honest ("the rule started
 * existing then"). A rule editor field to pin a true first occurrence is a separate, optional
 * follow-up; nobody should have to fill in a form before their forecast is right.
 *
 * ⚠️ `due_day` WINS OVER THE ANCHOR'S OWN WEEKDAY. The anchor supplies the PHASE only. Tre's `Fuel`
 * rule bills on Fridays (`due_day` 5) but was created on a Sunday, so anchoring on the raw date
 * would move every occurrence to a Sunday and quietly overrule what the user asked for. We advance
 * to the first `due_day` on or after the base date instead.
 *
 * For a rule carrying neither date the phase is genuinely arbitrary, so `today` is as good as
 * anything — but no live row is in that state (`created_at` is non-null for every row in the
 * database), so in practice this only serves test doubles.
 */
export function resolveBiweeklyAnchor(rule: BiweeklyRule, today: Date = new Date()): Date {
  // ⚠️ CLAMPED to a real weekday, not merely null-checked. `due_day` holds a DAY OF MONTH on
  // monthly rules, so flipping a rule from monthly to biweekly hands this a 15 — and the advance
  // loop below would spin forever hunting a weekday that does not exist. The rule editor calls
  // this on every keystroke, while the frequency select and the due_day input are still
  // disagreeing, so the hang is reachable from the UI and not only from bad stored data.
  const raw = rule.due_day;
  const dayOfWeek = typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 6 ? raw : 5;
  // Both columns are read as a CALENDAR DAY at local noon. `created_at` is a UTC timestamp, so
  // taking its date part keeps the anchor stable regardless of the viewer's timezone — the phase
  // must not depend on where the app is opened.
  const base = rule.start_date
    ? new Date(`${rule.start_date.slice(0, 10)}T12:00:00`)
    : rule.created_at
      ? new Date(`${rule.created_at.slice(0, 10)}T12:00:00`)
      : atNoon(today);
  const d = Number.isNaN(base.getTime()) ? atNoon(today) : base;
  while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
  return d;
}

/** What the rule editor tells a user about the phase their biweekly rule will actually run on. */
export type BiweeklyAnchorDescription = {
  /** The date the 14-day cycle is measured from, as a LOCAL calendar day (`YYYY-MM-DD`). */
  anchor: string;
  /** True when the user pinned it via `start_date`; false when it was derived from `created_at`. */
  pinned: boolean;
  /** True when a pinned `start_date` was moved because its weekday disagreed with `due_day`. */
  shiftedFromInput: boolean;
};

/**
 * Describe `resolveBiweeklyAnchor`'s answer in the terms a form needs.
 *
 * ⚠️ `shiftedFromInput` is the reason this exists rather than the editor calling the resolver
 * directly. The resolver advances the base date to the first `due_day` weekday on or after it, so
 * a user who types their real first paycheck date on a rule whose `due_day` names a different
 * weekday gets a schedule that starts somewhere else. Moving their date is correct — `due_day` is
 * also something they asked for — but doing it silently is not, so the caller can surface it.
 */
export function describeBiweeklyAnchor(rule: BiweeklyRule, today: Date = new Date()): BiweeklyAnchorDescription {
  const anchor = toLocalDateStr(resolveBiweeklyAnchor(rule, today));
  const pinnedDay = rule.start_date ? rule.start_date.slice(0, 10) : null;
  return {
    anchor,
    pinned: pinnedDay != null,
    shiftedFromInput: pinnedDay != null && pinnedDay !== anchor,
  };
}

/**
 * Every date a biweekly rule bills on within one calendar month — the ONE definition of biweekly
 * cadence, shared by `generateScheduledEvents`, `countRuleOccurrencesInMonth` and
 * `getRuleOccurrenceDatesInMonth`. Three copies of this arithmetic is what let them disagree.
 *
 * Occurrences are the dates D where `(D - anchor)` is a whole number of 14-day cycles, D is on or
 * after the anchor, and D falls inside the rule's `start_date`/`end_date` bounds.
 */
export function getBiweeklyDatesInMonth(
  rule: BiweeklyRule & { end_date?: string | null },
  year: number,
  month: number, // 0-indexed
  today: Date = new Date(),
): Date[] {
  const monthStart = new Date(year, month, 1, 12, 0, 0, 0);
  const monthEnd = new Date(year, month + 1, 0, 12, 0, 0, 0);
  const anchor = resolveBiweeklyAnchor(rule, today);
  if (anchor > monthEnd) return [];

  const end = rule.end_date
    ? new Date(`${rule.end_date.slice(0, 10)}T12:00:00`)
    : null;
  const lastDay = end && end < monthEnd ? end : monthEnd;

  const d = new Date(anchor);
  if (d < monthStart) {
    // Jump whole cycles rather than stepping, then close the remainder. Day-differencing
    // noon-anchored dates is exact, so this never lands off-phase.
    const wholeCycles = Math.floor(Math.round((monthStart.getTime() - d.getTime()) / DAY_MS) / 14);
    d.setDate(d.getDate() + wholeCycles * 14);
    while (d < monthStart) d.setDate(d.getDate() + 14);
  }

  const dates: Date[] = [];
  while (d <= lastDay) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 14);
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
      // Phase-anchored — see `resolveBiweeklyAnchor`. This used to start at
      // `max(today, start_date)` and step 14 from there, which re-phased the whole schedule every
      // calendar day and disagreed with the per-month generators by up to 7 days.
      const anchor = resolveBiweeklyAnchor(rule, from);
      const fromDay = atNoon(from);
      const d = new Date(anchor);
      if (d < fromDay) {
        const wholeCycles = Math.floor(Math.round((fromDay.getTime() - d.getTime()) / DAY_MS) / 14);
        d.setDate(d.getDate() + wholeCycles * 14);
        while (d < fromDay) d.setDate(d.getDate() + 14);
      }
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
      // Re-derive every occurrence from a (year, monthIndex) cursor instead of advancing one
      // mutating Date with setMonth(+1). That mutation carries the PREVIOUS occurrence's day
      // forward, so a day-31 rule overflowed short months CUMULATIVELY: from Jul 15 it emitted
      // Jul 31, Aug 31, then Oct 1 — September vanished outright — and the rule was then stuck
      // on the 1st of every month forever. Clamping due_day to the month's length matches how
      // Chase and most billers bill a 31st due date (Feb 28/29, Apr 30), gives every month
      // exactly one charge, and skips none. Unlike the yearly overflow below this does NOT
      // depend on today's date. Covered by scheduling.monthlyDueDayClamp.test.ts.
      const anchor = new Date(Math.max(from.getTime(), startDate.getTime()));
      const dueDay = rule.due_day || 1;
      const year = anchor.getFullYear();
      // monthIdx may run past 11; the Date constructor normalizes it into later years, and
      // `new Date(year, monthIdx + 1, 0)` is the last day of monthIdx under the same rule.
      const occurrenceAt = (monthIdx: number) =>
        new Date(year, monthIdx, Math.min(dueDay, new Date(year, monthIdx + 1, 0).getDate()));

      let monthIdx = anchor.getMonth();
      if (occurrenceAt(monthIdx) < from) monthIdx += 1;
      for (let d = occurrenceAt(monthIdx); d <= effectiveEnd; d = occurrenceAt(++monthIdx)) {
        events.push({
          date: toLocalDateStr(d),
          name: rule.name,
          amount: Number(rule.amount),
          type: rule.rule_type as ScheduledEvent['type'],
          source: accountName,
          ruleId: rule.id,
        });
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
 * Biweekly defers to `getBiweeklyDatesInMonth`, the one definition of the cadence, so this can
 * never drift from what the generators actually emit.
 * Returns 1/12 for yearly (amortized). Returns 0 if rule is outside start/end bounds.
 */
export function countRuleOccurrencesInMonth(
  rule: {
    frequency: string; due_day?: number | null;
    start_date?: string | null; end_date?: string | null; created_at?: string | null;
  },
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
  if (rule.frequency === 'biweekly') return getBiweeklyDatesInMonth(rule, year, month, today).length;
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
