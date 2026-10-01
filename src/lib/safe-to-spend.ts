/**
 * SAFE TO SPEND UNTIL PAYDAY (ask 23fe1862, design: docs/plans/2026-10-01_safe-to-spend-until-payday.md).
 *
 * Tre approved the App Store listing "Safe to Spend & Payoff Date". Until this file the app showed
 * no figure by that name - only "Safe to Pay", which is what can go to the cards this month.
 *
 * THE DEFINITION: the LOWEST projected balance of the funding account from today up to and
 * including payday, before the paycheck on payday lands, minus the cash floor. Never below 0.
 *
 * THE LOW POINT, NOT THE END POINT. A bill due on day 3 must be covered on day 3, even when an
 * income on day 5 refills the account. An end-point figure would let the user spend money that a
 * bill needs first. For the same reason, on any one date every outflow is applied BEFORE that
 * date's inflows: a bill can clear before a deposit posts.
 *
 * ⚠️ THE INPUTS COME FROM THE ENGINE, NEVER FROM THE TRANSACTION-MERGE HELPERS
 * (`getRemainingTransaction*ByDay`). Finding §1.1: that merge omitted savings goals, the car
 * reserve, car loans, insurance, mortgage and transfers, and read $3,487 above Forecast's END CASH.
 * `assembleSafeToSpendInput` below dates the same rule outflows month 0 subtracts (same filters as
 * `useCardProjection`'s forecastMonthEvents) and reserves every month-0 chain term that has no date.
 *
 * WHAT IS CONSERVATIVE, ON PURPOSE, AND SAYS SO: undated obligations (goal contributions, car
 * reserve and loan, insurance, other debt, transfers, payment plans, card statements and minimums)
 * are reserved IN FULL on the first day, even when some fall after payday. That can only make the
 * figure LOWER than the truth, never higher - the failure a "safe" figure must never have.
 * Paycheck-rule income is never counted before payday (the figure is what is safe BEFORE it lands).
 *
 * WHEN PAYDAY FALLS NEXT MONTH (R-NOW26 (b), Sam's ruling 938fb5db): next month's dated rule bills
 * come from `scheduledEvents`; next month's chain terms (transfers, goals, car loans, card payments,
 * other debt) come from `nextMonthTerms` via `safe-to-spend-next-month.ts` - dated where they have a
 * due day, on day 1 where they do not, and the undated ones are listed in `undatedNextMonth`.
 * A card's discretionary extra paydown (Safe to Pay) is not reserved - the user chooses between it
 * and spending, and both figures sit side by side.
 */
import { CC_DEFAULT_CATEGORIES } from '@/lib/credit-card-engine';
import { isRuleOccurrenceConfirmed, type ConfirmedOccurrences } from '@/lib/confirmed-capture';
import type { ScheduledEvent } from '@/lib/scheduling';
import {
  nextMonthReservations, nextMonthStart, datedMonthZero, type NextMonthTerm, type UndatedNextMonthItem,
} from '@/lib/safe-to-spend-next-month';

export interface DatedCashEvent {
  /** 'YYYY-MM-DD' local date. */
  date: string;
  /** Always positive. */
  amount: number;
  /** 'in' adds to the balance on that date, 'out' subtracts. */
  direction: 'in' | 'out';
  label: string;
}

export interface SafeToSpendInput {
  /** 'YYYY-MM-DD'. Events on or before this date are already in startBalance and are ignored. */
  cutoffDate: string;
  /** 'YYYY-MM-DD' of the next paycheck, or null when the user has no pay schedule. */
  payday: string | null;
  /** Cash in the funding account now, net of anything already spoken for. null = no funding account. */
  startBalance: number | null;
  /** Obligations this month that have no date; reserved in full on the first day (conservative). >= 0. */
  undatedReserve: number;
  events: readonly DatedCashEvent[];
  /** Manual cash floor in dollars. Pass 0 in automatic-floor mode (the automatic floor IS the committed outflows, already in `events`). */
  floor: number;
  /** Next month's items with no due date, reserved on its 1st because payday falls next month. For the drawer. */
  undatedNextMonth?: readonly UndatedNextMonthItem[];
  /** 'YYYY-MM-01' of the month those undated items are reserved in. */
  nextMonthFirst?: string;
  /**
   * 'YYYY-MM-DD' the walk runs to (>= payday). Defaults to payday. Past payday the events must include
   * the paychecks themselves, or a bill after payday would be compared with no income at all.
   */
  horizon?: string;
}

