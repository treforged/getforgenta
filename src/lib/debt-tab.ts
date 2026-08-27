/**
 * Which panel /debt opens on when a LINK says so — the mirror of `garage-tab.ts`, and for the
 * same reason.
 *
 * The tab is persisted (`tre:debtpayoff:activeTab`) so a returning user lands where they left off.
 * That is right for a return visit and wrong for a link: once the vehicle money moved off the
 * Garage (2026-08-27), the car list needed a way to say "the AUTO LOANS tab", not just "/debt" —
 * a user last on Credit Card Payoff would otherwise follow a link about a car and land on cards.
 *
 * Absent or unrecognised returns null, never a default: a plain visit must leave the remembered
 * tab alone. The page honours the param once, then strips it.
 */

export const DEBT_TABS = ['cards', 'auto', 'mortgage', 'student', 'other'] as const;

export type DebtTab = (typeof DEBT_TABS)[number];

export function isDebtTab(value: string | null | undefined): value is DebtTab {
  return typeof value === 'string' && (DEBT_TABS as readonly string[]).includes(value);
}

/** The tab a URL asks for, or null when it asks for nothing the page knows. */
export function debtTabFromSearch(search: string | URLSearchParams): DebtTab | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const asked = params.get('tab');
  return isDebtTab(asked) ? asked : null;
}
