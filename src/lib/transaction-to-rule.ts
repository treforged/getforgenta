// Ask 12: "also want to be able to schedule transactions by week". Turning the Activity page's
// add-transaction form into a `recurring_rules` row. Pure, no I/O, the same intent shape as
// `payment-plan-from-transaction.ts`.
//
// ⚠️ A REPEAT WRITES THE RULE AND NOTHING ELSE. `generateMonthTransactionsFromRules` projects an
// occurrence for the entered date already, so inserting the one-off row as well would put two
// identical rows in the ledger for that day and count the money twice everywhere the stream is
// summed. "May this be a rule" and "what rule would it be" are one decision for the same reason
// they are one decision over in the plan converter: a caller that answers one and forgets the other
// is how the duplicate gets back in.
//
// ⚠️ `due_day` MEANS A DAY OF THE WEEK (0-6) on weekly and biweekly rules and a day of the MONTH on
// monthly ones. That is the stored convention (`pay-schedule.ts:1144`), not a choice made here.
//
// ⚠️ EVERY DATE IS READ FROM THE STRING'S OWN PARTS. `new Date('2026-08-21')` parses as UTC
// midnight, which is the previous calendar day for every negative-offset timezone, so a Sunday
// transaction would be scheduled to repeat on Saturdays. Same trap `toLocalDateStr` exists for.

import type { TablesInsert } from '@/integrations/supabase/types';

/** The Repeats select's value space. `none` is the default and means an ordinary one-off row. */
export type TransactionRepeat = 'none' | 'weekly' | 'biweekly' | 'monthly';

/**
 * The Repeats options, in order. Labels match the payment-plan frequency select on the same page
 * so one page never calls the same cadence two things. No Yearly: this dialog is for cadence, and
 * an anniversary belongs in Budget Control where the Due Month field lives.
 */
export const TRANSACTION_REPEAT_OPTIONS: { value: TransactionRepeat; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 Weeks' },
  { value: 'monthly', label: 'Monthly' },
];

const REPEAT_VALUES = TRANSACTION_REPEAT_OPTIONS.map(o => o.value);

/**
 * Read a form value as a repeat choice, defaulting to `none`.
 *
 * ⚠️ NOT A CAST. Form state is string-valued and a draft saved before this field existed restores
 * with no `repeat` key at all, so `!== 'none'` on the raw value would read `undefined` as "repeat
 * this" and silently turn a plain add into a rule. Anything unrecognised is a one-off.
 */
export function parseTransactionRepeat(value: string | null | undefined): TransactionRepeat {
  return REPEAT_VALUES.includes(value as TransactionRepeat) ? (value as TransactionRepeat) : 'none';
}

/** What the add form knows, in the shape the rule builder needs. Structural, so tests need no DB. */
export interface TransactionRepeatInput {
  repeat: TransactionRepeat;
  /** The entered date, `YYYY-MM-DD`. Becomes `start_date` and supplies the due day. */
  date: string;
  /** The form's Type select: `income`, or anything else meaning an expense. */
  type: string;
  /** Already parsed and range-checked by the caller, exactly as the one-off insert does. */
  amount: number;
  category: string;
  /** The note as it would have been stored, already profanity-cleaned. Becomes the rule's NAME. */
  name: string;
  /**
   * The form's payment-source value: `''`, `account:<id>`, or one of the placeholder values the
   * select falls back to when the user has no accounts (`cash`, `bank_account`, `credit_card`).
   */
  paymentSource: string;
}

/** A `recurring_rules` insert, minus the `user_id` the hook attaches. */
export type RecurringRuleDraft = Omit<TablesInsert<'recurring_rules'>, 'user_id'>;

export type RuleFromTransactionIntent =
  | { ok: true; payload: RecurringRuleDraft }
  | { ok: false; reason: string };

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The calendar day a `YYYY-MM-DD` string names, at local noon, or null if it names none. */
function localDayOf(date: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  // Noon rather than midnight, matching `scheduling.ts`: a DST shift can never move the day.
  const parsed = new Date(y, m - 1, d, 12, 0, 0, 0);
  // Rejects 2026-02-31 and friends, which JS would roll forward into March without complaint.
  if (parsed.getFullYear() !== y || parsed.getMonth() !== m - 1 || parsed.getDate() !== d) return null;
  return parsed;
}

