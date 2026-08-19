/**
 * Debt-to-income, in the sense a lender means it.
 *
 * ⚠️ WHY THIS EXISTS. The Dashboard tile used to read
 * `debtBreakdown.totalMinimumsDue / summary.income`, and that is not a debt-to-income ratio at all.
 * `totalMinimumsDue` is what is still UNPAID on the credit cards this month, so the tile had three
 * faults at once:
 *   - it fell towards zero as the month went on, and hit 0% the day the last minimum cleared —
 *     a ratio that improves because you paid a bill is measuring the calendar, not the debt;
 *   - it excluded every loan, so a student loan, a mortgage and a car payment counted as no debt;
 *   - it excluded cards on autopay-in-full, which are the cards most reliably being paid.
 * On the demo account — $12,700 of cards, an $8,000 student loan and a $26,500 car loan — it read
 * **0.5%, labelled "healthy"**. A confident wrong number on the one tile whose whole job is to say
 * whether someone is over-borrowed.
 *
 * ⚠️ THE NUMERATOR IS CONTRACTUAL, NOT CHOSEN. It is what must be paid each month — card minimums,
 * loan minimums, active vehicle-loan payments — never what the avalanche engine recommends paying.
 * Someone throwing every spare dollar at a card is not more indebted for doing it, and a DTI that
 * rose when they did would punish exactly the behaviour the rest of the app is for.
 */
import { isCardOpenAsOf, type CardStartDateAccount } from './card-start-date';
import { getActiveCarLoanPayments } from './vehicle-loan-engine';
import type { CarFund } from './types';

export interface DebtToIncomeDebt {
  name: string;
  min_payment?: number | null;
}

export interface DebtToIncomeInput {
  /** Every row from `debts` — cards, student loans, mortgage, anything else. */
  debts: readonly DebtToIncomeDebt[];
  /** Accounts, read ONLY to hold back a card that has not been opened yet. */
  accounts: readonly (CardStartDateAccount & { name?: string | null })[];
  carFunds: readonly CarFund[];
  /** Monthly income. Non-positive means there is nothing to divide by. */
  income: number;
  asOf?: Date;
}

/**
 * The monthly obligation, in dollars.
 *
 * ⚠️ An unopened card is held out, the same rule as the recommendations, the month-0 breakdown and
 * the liabilities list (2026-08-18). A card whose `card_start_date` is still ahead owes nothing,
 * and a DTI that counted its minimum would be asking a person to service a card that does not
 * exist yet.
 */
export function monthlyDebtObligation(
  input: Pick<DebtToIncomeInput, 'debts' | 'accounts' | 'carFunds' | 'asOf'>,
): number {
  const asOf = input.asOf ?? new Date();

  const unopened = new Set(
    input.accounts
      .filter(a => !isCardOpenAsOf(a, asOf))
      .map(a => (a.name ?? '').toLowerCase())
      .filter(Boolean),
  );

  const fromDebts = input.debts
    .filter(d => !unopened.has(d.name.toLowerCase()))
    .reduce((sum, d) => sum + Math.max(0, Number(d.min_payment ?? 0)), 0);

  const fromVehicles = getActiveCarLoanPayments(input.carFunds as CarFund[], asOf)
    .reduce((sum, l) => sum + Math.max(0, Number(l.payment ?? 0)), 0);

  return fromDebts + fromVehicles;
}

/**
 * The ratio as a percentage, or `null` when there is no income to measure against.
 *
 * ⚠️ Null rather than zero, and rather than infinity. A month with no income recorded yet is a
 * reading the app does not have; drawing "0%" or "healthy" over it would be a confident answer to
 * a question nothing has answered. The tile renders "—" for null.
 */
export function debtToIncomeRatio(input: DebtToIncomeInput): number | null {
  if (!(input.income > 0)) return null;
  return (monthlyDebtObligation(input) / input.income) * 100;
}
