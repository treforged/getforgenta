// §1A Stage B — does a real settled transaction correspond to a recurring rule's occurrence?
//
// Pure, no I/O. Callers hand in the rule, the month, and the candidate transactions; this decides.
// It is the single definition of "matched", used by BOTH the /budget auto-matched badge and
// (Stage C) the forecast's captured-in-balance evidence, so those two surfaces cannot disagree
// about the same bill. Matches are derived at read time and never persisted — rules are edited
// constantly, and a stored match would need invalidating on every edit.
//
// DESIGN BIAS: silence over guesses.
//
// The badge is the only user-visible output, and a false positive reads as "this bill was paid"
// about money that never moved. A false negative reads as nothing at all, because an absent badge
// means "no information" — the matcher will have gaps for as long as backfill is incomplete. So
// every ambiguity below resolves to `null`, including "two candidates are equally good". Loosening
// a tolerance to raise the hit rate trades a harmless silence for a harmful assertion; the tests
// in `__tests__/transaction-matching.test.ts` exist to make that trade fail loudly.
//
// Grounded in Tre's real data (2026-08-07, 143 synced Discover rows):
//   - `recurring_rules.payment_source` holds a BARE `accounts.id` uuid on all 28 non-null rules,
//     and `synced_transactions.account_id` is the same id — so the account test is an id equality,
//     not the name comparison the plan doc sketched.
//   - Three separate $10.00 "CFX - E-PASS A/R" tolls posted on 2026-08-03. Identical amounts on
//     one day are ordinary on a card, which is why one-candidate-only is a hard rule and not a
//     defensive nicety.
//
// No fuzzy merchant-name scoring in v1. Account + amount + date already identify a recurring bill;
// name similarity is unpredictable, locale-sensitive, and hard to test, and it would mostly serve
// to rescue the ambiguous cases this file deliberately refuses.

import { dueDateInMonth, type CaptureEvidence } from './sync-cutoff';

/** A match this tight is to-the-penny; anything looser is `strong`. */
export const AMOUNT_EXACT_TOLERANCE = 0.01;

/**
 * The looser band, as a fraction of the rule amount — a variable bill (utilities) drifts
 * proportionally, not by a fixed number of dollars.
 *
 * PROPORTIONAL, not absolute, on purpose. An absolute floor of ~$1 was tried first and is wrong at
 * the small end: it makes a $10 rule accept a $10.75 coffee, and small discretionary charges are
 * exactly what fills a card. 1% keeps the band meaningful for a $1,200 rent ($12) while making it
 * essentially penny-tight for a $10 rule.
 */
export const AMOUNT_STRONG_TOLERANCE_PCT = 0.01;

/**
 * Floor under the proportional band, so a tiny rule still tolerates rounding rather than demanding
 * a bit-exact match. Small enough that it never spans two plausible charges.
 */
export const AMOUNT_STRONG_TOLERANCE_ABS = 0.05;

/**
 * Days either side of the due date a settled transaction may land and still count.
 *
 * Deliberately narrow. Widening it multiplies candidates, and more candidates means more
 * ambiguity, which under the one-candidate rule means FEWER matches, not more — the tuning knob
 * points the opposite way from the intuition.
 */
export const DATE_WINDOW_DAYS = 5;

/**
 * Frequencies whose occurrence THIS FUNCTION can locate from `due_day` alone.
 *
 * `weekly` and `biweekly` are excluded because `due_day` there is a day of WEEK, not a day of
 * month (`scheduling.ts:215`); reading it as a date would aim the window at an arbitrary day and
 * produce confident nonsense. `semi_monthly` is excluded because one `due_day` cannot describe its
 * two occurrences.
 *
 * ⚠️ THIS IS A LIMIT OF `matchOccurrence`, NOT OF THE MATCHER, and the difference matters. The
 * guard is correct — refusing to read a weekday as a day of the month is the only honest thing to
 * do here — but SKIPPING THE FREQUENCY was never the right outcome: it meant Tre's weekly paycheck
 * (30 settled rows in 8 months) and his biweekly `Fuel` rule could never be suggested at all.
 * `matchRuleOnDates` below is the way through: a caller that can generate the real occurrence dates
 * (`pay-schedule.ts`'s `getRuleOccurrenceDatesInMonth`, the app's one definition of where a rule's
 * occurrences land) hands them in and every frequency becomes matchable, with no tolerance loosened.
 */
