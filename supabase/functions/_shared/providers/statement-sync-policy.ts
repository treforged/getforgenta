/**
 * Who owns `accounts.statement_balance` and `accounts.payment_due_day` on a Plaid sync (ask ec48da25).
 *
 * Pure and free of Deno APIs so vitest can load it, same as apr-sync-policy.ts.
 *
 * THE DEFECT THIS FIXES. plaid.ts read only aprs, credit_limit and minimum_payment_amount from
 * /liabilities/get, so NO card's statement balance or due date could ever come from the bank.
 *
 * WHAT `statement_balance` MEANS HERE: the amount still due at the card's NEXT due date (the
 * current statement), not the card's balance. So Plaid's last_statement_balance is only written
 * while that statement is still due: its due date is today or later, minus a payment made since
 * the statement was issued. A statement already paid in full reverts the column to auto (null).
 * Plaid reports only the LAST payment, so two partial payments read as one; the remainder is then
 * overstated, which errs toward paying more and saving interest (the "save the most money" rule).
 *
 * WHO OWNS IT. `statement_balance_plaid_synced` mirrors `apr_plaid_synced`: true means the stored
 * value came from Plaid. A null flag is NOT Plaid's - a person typed it - so it is never touched.
 *
 * DUE DAY is seeded only: Plaid fills an EMPTY payment_due_day and never overwrites one.
 */

export interface PlaidStatementFacts {
  lastStatementBalance: number | null;
  lastStatementIssueDate: string | null;
  nextPaymentDueDate: string | null;
  lastPaymentDate: string | null;
  lastPaymentAmount: number | null;
}

/**
 * Extracts and converts Plaid liability fields into PlaidStatementFacts.
 * @param liab - Plaid liability object with snake_case fields.
 * @returns PlaidStatementFacts with parsed values.
 */
export function factsFromPlaidLiability(liab: Record<string, unknown>): PlaidStatementFacts {
  const parseNumber = (val: unknown): number | null => {
    if (typeof val === 'number' && isFinite(val)) return val;
    if (typeof val === 'string' && val.trim() !== '') {
      const num = Number(val);
      if (!isNaN(num) && isFinite(num)) return num;
    }
    return null;
  };

  const parseDate = (val: unknown): string | null => {
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    return null;
  };

  return {
    lastStatementBalance: parseNumber(liab['last_statement_balance']),
    lastStatementIssueDate: parseDate(liab['last_statement_issue_date']),
    nextPaymentDueDate: parseDate(liab['next_payment_due_date']),
    lastPaymentDate: parseDate(liab['last_payment_date']),
    lastPaymentAmount: parseNumber(liab['last_payment_amount']),
  };
}

/**
 * Calculates the current amount still due based on Plaid facts and today's date.
 * @param f - PlaidStatementFacts.
 * @param today - ISO date string for comparison.
 * @returns Number rounded to 2 decimals or null if conditions not met.
 */
/** Longest gap from statement date to its own due date that still counts as the same cycle. */
export const MAX_STATEMENT_TO_DUE_DAYS = 35;

/** Whole days from one ISO date to another, by UTC midnight (no time zone can shift it). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function statementAmountStillDue(f: PlaidStatementFacts, today: string): number | null {
  if (f.lastStatementBalance === null || f.nextPaymentDueDate === null || f.nextPaymentDueDate < today) {
    return null;
  }

  // The due date must belong to THIS statement. Plaid moves next_payment_due_date on as soon as a
  // due date passes, before the next statement is issued: Tre's Discover read issued 09-04, due
  // 11-01 (58 days) - the 09-04 statement was due 10-01. Card due dates run 21-28 days after the
  // statement, so a gap over 35 days means the statement is no longer the current one.
  if (f.lastStatementIssueDate !== null && daysBetween(f.lastStatementIssueDate, f.nextPaymentDueDate) > MAX_STATEMENT_TO_DUE_DAYS) {
    return null;
  }

  if (f.lastStatementBalance <= 0) return 0;

  if (
    f.lastPaymentDate !== null &&
    f.lastStatementIssueDate !== null &&
    f.lastPaymentDate >= f.lastStatementIssueDate &&
    f.lastPaymentAmount !== null &&
    f.lastPaymentAmount > 0
  ) {
    const adjusted = f.lastStatementBalance - f.lastPaymentAmount;
    return Math.max(0, Math.round(adjusted * 100) / 100);
  }

  return Math.round(f.lastStatementBalance * 100) / 100;
}

export interface StatementSyncDecision {
  write: boolean;
  value: number | null;
  markPlaidSynced: boolean;
  keptManual: boolean;
}

/**
 * Resolves statement balance sync decision based on Plaid data and existing DB state.
 * @param due - Calculated due amount from Plaid.
 * @param existingBalance - Existing DB balance.
 * @param existingPlaidSynced - Whether existing balance was synced from Plaid.
 * @returns Sync decision object.
 */
export function resolveStatementBalanceOnSync(
  due: number | null,
  existingBalance: number | null,
  existingPlaidSynced: boolean | null
): StatementSyncDecision {
  if (existingBalance !== null && existingPlaidSynced !== true) {
    return { write: false, value: existingBalance, markPlaidSynced: false, keptManual: true };
  }

  if (due === null) {
    return {
      write: existingBalance !== null,
      value: null,
      markPlaidSynced: false,
      keptManual: false,
    };
  }

  if (due === 0) {
    return { write: existingBalance !== null, value: null, markPlaidSynced: false, keptManual: false };
  }

  return { write: true, value: due, markPlaidSynced: true, keptManual: false };
}

/**
 * Extracts day of month from date string (1-31) without using Date object.
 * @param date - ISO date string or null.
 * @returns Day as number or null if invalid.
 */
export function dueDayFromDate(date: string | null): number | null {
  if (date === null) return null;
  const parts = date.split('-');
  if (parts.length !== 3) return null;
  const dayStr = parts[2];
  if (/^\d+$/.test(dayStr)) {
    const day = parseInt(dayStr, 10);
    if (day >= 1 && day <= 31) return day;
  }
  return null;
}

/**
 * Resolves due day sync decision based on Plaid and existing data.
 * @param plaidDay - Day from Plaid data.
 * @param existingDay - Existing DB day.
 * @returns Resolved day or null to indicate no write.
 */
export function resolveDueDayOnSync(plaidDay: number | null, existingDay: number | null): number | null {
  if (plaidDay !== null && existingDay === null) return plaidDay;
  return null;
}

/**
 * Plaid error codes that are a definitive answer from the institution: this item has no
 * liability data to give. Anything else (a timeout, a 5xx, ADDITIONAL_CONSENT_REQUIRED) is a
 * failed pass, and a failed pass must not stamp `liability_synced_at`.
 */
export const LIABILITY_DEFINITIVE_NO_DATA: readonly string[] = ["PRODUCTS_NOT_SUPPORTED", "NO_LIABILITY_ACCOUNTS"];

/**
 * Whether one /liabilities/get pass counts as done, so `liability_synced_at` may be stamped.
 * Before ec48da25 the stamp was written even when the pass failed, so it proved nothing.
 */
export function liabilityPassCounts(ok: boolean, errorCode: string | null | undefined): boolean {
  if (ok) return true;
  return typeof errorCode === "string" && LIABILITY_DEFINITIVE_NO_DATA.includes(errorCode);
}
