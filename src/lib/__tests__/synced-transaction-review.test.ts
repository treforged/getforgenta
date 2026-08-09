import { describe, it, expect } from 'vitest';
import { validateReviewInput, isHandledReview } from '../synced-transaction-review';

describe('validateReviewInput', () => {
  // THE RULE THE DATABASE CANNOT ENFORCE. `rule_id` is ON DELETE SET NULL, SET NULL fires an UPDATE,
  // and Postgres evaluates CHECKs on UPDATE — so "status='linked_rule' implies rule_id is not null"
  // as a CHECK would make DELETING A RULE fail. Creation-time presence has nowhere else to live.
  it('rejects a rule link with no rule', () => {
    expect(validateReviewInput({
      synced_transaction_id: 's1', status: 'linked_rule', occurrence_month: '2026-08',
    })).toBe('A rule link needs a rule');
  });

  // A rule recurs and a charge does not, so a link without the occurrence it settles says nothing.
  it('rejects a rule link with no occurrence month', () => {
    expect(validateReviewInput({
      synced_transaction_id: 's1', status: 'linked_rule', rule_id: 'r1',
    })).toBe('A rule link needs the month it settles');
  });

  it('accepts a complete rule link', () => {
    expect(validateReviewInput({
      synced_transaction_id: 's1', status: 'linked_rule', rule_id: 'r1', occurrence_month: '2026-08',
    })).toBeNull();
  });

  // §1B Stage 4C — the SAME database-unenforceable rule as `linked_rule`, and for the same reason:
  // `payment_plan_id` is ON DELETE SET NULL, so a CHECK requiring it would make deleting a payment
  // plan fail. Creation-time presence has nowhere to live but here.
  it('rejects a plan link with no payment plan', () => {
    expect(validateReviewInput({
      synced_transaction_id: 's1', status: 'linked_plan', occurrence_month: '2026-08',
    })).toBe('A plan link needs a payment plan');
  });

  // A plan bills every month; without the occurrence the link says nothing about which one.
  it('rejects a plan link with no occurrence month', () => {
    expect(validateReviewInput({
      synced_transaction_id: 's1', status: 'linked_plan', payment_plan_id: 'p1',
    })).toBe('A plan link needs the month it settles');
  });

  it('accepts a complete plan link', () => {
    expect(validateReviewInput({
      synced_transaction_id: 's1', status: 'linked_plan', payment_plan_id: 'p1', occurrence_month: '2026-08',
    })).toBeNull();
  });

  // A plan link is NOT a rule link. Nothing about naming a plan implies a recurring rule, and
  // accepting a `rule_id` in its place would let the (separate) rule-occurrence suppression read a
  // plan charge as settling a bill.
  it('does not accept a rule in place of a payment plan', () => {
    expect(validateReviewInput({
      synced_transaction_id: 's1', status: 'linked_plan', rule_id: 'r1', occurrence_month: '2026-08',
    })).toBe('A plan link needs a payment plan');
  });

  it.each(['linked_txn', 'imported'] as const)('rejects %s with no ledger entry', status => {
    expect(validateReviewInput({ synced_transaction_id: 's1', status }))
      .toBe('That status needs a ledger entry');
  });

  // A stale pointer would make the row look linked to any query reading the FKs without the status.
  it.each(['ignored', 'categorized'] as const)('rejects %s that still carries a link', status => {
    expect(validateReviewInput({ synced_transaction_id: 's1', status, rule_id: 'r1' }))
      .toBe('That status cannot stay linked to a rule, plan or entry');
    expect(validateReviewInput({ synced_transaction_id: 's1', status, transaction_id: 't1' }))
      .toBe('That status cannot stay linked to a rule, plan or entry');
    expect(validateReviewInput({ synced_transaction_id: 's1', status, payment_plan_id: 'p1' }))
      .toBe('That status cannot stay linked to a rule, plan or entry');
  });

  it.each(['ignored', 'categorized'] as const)('accepts a clean %s', status => {
    expect(validateReviewInput({ synced_transaction_id: 's1', status })).toBeNull();
  });

  it('rejects a malformed occurrence month', () => {
    expect(validateReviewInput({
      synced_transaction_id: 's1', status: 'linked_rule', rule_id: 'r1', occurrence_month: '2026-8',
    })).toBe('Bad month');
  });

  it('rejects a decision about nothing', () => {
    expect(validateReviewInput({ synced_transaction_id: '', status: 'ignored' })).toBe('Missing transaction');
  });
});

describe('isHandledReview', () => {
  // ABSENCE MEANS UNREVIEWED, and unreviewed means NOTHING AT ALL. With all history in scope most
  // rows are permanently unreviewed by design, so this must never be read as "did not happen".
  it('is false for no review', () => {
    expect(isHandledReview(null)).toBe(false);
    expect(isHandledReview(undefined)).toBe(false);
  });

  it.each(['linked_rule', 'linked_txn', 'imported', 'ignored', 'linked_plan'])('treats %s as handled', status => {
    expect(isHandledReview({ status })).toBe(true);
  });

  // The whole reason the fifth status exists: correcting a label is not taking a position on
  // whether the charge was dealt with. If this ever flips to true, fixing a wrong auto-category
  // would silently mark the charge resolved.
  it('does NOT treat categorized as handled', () => {
    expect(isHandledReview({ status: 'categorized' })).toBe(false);
  });

  it('does not treat an unknown status as handled', () => {
    expect(isHandledReview({ status: 'something_new' })).toBe(false);
  });
});
