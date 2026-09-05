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

/* ─── Custom repeat intervals ──────────────────────────────────────────────────────────────────
 *
 * Tre, 2026-09-05: a planned item must repeat every other month, every three weeks, every five
 * weeks — not only on the closed `frequency` vocabulary.
 *
 * TWO COLUMNS, NOT MORE ENUM VALUES. `interval_unit` + `interval_count` express every one of those
 * and every one nobody has asked for yet, without any of the twenty-odd files that branch on
 * `frequency` growing a new case. See migration 20260905_recurring_rules_custom_interval.sql.
 *
 * ⚠️ NULL MEANS NOTHING CHANGES. Every rule in the database carries nulls here, so
 * `ruleCustomInterval` returns null for all of them and every generator below takes the byte-
 * identical path it took yesterday. That is deliberate and it is what the round-trip test on
 * Tre's own Supplements rule (monthly, due day 28) pins.
 */

export type CustomInterval = { unit: 'day' | 'week' | 'month' | 'year'; count: number };

const INTERVAL_UNITS = ['day', 'week', 'month', 'year'] as const;

/** The rule's custom interval, or null when it has none and `frequency` still governs.
 *
 * BOTH COLUMNS OR NEITHER. A count with no unit is not a schedule and a unit with no count is
 * ambiguous between "one" and "unset"; the database CHECK refuses to hold either, and this refuses
 * to interpret one, so a legacy or hand-edited half-row falls back to `frequency` rather than
 * silently inventing a cadence. The bounds mirror the CHECK exactly (1..60): an out-of-range value
 * reaching a walking loop is an out-of-range value driving a loop. */
export function ruleCustomInterval(
  rule: { interval_unit?: string | null; interval_count?: number | null },
): CustomInterval | null {
  const unit = rule.interval_unit;
  const count = rule.interval_count;
  if (unit == null || count == null) return null;
  if (!(INTERVAL_UNITS as readonly string[]).includes(unit)) return null;
  if (!Number.isInteger(count) || count < 1 || count > 60) return null;
  return { unit: unit as CustomInterval['unit'], count };
}

/** The date every custom-interval schedule is phased from, at local noon, or null when the rule
 * carries nothing to phase on. Noon, not midnight, for the reason this file documents everywhere
 * else: `new Date('2026-07-01')` is the evening of 30 June at any negative offset. */
