/**
 * The TEXT of the shareable debt-free card (ask 555a4c71, Tre 2026-09-20: "our app needs virality").
 *
 * Pure, so the privacy rule can be asserted without a DOM. THE HARD CONSTRAINT: the card carries
 * a DATE and a count of MONTHS, never a balance, a payment, an APR or an account name. A finance
 * app whose viral screen leaks a number is a worse story than no viral screen.
 * `cardLeaksMoney` is the guard, and the renderer refuses any spec it flags.
 *
 * `etaMonth` uses the SAME 1-indexed convention as CreditCardEngine's Payoff ETA (1 = this month),
 * so the card and the header it is shared from always name the same month.
 */

export type ShareCardKind = 'paid' | 'date';

export interface ShareCardSpec {
  kind: ShareCardKind;
  eyebrow: string;
  headline: string;
  dateLabel: string | null;
  subline: string;
  footer: string;
}

const FOOTER = 'Planned with Forgenta  ·  getforgenta.com';

/**
 * Builds a share-card spec describing a debt-free date.
 * Returns null for invalid or unknown ETA values.
 */
export function buildDebtFreeCard(
  etaMonth: number | null,
  today: Date
): ShareCardSpec | null {
  // Guard invalid inputs
  if (
    etaMonth === null ||
    !Number.isFinite(etaMonth) ||
    etaMonth > 600
  ) {
    return null;
  }

  // Paid-off case (zero or negative months)
  if (etaMonth <= 0) {
    return {
      kind: 'paid',
      eyebrow: 'Credit card debt',
      headline: 'Paid off.',
      dateLabel: null,
      subline: 'Every card cleared',
      footer: FOOTER,
    };
  }

  // Helper to format the target month (local calendar)
  const targetDate = new Date(
    today.getFullYear(),
    today.getMonth() + etaMonth - 1,
    1
  );
  const formatted = targetDate.toLocaleString('en', {
    month: 'long',
    year: 'numeric',
  });

  // This month (etaMonth === 1)
  if (etaMonth === 1) {
    return {
      kind: 'date',
      eyebrow: 'Credit-card debt-free',
      headline: 'This month.',
      dateLabel: formatted,
      subline: 'Right on plan',
      footer: FOOTER,
    };
  }

  // Future months (etaMonth > 1)
  const monthsToGo = etaMonth - 1;
  const monthWord = monthsToGo === 1 ? 'month' : 'months';
  return {
    kind: 'date',
    eyebrow: 'Credit-card debt-free by',
    headline: formatted,
    dateLabel: formatted,
    subline: `${monthsToGo} ${monthWord} to go`,
    footer: FOOTER,
  };
}

/**
 * Detects accidental leakage of monetary information.
 */
export function cardLeaksMoney(spec: ShareCardSpec): boolean {
  const fields = [
    spec.eyebrow,
    spec.headline,
    spec.subline,
    spec.footer,
    ...(spec.dateLabel ? [spec.dateLabel] : []),
  ];

  const moneyRegex = /[$%]/;
  const decimalOrCommaRegex = /\d[\d,]*\.\d|\d{1,3},\d{3}/;
  const forbiddenWords = /\b(balance|owe|APR|interest|payment)\b/i;

  return fields.some(
    (text) =>
      moneyRegex.test(text) ||
      decimalOrCommaRegex.test(text) ||
      forbiddenWords.test(text)
  );
}