export type SafeToSpendMissing = 'no-funding-account' | 'no-payday' | 'no-projection';

export type SafeToSpendResult =
  | {
      kind: 'figure'; amount: number; lowPoint: number; lowDate: string; payday: string; floor: number;
      /** The last date the walk covered. */
      horizon: string;
      /** True when the low point falls AFTER payday, so a later bill caps the figure. */
      cappedAfterPayday: boolean;
    }
  | { kind: 'empty'; missing: SafeToSpendMissing };

export function computeSafeToSpend(input: SafeToSpendInput | null): SafeToSpendResult {
  if (input === null) {
    return { kind: 'empty', missing: 'no-projection' };
  }

  const { cutoffDate, payday, startBalance, undatedReserve, events, floor } = input;

  if (startBalance === null || !isFinite(startBalance)) {
    return { kind: 'empty', missing: 'no-funding-account' };
  }

  if (payday === null || payday <= cutoffDate) {
    return { kind: 'empty', missing: 'no-payday' };
  }

  // Sam's condition (1), 2026-10-01: the figure must stay safe PAST payday too. If the user spends it
  // today, every later bill through the horizon must still be covered once the paychecks land.
  const horizon = input.horizon && input.horizon > payday ? input.horizon : payday;

  // Filter events that are within the projection period
  const filteredEvents = events.filter(event => {
    return (
      cutoffDate < event.date &&
      event.date <= horizon &&
      event.amount > 0 &&
      isFinite(event.amount)
    );
  });

  // Group events by date
  const eventsByDate: Record<string, DatedCashEvent[]> = {};
  for (const event of filteredEvents) {
    if (!eventsByDate[event.date]) {
      eventsByDate[event.date] = [];
    }
    eventsByDate[event.date].push(event);
  }

  // Start computation
  let balance = startBalance - undatedReserve;
  let lowPoint = balance;
  let lowDate = cutoffDate;

  // Process events in chronological order
  const sortedDates = Object.keys(eventsByDate).sort();
  for (const date of sortedDates) {
    const dayEvents = eventsByDate[date];
    
    // Apply 'out' events first
    const outEvents = dayEvents.filter(e => e.direction === 'out');
    for (const event of outEvents) {
      balance -= event.amount;
      if (balance < lowPoint) {
        lowPoint = balance;
        lowDate = date;
      }
    }
    
    // Apply 'in' events
    const inEvents = dayEvents.filter(e => e.direction === 'in');
    for (const event of inEvents) {
      balance += event.amount;
    }
  }

  // Calculate final amount
  const amount = Math.max(0, Math.round((lowPoint - floor) * 100) / 100);
  
  return {
    kind: 'figure',
    amount,
    lowPoint: Math.round(lowPoint * 100) / 100,
    lowDate,
    payday,
    floor,
    horizon,
    cappedAfterPayday: lowDate > payday,
  };
}

export function formatSafeToSpendMissing(missing: SafeToSpendMissing): string {
  switch (missing) {
    case 'no-funding-account':
      return 'Add a checking account to see what is safe to spend before payday.';
    case 'no-payday':
      return 'Add your pay schedule to see what is safe to spend before payday.';
    case 'no-projection':
      return 'Add your accounts and bills to see what is safe to spend before payday.';
    default:
      throw new Error(`Unhandled missing case: ${missing}`);
  }
}

/** The rule fields the assembly reads. Structural, so this file stays free of hook imports. */
export interface SafeToSpendRule {
  id: string;
  active: boolean | null;
  rule_type: string;
  category: string;
  payment_source?: string | null;
  deposit_account?: string | null;
  tax_rate?: number | string | null;
}

/** The month-0 chain terms the engine subtracted, plus the card statements it paid. */
export interface SafeToSpendMonth0 {
  fundingBalance: number;
  carSavedEarmark: number;
  goalContributions: number;
  autoExtraReserve: number;
  carReserve: number;
  carLoanPayment: number;
  vehicleInsurance: number;
  otherDebtPayment: number;
  transfers: number;
  planExpenses: number;
  oneTimeNet: number;
  /** `Month0Result.cyclingPayment` - statements on cards paid in full this month. */
  cyclingPayment: number;
}

