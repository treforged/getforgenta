export interface CardStartDateAccount {
  id: string;
  account_type?: string | null;
  card_start_date?: string | null;
  name?: string | null;
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
