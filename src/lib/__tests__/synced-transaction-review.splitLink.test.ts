// §1B SPLIT LINK Slice A — the rules ABOUT A SET of decisions on one charge.
//
// These pin the DECISIONS, not just the behaviour. Every rule here mirrors a partial unique index
// the migration will add (Slice C), so if one of these ever loosens, the database will start
// rejecting writes with a constraint name the user cannot act on instead.

import { describe, it, expect } from 'vitest';
import {
  validateReviewInput,
  validateReviewSet,
  isLinkStatus,
  LINK_STATUSES,
  type ReviewInput,
} from '../synced-transaction-review';

const CHARGE = '11111111-1111-4111-8111-111111111111';

const ruleLink = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  synced_transaction_id: CHARGE,
  status: 'linked_rule',
  rule_id: 'rent',
  occurrence_month: '2026-08',
  ...over,
});

describe('isLinkStatus — the predicate of the partial unique index', () => {
  it.each(['linked_rule', 'linked_plan', 'linked_car'])('%s is a link a charge may hold several of', s => {
    expect(isLinkStatus(s)).toBe(true);
  });

  // The exclusive row. `'imported'` is the one that carries import idempotency, so if it ever became
  // a link status a charge could be imported twice — the failure the whole constraint exists for.
  it.each(['imported', 'ignored', 'linked_txn', 'categorized'])('%s is EXCLUSIVE — at most one per charge', s => {
    expect(isLinkStatus(s)).toBe(false);
  });

  it('is false for a missing status rather than throwing', () => {
    expect(isLinkStatus(null)).toBe(false);
    expect(isLinkStatus(undefined)).toBe(false);
  });

  it('names exactly the three link statuses, no more', () => {
    expect([...LINK_STATUSES].sort()).toEqual(['linked_car', 'linked_plan', 'linked_rule']);
  });
});

describe('validateReviewInput — one row names one thing', () => {
  // Under N rows per charge each link row occupies a slot in exactly one dedupe index. A row
  // carrying two ids occupies two, so "linked twice" stops being detectable — and every reader that
  // keys on one id alone (`buildConfirmedOccurrences` keys on `rule_id`) would act on the other.
  it('rejects a rule link that also names a payment plan', () => {
    expect(validateReviewInput(ruleLink({ payment_plan_id: 'p1' })))
      .toBe('A link names one thing, and this one also names a payment plan');
  });

  it('rejects a rule link that also names a vehicle', () => {
    expect(validateReviewInput(ruleLink({ car_fund_id: 'c1', car_charge_kind: 'insurance' })))
      .toBe('A link names one thing, and this one also names a vehicle');
  });

  it('rejects a plan link that also names a vehicle', () => {
    expect(validateReviewInput({
      synced_transaction_id: CHARGE, status: 'linked_plan', payment_plan_id: 'p1',
      occurrence_month: '2026-08', car_fund_id: 'c1', car_charge_kind: 'loan_payment',
    })).toBe('A link names one thing, and this one also names a vehicle');
  });

  it('rejects a vehicle link that also names a rule', () => {
    expect(validateReviewInput({
      synced_transaction_id: CHARGE, status: 'linked_car', car_fund_id: 'c1',
      car_charge_kind: 'loan_payment', occurrence_month: '2026-08', rule_id: 'r1',
    })).toBe('A link names one thing, and this one also names a rule');
  });

  // The MISSING-target rule still wins over the cross-target one: a plan link carrying only a
  // `rule_id` is missing its plan first and foremost, and that is the sentence the user can act on.
  it('still reports a missing target before a stray one', () => {
    expect(validateReviewInput({
      synced_transaction_id: CHARGE, status: 'linked_plan', rule_id: 'r1', occurrence_month: '2026-08',
    })).toBe('A plan link needs a payment plan');
  });

  // Slice A changes NO per-row behaviour for the rows the app writes today.
  it('still accepts a plain rule link, and one carrying a category the way the app writes it now', () => {
    expect(validateReviewInput(ruleLink())).toBeNull();
    expect(validateReviewInput(ruleLink({ category_override: 'Rent' }))).toBeNull();
  });
});

