// This module reserves pending debits that have not yet posted to the checking balance.
// Pending debits must be counted now, but if they correspond to an already-scheduled
// bill (an "out" event with a matching amount near the pending date) we replace that
// bill so it isn't subtracted twice. The replaced bill is effectively moved to today,
// which can only lower the "safe to spend" figure.
import type { DatedCashEvent } from '@/lib/safe-to-spend';

export interface PendingDebit {
  accountId: string;
  date: string; // YYYY-MM-DD
  amount: number;
  label: string;
}

export interface PendingReservation {
  /** Sum of every counted pending debit, rounded to cents. >= 0. */
  reserve: number;
  /** The input events minus each 'out' event a pending debit replaced. New array; input untouched. */
  events: DatedCashEvent[];
  /** Counted pending debits, in input order, each with the label of the event it replaced (or null). */
  items: { label: string; amount: number; date: string; replaces: string | null }[];
}

export const PENDING_MATCH_DAYS_BEFORE = 3;
export const PENDING_MATCH_DAYS_AFTER = 10;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a YYYY-MM-DD string to a Date (local time) and add n days.
 */
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Compare two YYYY-MM-DD strings lexicographically (valid because of format).
 */
function isDateInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

/**
 * Returns a new reservation object without mutating any input.
 */
export function reservePendingDebits(
  pending: readonly PendingDebit[] | null | undefined,
  events: readonly DatedCashEvent[],
  accountIds: ReadonlySet<string>,
): PendingReservation {
  const items: PendingReservation['items'] = [];
  let reserveSum = 0;

  // Guard against null/undefined pending list.
  const pendingRows = pending ?? [];

  // Pre-compute a stable, date-sorted list of event indices.
  const sortedEventIndices = events
    .map((e, idx) => ({ e, idx }))
    .sort((a, b) => {
      if (a.e.date < b.e.date) return -1;
      if (a.e.date > b.e.date) return 1;
      // tie-breaker: original order
      return a.idx - b.idx;
    })
    .map(pair => pair.idx);

  const replacedSet = new Set<number>();

  for (const row of pendingRows) {
    // Rule 1 validation
    if (
      !accountIds.has(row.accountId) ||
      typeof row.amount !== 'number' ||
      !Number.isFinite(row.amount) ||
      row.amount <= 0 ||
      typeof row.date !== 'string' ||
      !DATE_REGEX.test(row.date)
    ) {
      continue;
    }

    reserveSum += row.amount;

    // Rule 3 - double-count guard
    const lower = addDays(row.date, -PENDING_MATCH_DAYS_BEFORE);
    const upper = addDays(row.date, PENDING_MATCH_DAYS_AFTER);
    let replaceLabel: string | null = null;

    for (const idx of sortedEventIndices) {
      if (replacedSet.has(idx)) continue;
      const ev = events[idx];
      if (ev.direction !== 'out') continue;
      if (Math.abs(ev.amount - row.amount) >= 0.005) continue;
      if (!isDateInRange(ev.date, lower, upper)) continue;

      // First matching event found
      replacedSet.add(idx);
      replaceLabel = ev.label;
      break;
    }

    items.push({
      label: row.label,
      amount: row.amount,
      date: row.date,
      replaces: replaceLabel,
    });
  }

  // Build the new events array without the replaced ones.
  const newEvents = events.filter((_e, i) => !replacedSet.has(i));

  // Rule 5 rounding
  const reserve = Math.round(reserveSum * 100) / 100;

  return {
    reserve,
    events: newEvents,
    items,
  };
}
