/**
 * ec48da25 - a card's statement balance and due date from Plaid /liabilities/get.
 *
 * Before this, plaid.ts never read last_statement_balance, last_statement_issue_date or
 * next_payment_due_date, so no card's statement figures could come from the bank. These tests pin
 * the rules: write only what is STILL DUE, never overwrite a typed value, seed the due day only.
 */
import { describe, expect, it } from 'vitest';
import {
  liabilityConsentRequired,
  dueDayFromDate,
  factsFromPlaidLiability,
  liabilityPassCounts,
  resolveDueDayOnSync,
  resolveStatementBalanceOnSync,
  statementAmountStillDue,
  type PlaidStatementFacts,
} from '../../../supabase/functions/_shared/providers/statement-sync-policy';

const TODAY = '2026-10-03';
const facts = (o: Partial<PlaidStatementFacts>): PlaidStatementFacts => ({
  lastStatementBalance: 334.26, lastStatementIssueDate: '2026-09-18',
  nextPaymentDueDate: '2026-10-12', lastPaymentDate: '2026-09-01', lastPaymentAmount: 200,
  ...o,
});

describe('factsFromPlaidLiability', () => {
  it('reads the five fields', () => {
    expect(factsFromPlaidLiability({
      last_statement_balance: 334.26, last_statement_issue_date: '2026-09-18',
      next_payment_due_date: '2026-10-12', last_payment_date: '2026-09-01', last_payment_amount: '200',
    })).toEqual(facts({}));
  });
  it('rejects junk: empty string, NaN, bad dates', () => {
    expect(factsFromPlaidLiability({
      last_statement_balance: '', last_statement_issue_date: '09/18/2026',
      next_payment_due_date: null, last_payment_date: 7, last_payment_amount: 'abc',
    })).toEqual({
      lastStatementBalance: null, lastStatementIssueDate: null, nextPaymentDueDate: null,
      lastPaymentDate: null, lastPaymentAmount: null,
    });
  });
});

describe('statementAmountStillDue', () => {
  it('a statement with no payment since it was issued is due in full', () => {
    expect(statementAmountStillDue(facts({}), TODAY)).toBe(334.26);
  });
  it('a payment after the statement reduces what is due', () => {
    expect(statementAmountStillDue(facts({ lastPaymentDate: '2026-09-25', lastPaymentAmount: 100 }), TODAY)).toBe(234.26);
  });
  it('a statement paid in full is 0, and an overpayment never goes negative', () => {
    expect(statementAmountStillDue(facts({ lastPaymentDate: '2026-09-25', lastPaymentAmount: 334.26 }), TODAY)).toBe(0);
    expect(statementAmountStillDue(facts({ lastPaymentDate: '2026-09-25', lastPaymentAmount: 900 }), TODAY)).toBe(0);
  });
  it('a past due date is no longer the current statement', () => {
    expect(statementAmountStillDue(facts({ nextPaymentDueDate: '2026-10-02' }), TODAY)).toBeNull();
  });
  it('a due date that belongs to the NEXT statement is no opinion (Tre\'s Discover, 10-03 probe)', () => {
    expect(statementAmountStillDue(facts({
      lastStatementBalance: 10413.92, lastStatementIssueDate: '2026-09-04', nextPaymentDueDate: '2026-11-01',
      lastPaymentDate: '2026-10-01', lastPaymentAmount: 198.17,
    }), TODAY)).toBeNull();
    // 35 days is still the same cycle; 36 is not.
    expect(statementAmountStillDue(facts({ lastStatementIssueDate: '2026-09-07', nextPaymentDueDate: '2026-10-12' }), TODAY)).toBe(334.26);
    expect(statementAmountStillDue(facts({ lastStatementIssueDate: '2026-09-06', nextPaymentDueDate: '2026-10-12' }), TODAY)).toBeNull();
  });
  it('due today still counts', () => {
    expect(statementAmountStillDue(facts({ nextPaymentDueDate: TODAY }), TODAY)).toBe(334.26);
  });
  it('no balance or no due date is no opinion', () => {
    expect(statementAmountStillDue(facts({ lastStatementBalance: null }), TODAY)).toBeNull();
    expect(statementAmountStillDue(facts({ nextPaymentDueDate: null }), TODAY)).toBeNull();
  });
  it('a credit or zero statement owes nothing', () => {
    expect(statementAmountStillDue(facts({ lastStatementBalance: -12 }), TODAY)).toBe(0);
  });
});

