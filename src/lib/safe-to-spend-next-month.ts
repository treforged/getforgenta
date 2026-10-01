/**
 * SAFE TO SPEND - NEXT MONTH'S ITEMS BEFORE AN EARLY PAYDAY (R-NOW26 (b); Sam's ruling, ask 938fb5db).
 *
 * When payday falls in the month after the sync cutoff, the walk in `computeSafeToSpend` must also
 * reserve that month's obligations that land on or before payday. Month 0's chain terms are not
 * enough: they describe THIS month only.
 *
 * THE RULE (Sam, 2026-10-01): date everything that has a real due day, exactly. A car loan due on
 * the 20th is NOT reserved before a payday on the 2nd. Anything with NO due date is reserved on day 1
 * of its month - so the residue can only read LOW, never high - and is listed so the drawer can say
 * which items to give a due date. Goal contributions are reserved in full on day 1 but are not listed:
 * a goal has no due-date field, so "add one" would be advice the user cannot follow.
 *
 * Other debts are dated by their account's `payment_due_day` and payment plans by their own payment
 * dates (ask 66279032) - both fields already exist, so the only undated debt is one whose account has
 * no due day set, and that one the user CAN fix on the account's edit screen.
 *
 * Pure string arithmetic on 'YYYY-MM-DD'. No Date objects, so no time-zone drift.
 */
import type { DatedCashEvent } from '@/lib/safe-to-spend';
import { listDebtServiceLiabilities, projectLiabilityBalances, isOtherDebtPaymentOwed } from '@/lib/non-cc-liabilities';
import { getPaymentDates, type PaymentPlan } from '@/lib/payment-plan-generator';

export type NextMonthTermKind = 'transfer' | 'goal' | 'car-loan' | 'insurance' | 'other-debt' | 'plan' | 'card';

export interface NextMonthTerm {
  label: string;
  /** Dollars, positive. Non-positive or non-finite amounts are ignored. */
  amount: number;
  /** Day of month 1-31, or null when the item has no due date. Past the month's end clamps to the last day. */
  dueDay: number | null;
  kind: NextMonthTermKind;
  /** App route to edit this item, or null. */
  editPath: string | null;
}

export interface UndatedNextMonthItem {
  label: string;
  amount: number;
  kind: NextMonthTermKind;
  editPath: string | null;
}

export interface NextMonthTransferRule {
  name: string;
  amount: number | string;
  frequency: string;
  due_day: number | null;
  start_date: string | null;
  end_date: string | null;
  payment_source: string | null;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

function ym(date: string): { y: number; m: number } {
  const [y, m] = date.split('-').map(Number);
  return { y, m };
}

function following(y: number, m: number): { y: number; m: number } {
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** Day of week, 0 = Sunday (Sakamoto). */
function weekday(y: number, m: number, d: number): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const yy = m < 3 ? y - 1 : y;
  return (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m - 1] + d) % 7;
}

/** 'YYYY-MM-01' of the calendar month after `cutoffDate`. December rolls to January. */
export function nextMonthStart(cutoffDate: string): string {
  const { y, m } = ym(cutoffDate);
  const n = following(y, m);
  return `${pad(n.y, 4)}-${pad(n.m)}-01`;
}

/**
 * Dated outflows for next month's terms that land on or before payday, plus the undated ones to list.
 * `cutoffDate` here is any date in the ENGINE's month 0 (pass today, not the sync cutoff - see
 * `SafeToSpendAssembly.monthZeroDate`). Empty unless payday falls in EXACTLY the following month:
 * a payday this month needs nothing,
 * and a payday two or more months out is not handled (no pay schedule here produces one).
 */
export function nextMonthReservations(
  terms: readonly NextMonthTerm[], cutoffDate: string, payday: string | null,
): { events: DatedCashEvent[]; undated: UndatedNextMonthItem[] } {
  const events: DatedCashEvent[] = [];
  const undated: UndatedNextMonthItem[] = [];
  if (!payday) return { events, undated };
  const c = ym(cutoffDate);
  const n = following(c.y, c.m);
  const p = ym(payday);
  if (p.y !== n.y || p.m !== n.m) return { events, undated };

  const last = daysInMonth(n.y, n.m);
  for (const term of terms) {
    if (!(term.amount > 0) || !isFinite(term.amount)) continue;
    const day = term.dueDay === null ? 1 : Math.min(Math.max(Math.trunc(term.dueDay), 1), last);
    const date = `${pad(n.y, 4)}-${pad(n.m)}-${pad(day)}`;
    if (date > payday) continue;
    events.push({ date, amount: term.amount, direction: 'out', label: term.label });
    if (term.dueDay === null && term.kind !== 'goal') {
      undated.push({ label: term.label, amount: term.amount, kind: term.kind, editPath: term.editPath });
    }
  }
  return { events, undated };
}

/**
 * Transfer rules as terms for the month starting at `monthStart`. A transfer whose source is a
 * non-cash account never touches checking, so it is skipped (mirrors the engine's month-0 loop).
 */