/**
 * The account id a rule should store, or null when the form value names no account.
 *
 * ⚠️ NULL RATHER THAN THE RAW STRING. `payment_source` and `deposit_account` hold a bare
 * `accounts.id` on a rule (see BudgetControl's `allAccountOptions`), while this page's select
 * speaks `account:<id>` plus a few placeholder labels for users with no accounts at all. Writing
 * `cash` into an id column would put a value there that no account lookup can resolve, and the
 * semantics already treat a null source as unassigned, which is the honest reading of "we could
 * not tell which account this is".
 */
function accountIdFromSource(paymentSource: string): string | null {
  if (paymentSource.startsWith('account:')) return paymentSource.slice(8) || null;
  return null;
}

/**
 * The rule a repeating add would create, or the reason it cannot be created yet.
 *
 * Returns a reason rather than throwing: every `false` here is something the user can fix in the
 * form they are already looking at, so it is a message, not an incident.
 */
export function ruleFromTransactionForm(input: TransactionRepeatInput): RuleFromTransactionIntent {
  if (input.repeat === 'none') {
    return { ok: false, reason: 'This transaction does not repeat.' };
  }

  const day = localDayOf(input.date);
  if (!day) {
    return { ok: false, reason: 'Pick a real date before setting a repeat.' };
  }

  if (!Number.isFinite(input.amount) || input.amount === 0) {
    return { ok: false, reason: 'This transaction has no usable amount.' };
  }

  // A rule is listed and edited BY NAME under Budget Control, so an unnamed one is a row the user
  // cannot find again. The one-off path can fall back to "Transaction" because its date and amount
  // identify it in the ledger; a rule that repeats forever cannot.
  const name = input.name.trim();
  if (!name) {
    return { ok: false, reason: 'A note is required for a repeating transaction. It becomes the name you will see under Budget Control.' };
  }

  const isIncome = input.type === 'income';
  const accountId = accountIdFromSource(input.paymentSource);

  return {
    ok: true,
    payload: {
      name,
      amount: Math.abs(input.amount),
      rule_type: isIncome ? 'income' : 'expense',
      frequency: input.repeat,
      due_day: input.repeat === 'monthly' ? day.getDate() : day.getDay(),
      due_month: null,
      category: input.category,
      // Income deposits INTO an account and an expense is charged TO one. Same split the page's
      // existing rule-edit save makes, and the same one `generateMonthTransactionsFromRules` reads
      // back when it decides which field a generated occurrence's source comes from.
      payment_source: isIncome ? null : accountId,
      deposit_account: isIncome ? accountId : null,
      // ⚠️ LOAD-BEARING ON BIWEEKLY. `resolveBiweeklyAnchor` measures the 14-day cycle from
      // `start_date` when there is one and from `created_at` otherwise, so without this the cycle
      // would be phased on the moment the row was inserted rather than on the date the user picked.
      // On weekly and monthly it is the honest start bound: no occurrence is projected into a month
      // before the one the user entered.
      start_date: input.date,
      end_date: null,
      notes: null,
      active: true,
    },
  };
}

/** `21` to `21st`. Only ever fed a day of the month, so 1-31. */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/**
 * What the form tells the user a repeat will actually do, or null when there is nothing to say.
 *
 * Written from the same (repeat, date) pair the payload is, so the caption cannot describe a
 * schedule other than the one being saved. The second sentence is the part that matters: choosing
 * a repeat replaces the single row rather than adding to it, and the user should not have to
 * discover that by counting rows afterwards.
 */
export function transactionRepeatHint(repeat: TransactionRepeat, date: string): string | null {
  if (repeat === 'none') return null;
  const day = localDayOf(date);
  if (!day) return null;

  const from = day.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const managed = 'Saved as a rule under Budget Control, not as a single row.';

  if (repeat === 'weekly') {
    return `Repeats every ${DAY_NAMES[day.getDay()]} from ${from}. ${managed}`;
  }
  if (repeat === 'biweekly') {
    // Phrased in days, matching the biweekly caption in the Budget Control rule editor.
    return `Repeats every 14 days from ${from}. ${managed}`;
  }
  const dayOfMonth = day.getDate();
  // Months too short for the chosen day bill on their last day (`getRuleOccurrenceDatesInMonth`
  // clamps), which is worth saying out loud rather than letting February look like a bug.
  const shortMonths = dayOfMonth > 28 ? ' Shorter months bill on their last day.' : '';
  return `Repeats on the ${ordinal(dayOfMonth)} of each month from ${from}. ${managed}${shortMonths}`;
}

/** The cadence, as the success toast says it. */
export function transactionRepeatCadence(repeat: TransactionRepeat): string {
  if (repeat === 'weekly') return 'weekly';
  if (repeat === 'biweekly') return 'every 2 weeks';
  if (repeat === 'monthly') return 'monthly';
  return 'never';
}
