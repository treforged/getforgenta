/**
 * §1B — the real payment, shown in place of the projection it answered.
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────
 * Tre, 2026-08-24: "if a transaction matches a budget rule, the real transaction date and costs
 * should auto override the transaction for that month. the real one should actually show."
 * `buildMatchedOccurrenceIndex` (`auto-matched-occurrences.ts`) found the real charge and kept it.
 * This is the half that renders it: given that index, a projected occurrence either keeps its rule's
 * predicted date and amount, or is replaced by what actually left the account.
 *
 * ⚠️ RENDER ONLY. NOTHING HERE MAY REACH AN ENGINE. The forecast, the card projection and the
 * min-safe-cash floor all SUPPRESS a matched occurrence rather than substituting it, and that is
 * correct: the real charge is already inside the synced balance those engines start from, so adding
 * it back would charge the same dollars twice. See `docs/1B-transaction-review-plan.md` risk 2.
 * Every function in this file returns something a person looks at.
 *
 * ⚠️ THE SIGN FLIP IS DELIBERATE AND LIVES IN ONE PLACE. `MatchedOccurrence.actualAmount` is
 * `synced_transactions.amount`, OUTFLOW POSITIVE (a $1,200 rent debit is `+1200`).
 * `EnrichedTransaction.amount` and `ScheduledEvent.amount` are magnitudes whose direction is carried
 * by `type`. `realDisplayAmount` is the only conversion, and it refuses rather than guesses when the
 * two disagree — the header of `auto-matched-occurrences.ts` warns that a silent flip renders a rent
 * payment as income.
 *
 * Pure: no database, no clock. The month arrives as an argument.
 */

import type { MatchedOccurrence, MatchedOccurrenceIndex } from './auto-matched-occurrences';
import { getRuleOccurrenceDatesInMonth, type EnrichedTransaction } from './pay-schedule';
import type { ScheduledEvent } from './scheduling';

/** Stable key for one rule occurrence — must match `confirmed-capture.ts`'s `occurrenceKey`. */
function occurrenceKey(ruleId: string, scope: string): string {
  return `${ruleId}|${scope}`;
}

/**
 * The real payment that answered this occurrence, or undefined.
 *
 * Probes the exact-occurrence key first and the legacy month key second, exactly as
 * `isRuleOccurrenceConfirmed` does, so the two views of the same key space can never disagree about
 * which occurrences are handled. A month-keyed entry is always suppress-only (it names every
 * occurrence in the month at once, so no single date or amount belongs to it), which is why a
 * caller that finds one must drop the projection rather than draw figures on it.
 */
export function lookupMatchedOccurrence(
  index: MatchedOccurrenceIndex,
  ruleId: string | null | undefined,
  date: string | null | undefined,
): MatchedOccurrence | undefined {
  if (index.size === 0 || !ruleId || !date) return undefined;
  return index.get(occurrenceKey(ruleId, date)) ?? index.get(occurrenceKey(ruleId, date.slice(0, 7)));
}

/**
 * A matched charge in the display convention — a positive magnitude, direction carried by `type`.
 *
 * NULL WHEN THE DIRECTION CONTRADICTS THE OCCURRENCE, and the caller must then leave the projection
 * exactly as it was. Only outflow rules auto-match, so the matcher itself cannot produce this; a
 * confirmed review pointing an income rule at a debit (or the reverse) can. A refund is not evidence
 * that a bill was paid, and rendering one as though it were would turn an expense row into income.
 */
export function realDisplayAmount(type: string, actualAmount: number): number | null {
  if (!Number.isFinite(actualAmount) || actualAmount === 0) return null;
  const magnitude = type === 'income' ? -actualAmount : actualAmount;
  return magnitude > 0 ? magnitude : null;
}

/** The rule fields the month walk below reads. Structural, so `RuleRow` and Budget Control's own row type both satisfy it. */
export type MatchableScheduleRule = {
  id: string;
  amount: number | string;
  rule_type: string;
  frequency: string;
  due_day?: number | null;
  due_month?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
};

