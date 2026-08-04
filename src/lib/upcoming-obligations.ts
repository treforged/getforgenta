/**
 * Turns generated obligation rows (debt payments, vehicle loan + insurance, payment-plan
 * installments) into the {@link ScheduledEvent} shape the Dashboard's upcoming/bills widgets
 * already speak.
 *
 * Those widgets used to read `generateScheduledEvents(rules, …)` alone, so they saw only
 * recurring budget rules. On real data that understated the week by ~25×: a Friday showing
 * "Fuel $65" actually carried a $1,008 card payment, a $423 auto-loan payment and $173 of
 * vehicle insurance as well — every one of them visible on /transactions, none of them in the
 * "Bills This Week" total. The ledger builds those rows from the canonical month-0 projection,
 * `generateCarLoanTransactions` and `generatePaymentPlanTransactions`; this adapter lets the
 * widgets read the same rows instead of growing a fourth definition of "what is due".
 */

import type { ScheduledEvent } from './scheduling';

/** The subset of an EnrichedTransaction an obligation event needs. */
export interface ObligationTransaction {
  date: string;
  type: string;
  amount: number;
  note?: string | null;
  category?: string | null;
  payment_source?: string | null;
}

/**
 * Expense rows only, mapped to scheduled events tagged with `source`.
 *
 * `excludePaymentSources` drops rows charged to a credit card: the card's own payment is already
 * counted as a separate obligation, so counting the purchase too would bill it twice.
 */
export function toScheduledObligations(
  transactions: readonly ObligationTransaction[],
  source: string,
  excludePaymentSources: ReadonlySet<string> = new Set(),
): ScheduledEvent[] {
  const events: ScheduledEvent[] = [];

  for (const t of transactions) {
    if (t.type !== 'expense') continue;
    if (!t.date) continue;
    if (!(t.amount > 0)) continue;

    const paymentSource = t.payment_source || '';
    const normalized = paymentSource.startsWith('account:') ? paymentSource.slice(8) : paymentSource;
    if (normalized && excludePaymentSources.has(normalized)) continue;

    events.push({
      date: t.date,
      name: t.note || t.category || source,
      amount: t.amount,
      type: 'expense',
      source,
    });
  }

  return events;
}
