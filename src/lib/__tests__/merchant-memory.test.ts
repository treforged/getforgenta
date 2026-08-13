// §1B Stage 7A — merchant memory. Synthetic values only (AGENT.md: nothing derived from real data).
import { describe, it, expect } from 'vitest';
import {
  normalizeMerchant, deriveMerchantRules, merchantRuleFor, planRetroactivePass, planRetroactiveUndo,
  planMerchantRelabel,
  type MerchantCharge, type MerchantReview,
} from '../merchant-memory';

const charge = (id: string, merchant: string): MerchantCharge => ({ id, merchant_name: merchant, name: merchant });
const categorized = (category: string, at = '2026-01-01T00:00:00Z'): MerchantReview[] =>
  [{ status: 'categorized', category_override: category, updated_at: at }];

describe('normalizeMerchant', () => {
  it('folds case and whitespace so one merchant is one key', () => {
    expect(normalizeMerchant('  Corner   Cafe ')).toBe('CORNER CAFE');
    expect(normalizeMerchant('corner cafe')).toBe(normalizeMerchant('CORNER CAFE'));
  });

  it('strips a trailing reference number', () => {
    // The case the card names: the same merchant with and without its phone/reference tail.
    expect(normalizeMerchant('EXAMPLECO 5551234567')).toBe('EXAMPLECO');
    expect(normalizeMerchant('EXAMPLECO')).toBe('EXAMPLECO');
    expect(normalizeMerchant('EXAMPLECO 5551234567')).toBe(normalizeMerchant('EXAMPLECO'));
  });

  it('strips an ACH trace and a masked account tail, including both on one name', () => {
    expect(normalizeMerchant('SAMPLE PAYROLL PPD ID: 1234567890')).toBe('SAMPLE PAYROLL');
    expect(normalizeMerchant('SAMPLE CARD 0000 WEB ID: 9999999999')).toBe('SAMPLE CARD');
    expect(normalizeMerchant('SAMPLE BILL XXXX1234')).toBe('SAMPLE BILL');
  });

  it('KEEPS a digit that is part of the name, not a reference', () => {
    // The regression this guard exists for: a leading digit and a short numeric suffix are names.
    expect(normalizeMerchant('9-Eleven')).toBe('9-ELEVEN');
    expect(normalizeMerchant('Station 66')).toBe('STATION 66');
  });

  it('never returns an empty key, even when the whole name looks like a reference', () => {
    expect(normalizeMerchant('12345')).toBe('12345');
    expect(normalizeMerchant('   ')).toBeNull();
    expect(normalizeMerchant(null)).toBeNull();
  });

  it('does not collapse two different merchants that share a prefix', () => {
    expect(normalizeMerchant('SAMPLE STORE')).not.toBe(normalizeMerchant('SAMPLE STORE GROCERY'));
  });
});

describe('deriveMerchantRules', () => {
  it('learns a merchant from one categorised charge', () => {
    const rules = deriveMerchantRules(
      [charge('a', 'Corner Cafe'), charge('b', 'Corner Cafe')],
      { a: categorized('Dining') },
    );
    expect(rules['CORNER CAFE'].category).toBe('Dining');
    expect(rules['CORNER CAFE'].decidedCount).toBe(1);
  });

  it('applies a decision across the reference-number variants of one merchant', () => {
    const rules = deriveMerchantRules(
      [charge('a', 'EXAMPLECO 5551234567'), charge('b', 'EXAMPLECO')],
      { a: categorized('Bills') },
    );
    expect(merchantRuleFor(charge('b', 'EXAMPLECO'), rules)?.category).toBe('Bills');
  });

  it('takes the MOST RECENT decision, not the majority, and reports the disagreement', () => {
    const rules = deriveMerchantRules(
      [charge('a', 'Big Box'), charge('b', 'Big Box'), charge('c', 'Big Box')],
      {
        a: categorized('Groceries', '2026-01-01T00:00:00Z'),
        b: categorized('Groceries', '2026-02-01T00:00:00Z'),
        c: categorized('Shopping', '2026-03-01T00:00:00Z'),
      },
    );
    expect(rules['BIG BOX'].category).toBe('Shopping');
    expect(rules['BIG BOX'].decidedCount).toBe(3);
    expect(rules['BIG BOX'].conflictingCount).toBe(2);
  });

  it('IGNORES a category sitting on a link row', () => {
    // The 2026-08-09 rule: the category lives on the exclusive row. A stale override on a link must
    // never become the answer taught to every future charge of that merchant.
    const rules = deriveMerchantRules([charge('a', 'Corner Cafe')], {
      a: [{ status: 'linked_rule', category_override: 'Travel', updated_at: '2026-03-01T00:00:00Z' }],
    });
    expect(rules['CORNER CAFE']).toBeUndefined();
  });

  it('ignores an override that is not a real category', () => {
    const rules = deriveMerchantRules([charge('a', 'Corner Cafe')], { a: categorized('NotACategory') });
    expect(rules['CORNER CAFE']).toBeUndefined();
  });

  it('a suppressed merchant still exists as a rule but speaks for no charge', () => {
    const rules = deriveMerchantRules([charge('a', 'Corner Cafe')], { a: categorized('Dining') });
    expect(rules['CORNER CAFE']).toBeDefined();
    expect(merchantRuleFor(charge('b', 'Corner Cafe'), rules, { 'CORNER CAFE': true })).toBeNull();
  });
});

