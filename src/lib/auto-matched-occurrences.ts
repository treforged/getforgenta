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
  amountConfidence, matchCharge, normalizePaymentSource, ruleChargeAccountId,
  type MatchableRule, type MatchableTransaction, type MatchConfidence,
} from './transaction-matching';
import { getRuleOccurrenceDatesInMonth } from './pay-schedule';
import type { ConfirmedOccurrences, RuleOccurrenceReview } from './confirmed-capture';

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
 * The merchant a bank row names, or null when it names nobody.
 *
 * `merchant_name` is Plaid's cleaned-up counterparty and `name` is the raw descriptor, so the
 * cleaned one wins where it exists. An empty string is null, never a label: a blank chip reads as a
 * merchant called "" rather than as an absent one.
 */
function merchantOf(txn: MatchableTransaction): string | null {
  const merchant = (txn.merchant_name ?? '').trim();
  if (merchant) return merchant;
  const name = (txn.name ?? '').trim();
  return name || null;
}

/** Whether a match came from the matcher or from the person who paid the bill. */
export type MatchedOccurrenceSource = 'auto' | 'confirmed';

/**
 * One rule occurrence, and the real money that answered it.
 *
 * ⚠️ SIGN CONVENTION — READ BEFORE RENDERING. `actualAmount` is `synced_transactions.amount`
 * verbatim, which §1A Stage A normalizes to OUTFLOW POSITIVE and inflow negative (see
 * `MatchableTransaction.amount` in `transaction-matching.ts`): a $1,200 rent debit is `+1200` and a
 * refund is `-1200`. It is deliberately NOT re-signed to agree with `EnrichedTransaction.amount`,
 * which is always positive with direction carried by `type`. A consumer putting the two side by
 * side must convert on purpose, because a silent flip renders a rent payment as income.
 *
 * Every field here is copied from a row that exists. Nothing is derived, defaulted or rounded — if a
 * value is not available the entry is a {@link SuppressOnlyOccurrence} instead.
 */
export interface ValuedMatchedOccurrence {
  suppressOnly: false;
  ruleId: string;
  /** The PROJECTED occurrence this answers, `YYYY-MM-DD`. The right-hand half of the index key. */
  occurrenceDate: string;
  /** `synced_transactions.id`. */
  transactionId: string;
  /** When the money ACTUALLY moved, `YYYY-MM-DD`. This is the date Tre asked to see. */
  actualDate: string;
  /** What ACTUALLY moved. Outflow positive — see the sign note above. */
  actualAmount: number;
  /** Cleaned merchant, else the raw descriptor, else null. Never a placeholder. */
  merchantName: string | null;
  /**
   * How closely the real amount agrees with the rule's, on `matchCharge`'s scale.
   *
   * Null means NOT RATED, not "poor". A confirmed link is an assertion by the person who paid the
   * bill and this module does not overrule it — but where the amounts sit outside even the strong
   * band, or the rule is not among the ones handed in, there is no agreement to report and one will
   * not be invented.
   */
  confidence: MatchConfidence | null;
  source: MatchedOccurrenceSource;
}

/**
 * An occurrence known to be handled, whose real values are NOT available.
 *
 * The honest alternative to fabricating a date and an amount. Two things produce one: a legacy
 * month-keyed review, which names no single occurrence at all, and a review whose synced transaction
 * is not in the pool handed to this function (not loaded, or still pending and therefore not settled
 * evidence). Consumers must go on suppressing exactly as they do today and must render no figures.
 */
export interface SuppressOnlyOccurrence {
  suppressOnly: true;
  ruleId: string;
  /** `YYYY-MM-DD` for a date-keyed review, `YYYY-MM` for a legacy month-keyed one. */
  occurrenceDate: string;
  source: MatchedOccurrenceSource;
  /** Why there are no values. Never rendered; it exists so reading the index is not a guess. */
  reason: 'legacy_month_key' | 'transaction_unavailable' | 'transaction_pending';
}

export type MatchedOccurrence = ValuedMatchedOccurrence | SuppressOnlyOccurrence;

/**
 * Every handled occurrence, keyed exactly as `ConfirmedOccurrences` is.
 *
 * `new Set(index.keys())` is a `ConfirmedOccurrences`, so a consumer can suppress from the map and
 * read values from the same lookup instead of holding two structures that can disagree.
 */
export type MatchedOccurrenceIndex = ReadonlyMap<string, MatchedOccurrence>;

/**
 * Every auto-match in `month`, in claim order. The one computation behind both public views.
 *
 * `buildAutoMatchedOccurrences` is `keys of this`, so the Set and the Map cannot drift: there is no
 * second walk of the calendar and no second set of gates. Every guard the module header lists lives
 * here and nowhere else.
 */
function collectAutoMatches(p: BuildAutoMatchedParams): ValuedMatchedOccurrence[] {
  const { rules, transactions, month } = p;
  const matches: ValuedMatchedOccurrence[] = [];
  if (!transactions || transactions.length === 0 || rules.length === 0) return matches;

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
      matches.push({
        suppressOnly: false,
        ruleId: rule.id,
        occurrenceDate,
        transactionId: String(hit.txn.id),
        actualDate: hit.txn.date,
        actualAmount: Number(hit.txn.amount),
        merchantName: merchantOf(hit.txn),
        confidence: hit.confidence,
        source: 'auto',
      });
    }
  }

  return matches;
}

/**
 * The rule occurrences a settled bank transaction has already paid, this month.
 *
 * Returns the same shape `buildConfirmedOccurrences` does. Union the two — a manual confirmation
 * and an automatic match mean the same thing to every consumer, and a key present in both is
 * simply present.
 */
