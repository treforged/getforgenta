/**
 * THE DASHBOARD'S "PROJECTED MONTH-END CASH" DRAWER, AS NUMBERS.
 *
 * Dashboard.tsx `openMonthEndCalc` prints these rows top to bottom; each '+' / '−' row folds into a
 * running total and each '=' row is a checkpoint that total must equal. They used to be built inline
 * in the page, where nothing could check that the column adds up. Built here, a test folds them
 * (month0-transfer-parity.test.ts).
 *
 * Every row is a term of `month0.chain`, the exact terms the engine consumed. A term under half a
 * cent is left out, and a negative term is printed as its absolute value under the opposite sign,
 * so the printed column still reads as a sum.
 */
import type { Month0Result } from '@/lib/debt-model-types';

export interface Month0DrawerLine {
  /** Stable id, so a test can find a row without matching its wording. */
  key: string;
  label: string;
  /** Dollars and cents. A '+' / '−' row is the absolute value, its sign carried by `op`; the
   *  opening row and each '=' checkpoint are signed, as printed. */
  amount: number;
  /** undefined opens the column; '=' is a checkpoint. */
  op?: '+' | '−' | '=';
}

const CENT_HALF = 0.005;

export function month0DrawerChainLines(m0: Month0Result, monthEndCash: number): Month0DrawerLine[] {
  const c = m0.chain;
  const term = (key: string, label: string, value: number, op: '+' | '−'): Month0DrawerLine[] =>
    Math.abs(value) >= CENT_HALF
      ? [{ key, label, amount: Math.abs(value), op: value < 0 ? (op === '−' ? '+' : '−') : op }]
      : [];
  // `transfers` already carries the checking-paid part of other accounts' bills (see
  // Month0CashChain.unfundedAccountOutflow). It is printed on its own row, so the transfers row
  // shows only the rest; the two rows sum back to `transfers` exactly.
  const unfunded = c.unfundedAccountOutflow ?? 0;
  return [
    { key: 'fundingBalance', label: 'Balance on hand', amount: c.fundingBalance },
    ...term('income', 'Income still coming', c.income, '+'),
    ...term('expenses', 'Bills still coming', c.expenses, '−'),
    ...term('planExpenses', 'Payment Plans (from checking)', c.planExpenses, '−'),
    ...term('goalContributions', 'Savings goals', c.goalContributions, '−'),
    // Ranked automatic extra payments: surplus the user's ranking sent to goals and car
    // funds ahead of the cards. Omit it and the column is short by exactly that amount.
    ...term('autoExtraReserve', 'Extra to goals & car funds', c.autoExtraReserve, '−'),
    // §2.9: 'Balance on hand' is the GROSS balance now, so this row is what keeps the drawer's
    // column adding up to `cashPreDebt`. Omit it and the equation is short by the earmark.
    ...term('carSavedEarmark', 'Already saved toward a car', c.carSavedEarmark, '−'),
    ...term('carReserve', 'Car down payment reserve', c.carReserve, '−'),
    ...term('carLoanPayment', 'Auto loan payment', c.carLoanPayment, '−'),
    ...term('vehicleInsurance', 'Vehicle insurance (est.)', c.vehicleInsurance, '−'),
    ...term('otherDebtPayment', 'Other loan payments', c.otherDebtPayment, '−'),
    ...term('transfers', 'Transfers & lump sums', c.transfers - unfunded, '−'),
    // 5810a568: the part of another account's bills that account cannot cover, paid from checking.
    ...term('unfundedAccountOutflow', "Other accounts' bills paid from checking", unfunded, '−'),
    // b80124a0: what a transfer from savings or another account really moved into checking.
    ...term('nonCashIntoFunding', 'Moved into checking from other accounts', c.nonCashIntoFunding ?? 0, '+'),
    ...term('oneTimeNet', 'One-time transactions', c.oneTimeNet, '+'),
    { key: 'cashPreDebt', label: 'Cash before debt payments', amount: c.cashPreDebt, op: '=' },
    ...term('safeToPayTotal', 'Debt payments (available to deploy)', m0.safeToPayTotal, '−'),
    ...term('carReserveHeld', 'Car reserve still held at month end', m0.carReserveHeld, '+'),
    { key: 'monthEndCash', label: 'Projected Month-End Cash', amount: monthEndCash, op: '=' },
  ];
}