const MATCHABLE_FREQUENCIES = new Set(['monthly', 'yearly']);

export type MatchConfidence = 'exact' | 'strong';

/** The fields of a `recurring_rules` row this matcher reads. */
export interface MatchableRule {
  id: string;
  /** `numeric` — arrives as a string from supabase-js. Always positive; direction comes from `rule_type`. */
  amount: number | string;
  due_day: number;
  /** 1-12, `yearly` rules only. */
  due_month?: number | null;
  frequency: string;
  rule_type: string;
  /** An `accounts.id`, bare or `account:`-prefixed. Null means unattributed. */
  payment_source: string | null;
  /**
   * Where an income rule's money LANDS — an `accounts.id`, bare or `account:`-prefixed.
   *
   * ⚠️ THIS IS WHY NO INCOME RULE COULD EVER MATCH. A bill names the account it is paid FROM in
   * `payment_source`; a paycheck names the account it is paid INTO, and the rule editor writes that
   * to `deposit_account` and leaves `payment_source` null (`BudgetControl.tsx:859`). Every income
   * rule Tre has therefore hit `matchCharge`'s `if (!accountId) return null` guard on its first
   * line — the weekly paycheck, 30 settled rows in 8 months, and the $1,100/mo from his girlfriend.
   * `pay-schedule.ts:1255` already reads the two columns this way round for income.
   */
  deposit_account?: string | null;
  active?: boolean;
}

/** The fields of a `synced_transactions` row this matcher reads. */
export interface MatchableTransaction {
  id: string;
  account_id: string | null;
  /** `numeric` — arrives as a string. Stage A normalizes to OUTFLOW POSITIVE, inflow negative. */
  amount: number | string;
  /** `YYYY-MM-DD`. */
  date: string;
  pending: boolean;
  name?: string | null;
  merchant_name?: string | null;
}

export interface OccurrenceMatch {
  txn: MatchableTransaction;
  confidence: MatchConfidence;
}

/**
 * The `accounts.id` a `payment_source` refers to, or null if it names no account.
 *
 * Live rows are bare uuids, but demo fixtures and four other call sites still carry the legacy
 * `account:` prefix, so both are accepted. Null and empty both mean unattributed — an empty string
 * must never be treated as an id that could equal something.
 */
export function normalizePaymentSource(src: string | null | undefined): string | null {
  if (!src) return null;
  const id = src.startsWith('account:') ? src.slice(8) : src;
  return id || null;
}

/**
 * The `accounts.id` a rule's money moves through, or null if the rule names none.
 *
 * ⚠️ THE DEPOSIT FALLBACK IS ADDITIVE AND ONLY FOR INCOME. `payment_source` still wins wherever it
 * is set, so no match that exists today can change; the fallback only reaches rules that had no
 * account at all and therefore matched nothing. Restricting it to `rule_type = 'income'` is
 * deliberate: on an expense rule `deposit_account` means "apply to / deposit into" — a transfer's
 * destination, not the account the charge posts against — and reading it as the charge account
 * would aim the window at the wrong side of the movement. `pay-schedule.ts:1255` makes the same
 * split, preferring `deposit_account` for income; it is only a preference there because both
 * columns can be set, and preferring it here would silently move existing matches.
 */
export function ruleChargeAccountId(rule: Pick<MatchableRule, 'rule_type' | 'payment_source' | 'deposit_account'>): string | null {
  const source = normalizePaymentSource(rule.payment_source);
  if (source) return source;
  return rule.rule_type === 'income' ? normalizePaymentSource(rule.deposit_account) : null;
}

/**
 * Days from `a` to `b`, both `YYYY-MM-DD`. Built from parts to stay in local time, as sync-cutoff does.
 *
 * Exported for `transfer-pair-detection.ts`, which asks the same "are these two dates close enough
 * to be one event" question about a different pair of rows. `new Date('YYYY-MM-DD')` is UTC
 * midnight and shifts a day in every US timezone, so a second implementation of this is a second
 * chance to reintroduce that bug in a file nobody is looking at.
 */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round(
    (new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86_400_000,
  );
}

