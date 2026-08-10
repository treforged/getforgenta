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
  linkTarget,
  findExclusiveReview,
  findReviewRowFor,
  applyReviewToSet,
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

// §1B SPLIT LINK Slice C — THE ROUTING.
//
// `validateReviewSet` above says which sets are legal. These say how a write REACHES a set: which of
// a charge's rows a decision lands on, and whether "link another" is an INSERT or an UPDATE. The two
// are one mechanism — the routing enforces structurally what the validator rejects, so a rule that
// survives here survives an edit to the validator, and vice versa.
//
// Written against the same pure helpers `useSupabaseData.ts` calls, so a change that would break the
// live write paths breaks these first, without a Supabase client.

const carLink = (kind: 'loan_payment' | 'insurance', over: Partial<ReviewInput> = {}): ReviewInput => ({
  synced_transaction_id: CHARGE,
  status: 'linked_car',
  car_fund_id: 'c1',
  car_charge_kind: kind,
  occurrence_month: '2026-08',
  ...over,
});

const planLink = (id: string, over: Partial<ReviewInput> = {}): ReviewInput => ({
  synced_transaction_id: CHARGE,
  status: 'linked_plan',
  payment_plan_id: id,
  occurrence_month: '2026-08',
  ...over,
});

const categorized = (label: string): ReviewInput => ({
  synced_transaction_id: CHARGE,
  status: 'categorized',
  category_override: label,
});

describe('linkTarget — the key of the three dedupe indexes', () => {
  it('keys a rule link by its rule, a plan link by its plan', () => {
    expect(linkTarget(ruleLink({ rule_id: 'rent' }))).toBe('rule:rent');
    expect(linkTarget(planLink('p1'))).toBe('plan:p1');
  });

  // The car index is `(txn, car_fund_id, car_charge_kind)` — the kind is part of the key because one
  // vehicle bills two independently-gated obligations a month, and both may sit on one charge.
  it('keys a vehicle link by BOTH the vehicle and which of its two charges it paid', () => {
    expect(linkTarget(carLink('loan_payment'))).toBe('car:c1:loan_payment');
    expect(linkTarget(carLink('loan_payment'))).not.toBe(linkTarget(carLink('insurance')));
  });

  // Null is not "no answer" here, it is the answer: the exclusive row occupies no dedupe slot, and
  // that is exactly what routes an exclusive decision to `findExclusiveReview`.
  it.each(['imported', 'ignored', 'linked_txn', 'categorized'])('is null for the exclusive status %s', s => {
    expect(linkTarget({ status: s })).toBeNull();
  });

  // The month is deliberately NOT in the key. One charge settling two occurrences of the SAME rule is
  // a claim nothing downstream can read — see the arrears test above, which rejects it.
  it('does not distinguish two months of the same rule', () => {
    expect(linkTarget(ruleLink({ occurrence_month: '2026-07' })))
      .toBe(linkTarget(ruleLink({ occurrence_month: '2026-08' })));
  });
});

describe('findExclusiveReview — the at-most-one row that is about the charge itself', () => {
  it('finds the exclusive row among several links', () => {
    const cat = categorized('Rent');
    expect(findExclusiveReview([ruleLink({ rule_id: 'rent' }), cat, planLink('p1')])).toBe(cat);
  });

  // A charge whose only decisions are links has NO row to carry a category, which is why
  // `setCategory` must be able to INSERT one rather than assuming it can update.
  it('returns undefined when the charge holds only links', () => {
    expect(findExclusiveReview([ruleLink({ rule_id: 'rent' }), ruleLink({ rule_id: 'water' })]))
      .toBeUndefined();
    expect(findExclusiveReview([])).toBeUndefined();
  });
});