/** Where this rule's occurrences land in this month — the app's one definition, borrowed not copied. */
function occurrenceDatesIn(rule: MatchableScheduleRule, year: number, month: number): string[] {
  return getRuleOccurrenceDatesInMonth({
    frequency: rule.frequency,
    due_day: rule.due_day ?? 1,
    due_month: rule.due_month ?? null,
    start_date: rule.start_date ?? null,
    end_date: rule.end_date ?? null,
    created_at: rule.created_at ?? undefined,
  }, year, month);
}

/** A scheduled occurrence, plus what really paid it when something did. */
export interface SettledScheduledEvent extends ScheduledEvent {
  /** `YYYY-MM-DD` the money actually moved. Present only on a substituted event. */
  settledDate?: string;
  /** The rule's predicted amount, kept so a surface can say what it replaced. */
  projectedAmount?: number;
}

/**
 * Scheduled occurrences with the ones a real payment already answered rewritten or removed.
 *
 * Dashboard's "Upcoming This Week" had no suppression at all until now: a bill paid on the 3rd went
 * on being listed as still upcoming for as long as its due date was in the window, which is the
 * plainest possible version of the bug this workstream exists to fix.
 *
 * THREE OUTCOMES, and the middle one is the point:
 *   - no match: the event is returned untouched, by identity.
 *   - a valued match: the event takes the REAL date and the REAL amount. It is deliberately NOT
 *     dropped — Tre asked for the real one to show — and because the substituted date is the day the
 *     money actually moved, an ordinary "paid early" bill then falls out of the caller's own upcoming
 *     window on its own, while one settling later in the week stays and shows what it really cost.
 *   - a suppress-only match, or a real charge whose direction contradicts the occurrence: the event
 *     is DROPPED. The occurrence is handled either way, so listing it as upcoming would be false;
 *     there are simply no figures to put on it, and this file invents none.
 *
 * Events with no `ruleId` (card payments, vehicle obligations, plan installments) pass through
 * untouched: they are not rule occurrences and this index does not key them.
 */
export function substituteSettledOccurrences<T extends ScheduledEvent>(
  events: readonly T[],
  index: MatchedOccurrenceIndex,
): (T & SettledScheduledEvent)[] {
  if (index.size === 0) return events as (T & SettledScheduledEvent)[];
  const out: (T & SettledScheduledEvent)[] = [];
  for (const event of events) {
    const match = lookupMatchedOccurrence(index, event.ruleId, event.date);
    if (!match) { out.push(event); continue; }
    if (match.suppressOnly) continue;
    const amount = realDisplayAmount(event.type, match.actualAmount);
    if (amount === null) continue;
    out.push({
      ...event,
      date: match.actualDate,
      amount,
      settledDate: match.actualDate,
      projectedAmount: event.amount,
    });
  }
  return out;
}

/** The rule and occurrence a generated ledger row names, or null when the row is not one. */
function generatedOccurrence(t: EnrichedTransaction): { ruleId: string; occurrenceDate: string } | null {
  // `gen:<ruleId>:<YYYY-MM-DD>` is the only place a row in the merged stream still knows which rule
  // produced it, and a uuid contains no `:` — the same parse `isOccurrenceConfirmed` makes.
  if (!t.isGenerated || !t.id) return null;
  const parts = t.id.split(':');
  if (parts.length !== 3 || parts[0] !== 'gen') return null;
  return { ruleId: parts[1], occurrenceDate: parts[2] };
}

/** Do two `YYYY-MM-DD` dates fall in the same calendar month? */
function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/**
 * A transaction ledger with each generated occurrence a real bank charge answered showing that
 * charge's date and amount instead of the rule's prediction.
 *
 * ⚠️ REAL LEDGER ROWS ARE A SEPARATE MECHANISM AND ARE NOT TOUCHED HERE. A row the user typed into
 * `public.transactions` already retires its projection inside `mergeWithGeneratedTransactions`
 * (PASS 2, `overridesGeneratedOccurrence`). This is the other source of truth: a settled
 * `synced_transactions` row, which never enters the ledger stream at all, so its projection survived
 * that merge and is still standing here at the rule's predicted figures.
 *
 * ⚠️ THE ROW STAYS IN THE MONTH OF THE OBLIGATION. The matcher's window reaches five days either
 * side, so an occurrence near a month boundary can be answered by a charge in the neighbouring
 * month; moving the row there would take a bill out of the month the user is looking at and stand it
 * beside that month's own projection. The displayed date is always the real one — surfaces read
 * `matchedActualDate` — but the sort and month-filter key only follows it within the same month.
 *
 * Suppression is NOT this function's job: a suppress-only entry (a legacy month-keyed confirmation,
 * or one whose transaction is not loaded) leaves the projected row exactly as it was, because
 * deleting a ledger row while having no figures to put in its place would take information away.
 */
