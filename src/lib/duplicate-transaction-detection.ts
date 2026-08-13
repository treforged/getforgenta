/**
 * Did the user hand-enter a payment the app already generates?
 *
 * WHY THIS EXISTS. Tre's ledger carries a `transactions` row dated 2026-09-08 for $422.89, noted
 * `2004 Chevorlet C5 Payment (13/29)`, `origin = 'manual'` — while `car_funds` amortization
 * generates September's $422.89 car payment on its own. September is charged twice. That single
 * duplicated row is what drags Sep 2026 ending cash to ~$709 and trips the "Cash below safe
 * minimum" milestone; without it the month ends around $1,132. A milestone the user then plans
 * around, caused by a row they typed once and forgot.
 *
 * It is a data-entry trap, not a one-off. Every generator in this app — car-loan amortization,
 * payment-plan installments, recurring rules — emits rows that look exactly like something a person
 * would also type by hand, and NOTHING in the stream reconciles the two. So this module asks one
 * question of the whole ledger: is there a manual row that a generator already covers?
 *
 * ⚠️ IT NEVER RESOLVES THE COLLISION ITSELF. No auto-delete, no silent netting out. A second real
 * payment of the same amount in the same month is an ordinary thing (an extra principal payment, a
 * second installment paid early), and a session that quietly removed it would be destroying a true
 * record to make a number look right. The user decides which row is real; this file only makes the
 * collision visible, and remembers when they say "both are real".
 *
 * DESIGN BIAS, inherited from `transaction-matching.ts`: silence over guesses — but the direction
 * of harm is the opposite one here, so the tuning is too. There, a false positive asserted money
 * had moved. Here a warning asserts nothing; it asks. So the match is deliberately LOOSER than the
 * settled-transaction matcher (whole month, not a ±5-day window), because a hand-typed row rarely
 * lands on the generator's exact day — the September row is dated the 8th, the amortization row is
 * not. What keeps it from crying wolf is the one-to-one pairing below, not a tight window.
 */

import { generateMonthTransactionsFromRules, type EnrichedTransaction } from './pay-schedule';
import { generatePaymentPlanTransactions, type PaymentPlan } from './payment-plan-generator';
import { generateCarLoanTransactions } from './vehicle-loan-engine';
import type { CarFund } from './types';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';

/**
 * How far two amounts may sit apart and still be "the same payment", in dollars.
 *
 * A cent, per the brief. Absolute rather than proportional (the opposite of
 * `AMOUNT_STRONG_TOLERANCE_PCT`) because this is not a variable bill drifting — it is the same
 * scheduled figure entered twice, and the only gap that should ever appear is a rounding cent.
 */
export const DUPLICATE_AMOUNT_TOLERANCE = 0.01;

/** Float slack, so 422.89 − 422.88 = 0.010000000000019 still counts as a cent. */
const EPSILON = 1e-9;

/** Which generator produced the row a manual entry collided with. */
export type GeneratorKind = 'car_loan' | 'payment_plan' | 'recurring_rule';

export const GENERATOR_LABEL: Record<GeneratorKind, string> = {
  car_loan: 'car loan schedule',
  payment_plan: 'payment plan',
  recurring_rule: 'recurring rule',
};

/** One generated obligation, reduced to what the collision test reads. */
export interface GeneratedObligation {
  /** Stable across renders: `carloan:<fundId>:<i>`, `plan:<planId>:<i>`, `gen:<ruleId>:<date>`. */
  id: string;
  kind: GeneratorKind;
  /** `YYYY-MM-DD`. */
  date: string;
  type: string;
  amount: number;
  note: string;
  /** `account:<id>`, a bare id, or '' for unattributed. */
  payment_source: string;
}

/** One hand-entered row that might be a duplicate. */
export interface ManualTransaction {
  id: string;
  date: string;
  type: string;
  amount: number;
  note?: string | null;
  category?: string;
  payment_source?: string | null;
  /** `transactions.origin`. Anything other than 'manual' (i.e. 'synced') is never a candidate. */
  origin?: string | null;
}

/** A manual row and the generated row it appears to duplicate. */
export interface DuplicateCollision {
  /** Stable identity of THIS pair at THIS amount — the dismissal key. See {@link collisionKey}. */
  key: string;
  manual: ManualTransaction;
  generated: GeneratedObligation;
  /** `YYYY-MM`, the month charged twice. */
  monthKey: string;
  /** The manual row's amount — what the month is over-charged by if the manual row is not real. */
  amount: number;
}

