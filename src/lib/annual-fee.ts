/**
 * An account's annual fee, and the months it lands in.
 *
 * Tre, 2026-08-27: *"can we set it up so users can add cards with annual fees on the account with
 * the scheduled date?"* — asked because his own forecast showed June 2027 $395 better than it will
 * be: the Venture X he has dated for that month carries a fee the projection had no way to know
 * about. A card's cost is part of the plan, and a plan that omits it is optimistic by exactly the
 * fee, every year, forever.
 *
 * ⚠️ THE FEE IS CHARGED TO THE CARD, NOT TO CASH. That is what a real annual fee does: it posts to
 * the statement, and cash only moves when the statement is paid. Modelling it as a cash expense
 * would double-count against the card payment the engine already schedules, and would land the
 * money in the wrong month for anyone who does not pay in full.
 *
 * ⚠️ IT RECURS. `annual_fee_date` is the FIRST charge; every anniversary after it is another one,
 * for as long as the projection runs. A one-off would understate year two onwards.
 */

/** The account fields this module needs — the shape both the projection and the UI already hold. */
export interface AnnualFeeAccount {
  annual_fee?: number | null;
  annual_fee_date?: string | null;
  /** A card that has not opened yet cannot be charged a fee before it exists. */
  card_start_date?: string | null;
}

/** The fee, or 0 when there is none to charge. Never negative, never NaN. */
export function annualFeeAmount(account: AnnualFeeAccount): number {
  const raw = Number(account.annual_fee);
  if (!isFinite(raw) || raw <= 0) return 0;
  return raw;
}

/** `2027-06-01` → the number of whole months from `now`'s month to that date's month. */
function monthOffset(iso: string, now: Date): number {
  const [y, m] = iso.split('-').map(Number);
  if (!y || !m) return NaN;
  return (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth());
}

/**
 * Which projection months this account's fee is charged in.
 *
 * Month 0 is the current month and is DELIBERATELY INCLUDED only when the anniversary falls in it
 * and the projection is being built forward from it — the caller decides whether month 0 already
 * reflects a charge that has posted (the live card balance normally does), exactly as it does for
 * every other purchase.
 *
 * Returns an empty array for an account with no fee, no date, an unparseable date, or a fee whose
 * first charge is after the window ends.
 */
export function annualFeeMonthIndexes(
  account: AnnualFeeAccount,
  now: Date,
  projectionMonths: number,
): number[] {
  if (annualFeeAmount(account) === 0) return [];
  const first = account.annual_fee_date;
  if (!first) return [];

  let offset = monthOffset(first, now);
  if (!isFinite(offset)) return [];

  // A fee dated in the past still recurs: walk its anniversaries forward until one is inside the
  // window. A user typing the date the card was opened years ago must not get a silent no-op.
  while (offset < 0) offset += 12;

  // A card that opens later cannot be billed earlier, whatever the fee date says. The two fields
  // are entered separately and nothing stops them disagreeing.
  const opensAt = account.card_start_date ? monthOffset(account.card_start_date, now) : null;
  const earliest = opensAt != null && isFinite(opensAt) ? Math.max(0, opensAt) : 0;

  const months: number[] = [];
  for (let m = offset; m < projectionMonths; m += 12) {
    if (m >= earliest) months.push(m);
  }
  return months;
}

/** `Jun 2027` — the month the next charge lands in, for a UI that has to say when. */
export function nextAnnualFeeLabel(account: AnnualFeeAccount, now: Date): string | null {
  const months = annualFeeMonthIndexes(account, now, 12 * 60);
  if (months.length === 0) return null;
  const d = new Date(now.getFullYear(), now.getMonth() + months[0], 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