export function buildAutoMatchedOccurrences(p: BuildAutoMatchedParams): ConfirmedOccurrences {
  const matched = new Set<string>();
  for (const match of collectAutoMatches(p)) {
    matched.add(occurrenceKey(match.ruleId, match.occurrenceDate));
  }
  return matched;
}

export type BuildMatchedIndexParams = BuildAutoMatchedParams & {
  /**
   * `synced_transaction_reviews` rows, if the caller has them. The manual half.
   *
   * ⚠️ NOT MONTH-SCOPED, unlike the auto half, and the asymmetry is inherited rather than chosen:
   * `buildConfirmedOccurrences` has never filtered reviews by month either, because a confirmation
   * already names its own occurrence and consumers union the whole set. Every review handed in gets
   * an entry; only the matcher looks at `month`.
   */
  reviews?: readonly RuleOccurrenceReview[] | null;
};

/**
 * Every handled occurrence WITH the real transaction behind it — what actually got paid, and when.
 *
 * ⚠️ THIS IS THE VALUE-BEARING VIEW OF THE SAME COMPUTATION `buildAutoMatchedOccurrences` returns,
 * not a second matcher. That function was lossy by design: it answers "is this occurrence handled"
 * and throws the charge away, so every surface could only ever DELETE the projected row. Tre,
 * 2026-08-24: "if a transaction matches a budget rule, the real transaction date and costs should
 * auto override the transaction for that month. the real one should actually show." That needs the
 * charge, so this keeps it.
 *
 * ⚠️ PRECEDENCE, when a key is produced twice. A valued entry always beats a suppress-only one —
 * knowing the figures is strictly more than knowing the fact. Between two valued entries the
 * CONFIRMED one wins: a link the user asserted outranks one the matcher inferred, which is the
 * standing order in `confirmed-capture.ts`'s header.
 *
 * Pure, and additive: no existing caller changes, because no existing caller is asked to.
 */
export function buildMatchedOccurrenceIndex(p: BuildMatchedIndexParams): MatchedOccurrenceIndex {
  const index = new Map<string, MatchedOccurrence>();
  for (const match of collectAutoMatches(p)) {
    index.set(occurrenceKey(match.ruleId, match.occurrenceDate), match);
  }

  const { reviews, transactions, rules } = p;
  if (!reviews || reviews.length === 0) return index;

  const byId = new Map<string, MatchableTransaction>();
  for (const txn of transactions ?? []) byId.set(String(txn.id), txn);
  const ruleAmountById = new Map<string, number | string>();
  for (const rule of rules) if (rule.id) ruleAmountById.set(rule.id, rule.amount);

  for (const review of reviews) {
    // The same three gates `buildConfirmedOccurrences` applies, in the same order, so the two key
    // spaces stay identical. Anything it skips is skipped here.
    if (review.status !== 'linked_rule') continue;
    if (!review.rule_id || !review.occurrence_month) continue;

    const ruleId = review.rule_id;
    const scope = review.occurrence_date || review.occurrence_month;
    const key = occurrenceKey(ruleId, scope);
    const entry = resolveConfirmedOccurrence(review, ruleId, scope, byId, ruleAmountById);

    // A confirmed entry displaces an auto one only when it carries at least as much: values beat
    // the bare fact, and between two valued entries the human assertion is the better evidence.
    const existing = index.get(key);
    if (existing && existing.suppressOnly === false && entry.suppressOnly === true) continue;
    index.set(key, entry);
  }

  return index;
}

/**
 * One confirmed review, resolved to values where the evidence supports it and to a bare suppression
 * where it does not.
 *
 * SETTLED ONLY, matching `matchCharge`. `BankActivity.tsx` never offers a pending row for linking,
 * so a pending one here is already off the documented path — and a debit that can still be reversed
 * is exactly the provisional figure §1A stopped presenting as fact. It suppresses, as the review
 * says it should, but it contributes no numbers.
 */
function resolveConfirmedOccurrence(
  review: RuleOccurrenceReview,
  ruleId: string,
  scope: string,
  byId: ReadonlyMap<string, MatchableTransaction>,
  ruleAmountById: ReadonlyMap<string, number | string>,
): MatchedOccurrence {
  const bare = (reason: SuppressOnlyOccurrence['reason']): SuppressOnlyOccurrence =>
    ({ suppressOnly: true, ruleId, occurrenceDate: scope, source: 'confirmed', reason });

  // A month key names every occurrence in the month at once, so no single real date or amount can
  // belong to it. Suppression is all a legacy row was ever able to say.
  if (!review.occurrence_date) return bare('legacy_month_key');

  const txn = review.synced_transaction_id ? byId.get(String(review.synced_transaction_id)) : undefined;
  if (!txn) return bare('transaction_unavailable');
  if (txn.pending) return bare('transaction_pending');

  const actualAmount = Number(txn.amount);
  if (!txn.date || !Number.isFinite(actualAmount)) return bare('transaction_unavailable');

  const ruleAmount = ruleAmountById.get(ruleId);
  return {
    suppressOnly: false,
    ruleId,
    occurrenceDate: scope,
    transactionId: String(txn.id),
    actualDate: txn.date,
    actualAmount,
    merchantName: merchantOf(txn),
    confidence: ruleAmount === undefined ? null : amountConfidence(ruleAmount, actualAmount),
    source: 'confirmed',
  };
}

/** Union of a manual confirmation set and an automatic one. Both mean "already paid". */
export function mergeConfirmedOccurrences(
  ...sets: readonly ConfirmedOccurrences[]
): ConfirmedOccurrences {
  const out = new Set<string>();
  for (const set of sets) for (const key of set) out.add(key);
  return out;
}