export function transferTerms(
  rules: readonly NextMonthTransferRule[], monthStart: string, cashSourceIds: ReadonlySet<string>,
): NextMonthTerm[] {
  const { y, m } = ym(monthStart);
  const last = daysInMonth(y, m);
  const monthEnd = `${pad(y, 4)}-${pad(m)}-${pad(last)}`;
  const terms: NextMonthTerm[] = [];
  const term = (amount: number, dueDay: number | null, name: string): NextMonthTerm =>
    ({ label: name, amount, dueDay, kind: 'transfer', editPath: '/budget' });

  for (const r of rules) {
    if (r.start_date && r.start_date > monthEnd) continue;
    if (r.end_date && r.end_date < monthStart) continue;
    if (r.payment_source && !cashSourceIds.has(r.payment_source.replace(/^account:/, ''))) continue;
    const amount = Number(r.amount);
    if (!(amount > 0)) continue;
    if (r.frequency === 'monthly') {
      terms.push(term(amount, r.due_day || 1, r.name));
    } else if (r.frequency === 'weekly') {
      const dow = r.due_day ?? 5;
      for (let d = 1; d <= last; d++) if (weekday(y, m, d) === dow) terms.push(term(amount, d, r.name));
    } else if (r.frequency === 'yearly') {
      terms.push(term(amount / 12, null, r.name));
    } else {
      // biweekly and anything else: the full amount, undated (engine parity: at most once a month).
      terms.push(term(amount, null, r.name));
    }
  }
  return terms;
}

/** The raw next-month figures the hook can read, before they become terms. */
export interface NextMonthTermSources {
  /** 'YYYY-MM-01' of the month the terms describe. */
  monthStart: string;
  transferRules: readonly NextMonthTransferRule[];
  /** Ids of cash accounts a transfer may draw from. */
  cashSourceIds: ReadonlySet<string>;
  /** Monthly total; goals have no due-date field. */
  goalContributions: number;
  /** One per non-card debt still owed that month; `dueDay` is its account's `payment_due_day`. */
  otherDebts: readonly { label: string; amount: number; dueDay: number | null }[];
  /** One per cash payment-plan installment that month, dated by the plan's own schedule. */
  planPayments: readonly { label: string; amount: number; date: string }[];
  /** One per active car loan; the due day is `paymentStartDate`'s day of month. */
  carLoans: readonly { label: string; amount: number; paymentStartDate: string | null }[];
  /** One per insured car; the due day is `anchorDate`'s day of month. */
  carInsurance: readonly { label: string; amount: number; anchorDate: string | null }[];
  /** One per card: its payment due that month (contract minimum, or the statement on a card paid in full). */
  cards: readonly { label: string; amount: number; dueDay: number | null }[];
}

const dayOf = (date: string | null): number | null => {
  const d = date ? Number(date.slice(8, 10)) : NaN;
  return d >= 1 && d <= 31 ? d : null;
};

/** Every next-month chain term, dated where the data carries a due day. */
export function buildNextMonthTerms(s: NextMonthTermSources): NextMonthTerm[] {
  return [
    ...transferTerms(s.transferRules, s.monthStart, s.cashSourceIds),
    { label: 'Savings goal contributions', amount: s.goalContributions, dueDay: null, kind: 'goal', editPath: '/goals' },
    ...s.carLoans.map((c): NextMonthTerm =>
      ({ label: c.label, amount: c.amount, dueDay: dayOf(c.paymentStartDate), kind: 'car-loan', editPath: '/car-fund' })),
    ...s.carInsurance.map((c): NextMonthTerm =>
      ({ label: c.label, amount: c.amount, dueDay: dayOf(c.anchorDate), kind: 'insurance', editPath: '/car-fund' })),
    ...s.cards.map((c): NextMonthTerm =>
      ({ label: c.label, amount: c.amount, dueDay: c.dueDay, kind: 'card', editPath: '/accounts' })),
    ...s.otherDebts.map((d): NextMonthTerm =>
      ({ label: d.label, amount: d.amount, dueDay: d.dueDay, kind: 'other-debt', editPath: '/accounts' })),
    ...s.planPayments.map((pp): NextMonthTerm =>
      ({ label: pp.label, amount: pp.amount, dueDay: dayOf(pp.date), kind: 'plan', editPath: '/debt' })),
  ];
}

/**
 * Non-card debts owed in the month after month 0, with the engine's own selection: liability accounts
 * paired with `debts` rows (`listDebtServiceLiabilities`), a debt paid by a same-named expense rule
 * left to that rule (it is already a dated rule event), and a debt projected paid off by then dropped.
 */
export function nextMonthOtherDebts(params: Parameters<typeof listDebtServiceLiabilities>[0], month = 1):
  NextMonthTermSources['otherDebts'] {
  return listDebtServiceLiabilities(params)
    .filter(l => !l.paidByExpenseRule && l.payment > 0
      && isOtherDebtPaymentOwed(l, projectLiabilityBalances(l.balance, l.apr, l.amortizingPayment, month + 2), month))
    .map(l => ({ label: l.name, amount: l.payment, dueDay: l.dueDay }));
}

