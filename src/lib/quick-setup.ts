/**
 * The FAST first-run path (Tre via Sam, 2026-10-09): 5 signups in 90 days, and the latest quit on
 * the first onboarding screen. One screen asks only what Safe to Spend and the payoff date need,
 * then lands on Home with a real number; everything else becomes "finish later" on Home.
 * Audit and tap counts: docs/onboarding-audit-2026-10-09.md.
 */

export type PayFrequency = 'weekly' | 'biweekly' | 'monthly';

/**
 * The profile columns a "next payday" answer sets, read the way `buildPayConfig` reads them
 * (pay-schedule.ts): weekly/biweekly use `paycheck_day` as a DAY OF THE WEEK (0 = Sun), monthly as
 * a DAY OF THE MONTH, and biweekly also needs `paycheck_start_date` as its phase anchor (any known
 * payday). Without an answer nothing is written and the engine keeps its default (Friday).
 */
export function paydayColumns(
  frequency: string,
  nextPayday: string | undefined,
): { paycheck_day?: number; paycheck_start_date?: string } {
  if (!nextPayday || !/^\d{4}-\d{2}-\d{2}$/.test(nextPayday)) return {};
  const [y, m, d] = nextPayday.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return {};
  if (frequency === 'monthly') return { paycheck_day: d };
  if (frequency === 'biweekly') return { paycheck_day: date.getDay(), paycheck_start_date: nextPayday };
  return { paycheck_day: date.getDay() };
}

/** The one required answer: pay. Without it Safe to Spend has no income and Home stays empty. */
export function quickSetupReady(weeklyGross: string): boolean {
  const n = parseFloat(weeklyGross);
  return Number.isFinite(n) && n > 0;
}

/**
 * The card a fast-path user names, as an `accounts` row. A CREDIT-CARD ACCOUNT, not a `debts` row:
 * the payoff engine builds cards from `accounts` only (`buildCardData` filters
 * `account_type === 'credit_card'`), so a `debts` row alone would never produce a payoff date.
 * null when no positive balance was given.
 */
export function quickCardAccount(
  balance: string | undefined,
  apr: string | undefined,
): { name: string; account_type: 'credit_card'; balance: number; apr: number | null } | null {
  const b = parseFloat(balance ?? '');
  if (!Number.isFinite(b) || b <= 0) return null;
  const a = parseFloat(apr ?? '');
  return {
    name: 'Credit card',
    account_type: 'credit_card',
    balance: Math.round(b * 100) / 100,
    apr: Number.isFinite(a) && a >= 0 ? a : null,
  };
}