function customIntervalAnchor(
  rule: { start_date?: string | null; created_at?: string | null },
): Date | null {
  const raw = rule.start_date ?? rule.created_at ?? null;
  if (!raw) return null;
  const d = new Date(`${raw.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const noonOn = (y: number, m: number, day: number) => new Date(y, m, day, 12, 0, 0, 0);

/**
 * Every occurrence of a custom-interval rule inside one calendar month, as local Dates at noon.
 *
 * ONE DEFINITION, THREE CALLERS. `generateScheduledEvents`, `countRuleOccurrencesInMonth` and
 * `getRuleOccurrenceDatesInMonth` all come through here rather than each walking its own grid.
 * This file's history is a list of bugs where two generators disagreed by a day or a cycle — the
 * biweekly re-phasing, the day-31 month overflow, the UTC-formatted local date. A single source
 * cannot drift from itself.
 *
 * DAY / WEEK phase on the anchor, exactly as biweekly phases on `start_date`.
 * MONTH / YEAR land on `due_day`, CLAMPED to the month's length for the same reason the monthly
 * generator clamps it: a day-31 rule must charge on 28 February, not overflow into March and then
 * stay there. A month that is not on the interval grid produces nothing at all.
 *
 * `start_date` and `end_date` are NOT applied here — the callers apply their own shared gates
 * (`notBeforeStart` / `occurrenceSurvivesEndDate`), so the arrears rules keep working unchanged.
 */
export function getCustomIntervalDatesInMonth(
  rule: { due_day?: number | null; start_date?: string | null; created_at?: string | null },
  interval: CustomInterval,
  year: number,
  month: number,
): Date[] {
  const anchor = customIntervalAnchor(rule);
  if (!anchor) return [];
  const monthStart = noonOn(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  const monthEnd = noonOn(year, month, lastDay);

  if (interval.unit === 'month' || interval.unit === 'year') {
    const stepMonths = interval.count * (interval.unit === 'year' ? 12 : 1);
    const anchorIdx = anchor.getFullYear() * 12 + anchor.getMonth();
    const targetIdx = year * 12 + month;
    const delta = targetIdx - anchorIdx;
    if (delta < 0 || delta % stepMonths !== 0) return [];
    const dueDay = rule.due_day || anchor.getDate();
    return [noonOn(year, month, Math.min(dueDay, lastDay))];
  }

  const stepDays = interval.count * (interval.unit === 'week' ? 7 : 1);
  const d = new Date(anchor);
  if (d < monthStart) {
    // Jump whole cycles then close the remainder — the same arithmetic the biweekly grid uses,
    // and for the same reason: day-differencing noon-anchored dates never lands off-phase.
    const whole = Math.floor(Math.round((monthStart.getTime() - d.getTime()) / DAY_MS) / stepDays);
    d.setDate(d.getDate() + whole * stepDays);
    while (d < monthStart) d.setDate(d.getDate() + stepDays);
  }
  const dates: Date[] = [];
  while (d <= monthEnd) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + stepDays);
  }
  return dates;
}

/** The rule fields the end-date/arrears rules read. Structural, so every caller's row satisfies it.
 *
 * ⚠️ `rule_type` IS OPTIONAL, AND OMITTING IT OPTS OUT OF THE TRAILING PAYCHECK. A caller that does
 * not supply it is treated as not-income, so `trailingEarnedPayDate` returns null and `end_date`
 * truncates exactly as it always has. That is deliberate for the bank-charge matchers
 * (`auto-matched-occurrences.ts`, `bank-activity-queue.ts`, `matched-occurrence-display.ts`,
 * `rules-from-history.ts`), which build a narrow literal to ask "where do this rule's occurrences
 * land" for charge attribution and have no use for a paycheck that has not happened yet. Anything
 * modelling INCOME must pass the whole rule row. */
export type EndDatedRule = BiweeklyRule & {
  rule_type?: string | null;
  frequency?: string | null;
  end_date?: string | null;
};

/**
 * The ONE extra paycheck a weekly/biweekly INCOME rule still owes after its `end_date`, as
 * `YYYY-MM-DD`, or null when it owes none.
 *
 * ⚠️ THE DEFECT THIS PREVENTS. `end_date` used to truncate the schedule strictly at the date, which
 * silently deleted the final EARNED paycheck: work done up to the last day is paid on the next
 * payday, which by definition falls after the last day. Measured on a biweekly $1,100 partner
 * income ending 2027-08-31 (Tre's move month): the schedule stopped at 2027-08-27 and the
 * 2027-09-10 cheque — real money, already earned — never appeared in the forecast at all. A
 * household planning a move around that date is counting on it.
 *
 * ⚠️ ARREARS IS A PER-FREQUENCY CLAIM, NOT A BLANKET ONE.
 *  - `weekly` / `biweekly`: paid in arrears. A payday settles the cycle ENDING on it, so anything
 *    worked after the last payday on or before `end_date` is unpaid and lands on the next scheduled
 *    payday. That is the cheque returned here.
 *  - a payday landing EXACTLY on `end_date` settles the final cycle, so nothing trails it — null.
 *  - `monthly` / `semi_monthly` / `yearly`: NOT given a trailing cheque. A monthly salary is
 *    normally paid current (on or near the last day of the period it covers), and the app models it
 *    as one payment on `due_day` with no period boundaries to reason about, so inventing a trailing
 *    payment would be inventing money. These truncate at `end_date`, unchanged.
 *  - EXPENSES get nothing. Rent does not arrive one cycle late because the lease ended.
 */
export function trailingEarnedPayDate(rule: EndDatedRule, today: Date = new Date()): string | null {
  if (rule.rule_type !== 'income') return null;
  if (!rule.end_date) return null;
  if (rule.frequency !== 'weekly' && rule.frequency !== 'biweekly') return null;

  const end = new Date(`${rule.end_date.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  // An end before the start is not a schedule at all — the rule never pays, so nothing trails it.
  // (BudgetControl rejects this on save; a legacy row could still carry it.)
  if (rule.start_date && rule.end_date.slice(0, 10) < rule.start_date.slice(0, 10)) return null;

  if (rule.frequency === 'weekly') {
    // Clamped exactly as `resolveBiweeklyAnchor` clamps it, and for the same reason: `due_day`
    // holds a DAY OF MONTH on monthly rules, so a rule flipped monthly -> weekly hands this a 15
    // and an unclamped weekday walk never terminates.
    const raw = rule.due_day;
    const dayOfWeek = typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 6 ? raw : 5;
    if (end.getDay() === dayOfWeek) return null; // payday on the last day — already settled
    const d = new Date(end);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() !== dayOfWeek);
    return toLocalDateStr(d);
  }

  // Biweekly: walk the phase-anchored grid to the first payday strictly after `end_date`.
  const d = resolveBiweeklyAnchor(rule, today);
  if (d <= end) {
    // Jump whole cycles then close the remainder, same exact arithmetic as
    // `getBiweeklyDatesInMonth` — day-differencing noon-anchored dates never lands off-phase.
    const wholeCycles = Math.floor(Math.round((end.getTime() - d.getTime()) / DAY_MS) / 14);
    d.setDate(d.getDate() + wholeCycles * 14);
    while (d <= end) d.setDate(d.getDate() + 14);
    const previous = new Date(d);
    previous.setDate(previous.getDate() - 14);
    if (previous.getTime() === end.getTime()) return null; // payday on the last day
  }
  // `d > end` on entry means the rule ended before its very first payday, in which case that first
  // payday IS the final earned cheque — the anchor itself, which is what `d` already holds.
  return toLocalDateStr(d);
}

/**
 * Whether one occurrence date survives the rule's `end_date`. The single gate every generator
 * shares, so none of them can disagree about where a schedule stops.
 *
 * `end_date` truncates, with exactly one exception: the final earned paycheck of a weekly/biweekly
 * income rule (see `trailingEarnedPayDate`).
 *
 * ⚠️ COMPARED AS `YYYY-MM-DD` STRINGS, not Dates. `new Date('2027-08-27')` parses as UTC MIDNIGHT,
 * which is 2027-08-26 20:00 in US Eastern — so the old `d <= new Date(rule.end_date)` bound in
 * `generateScheduledEvents` dropped a paycheck landing ON its own end date, stopping a biweekly
 * income a FULL CYCLE early. Lexicographic comparison of the date strings has no timezone and no
 * time-of-day in it at all.
 */
export function occurrenceSurvivesEndDate(
  rule: EndDatedRule,
  iso: string,
  today: Date = new Date(),
): boolean {
  if (!rule.end_date) return true;
  if (iso <= rule.end_date.slice(0, 10)) return true;
  return iso === trailingEarnedPayDate(rule, today);
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

    // NOON LOCAL, not `new Date(rule.start_date)`. The bare form parses `YYYY-MM-DD` as UTC
    // midnight, which is the EVENING BEFORE at any negative offset — so a rule starting
    // 2027-07-01 was already in range on 30 June in US Eastern and its occurrences generated a
    // month early. On the real capture that put "Rent (new place)" ($1,480/mo, start_date
    // 2027-07-01) into June 2027, a month of rent the user does not owe, and the phantom expense
    // then propagated backward through `computeFloorProtection`'s reserve pass and moved the
    // projected CC payoff from Sep 2028 to Dec 2028. Invisible until the suite first ran under
    // TZ=UTC, where the two parses coincide.
    //
    // The `end_date` immediately below already documents the same trap, and the per-month
    // generators already parse at 'T12:00:00'. This line was the one that did not — so the two
    // paths disagreed with each other as well as with the calendar.
    const startDate = rule.start_date ? new Date(`${rule.start_date.slice(0, 10)}T12:00:00`) : from;
    // END OF THE END DATE'S DAY, not its UTC midnight. `new Date('2027-08-27')` is 2027-08-26 20:00
    // in US Eastern, so an occurrence at local noon on its own end date compared GREATER than the
    // bound and was dropped — a biweekly income ending on a payday stopped a full cycle early and
    // lost that $1,100 cheque outright. The per-month generators parse at 'T12:00:00' and did NOT
    // have the bug, so the two paths also disagreed by one paycheck.
    const ruleEnd = rule.end_date ? new Date(`${rule.end_date.slice(0, 10)}T23:59:59.999`) : endDate;
    const effectiveEnd = ruleEnd < endDate ? ruleEnd : endDate;

    const accountName = rule.deposit_account
      ? accounts.find(a => a.id === rule.deposit_account)?.name
      : rule.payment_source
        ? accounts.find(a => a.id === rule.payment_source)?.name
        : undefined;

    const customInterval = ruleCustomInterval(rule);
    if (customInterval) {
      // Walked MONTH BY MONTH through the same per-month function the other two generators call,
      // rather than stepping a cursor of its own. That is what makes the timeline and the per-month
      // count agree by construction instead of by careful copying — this file's history is a list
      // of two generators drifting apart by a day or a cycle.
      const windowStart = new Date(Math.max(from.getTime(), startDate.getTime()));
      const cursor = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
      while (cursor <= effectiveEnd) {
        for (const d of getCustomIntervalDatesInMonth(rule, customInterval, cursor.getFullYear(), cursor.getMonth())) {
          if (d < windowStart || d > effectiveEnd) continue;
          if (!occurrenceSurvivesEndDate(rule, toLocalDateStr(d))) continue;
          events.push({
            date: toLocalDateStr(d),
            name: rule.name,
            amount: Number(rule.amount),
            type: rule.rule_type as ScheduledEvent['type'],
            source: accountName,
            ruleId: rule.id,
          });
        }
        cursor.setMonth(cursor.getMonth() + 1);
      }
    } else if (rule.frequency === 'weekly') {
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

    // The final EARNED paycheck of a weekly/biweekly income rule, which lands after `end_date` and
    // so is unreachable from any loop above — every one of them stops at `effectiveEnd`. That is
    // also why this can never duplicate an event: the trailing date is strictly after `end_date`
    // and the loops emit nothing past it. Bounded by `from`/`endDate` like the loops are, so a
    // rule that ended before today contributes nothing.
    const trailing = trailingEarnedPayDate(rule, from);
    if (trailing && trailing >= toLocalDateStr(from) && trailing <= toLocalDateStr(endDate)) {
      events.push({
        date: trailing,
        name: rule.name,
        amount: Number(rule.amount),
        type: rule.rule_type as ScheduledEvent['type'],
        source: accountName,
        ruleId: rule.id,
      });
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
    rule_type?: string | null;
    interval_unit?: string | null; interval_count?: number | null;
  },
  year: number,
  month: number,
  today: Date = new Date(),
): number {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  if (rule.start_date && new Date(rule.start_date + 'T00:00:00') > monthEnd) return 0;
  if (rule.end_date && new Date(rule.end_date + 'T00:00:00') < monthStart) {
    // The whole-month gate is not the last word for a weekly/biweekly income rule: its final
    // earned paycheck lands AFTER `end_date`, so it can fall in a month the rule has otherwise
    // finished. Every other frequency (and every expense) gets null back and still returns 0.
    const trailing = trailingEarnedPayDate(rule, today);
    return trailing != null
      && trailing >= toLocalDateStr(monthStart) && trailing <= toLocalDateStr(monthEnd) ? 1 : 0;
  }
  // A custom interval answers this outright and never reaches the frequency branches: it is the
  // only thing that knows a month is OFF the grid entirely (an every-other-month bill contributes
  // nothing in its off months, where `frequency === 'monthly'` would return a flat 1).
  const customInterval = ruleCustomInterval(rule);
  if (customInterval) {
    return getCustomIntervalDatesInMonth(rule, customInterval, year, month)
      .filter(d => occurrenceSurvivesEndDate(rule, toLocalDateStr(d), today))
      .filter(d => !rule.start_date || toLocalDateStr(d) >= rule.start_date.slice(0, 10))
      .length;
  }
  if (rule.frequency === 'monthly') return 1;
  if (rule.frequency === 'semi_monthly') return 2;
  if (rule.frequency === 'yearly') return 1 / 12;
  const dayOfWeek = rule.due_day ?? 5;
  // ⚠️ THE `end_date` BRANCHES BELOW EXIST BECAUSE THE MONTH GATE ABOVE IS TOO COARSE FOR A RULE
  // THAT ENDS MID-MONTH. `countWeekdayInMonth` counts every matching weekday in the month, so a
  // weekly income ending on the 5th was still counted as four paychecks in its final month — 4
  // where `getRuleOccurrenceDatesInMonth` (which has honoured end_date per occurrence since it was
  // written) said 0. The no-`end_date` path is left literally untouched, which is nearly every
  // rule: it must stay byte-identical.
  if (rule.frequency === 'weekly') {
    if (!rule.end_date) return countWeekdayInMonth(year, month, dayOfWeek);
    const d = new Date(year, month, 1);
    while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
    let count = 0;
    while (d.getMonth() === month) {
      if (occurrenceSurvivesEndDate(rule, toLocalDateStr(d), today)) count++;
      d.setDate(d.getDate() + 7);
    }
    return count;
  }
  if (rule.frequency === 'biweekly') {
    if (!rule.end_date) return getBiweeklyDatesInMonth(rule, year, month, today).length;
    // The grid is generated UNCLAMPED (`end_date: null`) because the trailing cheque is by
    // definition past the date `getBiweeklyDatesInMonth` clamps at; the shared gate then decides.
    return getBiweeklyDatesInMonth({ ...rule, end_date: null }, year, month, today)
      .filter(d => occurrenceSurvivesEndDate(rule, toLocalDateStr(d), today)).length;
  }
  return 0;
}

// Get upcoming events within the next N days.
//
// Generic over the event type so a caller that has ENRICHED its events — Dashboard substitutes the
// real settled date and amount into the ones a bank charge already answered, see
// `matched-occurrence-display.ts` — gets its own row type back rather than a widened
// `ScheduledEvent[]` that has quietly dropped the extra fields. Filter only: nothing is read but
// `date`, and no existing caller's behaviour changes.
export function getUpcomingEvents<T extends ScheduledEvent>(events: readonly T[], days: number = 7): T[] {
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