/**
 * The rule's due date in `monthKey`, clamped into the month.
 *
 * `dueDateInMonth` pads without clamping, so due_day 31 in September yields "2026-09-31" — a
 * string that sorts fine but is not a date. That is harmless where the value is only ever
 * compared, but here it feeds day arithmetic, and an invalid date would make the window NaN and
 * silently match nothing all month.
 */
function occurrenceDate(monthKey: string, dueDay: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return dueDateInMonth(monthKey, Math.min(Math.max(dueDay, 1), lastDay));
}

/** How far a transaction amount may sit from the rule and still count as `strong`. */
function strongTolerance(ruleAmount: number): number {
  return Math.max(AMOUNT_STRONG_TOLERANCE_ABS, ruleAmount * AMOUNT_STRONG_TOLERANCE_PCT);
}

/**
 * How closely two amounts agree, or null when they are too far apart to be the same payment.
 *
 * Both arguments are read as MAGNITUDES; direction stays the caller's gate, exactly as it is inside
 * `matchCharge`. Zero and non-finite are refused rather than treated as a match — a missing amount
 * is no information, and this file never turns no information into an assertion.
 *
 * Exported so the ledger's occurrence substitution (`pay-schedule.ts`'s
 * `mergeWithGeneratedTransactions`) asks the SAME amount question the matcher asks. A second
 * tolerance written out longhand over there is a second number to drift, and the two surfaces would
 * then disagree about whether one real payment answers one projected bill.
 */
export function amountConfidence(target: number | string, actual: number | string): MatchConfidence | null {
  const want = Math.abs(Number(target));
  const got = Math.abs(Number(actual));
  if (!Number.isFinite(want) || !Number.isFinite(got) || want === 0 || got === 0) return null;
  const delta = Math.abs(got - want);
  if (delta > strongTolerance(want)) return null;
  return delta <= AMOUNT_EXACT_TOLERANCE ? 'exact' : 'strong';
}

/**
 * The settled transaction that corresponds to `rule`'s occurrence in `monthKey`, or null.
 *
 * Null means "no confident match" and must be presented as no information — never as evidence the
 * charge did not happen. Tests: account, then direction, then amount, then date; a candidate must
 * pass all four, and there must be exactly one best candidate.
 *
 * `txns` may be every transaction the user has; it is filtered here and never mutated.
 */
export function matchOccurrence(
  rule: MatchableRule,
  monthKey: string,
  txns: readonly MatchableTransaction[],
): OccurrenceMatch | null {
  if (rule.active === false) return null;
  if (!MATCHABLE_FREQUENCIES.has(rule.frequency)) return null;

  // A yearly rule occurs in exactly one month; in every other month there is no occurrence to
  // match, and matching one would badge a bill eleven months early.
  if (rule.frequency === 'yearly') {
    const month = Number(monthKey.split('-')[1]);
    if (month !== (rule.due_month ?? 1)) return null;
  }

  return matchCharge(ruleOccurrenceCharge(rule, occurrenceDate(monthKey, rule.due_day)), txns);
}

/** One occurrence of a rule, in the shape `matchCharge` asks about. */
function ruleOccurrenceCharge(rule: MatchableRule, dueDate: string): ChargeToMatch {
  return {
    accountId: ruleChargeAccountId(rule),
    amount: rule.amount,
    dueDate,
    isInflow: rule.rule_type === 'income',
  };
}

/** One of a rule's occurrences, and the settled transaction that corresponds to it. */
export interface RuleOccurrenceMatch extends OccurrenceMatch {
  /** The occurrence's own date, `YYYY-MM-DD` — which fill-up, which paycheck. */
  occurrenceDate: string;
}