export interface SafeToSpendAssembly {
  /** null when the engine returned no projection. */
  month0: SafeToSpendMonth0 | null;
  /** The account the engine drew from (`debtFundingAccountId`). null = none chosen. */
  fundingAccountId: string | null;
  /** Ids of active checking / business_checking / cash accounts. */
  liquidAccountIds: ReadonlySet<string>;
  /** Ids of active credit-card accounts. */
  creditCardIds: ReadonlySet<string>;
  /** Income rules the forecast treats as THE paycheck (`resolvePaycheckRuleIds`). */
  paycheckRuleIds: ReadonlySet<string>;
  /** Month-0 contract minimums still owed on cards carrying a revolving balance. */
  cardMinimumReserve: number;
  rules: readonly SafeToSpendRule[];
  scheduledEvents: readonly ScheduledEvent[];
  confirmed: ConfirmedOccurrences;
  pauseSavings: boolean;
  /** `syncCutoffDate ?? today` - the balance already reflects everything on or before it. */
  cutoffDate: string;
  /** Next profile-schedule paycheck AFTER the cutoff, or null when no salary is set. */
  profilePayday: string | null;
  /** `resolveCashFloor(profile)` - already 0 in automatic-floor mode. */
  floor: number;
  /** The chain terms of the month after month 0. Used only when payday falls in that month. */
  nextMonthTerms?: readonly NextMonthTerm[];
  /**
   * 'YYYY-MM-DD' in the ENGINE's month 0 - today. ⚠️ Not the cutoff: on the 1st the sync cutoff is
   * still last month, and keying "next month" off it reserved THIS month's terms twice (month 0's
   * chain already holds them). Measured on Tre's account 2026-10-01. Defaults to cutoffDate.
   */
  monthZeroDate?: string;
  /**
   * Month 0's per-item terms, by kind ('transfer' | 'car-loan' | 'insurance' | 'other-debt' | 'plan' |
   * 'card'). When given, each matching chain term is dated by `datedMonthZero` instead of reserved today.
   */
  monthZeroTerms?: readonly NextMonthTerm[];
  /**
   * Net PROFILE-salary paychecks in month 0 after the cutoff, ONLY when no income rule carries the pay
   * (`month0ProfilePaycheckIncome`'s rule). Rule paychecks come from `scheduledEvents`.
   */
  profilePaychecks?: readonly { date: string; net: number }[];
}