const monthOf = (date: string): string => (date ?? '').slice(0, 7);

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The account an id or `account:`-prefixed source refers to, or '' for unattributed.
 *
 * Both forms are live in this codebase at once — `payment_plans.payment_source` is stored
 * prefixed, `accounts.id` is not — so comparing the raw strings would call two references to the
 * same account different accounts, and let a real duplicate through.
 */
export function normalizeSource(src: string | null | undefined): string {
  if (!src) return '';
  return src.startsWith('account:') ? src.slice(8) : src;
}

/**
 * The dismissal key for a pair.
 *
 * Carries the AMOUNT as well as the two ids, on purpose: if the user edits the manual row to a
 * different figure and later edits it back, that is a new decision about a different number and
 * deserves to be asked again. Ids alone would silence it forever after one dismissal.
 */
export function collisionKey(manualId: string, generatedId: string, amount: number): string {
  return `${manualId}|${generatedId}|${round2(amount).toFixed(2)}`;
}

/**
 * Could these two be the same payment?
 *
 * Four gates, all hard:
 * - same calendar month (the unit the double-charge actually shows up in);
 * - same direction — an income row never duplicates an expense;
 * - amount within a cent;
 * - same account, WHEN BOTH NAME ONE. If either side is unattributed the account test is skipped
 *   rather than failed: the September row that started all this carries no `payment_source` at all,
 *   and a gate that required one would miss the exact case this module exists for.
 */
function isSamePayment(manual: ManualTransaction, generated: GeneratedObligation): boolean {
  if (monthOf(manual.date) !== monthOf(generated.date)) return false;
  if (manual.type !== generated.type) return false;

  const a = Number(manual.amount);
  const b = Number(generated.amount);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (Math.abs(a - b) > DUPLICATE_AMOUNT_TOLERANCE + EPSILON) return false;

  const manualSource = normalizeSource(manual.payment_source);
  const generatedSource = normalizeSource(generated.payment_source);
  if (manualSource && generatedSource && manualSource !== generatedSource) return false;

  return true;
}

/**
 * Is this a real, hand-entered row that could collide?
 *
 * Synced bank rows are excluded: they are what DID happen, they live on the Bank Activity tab and
 * never enter the planning stream, so they cannot double-charge a forecast month. Generated rows
 * are excluded because they are the other half of the pair, and reconciliation rows because a
 * balance adjustment is not a payment.
 */
function isManualCandidate(t: ManualTransaction & Partial<EnrichedTransaction>): boolean {
  if (t.origin && t.origin !== 'manual') return false;
  if (t.isGenerated || t.isDebtPayment || t.isPlanPayment || t.isCarLoanPayment) return false;
  if (t.isReconciliation) return false;
  if (!t.date) return false;
  const amount = Number(t.amount);
  return Number.isFinite(amount) && amount > 0;
}

export interface CollectObligationsInput {
  rules: RuleRow[];
  accounts: AccountRow[];
  paymentPlans: PaymentPlan[];
  carFunds: CarFund[];
  /** `YYYY-MM` values to expand recurring rules over. Anything outside is not scanned. */
  months: readonly string[];
  /**
   * The real ledger, used ONLY to reproduce `mergeWithGeneratedTransactions`'s substitution rule —
   * see below. Not scanned for candidates here.
   */
  realTransactions?: readonly ManualTransaction[];
}

/**
 * Every generated obligation the three generators emit, in the months asked for.
 *
 * ⚠️ RULE OCCURRENCES ARE SUPPRESSED WHEN THE STREAM ALREADY SUBSTITUTES THEM. `pay-schedule`'s
 * `mergeWithGeneratedTransactions` drops a generated rule occurrence whose `date:note:amount`
 * exactly equals a real row's — the real row REPLACES it, so nothing is double-counted and there is
 * nothing to warn about. Warning there would flag the app's own working substitution as a bug.
 * Car-loan and plan rows have no such rule: they are appended unconditionally, which is precisely
 * why the car case double-charges and the rule case usually does not.
 */