/** Cash payment-plan installments in `monthKey` ('YYYY-MM'). Same filter as `getMonthlyPlanCashExpenses`. */
export function nextMonthPlanPayments(
  plans: readonly PaymentPlan[], monthKey: string, cardSources: ReadonlySet<string>,
): NextMonthTermSources['planPayments'] {
  return plans
    .filter(pl => pl.active && !(pl.payment_source && cardSources.has(pl.payment_source)))
    .flatMap(pl => getPaymentDates(pl.start_date, pl.frequency, pl.total_payments)
      .filter(d => d.startsWith(monthKey))
      .map(d => ({ label: pl.name, amount: Number(pl.payment_amount), date: d })));
}

/** One month-0 chain term: the engine's total, and the items that make it up where the data has them. */
export interface MonthZeroComponent {
  /** The engine's month-0 total for this term (`month0.chain`). The amount authority. */
  total: number;
  /** Per-item breakdown; may be empty when the data model has none. */
  items: readonly NextMonthTerm[];
}

function dayAfter(date: string): string {
  const { y, m } = ym(date);
  const d = Number(date.slice(8, 10));
  if (d < daysInMonth(y, m)) return `${pad(y, 4)}-${pad(m)}-${pad(d + 1)}`;
  const n = following(y, m);
  return `${pad(n.y, 4)}-${pad(n.m)}-01`;
}

/**
 * MONTH 0, DATED (Sam 2026-10-01, extending 938fb5db): month 0's chain terms used to be reserved in full
 * today, so a user paid tomorrow read "$0" whenever the month's cards, loans and goals outweighed cash.
 *
 * Per component, the items are dated ONLY when they add up to the engine's total within $1. Otherwise the
 * whole total stays undated (reserved today). The engine's total already excludes what the bank shows as
 * paid, so this can never read HIGH (an item the engine still counts is never dropped) and never double.
 *
 * ⚠️ A due day already PASSED this month (on or before the cutoff) is still in the engine's total, so it
 * is still owed: it is reserved on the day after the cutoff, never moved to next month (Sam's edge case 2).
 * An item with no due day is reserved today too.
 */
export function datedMonthZero(
  components: readonly MonthZeroComponent[], monthZeroDate: string, cutoffDate: string,
): { events: DatedCashEvent[]; undatedReserve: number } {
  const events: DatedCashEvent[] = [];
  let undatedReserve = 0;
  const { y, m } = ym(monthZeroDate);
  const last = daysInMonth(y, m);
  const firstOpen = dayAfter(cutoffDate);
  for (const c of components) {
    const total = c.total > 0 && isFinite(c.total) ? c.total : 0;
    if (total === 0) continue;
    const items = c.items.filter(i => i.amount > 0 && isFinite(i.amount));
    const sum = items.reduce((s, i) => s + i.amount, 0);
    if (items.length === 0 || Math.abs(sum - total) > 1) { undatedReserve += total; continue; }
    for (const i of items) {
      if (i.dueDay === null) { undatedReserve += i.amount; continue; }
      const day = Math.min(Math.max(Math.trunc(i.dueDay), 1), last);
      const due = `${pad(y, 4)}-${pad(m)}-${pad(day)}`;
      events.push({ date: due < firstOpen ? firstOpen : due, amount: i.amount, direction: 'out', label: i.label });
    }
  }
  return { events, undatedReserve };
}

/** The projection maps the card split reads (`CardProjectionResult` fields). */
export interface CardSplitInput {
  simCards: readonly { id: string; name: string; dueDay?: number | null }[];
  monthlyRevolvingBalances: ReadonlyMap<string, readonly number[]>;
  perCardMinPayments: ReadonlyMap<string, readonly number[]>;
  perCardPayments: readonly { id: string; payments: readonly number[] }[];
}

/**
 * Each card's payment owed in month `idx`, split exactly as the engine splits it (useCardProjection's
 * debtPaymentTotals / cyclingPayment): a card still revolving at the START of the month owes its contract
 * minimum (the rest is the discretionary Safe to Pay); any other card's whole sim payment is its
 * statement. Month 0 reads end-of-month 0, as the engine does.
 * ⚠️ NOT `monthlyMandatoryCyclingPayment`: it read $0 for Tre's Robinhood card while the engine
 * reserved its $841 statement (9be90af5), so the items never matched the total.
 */
export function cardTermsFor(p: CardSplitInput, idx: number): NextMonthTermSources['cards'] {
  return p.simCards.map(c => {
    const revs = p.monthlyRevolvingBalances.get(c.id);
    const startRev = (idx === 0 ? revs?.[0] : revs?.[idx - 1]) ?? 0;
    const amount = startRev > 0
      ? (p.perCardMinPayments.get(c.id)?.[idx] ?? 0)
      : (p.perCardPayments.find(pc => pc.id === c.id)?.payments[idx] ?? 0);
    return { label: `${c.name} payment`, amount, dueDay: c.dueDay ?? null };
  });
}