/** Last day of `date`'s month, 'YYYY-MM-DD'. */
function monthEnd(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const last = new Date(y, m, 0).getDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

/**
 * Payday when the profile has no salary: the next date of the user's LARGEST income rule into a
 * cash account. Largest, so a $20 side payment is never taken for the paycheck.
 */
export function inferRulePayday(a: Pick<SafeToSpendAssembly, 'rules' | 'scheduledEvents' | 'liquidAccountIds' | 'cutoffDate'>): string | null {
  const incomeIds = new Set(
    a.rules.filter(r => r.active && r.rule_type === 'income' && (!r.deposit_account || a.liquidAccountIds.has(r.deposit_account))).map(r => r.id),
  );
  const future = a.scheduledEvents.filter(e => e.type === 'income' && e.ruleId && incomeIds.has(e.ruleId) && e.date > a.cutoffDate);
  if (future.length === 0) return null;
  const biggest = future.reduce((best, e) => (e.amount > best.amount ? e : best));
  const dates = future.filter(e => e.ruleId === biggest.ruleId).map(e => e.date).sort();
  return dates[0] ?? null;
}

/** Builds `computeSafeToSpend`'s input from the engine's own data. Returns null when it has none. */
export function assembleSafeToSpendInput(a: SafeToSpendAssembly): SafeToSpendInput | null {
  if (!a.month0) return null;
  const m = a.month0;
  const payday = a.profilePayday ?? inferRulePayday(a);
  // The payday rule (salary or inferred) never counts before payday: drop every paycheck rule.
  const paydayRuleIds = new Set(a.paycheckRuleIds);
  if (!a.profilePayday && payday) {
    for (const e of a.scheduledEvents) if (e.type === 'income' && e.date === payday && e.ruleId) paydayRuleIds.add(e.ruleId);
  }

  const ccSources = new Set<string>([...a.creditCardIds].flatMap(id => [id, `account:${id}`]));
  const ruleById = new Map(a.rules.map(r => [r.id, r]));
  const isCashOutflow = (r: SafeToSpendRule): boolean => {
    if (!r.active || r.rule_type !== 'expense') return false;
    if (r.payment_source && ccSources.has(r.payment_source)) return false; // charged to a card
    if (!r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category)) return false; // card by default
    if (r.payment_source && a.fundingAccountId && r.payment_source.replace(/^account:/, '') !== a.fundingAccountId) return false;
    if (a.pauseSavings && (r.category === 'Savings' || r.category === 'Investing')) return false;
    return true;
  };

  const events: DatedCashEvent[] = [];
  for (const e of a.scheduledEvents) {
    if (!e.ruleId || e.date <= a.cutoffDate) continue;
    const r = ruleById.get(e.ruleId);
    if (!r) continue;
    if (e.type === 'expense') {
      if (!isCashOutflow(r) || isRuleOccurrenceConfirmed(e.ruleId, e.date, a.confirmed)) continue;
      events.push({ date: e.date, amount: e.amount, direction: 'out', label: e.name });
    } else if (r.active && r.rule_type === 'income' && !paydayRuleIds.has(r.id)
      && (!r.deposit_account || a.liquidAccountIds.has(r.deposit_account))) {
      const tax = Number(r.tax_rate ?? 0) || 0;
      events.push({ date: e.date, amount: e.amount * (1 - tax / 100), direction: 'in', label: e.name });
    }
  }

  const next = nextMonthReservations(a.nextMonthTerms ?? [], a.monthZeroDate ?? a.cutoffDate, payday);
  events.push(...next.events);

  // Month 0's terms with per-item due days are dated (Sam 2026-10-01); the rest are reserved today.
  const byKind = (k: NextMonthTerm['kind']) => (a.monthZeroTerms ?? []).filter(t => t.kind === k);
  const zero = datedMonthZero([
    { total: m.transfers, items: byKind('transfer') },
    { total: m.carLoanPayment, items: byKind('car-loan') },
    { total: m.vehicleInsurance, items: byKind('insurance') },
    { total: m.otherDebtPayment, items: byKind('other-debt') },
    { total: m.planExpenses, items: byKind('plan') },
    { total: m.cyclingPayment + a.cardMinimumReserve, items: byKind('card') },
  ], a.monthZeroDate ?? a.cutoffDate, a.cutoffDate);
  events.push(...zero.events);
  const undatedReserve = m.goalContributions + m.autoExtraReserve + m.carReserve
    + Math.max(0, -m.oneTimeNet) + zero.undatedReserve;

  // Past payday (Sam's condition 1): walk to the end of month 0, the month whose obligations the chain
  // above holds in full, with the paychecks from payday on. A payday NEXT month keeps horizon = payday:
  // next month's items after payday are not assembled, so walking further would read high.
  const end = monthEnd(a.monthZeroDate ?? a.cutoffDate);
  const horizon = payday && payday <= end ? end : payday ?? undefined;
  if (payday && horizon && horizon > payday) {
    for (const e of a.scheduledEvents) {
      if (e.type !== 'income' || !e.ruleId || !paydayRuleIds.has(e.ruleId) || e.date < payday || e.date > horizon) continue;
      const r = ruleById.get(e.ruleId);
      if (!r || !r.active || (r.deposit_account && !a.liquidAccountIds.has(r.deposit_account))) continue;
      const tax = Number(r.tax_rate ?? 0) || 0;
      events.push({ date: e.date, amount: e.amount * (1 - tax / 100), direction: 'in', label: e.name });
    }
    for (const p of a.profilePaychecks ?? []) {
      if (p.date >= payday && p.date <= horizon) events.push({ date: p.date, amount: p.net, direction: 'in', label: 'Paycheck' });
    }
  }

  return {
    cutoffDate: a.cutoffDate,
    payday,
    // With no chosen funding account the engine starts from total liquid cash (`useCardProjection`'s
    // `liquidCash` fallback), so only "no cash account at all" is the empty state.
    startBalance: a.fundingAccountId || a.liquidAccountIds.size > 0 ? m.fundingBalance - m.carSavedEarmark : null,
    undatedReserve,
    events,
    floor: a.floor,
    undatedNextMonth: next.undated,
    nextMonthFirst: nextMonthStart(a.monthZeroDate ?? a.cutoffDate),
    horizon,
  };
}
