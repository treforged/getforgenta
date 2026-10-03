/**
 * How a card is actually paid, read from its payment transactions (ask ec48da25).
 *
 * Tre, 2026-10-03: "you should be able to tell that based off transaction history". Banks name
 * autopay plainly ("AUTOMATIC PAYMENT - THANK", "DIRECTPAY MINIMUM PAYMENT"), so the last 120 days
 * of payments say whether a card autopays, on which day, and whether it pays only the minimum.
 * Manual payments say nothing reliable about intent, so they read as 'unknown'.
 */
export interface CardPaymentTxn {
  date: string; // YYYY-MM-DD
  amount: number; // negative = a payment to the card
  name: string;
  pending?: boolean;
}

export type PayKind = 'minimum' | 'statement_or_more' | 'unknown';

export interface PayBehavior {
  autopay: boolean;
  kind: PayKind;
  dayOfMonth: number | null;
  sampleSize: number;
  lastAmount: number | null;
}

const WINDOW_DAYS = 120;
const DAY_MS = 86_400_000;

function utcMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function isAutopay(name: string): boolean {
  const up = name.toUpperCase();
  return up.includes('AUTOPAY') || up.includes('AUTOMATIC PAYMENT') || up.includes('DIRECTPAY');
}

export function inferCardPayBehavior(
  txns: CardPaymentTxn[],
  opts: { minPayment: number | null; today: string },
): PayBehavior {
  const todayMs = utcMs(opts.today);
  const cutoffMs = todayMs - WINDOW_DAYS * DAY_MS;
  const eligible = txns.filter(t => {
    if (t.pending || !(t.amount < 0)) return false;
    const ms = utcMs(t.date);
    return ms >= cutoffMs && ms <= todayMs;
  });

  const autopay = eligible.some(t => isAutopay(t.name));
  const used = autopay ? eligible.filter(t => isAutopay(t.name)) : eligible;
  if (used.length === 0) {
    return { autopay: false, kind: 'unknown', dayOfMonth: null, sampleSize: 0, lastAmount: null };
  }

  // Newest first, so "the latest" is index 0 and ties resolve to the most recent payment.
  const newest = [...used].sort((a, b) => utcMs(b.date) - utcMs(a.date));
  const lastAmount = Math.round(Math.abs(newest[0].amount) * 100) / 100;

  let dayOfMonth: number | null = null;
  if (autopay) {
    const counts = new Map<number, number>();
    for (const t of newest) {
      const d = new Date(utcMs(t.date)).getUTCDate();
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    const max = Math.max(...counts.values());
    dayOfMonth = newest
      .map(t => new Date(utcMs(t.date)).getUTCDate())
      .find(d => counts.get(d) === max) ?? null;
  }

  let kind: PayKind = 'unknown';
  if (autopay && used.some(t => t.name.toUpperCase().includes('MINIMUM'))) kind = 'minimum';
  else if (opts.minPayment != null && opts.minPayment > 0 && Math.abs(lastAmount - opts.minPayment) <= 1) kind = 'minimum';
  else if (autopay) kind = 'statement_or_more';

  return { autopay, kind, dayOfMonth, sampleSize: used.length, lastAmount };
}
