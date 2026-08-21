/**
 * A recurring bill paid EARLY, matched from the bank instead of waiting to be confirmed by hand.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 * `confirmed-capture.ts` says it in its own header: a bill due the 25th that the user actually
 * paid on the 5th is still charged against this month's remaining cash, because its DUE DATE has
 * not passed. Every other month-0 outflow in the app was moved off that date heuristic by §1A
 * ("settled transactions decide, the date heuristic is the fallback") — recurring-rule bills were
 * the one charge type §1A never reached. §1B Stage 4A gave them an escape hatch, but only a manual
 * one: the user has to open Bank Activity and confirm the link, for every bill, every month.
 *
 * This is the automatic half. It produces exactly the same `ConfirmedOccurrences` set a manual
 * confirmation produces, in the same key space, so nothing downstream changes at all — the
 * suppression path, the tests around it, and `isOccurrenceConfirmed` are all untouched. A caller
 * unions the two sets and the existing gate does the rest.
 *
 * ── WHY THIS IS ALLOWED TO ERR THE UNSAFE WAY ────────────────────────────────
 * Dropping an obligation RAISES projected cash, which is the dangerous direction, and it is why
 * Stage 4A was gated behind an explicit human assertion in the first place. What replaces that
 * assertion here is the same evidence standard the car-loan gate has run on since §1A, plus a
 * window that cannot reach a neighbouring occurrence:
 *
 *   1. SETTLED ONLY. `matchCharge` skips every pending row — a pending debit is the very guess §1A
 *      replaced, and it can still be reversed.
 *   2. FOUR HARD GATES. Same account, same direction, amount within max($0.05, 1%), and inside the
 *      window. Direction is a gate rather than a signal, so a refund can never satisfy a bill.
 *   3. EXACTLY ONE CANDIDATE. Two equally good matches claim nothing. A coin flip presented as
 *      evidence is worse than silence, and this codebase already paid to learn that on three
 *      identical $10 tolls in one day.
 *   4. THE WINDOW STOPS AT THE PREVIOUS OCCURRENCE. This is what makes "early" safe. A monthly
 *      bill's window opens the day after last month's occurrence; a weekly rule's opens seven days
 *      back. Last cycle's payment is structurally out of reach, so paying one month and skipping
 *      the next can never read as both being paid.
 *   5. ONE TRANSACTION, ONE CLAIM. A charge already claimed by an earlier occurrence is removed
 *      from the pool, so a single $200 debit cannot suppress two $200 occurrences.
 *   6. OUTFLOWS ONLY. Income rules are excluded — see `isOutflowRule` below.
 *
 * An empty `txns` produces an empty set, so a user whose bank is not connected, or whose backfill
 * has not landed, takes exactly the pre-existing path.
 *
 * Pure: no database, no clock. The month arrives as an argument.
 */

import {
  matchCharge, normalizePaymentSource, ruleChargeAccountId,
  type MatchableRule, type MatchableTransaction,
} from './transaction-matching';
import { getRuleOccurrenceDatesInMonth } from './pay-schedule';
import type { ConfirmedOccurrences } from './confirmed-capture';

/**
 * The `recurring_rules` columns this reads.
 *
 * `due_day` is optional here where `MatchableRule` has it required, because that is genuinely what
 * the app's `RuleRow` hands back — tightening it at this boundary would only force a cast at the
 * one call site and move the lie one layer up. A rule with no due day has no locatable occurrence,
 * `getRuleOccurrenceDatesInMonth` returns nothing for it, and it therefore matches nothing.
 */
export type AutoMatchableRule = Omit<MatchableRule, 'due_day' | 'payment_source'> & {
  id: string;
  due_day?: number | null;
  due_month?: number | null;
  payment_source?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string;
};

/**
 * Only money going OUT is auto-matched, and the asymmetry is deliberate.
 *
 * Suppressing an expense raises projected cash and needs every guard above. Suppressing an INCOME
 * occurrence lowers it — safe in itself — but income is not the problem being solved here, and a
 * paycheck's amount varies enough run to run that the 1% tolerance would miss most of them anyway,
 * producing a feature that silently works a third of the time. `pay-schedule.ts` already reconciles
 * income against real deposits by its own route.
 */
function isOutflowRule(rule: AutoMatchableRule): boolean {
  return rule.rule_type !== 'income';
}