export function collectGeneratedObligations(input: CollectObligationsInput): GeneratedObligation[] {
  const { rules, accounts, paymentPlans, carFunds, months, realTransactions = [] } = input;
  const monthSet = new Set(months);
  const out: GeneratedObligation[] = [];

  const substituted = new Set(
    realTransactions.map(t => `${t.date}:${t.note ?? ''}:${Number(t.amount)}`),
  );

  for (const monthKey of monthSet) {
    const [year, month] = monthKey.split('-').map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue;
    for (const g of generateMonthTransactionsFromRules(rules, accounts, year, month - 1)) {
      if (substituted.has(`${g.date}:${g.note ?? ''}:${Number(g.amount)}`)) continue;
      out.push({
        id: g.id,
        kind: 'recurring_rule',
        date: g.date,
        type: g.type,
        amount: Number(g.amount),
        note: g.note ?? '',
        payment_source: g.payment_source ?? '',
      });
    }
  }

  for (const p of generatePaymentPlanTransactions(paymentPlans)) {
    if (!monthSet.has(monthOf(p.date))) continue;
    out.push({
      id: p.id,
      kind: 'payment_plan',
      date: p.date,
      type: p.type,
      amount: Number(p.amount),
      note: p.note ?? '',
      payment_source: p.payment_source ?? '',
    });
  }

  for (const c of generateCarLoanTransactions(carFunds)) {
    if (!monthSet.has(monthOf(c.date))) continue;
    out.push({
      id: c.id,
      kind: 'car_loan',
      date: c.date,
      type: c.type,
      amount: Number(c.amount),
      note: c.note ?? '',
      payment_source: c.payment_source ?? '',
    });
  }

  return out;
}

/**
 * The collisions between hand-entered rows and generated ones.
 *
 * 🔬 PAIRING IS ONE-TO-ONE, and that is the whole reason this can be shown to a person. A month
 * with ONE generated $422.89 car payment and TWO manual $422.89 rows raises exactly ONE warning:
 * the second manual row has no generator left to duplicate, so it is treated as what it probably
 * is — a genuine second payment. Without the pairing, three real installments of the same amount
 * would each accuse the other two, and the warning would be noise inside a month.
 *
 * Deterministic: both sides are walked in date order, so the same ledger always produces the same
 * pairs and therefore the same dismissal keys. A key that moved between renders would un-dismiss
 * itself.
 *
 * `dismissed` keys are filtered out here rather than at the call site, so every surface hides the
 * same pair — dismissing on Transactions must also quiet the Forecast breakdown.
 */
export function findDuplicateCollisions(
  transactions: readonly (ManualTransaction & Partial<EnrichedTransaction>)[],
  generated: readonly GeneratedObligation[],
  dismissed: readonly string[] = [],
): DuplicateCollision[] {
  const dismissedSet = new Set(dismissed);
  const byDate = <T extends { date: string; id: string }>(a: T, b: T) =>
    a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

  const candidates = transactions.filter(isManualCandidate).slice().sort(byDate);
  const pool = generated.slice().sort(byDate);
  const claimed = new Set<string>();
  const collisions: DuplicateCollision[] = [];

  for (const manual of candidates) {
    const match = pool.find(g => !claimed.has(g.id) && isSamePayment(manual, g));
    if (!match) continue;
    claimed.add(match.id);

    const amount = round2(Number(manual.amount));
    const key = collisionKey(manual.id, match.id, amount);
    if (dismissedSet.has(key)) continue;

    collisions.push({ key, manual, generated: match, monthKey: monthOf(manual.date), amount });
  }

  return collisions;
}

export interface DuplicateScanInput extends Omit<CollectObligationsInput, 'months' | 'realTransactions'> {
  transactions: readonly (ManualTransaction & Partial<EnrichedTransaction>)[];
  dismissed?: readonly string[];
  /**
   * Restrict the scan to these `YYYY-MM` months. Default: every month a manual candidate exists
   * in — generating obligations for a month with nothing to collide with cannot produce a pair,
   * so the default is both cheapest and complete.
   */
  months?: readonly string[];
}

/** `collectGeneratedObligations` + `findDuplicateCollisions`, so both surfaces run one call. */
export function scanForDuplicateTransactions(input: DuplicateScanInput): DuplicateCollision[] {
  const { transactions, dismissed = [], months, ...rest } = input;
  const candidates = transactions.filter(isManualCandidate);
  const scanMonths = months ?? Array.from(new Set(candidates.map(t => monthOf(t.date))));
  if (scanMonths.length === 0) return [];

  const generated = collectGeneratedObligations({
    ...rest,
    months: scanMonths,
    realTransactions: transactions,
  });

  return findDuplicateCollisions(transactions, generated, dismissed);
}
