export interface CardStartDateAccount {
  /** Optional: `isCardOpenAsOf` never reads it, and callers with id-less account shapes
   * (net-worth's manual rows) must still be able to ask whether a card is open. */
  id?: string;
  account_type?: string | null;
  card_start_date?: string | null;
  name?: string | null;
}

/**
 * Month index (0 = the current month) at which a card becomes open. A card with
 * no start date, or one whose start date has already passed, is open now.
 *
 * Granularity is deliberately the MONTH, not the day: this is the same arithmetic
 * the simulation uses for cardStartMonths (credit-card-engine.ts), and the two
 * must agree or a card would count toward utilization in a month the projection
 * says it does not exist.
 */
export function cardStartMonthOffset(
  startDate: string | null | undefined,
  now: Date,
): number {
  if (!startDate) return 0;
  const start = new Date(startDate + 'T00:00:00');
  const diff = (start.getFullYear() - now.getFullYear()) * 12 + (start.getMonth() - now.getMonth());
  return Math.max(0, diff);
}

/**
 * True when a credit card is actually open as of `asOf`.
 *
 * A card with a FUTURE card_start_date is one the user has planned but not yet
 * opened. Its credit limit is not available credit, so it must not count toward
 * utilization — a $10,000 limit that does not exist yet makes utilization look
 * far better than it is. Non-cards, and cards with no start date, are open.
 */
export function isCardOpenAsOf(
  account: CardStartDateAccount,
  asOf: Date,
): boolean {
  if (account.account_type !== 'credit_card') return true;
  return cardStartMonthOffset(account.card_start_date, asOf) === 0;
}

function resolveAccountId(paymentSource: string | null | undefined): string | null {
  if (!paymentSource) return null;
  return paymentSource.startsWith('account:') ? paymentSource.slice(8) : paymentSource;
}

/**
 * A credit card with card_start_date set is a future card the engine excludes from
 * simulations until that month (see cardStartMonths in credit-card-engine.ts) — a real
 * transaction dated before that month is contradictory. Returns a user-facing reason if
 * the given date/payment_source pair violates that, or null if it's fine.
 */
export function getCardStartDateViolation(
  date: string,
  paymentSource: string | null | undefined,
  accounts: CardStartDateAccount[],
): string | null {
  const accountId = resolveAccountId(paymentSource);
  if (!accountId) return null;
  const account = accounts.find(a => a.id === accountId);
  if (!account || account.account_type !== 'credit_card' || !account.card_start_date) return null;
  if (date < account.card_start_date) {
    const label = account.name || 'This card';
    const startLabel = new Date(account.card_start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return `${label} doesn't start until ${startLabel}. Pick a later date or a different payment source.`;
  }
  return null;
}

/**
 * The CardData-shaped sibling of {@link isCardOpenAsOf}, for the simulation's own card
 * objects (which carry `startDate` and no `account_type` — every one of them is a card).
 *
 * This is deliberately NOT a second spelling of the flag: both predicates are
 * {@link cardStartMonthOffset} at month 0, so the account row and the sim card can never
 * disagree about whether a card exists yet.
 *
 * ⚠️ Use it at the RECOMMENDATION / DISPLAY layer only. The simulation is supposed to
 * model a future card turning on (see `cardStartMonths` in credit-card-engine.ts), and
 * filtering it out of the projection would delete that. What a card that does not exist
 * yet cannot do is receive a payment THIS month, or owe a balance today.
 */
export function isSimCardOpenAsOf(
  card: { startDate?: string | null },
  asOf: Date,
): boolean {
  return cardStartMonthOffset(card.startDate, asOf) === 0;
}
