// ─── Next-payment date arithmetic ────────────────────────
// Single source for "when is this card's next payment due", used by the /debt page's
// "Recommended this month" rows. Extracted rather than open-coded because the two things that can
// actually be wrong here are arithmetic, not layout: a bare 3-letter month name silently rolls
// 'Dec' into 'Jan' with no year, and a due day of 31 lands in a 30-day month.

/** Shown in place of an amount when the projection has not resolved a payment for that month.
 * A gauge that failed to read must never look like a gauge reading zero. */
export const NEXT_PAYMENT_UNKNOWN = 'Not modelled';
/** Shown in place of a date when the card has no due day recorded. */
export const NEXT_DUE_UNKNOWN = 'no due date set';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * The calendar date a card's next payment is due: `monthOffset` months from `now`, on `dueDay`,
 * CLAMPED to that month's length. Null when the card has no due day recorded — there is no honest
 * fallback, and sync-cutoff's `dueDateInMonth` would happily build '2026-09-31'.
 */
export function nextPaymentDueDate(dueDay: number | null, monthOffset: 0 | 1, now: Date): Date | null {
  if (dueDay == null || !Number.isFinite(dueDay)) return null;
  const y = now.getFullYear();
  const m = now.getMonth() + monthOffset;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(Math.max(1, Math.trunc(dueDay)), lastDay));
}

/** 'due Sep 7', or NEXT_DUE_UNKNOWN. Tre's own phrasing, bare day (no ordinal): '$2,845 due Sep 7'. */
export function formatNextDue(d: Date | null): string {
  if (!d) return NEXT_DUE_UNKNOWN;
  return `due ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