/**
 * Every match among a rule's occurrences, one `matchCharge` call per date. §1B Stage 6.
 *
 * ⚠️ THE DATES COME FROM THE CALLER, and that is the whole point of the split. Locating a weekly or
 * biweekly rule's occurrences is scheduling's job — `pay-schedule.ts`'s
 * `getRuleOccurrenceDatesInMonth` is the app's ONE definition of where they land, phase-anchored for
 * biweekly and bounded by `start_date`/`end_date` — and importing it here would drag its whole
 * dependency tree (vehicle loans, confirmed capture) into what is deliberately a leaf module. So
 * this file keeps the matching and borrows the calendar.
 *
 * ⚠️ NOTHING IS LOOSENED. Each date is an ordinary `matchCharge` call, so every gate and the
 * one-candidate-only rule apply per occurrence exactly as before. Because matching runs from the
 * OBLIGATION side, one occurrence can claim at most one charge — the mirror ambiguity that
 * `bank-activity-queue.ts` guards against for ledger rows is structurally impossible here.
 *
 * A charge inside two occurrences' windows is possible in principle (a weekly rule's ±5 day windows
 * are 11 days wide and 7 apart), and is handled by the caller keeping the first claim: both
 * occurrences name the SAME rule, so the suggestion is the same either way.
 */
export function matchRuleOnDates(
  rule: MatchableRule,
  dates: readonly string[],
  txns: readonly MatchableTransaction[],
): RuleOccurrenceMatch[] {
  if (rule.active === false) return [];
  const matches: RuleOccurrenceMatch[] = [];
  for (const occurrenceDate of dates) {
    const match = matchCharge(ruleOccurrenceCharge(rule, occurrenceDate), txns);
    if (match) matches.push({ ...match, occurrenceDate });
  }
  return matches;
}

/**
 * One dated money movement to look for. §1A Stage C.
 *
 * Deliberately NOT a `recurring_rules` row. Stage C's capture gates ask this question about things
 * that are not rules at all — a car loan payment from a `car_funds` row, a card's minimum, an
 * upfront-plan installment — and forcing those through a rule-shaped API would mean inventing fake
 * rules at each call site. `matchOccurrence` is now the rule-shaped wrapper over this.
 */
export interface ChargeToMatch {
  /** An `accounts.id`, already normalized. Null means unattributed and can never match. */
  accountId: string | null;
  /** Always positive; direction comes from `isInflow`. */
  amount: number | string;
  /** `YYYY-MM-DD`. */
  dueDate: string;
  /** Default false — outflow, which is what every capture gate asks about. */
  isInflow?: boolean;
  /**
   * `YYYY-MM-DD`. The earliest date a payment for THIS occurrence could have been made — the day
   * after the previous occurrence. Absent ⇒ only the symmetric ±`DATE_WINDOW_DAYS` window applies,
   * which is every pre-existing caller, byte for byte.
   *
   * ⚠️ THIS IS NOT A LOOSER TOLERANCE, it is a differently-SHAPED one, and the distinction is the
   * reason it is a separate field rather than a bigger `DATE_WINDOW_DAYS`. A bill due the 25th and
   * actually paid on the 5th is twenty days early — far outside a ±5 day window built to ask "did
   * this post around when it was due". Widening that window globally would let a charge claim the
   * NEIGHBOURING occurrence of the same rule, which is the harmful assertion this module's header
   * refuses to trade silence for. Bounding the early side at the previous occurrence makes that
   * structurally impossible: the window can never reach back far enough to touch it.
   *
   * The late side is unchanged. A payment made AFTER its due date is a late payment, and there is
   * no reason to reach further forward than the settlement lag already allows.
   */
  earliestDate?: string;
}

/**
 * The settled transaction corresponding to `charge`, or null.
 *
 * Tests: account, then direction, then amount, then date; a candidate must pass all four, and
 * there must be exactly one best candidate. `txns` may be every transaction the user has; it is
 * filtered here and never mutated.
 */
