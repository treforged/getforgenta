// ─── Ordinal number formatting ───────────────────────────
// Single source for day-of-month suffixes. Five separate implementations existed before this
// (Dashboard's debt widget, three in CreditCardEngine, Forecast's obligations list, the Accounts
// subtitle) and four of them were wrong, rendering `Due 1th`, `Due 22th`, `due 2th`.

/** English ordinal suffix for a number: 1 → "st", 2 → "nd", 3 → "rd", 4 → "th", 11–13 → "th". */
export function ordinalSuffix(n: number): string {
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(Math.trunc(n));
  const lastTwo = abs % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return 'th';
  switch (abs % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/** The number with its ordinal suffix appended: 22 → "22nd". */
export function ordinal(n: number): string {
  if (!Number.isFinite(n)) return '';
  return `${Math.trunc(n)}${ordinalSuffix(n)}`;
}