describe('resolveStatementBalanceOnSync', () => {
  it('NEVER overwrites a typed value (flag null or false)', () => {
    expect(resolveStatementBalanceOnSync(334.26, 500, null))
      .toEqual({ write: false, value: 500, markPlaidSynced: false, keptManual: true });
    expect(resolveStatementBalanceOnSync(null, 500, false).write).toBe(false);
    expect(resolveStatementBalanceOnSync(0, 500, false).write).toBe(false);
  });
  it('fills an empty column and claims it', () => {
    expect(resolveStatementBalanceOnSync(334.26, null, null))
      .toEqual({ write: true, value: 334.26, markPlaidSynced: true, keptManual: false });
  });
  it('replaces its own earlier value', () => {
    expect(resolveStatementBalanceOnSync(120, 334.26, true))
      .toEqual({ write: true, value: 120, markPlaidSynced: true, keptManual: false });
  });
  it('reverts its own value to auto when paid or no longer current', () => {
    expect(resolveStatementBalanceOnSync(0, 334.26, true))
      .toEqual({ write: true, value: null, markPlaidSynced: false, keptManual: false });
    expect(resolveStatementBalanceOnSync(null, 334.26, true))
      .toEqual({ write: true, value: null, markPlaidSynced: false, keptManual: false });
  });
  it('writes nothing when there is nothing to change', () => {
    expect(resolveStatementBalanceOnSync(0, null, null).write).toBe(false);
    expect(resolveStatementBalanceOnSync(null, null, true).write).toBe(false);
  });
});

describe('due day', () => {
  it('parses the day of month', () => {
    expect(dueDayFromDate('2026-10-12')).toBe(12);
    expect(dueDayFromDate('2026-10-00')).toBeNull();
    expect(dueDayFromDate(null)).toBeNull();
  });
  it('seeds an empty due day and never overwrites one', () => {
    expect(resolveDueDayOnSync(12, null)).toBe(12);
    expect(resolveDueDayOnSync(12, 15)).toBeNull();
    expect(resolveDueDayOnSync(null, null)).toBeNull();
  });
});

describe('liabilityPassCounts (liability_synced_at)', () => {
  it('a successful pass counts', () => expect(liabilityPassCounts(true, null)).toBe(true));
  it('a definitive no-data answer counts, so the re-link prompt clears', () => {
    expect(liabilityPassCounts(false, 'PRODUCTS_NOT_SUPPORTED')).toBe(true);
    expect(liabilityPassCounts(false, 'NO_LIABILITY_ACCOUNTS')).toBe(true);
  });
  it('a failed pass does NOT count', () => {
    expect(liabilityPassCounts(false, 'INTERNAL_SERVER_ERROR')).toBe(false);
    expect(liabilityPassCounts(false, 'ADDITIONAL_CONSENT_REQUIRED')).toBe(false);
    expect(liabilityPassCounts(false, undefined)).toBe(false);
  });
});

// Ask 3248738e: the stored "needs statement-data consent" flag. A failed pass that proves nothing
// must leave it alone, or a timeout would clear a real consent request.
describe('liabilityConsentRequired', () => {
  it('says consent is needed only on ADDITIONAL_CONSENT_REQUIRED', () => {
    expect(liabilityConsentRequired(false, 'ADDITIONAL_CONSENT_REQUIRED')).toBe(true);
  });
  it('clears the flag on a liabilities pass that succeeds', () => {
    expect(liabilityConsentRequired(true, null)).toBe(false);
  });
  it('leaves the flag unchanged on a pass that proves neither', () => {
    expect(liabilityConsentRequired(false, 'INTERNAL_SERVER_ERROR')).toBeUndefined();
    expect(liabilityConsentRequired(false, undefined)).toBeUndefined();
    expect(liabilityConsentRequired(false, 'PRODUCTS_NOT_SUPPORTED')).toBeUndefined();
  });
});
