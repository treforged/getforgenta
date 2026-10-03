/**
 * Month-0 card payments, sized by WHEN the cash arrives (Tre's /debt, 2026-10-03).
 *
 * The projection sizes month 0's card payments from the whole month's cash above the floor. It has
 * no dates, so a payment due BEFORE the next paycheck can be planned with money that only arrives
 * on payday: Prime Visa read $1,340.94 due 10-07 while Chase held $1,118 and Safe to Spend until the
 * 10-09 paycheck was $82. This is the display-layer correction, read off the Safe to Spend chain
 * (which already walks every dated outflow and reserves every card minimum):
 *
 *   A. A payment due on or before payday is capped at its minimum plus the cash left until payday.
 *      That cash is shared out in due-date order. The rest is "optional extra after payday".
 *   B. A card whose minimum is already settled this month and whose next due date is next month
 *      owes nothing this month. Its leftover extra is optional after payday, never "due".
 *
 * `payment` (the ledger figure that feeds the injected transactions) is NEVER changed: the cap
 * moves the money to after payday, it does not remove it from the month. Without a Safe to Spend
 * figure nothing is capped, because there is no until-payday cash to cap against.
 */
import type { CardRecRow } from '@/lib/month0-debt-breakdown';
import { toLocalDateStr } from '@/lib/scheduling';

export interface PrePaydayCard {
  id: string;
  minPayment: number;
  balance: number;
  m0MinSettled?: boolean;
}

export type PrePaydayRow = CardRecRow & {
  /** The part of this month's plan that can only be paid once the paycheck lands. Absent when none. */
  afterPayday?: number;
  /** Set to 0 when nothing is owed this month (rule B). Absent otherwise. */
  dueThisMonth?: number;
};

const round2 = (x: number): number => Math.round(x * 100) / 100;

export function capPrePaydayRows(
  rows: readonly CardRecRow[],
  cards: readonly PrePaydayCard[],
  safeToSpend: { amount: number; payday: string } | null,
  now: Date,
): PrePaydayRow[] {
  if (!safeToSpend) return [...rows];
  const { payday } = safeToSpend;
  const cardById = new Map(cards.map(c => [c.id, c]));
  const changed = new Map<string, PrePaydayRow>();

  const prePayday = rows
    .filter(r => r.nextPayMonth === 0 && r.nextDueDate !== null
      && typeof r.nextPayment === 'number' && Number.isFinite(r.nextPayment)
      && toLocalDateStr(r.nextDueDate) <= payday
      && toLocalDateStr(r.nextDueDate) >= toLocalDateStr(now))
    .sort((a, b) => a.nextDueDate!.getTime() - b.nextDueDate!.getTime());

  let pool = Math.max(0, safeToSpend.amount);
  for (const r of prePayday) {
    const card = cardById.get(r.cardId);
    const protectedMin = card?.m0MinSettled ? 0 : Math.min(card?.minPayment ?? 0, card?.balance ?? 0);
    const planned = r.nextPayment as number;
    const extra = Math.max(0, planned - protectedMin);
    const grant = Math.min(extra, pool);
    pool -= grant;
    const capped = round2(Math.min(planned, protectedMin + grant));
    if (planned - capped > 0.005) {
      changed.set(r.cardId, { ...r, nextPayment: capped, afterPayday: round2(planned - capped) });
    }
  }

  for (const r of rows) {
    if (r.nextPayMonth === 1 && cardById.get(r.cardId)?.m0MinSettled && r.payment > 0) {
      changed.set(r.cardId, { ...r, dueThisMonth: 0, afterPayday: round2(r.payment) });
    }
  }

  return rows.map(r => changed.get(r.cardId) ?? r);
}
