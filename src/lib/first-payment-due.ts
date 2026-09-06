export interface FirstPaymentDueAccount {
  /** The steady day-of-month a payment is due (1-31), or null when the user has not recorded one. */
  payment_due_day?: number | null;
  /** `accounts.first_payment_due_date` - an ISO 'YYYY-MM-DD' string, or null. */
  first_payment_due_date?: string | null;
}

/**
 * Month index (0 = the current month) of the month that contains a card's FIRST
 * payment due date, or null when that date says nothing useful - it is absent,
 * unparsable, or its month has already gone by.
 *
 * A newly opened card's first payment rarely lands on its steady cycle day. Tre's
 * Robinhood Gold opened in September and its first payment is due 10 October; from
 * November onward it is the 10th of every month. `payment_due_day` alone describes
 * the steady state and is silent about month one, which is why this exists.
 *
 * Granularity is deliberately the MONTH, not the day - the same arithmetic as
 * {@link cardStartMonthOffset} in card-start-date.ts, so the two can never disagree
 * about which month of the projection a card's first obligation falls in.
 */
export function firstPaymentDueMonthOffset(
  firstPaymentDueDate: string | null | undefined,
  now: Date,
): number | null {
  if (!firstPaymentDueDate) return null;
  const parsed = new Date(firstPaymentDueDate + 'T00:00:00');
  if (Number.isNaN(parsed.getTime())) return null;
  const diff = (parsed.getFullYear() - now.getFullYear()) * 12 + (parsed.getMonth() - now.getMonth());
  return diff < 0 ? null : diff;
}

/**
 * The day of the month a payment is due in the projection month `monthOffset`
 * (0 = the current month).
 *
 * The month holding the first payment due date uses THAT date's day; every other
 * month uses the steady `payment_due_day`. Once the first due month has passed the
 * field is inert and every month reads the steady day again.
 *
 * NEVER invents a day: a card with no `payment_due_day` and no first payment due
 * date returns null, because a made-up due day moves real money in the forecast.
 */
export function dueDayForMonthOffset(
  account: FirstPaymentDueAccount,
  monthOffset: number,
  now: Date,
): number | null {
  const firstOffset = firstPaymentDueMonthOffset(account.first_payment_due_date, now);
  if (firstOffset === monthOffset && account.first_payment_due_date) {
    const parsed = new Date(account.first_payment_due_date + 'T00:00:00');
    if (!Number.isNaN(parsed.getTime())) return parsed.getDate();
  }
  return account.payment_due_day ?? null;
}