export function matchCharge(
  charge: ChargeToMatch,
  txns: readonly MatchableTransaction[],
): OccurrenceMatch | null {
  const { accountId } = charge;
  if (!accountId) return null;

  const target = Math.abs(Number(charge.amount));
  if (!Number.isFinite(target) || target === 0) return null;

  const wantsInflow = charge.isInflow === true;

  const candidates: OccurrenceMatch[] = [];
  for (const txn of txns) {
    // Settled evidence only. A pending row is the very thing §1A replaces a guess about.
    if (txn.pending) continue;
    if (txn.account_id !== accountId) continue;

    const signed = Number(txn.amount);
    if (!Number.isFinite(signed) || signed === 0) continue;
    // Outflow positive (Stage A). Direction is a hard gate, not a scored signal: a -$1,000 card
    // payment must never satisfy a $1,000 expense.
    if (wantsInflow !== signed < 0) continue;

    const confidence = amountConfidence(target, signed);
    if (confidence === null) continue;

    // Either the symmetric settle-around-the-due-date window, or — when the caller has told us
    // where this occurrence's cycle begins — anywhere from that point up to the due date itself.
    const withinSettleWindow = Math.abs(daysBetween(charge.dueDate, txn.date)) <= DATE_WINDOW_DAYS;
    const paidEarlyThisCycle = charge.earliestDate !== undefined
      && txn.date >= charge.earliestDate && txn.date <= charge.dueDate;
    if (!withinSettleWindow && !paidEarlyThisCycle) continue;

    candidates.push({ txn, confidence });
  }

  // Exactly one candidate at the best available confidence, or nothing. Two equally good
  // candidates is a coin flip, and a coin flip presented as evidence is worse than silence — see
  // the three identical $10 tolls on one day in the real data.
  const exact = candidates.filter(c => c.confidence === 'exact');
  const best = exact.length > 0 ? exact : candidates;
  return best.length === 1 ? best[0] : null;
}

/**
 * Have settled transactions actually been observed across `dueDate`'s whole match window?
 *
 * This is the question that licenses concluding anything from an ABSENT match. Without it, an
 * account whose backfill has not arrived would report "no match" for every real bill it has, and
 * Stage C would read that as "none of these bills were paid" — confidently wrong in the direction
 * that overstates obligations across every surface at once.
 *
 * INFERRED FROM THE ROWS, not from a stored range: `synced_transactions` records no coverage
 * window and Plaid's cursor is opaque, so the observed min/max settled date per account is the
 * only honest signal available. It UNDER-claims — a sparse account with one transaction covers
 * almost nothing — and under-claiming just falls back to the date heuristic, which is the
 * pre-Stage-C behavior. Do not "improve" this by dropping the lower bound or by counting a
 * single row as a range; both trade a safe fallback for a confident assertion.
 *
 * The whole window (`± DATE_WINDOW_DAYS`) must be observed, not merely the due date, because a
 * bill due the 3rd can settle on the 6th and the sync may simply not have reached it yet.
 */
export function hasCoverage(
  accountId: string | null,
  dueDate: string,
  txns: readonly MatchableTransaction[],
): boolean {
  if (!accountId) return false;

  let earliest: string | null = null;
  let latest: string | null = null;
  for (const txn of txns) {
    // Pending rows are not settled evidence, so they must not stretch the observed range and let
    // an unmatched charge be declared "definitely has not hit".
    if (txn.pending) continue;
    if (txn.account_id !== accountId) continue;
    if (earliest === null || txn.date < earliest) earliest = txn.date;
    if (latest === null || txn.date > latest) latest = txn.date;
  }
  if (earliest === null || latest === null) return false;

  return daysBetween(earliest, dueDate) >= DATE_WINDOW_DAYS
    && daysBetween(dueDate, latest) >= DATE_WINDOW_DAYS;
}

/**
 * What settled transactions say about one charge, in the shape `isCapturedInBalance` consumes.
 *
 * The two booleans are not redundant. "No match" alone is ambiguous between "this did not happen"
 * and "we have not looked yet", and those demand opposite behavior from a capture gate — which is
 * precisely the distinction the pre-§1A date heuristic could never make.
 */
export function buildCaptureEvidence(
  charge: ChargeToMatch,
  txns: readonly MatchableTransaction[],
): CaptureEvidence {
  return {
    hasTxnCoverage: hasCoverage(charge.accountId, charge.dueDate, txns),
    matched: matchCharge(charge, txns) !== null,
  };
}