describe('planRetroactivePass', () => {
  const charges = [
    charge('a', 'Corner Cafe'),
    charge('b', 'Corner Cafe'),
    charge('c', 'Corner Cafe 9999999999'),
    charge('d', 'Other Shop'),
  ];
  const reviews = { a: categorized('Dining') };

  it('labels every un-categorised charge of a learned merchant, and counts them', () => {
    const rules = deriveMerchantRules(charges, reviews);
    const pass = planRetroactivePass(charges, reviews, rules);
    expect(pass.writes.map(w => w.chargeId)).toEqual(['b', 'c']);
    expect(pass.byMerchant).toEqual([
      { key: 'CORNER CAFE', label: 'Corner Cafe', category: 'Dining', count: 2 },
    ]);
  });

  it('NEVER overwrites a category the user already set', () => {
    const rules = deriveMerchantRules(charges, reviews);
    const withOwnAnswer = { ...reviews, b: categorized('Travel', '2026-05-01T00:00:00Z') };
    const pass = planRetroactivePass(charges, withOwnAnswer, rules);
    expect(pass.writes.map(w => w.chargeId)).toEqual(['c']);
  });

  it('skips a suppressed merchant entirely', () => {
    const rules = deriveMerchantRules(charges, reviews);
    expect(planRetroactivePass(charges, reviews, rules, { 'CORNER CAFE': true }).writes).toEqual([]);
  });

  it('undoes the whole pass, restoring each charge to what it was', () => {
    const rules = deriveMerchantRules(charges, reviews);
    const pass = planRetroactivePass(charges, reviews, rules);
    const undo = planRetroactiveUndo(pass);
    // Reversed, so a stopped undo unwinds the newest write first.
    expect(undo).toEqual([
      { chargeId: 'c', category: null },
      { chargeId: 'b', category: null },
    ]);
    // Every charge the pass touched is in the undo, and nothing else is.
    expect(undo.map(u => u.chargeId).sort()).toEqual(pass.writes.map(w => w.chargeId).sort());
  });

  it('is idempotent: replaying it after its writes land does nothing', () => {
    const rules = deriveMerchantRules(charges, reviews);
    const pass = planRetroactivePass(charges, reviews, rules);
    const after = { ...reviews } as Record<string, MerchantReview[]>;
    for (const w of pass.writes) after[w.chargeId] = categorized(w.category, '2026-06-01T00:00:00Z');
    expect(planRetroactivePass(charges, after, deriveMerchantRules(charges, after)).writes).toEqual([]);
  });
});

describe('planMerchantRelabel', () => {
  const charges = [
    charge('a', 'Corner Cafe'),
    charge('b', 'Corner Cafe'),
    charge('c', 'Corner Cafe 9999999999'),
    charge('d', 'Other Shop'),
  ];

  it('re-labels ONLY the charges that already carry a category', () => {
    // The regression this exists for: the Settings guard compared the RULE, so it was true on every
    // iteration and one dropdown change bulk-wrote the whole un-categorised backlog with no undo.
    const reviews = { a: categorized('Dining'), d: categorized('Dining') };
    const plan = planMerchantRelabel(charges, reviews, 'CORNER CAFE', 'Travel');
    expect(plan).toEqual([{ chargeId: 'a', previousCategory: 'Dining' }]);
  });

  it('covers every reference-number variant of the merchant that carries a category', () => {
    const reviews = { a: categorized('Dining'), c: categorized('Dining') };
    expect(planMerchantRelabel(charges, reviews, 'CORNER CAFE', 'Travel').map(w => w.chargeId))
      .toEqual(['a', 'c']);
  });

  it('records the previous category so the change reverses', () => {
    const reviews = { a: categorized('Dining'), c: categorized('Shopping') };
    expect(planMerchantRelabel(charges, reviews, 'CORNER CAFE', 'Travel')).toEqual([
      { chargeId: 'a', previousCategory: 'Dining' },
      { chargeId: 'c', previousCategory: 'Shopping' },
    ]);
  });

  it('writes nothing when the charges already say what the edit says', () => {
    const reviews = { a: categorized('Dining'), c: categorized('Dining') };
    expect(planMerchantRelabel(charges, reviews, 'CORNER CAFE', 'Dining')).toEqual([]);
  });

  it('never touches another merchant', () => {
    const reviews = { a: categorized('Dining'), d: categorized('Dining') };
    expect(planMerchantRelabel(charges, reviews, 'CORNER CAFE', 'Travel').map(w => w.chargeId))
      .not.toContain('d');
  });

  it('ignores a category recorded on a LINK row, exactly as the deriver does', () => {
    // A link row may carry a stale override (Tre, 2026-08-09); it is not the charge's answer, so a
    // re-label must not treat it as one and must not write over it.
    const reviews = { a: [{ status: 'linked_rule', category_override: 'Dining', updated_at: '2026-01-01T00:00:00Z' }] };
    expect(planMerchantRelabel(charges, reviews, 'CORNER CAFE', 'Travel')).toEqual([]);
  });
});