describe('validateReviewSet — the rules about the whole charge', () => {
  // THE CASE THE FEATURE EXISTS FOR. Tre's rent debit settles Rent, Internet and Smart Home for THIS
  // month and the Water/Sewer/Trash rider for the PREVIOUS one, billed in arrears. The per-link
  // month is why this is N rows and not a child table.
  it('accepts a rent charge split across three rules this month and a rider in arrears', () => {
    expect(validateReviewSet([
      ruleLink({ rule_id: 'rent', occurrence_month: '2026-08' }),
      ruleLink({ rule_id: 'internet', occurrence_month: '2026-08' }),
      ruleLink({ rule_id: 'smart-home', occurrence_month: '2026-08' }),
      ruleLink({ rule_id: 'water', occurrence_month: '2026-07' }),
    ])).toBeNull();
  });

  it('accepts links of different kinds on one charge', () => {
    expect(validateReviewSet([
      ruleLink(),
      { synced_transaction_id: CHARGE, status: 'linked_plan', payment_plan_id: 'p1', occurrence_month: '2026-08' },
      {
        synced_transaction_id: CHARGE, status: 'linked_car', car_fund_id: 'c1',
        car_charge_kind: 'loan_payment', occurrence_month: '2026-08',
      },
    ])).toBeNull();
  });

  it('accepts one exclusive decision alongside the links', () => {
    expect(validateReviewSet([
      { synced_transaction_id: CHARGE, status: 'categorized', category_override: 'Rent' },
      ruleLink(),
      ruleLink({ rule_id: 'water', occurrence_month: '2026-07' }),
    ])).toBeNull();
  });

  it('accepts an empty set — no decisions is not an invalid set of decisions', () => {
    expect(validateReviewSet([])).toBeNull();
  });

  it('rejects the same rule linked to the same charge twice', () => {
    expect(validateReviewSet([ruleLink(), ruleLink()]))
      .toBe('That is already linked to this charge');
  });

  // Not a duplicate: the same rule for two DIFFERENT months is the arrears case above, and the
  // dedupe index is `(synced_transaction_id, rule_id)` — so this one IS rejected, on purpose. A
  // single charge settling two occurrences of the SAME rule is a claim nothing downstream can read:
  // `buildConfirmedOccurrences` would key both, but the user has no way to say which is which.
  it('rejects the same rule twice even across different months', () => {
    expect(validateReviewSet([ruleLink({ occurrence_month: '2026-08' }), ruleLink({ occurrence_month: '2026-07' })]))
      .toBe('That is already linked to this charge');
  });

  it('rejects the same payment plan twice', () => {
    const plan: ReviewInput = {
      synced_transaction_id: CHARGE, status: 'linked_plan', payment_plan_id: 'p1', occurrence_month: '2026-08',
    };
    expect(validateReviewSet([plan, plan])).toBe('That is already linked to this charge');
  });

  // A vehicle bills a loan payment AND an insurance premium every month, and the engines gate them
  // independently — so BOTH on one charge is legitimate, and the same one twice is not.
  it('accepts both of a vehicle\'s charges but rejects the same one twice', () => {
    const car = (kind: 'loan_payment' | 'insurance'): ReviewInput => ({
      synced_transaction_id: CHARGE, status: 'linked_car', car_fund_id: 'c1',
      car_charge_kind: kind, occurrence_month: '2026-08',
    });
    expect(validateReviewSet([car('loan_payment'), car('insurance')])).toBeNull();
    expect(validateReviewSet([car('insurance'), car('insurance')])).toBe('That is already linked to this charge');
  });

  // IDEMPOTENCY, the job the dropped UNIQUE was doing that MUST survive: a row already imported
  // cannot be imported twice.
  it('rejects two exclusive decisions on one charge', () => {
    expect(validateReviewSet([
      { synced_transaction_id: CHARGE, status: 'imported', transaction_id: 't1' },
      { synced_transaction_id: CHARGE, status: 'imported', transaction_id: 't2' },
    ])).toBe('A charge can only hold one of those decisions at a time');
    expect(validateReviewSet([
      { synced_transaction_id: CHARGE, status: 'ignored' },
      { synced_transaction_id: CHARGE, status: 'categorized', category_override: 'Rent' },
    ])).toBe('A charge can only hold one of those decisions at a time');
  });

  // Tre, 2026-08-09: the category describes the CHARGE, not one of the several things it paid.
  // With the column populated on every row a charge could assert two categories with no rule for
  // which one wins.
  it('rejects a category on a link row — it belongs to the exclusive row', () => {
    expect(validateReviewSet([ruleLink({ category_override: 'Rent' })]))
      .toBe('A category belongs to the charge, not to one of its links');
  });

  it('pins WHERE the override may live: N links plus a category = exactly one row holding it', () => {
    const set: ReviewInput[] = [
      { synced_transaction_id: CHARGE, status: 'categorized', category_override: 'Rent' },
      ruleLink({ rule_id: 'rent' }),
      ruleLink({ rule_id: 'water', occurrence_month: '2026-07' }),
      ruleLink({ rule_id: 'internet' }),
    ];
    expect(validateReviewSet(set)).toBeNull();
    expect(set.filter(r => r.category_override).length).toBe(1);
  });

  it('still applies every per-row rule to every row of the set', () => {
    expect(validateReviewSet([ruleLink(), ruleLink({ rule_id: null, occurrence_month: '2026-07' })]))
      .toBe('A rule link needs a rule');
  });

  // A set is a set of decisions about ONE charge. Mixing charges would silently apply one charge's
  // exclusivity budget to another's rows.
  it('rejects a set spanning two charges', () => {
    expect(validateReviewSet([ruleLink(), ruleLink({ synced_transaction_id: 'other', rule_id: 'water' })]))
      .toBe('These decisions are about different charges');
  });
});