/** The day after `date`, `YYYY-MM-DD`. */
function dayAfter(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

/** `date` minus `days`, `YYYY-MM-DD`. */
function daysBefore(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const prev = new Date(y, m - 1, d - days);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
}

/**
 * Where this occurrence's cycle begins — the day after the one before it.
 *
 * `previous` is the preceding occurrence IN THE SAME MONTH when there is one, which is what makes a
 * weekly rule's four windows disjoint. For the month's FIRST occurrence there is no such date, so
 * the window opens a conservative 27 days back: long enough to cover any month-long cycle, and
 * short enough that it can never reach a monthly rule's previous occurrence, which is at least 28
 * days away. A shorter cycle (weekly, biweekly) always has a same-month predecessor for every
 * occurrence but the first, and its first occurrence falls within 7 days of the month start, so 27
 * days back lands harmlessly before the rule's own history.
 */
function cycleStart(occurrenceDate: string, previous: string | undefined): string {
  return previous === undefined ? daysBefore(occurrenceDate, 27) : dayAfter(previous);
}

/** The narrow shape `ruleChargeAccountId` asks for, with this module's looser nullability filled in. */
function asMatchable(rule: AutoMatchableRule): Pick<MatchableRule, 'rule_type' | 'payment_source' | 'deposit_account'> {
  return {
    rule_type: rule.rule_type,
    payment_source: rule.payment_source ?? null,
    deposit_account: rule.deposit_account ?? null,
  };
}

/** Stable key for one rule occurrence — must match `confirmed-capture.ts`'s `occurrenceKey`. */
function occurrenceKey(ruleId: string, date: string): string {
  return `${ruleId}|${date}`;
}

export type BuildAutoMatchedParams = {
  rules: readonly AutoMatchableRule[];
  /** Every settled transaction available. Filtered here; never mutated. */
  transactions: readonly MatchableTransaction[] | null | undefined;
  /** The month to look at, as a local `Date`. Only its year and month are read. */
  month: Date;
};

/**
 * The rule occurrences a settled bank transaction has already paid, this month.
 *
 * Returns the same shape `buildConfirmedOccurrences` does. Union the two — a manual confirmation
 * and an automatic match mean the same thing to every consumer, and a key present in both is
 * simply present.
 */
export function buildAutoMatchedOccurrences(p: BuildAutoMatchedParams): ConfirmedOccurrences {
  const { rules, transactions, month } = p;
  const matched = new Set<string>();
  if (!transactions || transactions.length === 0 || rules.length === 0) return matched;

  const year = month.getFullYear();
  const monthIdx = month.getMonth();

  // One charge claims one occurrence. Removing a claimed transaction from the pool is what stops a
  // single $200 debit from suppressing two $200 occurrences of the same bill.
  const claimed = new Set<string>();
  const available = () => transactions.filter(t => !claimed.has(String(t.id)));

  for (const rule of rules) {
    if (rule.active === false) continue;
    if (!isOutflowRule(rule)) continue;
    if (!rule.id) continue;
    // An unattributed rule can never match: there is no account to look in.
    if (normalizePaymentSource(ruleChargeAccountId(asMatchable(rule))) === null) continue;

    // `getRuleOccurrenceDatesInMonth` is the app's ONE definition of where a rule's occurrences
    // land — phase-anchored for biweekly, bounded by start_date/end_date. Borrowing it rather than
    // re-deriving the calendar here is the same choice `matchRuleOnDates` documents.
    const dates = getRuleOccurrenceDatesInMonth({
      frequency: rule.frequency,
      due_day: rule.due_day ?? 1,
      due_month: rule.due_month ?? null,
      start_date: rule.start_date ?? null,
      end_date: rule.end_date ?? null,
      created_at: rule.created_at,
    }, year, monthIdx);
    let previous: string | undefined;
    for (const occurrenceDate of dates) {
      const hit = matchCharge({
        accountId: ruleChargeAccountId(asMatchable(rule)),
        amount: rule.amount,
        dueDate: occurrenceDate,
        isInflow: false,
        earliestDate: cycleStart(occurrenceDate, previous),
      }, available());
      previous = occurrenceDate;
      if (!hit) continue;
      claimed.add(String(hit.txn.id));
      matched.add(occurrenceKey(rule.id, occurrenceDate));
    }
  }

  return matched;
}

/** Union of a manual confirmation set and an automatic one. Both mean "already paid". */
export function mergeConfirmedOccurrences(
  ...sets: readonly ConfirmedOccurrences[]
): ConfirmedOccurrences {
  const out = new Set<string>();
  for (const set of sets) for (const key of set) out.add(key);
  return out;
}