export function substituteMatchedLedgerRows(
  txns: readonly EnrichedTransaction[],
  index: MatchedOccurrenceIndex,
): EnrichedTransaction[] {
  if (index.size === 0) return [...txns];
  return txns.map(t => {
    const occurrence = generatedOccurrence(t);
    if (!occurrence) return t;
    const match = lookupMatchedOccurrence(index, occurrence.ruleId, occurrence.occurrenceDate);
    if (!match || match.suppressOnly) return t;
    const amount = realDisplayAmount(t.type, match.actualAmount);
    if (amount === null) return t;
    return {
      ...t,
      date: sameMonth(match.actualDate, occurrence.occurrenceDate) ? match.actualDate : occurrence.occurrenceDate,
      amount,
      matchedActualDate: match.actualDate,
      matchedProjectedAmount: t.amount,
    };
  });
}

/**
 * How far a rule's projected month total moves once the occurrences a real payment answered are
 * counted at what really left the account. Zero when nothing matched.
 *
 * ADDITIVE BY CONSTRUCTION, and that is why it is a delta rather than a replacement total. Budget
 * Control's `toCurrentMonthAmount` has its own frequency arithmetic (a weekly rule's occurrences in
 * this month, a yearly rule's due month, the start-date guard); re-deriving the whole total from
 * occurrence dates would quietly change every unmatched rule's figure too. This only ever adds
 * `real − projected` for occurrences that genuinely matched, so a user with no bank connection sees
 * the same numbers as before, to the penny.
 */
export function matchedMonthAmountDelta(
  rule: MatchableScheduleRule,
  year: number,
  month: number, // 0-indexed
  index: MatchedOccurrenceIndex,
): number {
  if (index.size === 0) return 0;
  const projected = Number(rule.amount);
  if (!Number.isFinite(projected)) return 0;

  let delta = 0;
  for (const date of occurrenceDatesIn(rule, year, month)) {
    const match = lookupMatchedOccurrence(index, rule.id, date);
    if (!match || match.suppressOnly) continue;
    const real = realDisplayAmount(rule.rule_type === 'income' ? 'income' : 'expense', match.actualAmount);
    if (real === null) continue;
    delta += real - projected;
  }
  return delta;
}

/**
 * The rules with at least one occurrence in `monthKey` that a real transaction answered.
 *
 * ⚠️ THIS REPLACES A `matchOccurrence` LOOP, AND THE DIFFERENCE IS NOT COSMETIC. `matchOccurrence`
 * locates an occurrence from `due_day` alone, so it refuses `weekly` and `biweekly` outright (there
 * `due_day` is a day of the WEEK) — Tre's weekly paycheck and his biweekly Fuel rule could never
 * carry the badge, however plainly the bank showed them paid. The index is built from
 * `getRuleOccurrenceDatesInMonth`, the same calendar the forecast matches on, so every frequency is
 * badgeable with no tolerance loosened.
 *
 * MONTH-SCOPED, keeping the badge's existing meaning. Auto matches are already confined to the month
 * they were built for; confirmed reviews are not, so an occurrence from an earlier month is filtered
 * out here rather than badging a rule forever after one confirmation. A legacy `YYYY-MM` key
 * prefix-matches its own month and no other.
 */
export function matchedRuleIdsInMonth(index: MatchedOccurrenceIndex, monthKey: string): Set<string> {
  const ruleIds = new Set<string>();
  for (const match of index.values()) {
    if (match.occurrenceDate.startsWith(monthKey)) ruleIds.add(match.ruleId);
  }
  return ruleIds;
}