describe('findReviewRowFor — UPDATE this row, or undefined to INSERT a new one', () => {
  // THE BUG THIS FUNCTION EXISTS TO PREVENT: before it, every write found the charge's one row and
  // updated it, so linking a second rule would have silently overwritten the first.
  it('routes a NEW target to an INSERT, leaving the existing link alone', () => {
    const rows = [ruleLink({ rule_id: 'rent' })];
    expect(findReviewRowFor(rows, ruleLink({ rule_id: 'water', occurrence_month: '2026-07' })))
      .toBeUndefined();
  });

  it('routes the SAME target to the row already holding it — changing your mind is an UPDATE', () => {
    const rent = ruleLink({ rule_id: 'rent', occurrence_month: '2026-08' });
    const rows = [rent, ruleLink({ rule_id: 'water', occurrence_month: '2026-07' })];
    // Same rule, different month: still the same row, because the month is not part of the key.
    expect(findReviewRowFor(rows, ruleLink({ rule_id: 'rent', occurrence_month: '2026-07' }))).toBe(rent);
  });

  it('treats a vehicle two charges as different targets and the same one as an UPDATE', () => {
    const loan = carLink('loan_payment');
    expect(findReviewRowFor([loan], carLink('insurance'))).toBeUndefined();
    expect(findReviewRowFor([loan], carLink('loan_payment', { occurrence_month: '2026-07' }))).toBe(loan);
  });

  // Structural enforcement of idempotency: an exclusive decision can never find its way to a second
  // row, so "a row already imported cannot be imported twice" holds without the validator being asked.
  it('routes EVERY exclusive decision to the one exclusive row, whatever its status', () => {
    const cat = categorized('Rent');
    const rows = [ruleLink({ rule_id: 'rent' }), cat, planLink('p1')];
    const ignored: ReviewInput = { synced_transaction_id: CHARGE, status: 'ignored' };
    const imported: ReviewInput = {
      synced_transaction_id: CHARGE, status: 'imported', transaction_id: 't1',
    };
    expect(findReviewRowFor(rows, ignored)).toBe(cat);
    expect(findReviewRowFor(rows, imported)).toBe(cat);
    expect(findReviewRowFor(rows, categorized('Groceries'))).toBe(cat);
  });

  it('routes an exclusive decision to an INSERT when the charge holds only links', () => {
    expect(findReviewRowFor([ruleLink({ rule_id: 'rent' })], categorized('Rent'))).toBeUndefined();
  });
});

describe('applyReviewToSet — the set a write would produce', () => {
  it('appends a new target', () => {
    const rows = [ruleLink({ rule_id: 'rent' })];
    const water = ruleLink({ rule_id: 'water', occurrence_month: '2026-07' });
    expect(applyReviewToSet(rows, water)).toEqual([...rows, water]);
  });

  it('replaces the row it routes to, in place, without growing the set', () => {
    const rent = ruleLink({ rule_id: 'rent', occurrence_month: '2026-08' });
    const water = ruleLink({ rule_id: 'water', occurrence_month: '2026-07' });
    const next = ruleLink({ rule_id: 'rent', occurrence_month: '2026-07' });
    expect(applyReviewToSet([rent, water], next)).toEqual([next, water]);
  });

  // The caller still holds `existing`, and one of those rows is about to be sent to the database as
  // an UPDATE. Mutating it here would change what the caller believes it is updating.
  it('does not mutate its input', () => {
    const rent = ruleLink({ rule_id: 'rent', occurrence_month: '2026-08' });
    const existing = [rent];
    const before = JSON.parse(JSON.stringify(existing));
    const result = applyReviewToSet(existing, ruleLink({ rule_id: 'rent', occurrence_month: '2026-07' }));
    expect(existing).toEqual(before);
    expect(existing[0]).toBe(rent);
    expect(result).not.toBe(existing);
  });

  // The join the write path actually makes: route, apply, then hand the result to the set validator.
  // These are the two answers that matter — the arrears case is legal, and neither of the two things
  // the routing is supposed to make unreachable can be produced by it.
  it('produces a set the validator accepts for the arrears case', () => {
    const built = [
      ruleLink({ rule_id: 'rent' }),
      ruleLink({ rule_id: 'internet' }),
      ruleLink({ rule_id: 'water', occurrence_month: '2026-07' }),
      categorized('Rent'),
    ].reduce<ReviewInput[]>((set, input) => applyReviewToSet(set, input), []);
    expect(built.length).toBe(4);
    expect(validateReviewSet(built)).toBeNull();
  });

  it('cannot produce a second exclusive row, nor the same thing linked twice', () => {
    const ignored: ReviewInput = { synced_transaction_id: CHARGE, status: 'ignored' };
    const built = [
      categorized('Rent'),
      ruleLink({ rule_id: 'rent' }),
      ignored,
      ruleLink({ rule_id: 'rent', occurrence_month: '2026-07' }),
    ].reduce<ReviewInput[]>((set, input) => applyReviewToSet(set, input), []);
    expect(built.length).toBe(2);
    expect(built.filter(r => !isLinkStatus(r.status)).length).toBe(1);
    expect(validateReviewSet(built)).toBeNull();
  });
});
