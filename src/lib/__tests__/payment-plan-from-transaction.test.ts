import { describe, it, expect } from 'vitest';
import {
  planDraftFromTransaction,
  type TransactionForPlanConversion,
  type PlanConversionContext,
} from '../payment-plan-from-transaction';

const realExpense: TransactionForPlanConversion = {
  id: 'aa0f4c62-1d1e-4b93-9a2e-6b7c1f0d5e11',
  date: '2026-08-03',
  type: 'expense',
  amount: 1249.99,
  category: 'Shopping',
  note: 'MacBook Pro',
};

const ctx: PlanConversionContext = { paymentSource: 'account:1f5b6b9e-9c1e-4f6a-8d47-2a3b4c5d6e7f' };

/** The intent's draft, or a thrown failure naming the refusal reason. */
function draftOf(txn: TransactionForPlanConversion, c: PlanConversionContext = ctx) {
  const intent = planDraftFromTransaction(txn, c);
  if (!intent.ok) throw new Error(`expected a draft, got refusal: ${intent.reason}`);
  return intent.draft;
}

describe('planDraftFromTransaction refusals', () => {
  it('refuses a reconciliation row', () => {
    const intent = planDraftFromTransaction(
      { ...realExpense, id: 'recon-row', isReconciliation: true },
      ctx,
    );
    expect(intent.ok).toBe(false);
    expect(intent.ok === false && intent.reason).toMatch(/balance adjustment/i);
  });

  it('refuses a generated recurring occurrence', () => {
    const intent = planDraftFromTransaction({ ...realExpense, isGenerated: true }, ctx);
    expect(intent.ok).toBe(false);
    expect(intent.ok === false && intent.reason).toMatch(/recurring rule/i);
  });

  it.each([
    ['gen:rule-1:2026-08-03', 'a generated occurrence id'],
    ['debt:card-1:2026-08-03', 'a debt payoff row'],
    ['plan:plan-1:2', 'a plan installment'],
    ['car:fund-1:2026-08-03', 'a car loan payment'],
    ['recon:abc', 'a reconciliation'],
  ])('refuses the synthetic id %s (%s)', id => {
    // A composite id names no `transactions` row, so nothing could be deleted after the plan saves.
    const intent = planDraftFromTransaction({ ...realExpense, id }, ctx);
    expect(intent.ok).toBe(false);
    expect(intent.ok === false && intent.reason).toMatch(/projected/i);
  });

  it('refuses an empty id', () => {
    expect(planDraftFromTransaction({ ...realExpense, id: '' }, ctx).ok).toBe(false);
  });

  it('refuses an income row', () => {
    const intent = planDraftFromTransaction(
      { ...realExpense, type: 'income', category: 'Income' },
      ctx,
    );
    expect(intent.ok).toBe(false);
    expect(intent.ok === false && intent.reason).toMatch(/expense/i);
  });

  it.each([0, NaN, Infinity])('refuses the unusable amount %s', amount => {
    const intent = planDraftFromTransaction({ ...realExpense, amount }, ctx);
    expect(intent.ok).toBe(false);
    expect(intent.ok === false && intent.reason).toMatch(/usable amount/i);
  });

  it('accepts an ordinary hand-entered expense', () => {
    expect(planDraftFromTransaction(realExpense, ctx).ok).toBe(true);
  });
});

describe('planDraftFromTransaction field mapping', () => {
  it('carries name, amount, date, category and payment source across', () => {
    expect(draftOf(realExpense)).toEqual({
      name: 'MacBook Pro',
      provider: '',
      total_amount: '1249.99',
      frequency: 'monthly',
      start_date: '2026-08-03',
      total_payments: '',
      category: 'Shopping',
      payment_source: 'account:1f5b6b9e-9c1e-4f6a-8d47-2a3b4c5d6e7f',
      plan_type: 'upfront',
      notes: '',
    });
  });

  it('never invents an installment count', () => {
    // Nothing on a transaction says how many payments were agreed. A guess would silently reshape
    // the per-payment figure the user is shown.
    expect(draftOf(realExpense).total_payments).toBe('');
    expect(draftOf({ ...realExpense, amount: 400 }).total_payments).toBe('');
  });

  it('stores the total as a positive amount', () => {
    // PostgREST hands `numeric` back as a string, and a negative would break the form's > 0 check.
    expect(draftOf({ ...realExpense, amount: -899.5 }).total_amount).toBe('899.5');
    expect(draftOf({ ...realExpense, amount: '250.25' as unknown as number }).total_amount).toBe('250.25');
  });

  it('trims the note into the plan name and falls back when it is blank', () => {
    expect(draftOf({ ...realExpense, note: '  Sofa  ' }).name).toBe('Sofa');
    expect(draftOf({ ...realExpense, note: '   ' }).name).toBe('Transaction');
    expect(draftOf({ ...realExpense, note: null }).name).toBe('Transaction');
  });

  it('falls back to the form default for a category the plan select cannot show', () => {
    // The plan form's select is built from CATEGORIES; an unknown value renders it blank.
    expect(draftOf({ ...realExpense, category: 'Balance Adjustment' }).category).toBe('Shopping');
    expect(draftOf({ ...realExpense, category: 'Groceries' }).category).toBe('Groceries');
  });

  it('leaves payment source unassigned when the row has none', () => {
    expect(draftOf(realExpense, { paymentSource: null }).payment_source).toBe('');
    expect(draftOf(realExpense, { paymentSource: undefined }).payment_source).toBe('');
  });
});
