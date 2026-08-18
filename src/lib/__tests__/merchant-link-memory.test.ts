// Link memory, pinned on the shape that produced it.
//
// The numbers here are Tre's real ones, read off Supabase on 2026-08-18: 22 `linked_rule` rows on
// `LOCKHEED MARTIN PAYROLL PPD ID: 4521893632`, every one pointing at the income rule
// `3a30b089-a93c-4e44-b200-f45be007b6d0` ("Weekly Paycheck"), and a 23rd charge of -815.75 with no
// review at all. That 23rd charge is what the deck opened on with nine expense chips.

import { describe, it, expect } from 'vitest';
import {
  deriveMerchantLinks, merchantLinkFor, linkSuggestionFor, MIN_LINKS_TO_REMEMBER,
  type MerchantLinkReview,
} from '../merchant-link-memory';

const PAYROLL = 'LOCKHEED MARTIN PAYROLL PPD ID: 4521893632';
const PAYCHECK = '3a30b089-a93c-4e44-b200-f45be007b6d0';
const payrollRule = { id: PAYCHECK, name: 'Weekly Paycheck', active: true };

/** `n` payroll charges, each carrying one link to `ruleId`. */
function payrollHistory(n: number, ruleId = PAYCHECK) {
  const charges = Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: PAYROLL, merchant_name: null }));
  const reviews: Record<string, MerchantLinkReview[]> = {};
  for (const [i, charge] of charges.entries()) {
    reviews[charge.id] = [{
      status: 'linked_rule', rule_id: ruleId, updated_at: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }];
  }
  return { charges, reviews };
}

describe('deriveMerchantLinks', () => {
  it("remembers the rule Tre's payroll has been linked to 22 times", () => {
    const { charges, reviews } = payrollHistory(22);
    const rules = deriveMerchantLinks(charges, reviews);

    // The trailing ACH trace id is stripped, so all 22 land on ONE key.
    expect(Object.keys(rules)).toEqual(['LOCKHEED MARTIN PAYROLL']);
    expect(rules['LOCKHEED MARTIN PAYROLL']).toMatchObject({
      ruleId: PAYCHECK, linkedCount: 22, conflictingCount: 0,
    });
  });

  it('says nothing about a merchant linked only once', () => {
    const { charges, reviews } = payrollHistory(1);
    expect(deriveMerchantLinks(charges, reviews)).toEqual({});
    // The threshold is the reason, not an accident of this fixture.
    expect(MIN_LINKS_TO_REMEMBER).toBe(2);
  });

  it('remembers at exactly the threshold', () => {
    const { charges, reviews } = payrollHistory(MIN_LINKS_TO_REMEMBER);
    expect(deriveMerchantLinks(charges, reviews)['LOCKHEED MARTIN PAYROLL'].linkedCount)
      .toBe(MIN_LINKS_TO_REMEMBER);
  });

  it('ignores every status that is not a rule link, and links with no rule id', () => {
    const charges = [
      { id: 'a', name: PAYROLL, merchant_name: null },
      { id: 'b', name: PAYROLL, merchant_name: null },
      { id: 'c', name: PAYROLL, merchant_name: null },
    ];
    const reviews: Record<string, MerchantLinkReview[]> = {
      // `ignored` and `categorized` are decisions, but not decisions about WHICH RULE.
      a: [{ status: 'ignored', rule_id: null }],
      b: [{ status: 'categorized', rule_id: null }],
      // A link row whose rule id is missing names nothing and must not be counted.
      c: [{ status: 'linked_rule', rule_id: null }],
    };
    expect(deriveMerchantLinks(charges, reviews)).toEqual({});
  });

  it('counts the majority rule and carries the disagreement rather than hiding it', () => {
    const { charges, reviews } = payrollHistory(3);
    // One charge went somewhere else — a paycheck the user split off once.
    reviews.c2 = [{ status: 'linked_rule', rule_id: 'other-rule', updated_at: '2026-08-09T00:00:00Z' }];

    const rule = deriveMerchantLinks(charges, reviews)['LOCKHEED MARTIN PAYROLL'];
    expect(rule.ruleId).toBe(PAYCHECK);
    expect(rule.linkedCount).toBe(2);
    expect(rule.conflictingCount).toBe(1);
  });

  it('lets a genuine switch take over once it is the habit', () => {
    const { charges, reviews } = payrollHistory(4);
    // The last two went to a new rule, and the old two are history.
    reviews.c2 = [{ status: 'linked_rule', rule_id: 'new-rule', updated_at: '2026-08-20T00:00:00Z' }];
    reviews.c3 = [{ status: 'linked_rule', rule_id: 'new-rule', updated_at: '2026-08-21T00:00:00Z' }];
    reviews.c4 = [{ status: 'linked_rule', rule_id: 'new-rule', updated_at: '2026-08-22T00:00:00Z' }];
    charges.push({ id: 'c4', name: PAYROLL, merchant_name: null });

    expect(deriveMerchantLinks(charges, reviews)['LOCKHEED MARTIN PAYROLL'].ruleId).toBe('new-rule');
  });

  it('counts every link row on a split-linked charge', () => {
    const charges = [{ id: 'a', name: 'RENT', merchant_name: null }];
    const reviews: Record<string, MerchantLinkReview[]> = {
      a: [
        { status: 'linked_rule', rule_id: 'rent', updated_at: '2026-08-01T00:00:00Z' },
        { status: 'linked_rule', rule_id: 'rent', updated_at: '2026-08-01T00:00:00Z' },
      ],
    };
    expect(deriveMerchantLinks(charges, reviews).RENT.linkedCount).toBe(2);
  });

  it('is deterministic when two rules tie on count and timestamp', () => {
    const charges = [
      { id: 'a', name: 'X', merchant_name: null }, { id: 'b', name: 'X', merchant_name: null },
      { id: 'c', name: 'X', merchant_name: null }, { id: 'd', name: 'X', merchant_name: null },
    ];
    const at = '2026-08-01T00:00:00Z';
    const reviews: Record<string, MerchantLinkReview[]> = {
      a: [{ status: 'linked_rule', rule_id: 'bbb', updated_at: at }],
      b: [{ status: 'linked_rule', rule_id: 'bbb', updated_at: at }],
      c: [{ status: 'linked_rule', rule_id: 'aaa', updated_at: at }],
      d: [{ status: 'linked_rule', rule_id: 'aaa', updated_at: at }],
    };
    expect(deriveMerchantLinks(charges, reviews).X.ruleId).toBe('aaa');
  });
});

describe('merchantLinkFor', () => {
  const { charges, reviews } = payrollHistory(22);
  const rules = deriveMerchantLinks(charges, reviews);
  // The 23rd paycheck: a DIFFERENT amount and no review of its own.
  const card = { id: 'new', name: PAYROLL, merchant_name: null };

  it('speaks for the unreviewed 23rd paycheck', () => {
    expect(merchantLinkFor(card, rules)?.ruleId).toBe(PAYCHECK);
  });

  it('stays quiet for a merchant the user switched off', () => {
    expect(merchantLinkFor(card, rules, { 'LOCKHEED MARTIN PAYROLL': true })).toBeNull();
  });

  it('stays quiet for an unrelated merchant', () => {
    expect(merchantLinkFor({ id: 'z', name: 'CHEWY', merchant_name: null }, rules)).toBeNull();
  });
});

describe('linkSuggestionFor', () => {
  const { charges, reviews } = payrollHistory(22);
  const rules = deriveMerchantLinks(charges, reviews);
  const byId = { [PAYCHECK]: payrollRule };
  const card = { id: 'new', name: PAYROLL, merchant_name: null };

  it('offers the paycheck rule on the card that had only expense chips', () => {
    const offered = linkSuggestionFor(card, null, rules, byId);
    expect(offered?.rule.name).toBe('Weekly Paycheck');
    expect(offered?.memory.linkedCount).toBe(22);
  });

  it('never overrules the matcher — evidence about THIS charge wins', () => {
    const matched = { rule: { id: 'something-else', name: 'Rent' } };
    expect(linkSuggestionFor(card, matched, rules, byId)).toBeNull();
  });

  it('stays quiet when the merchant has been linked two different ways', () => {
    const conflicted = {
      ...rules,
      'LOCKHEED MARTIN PAYROLL': { ...rules['LOCKHEED MARTIN PAYROLL'], conflictingCount: 1 },
    };
    expect(linkSuggestionFor(card, null, conflicted, byId)).toBeNull();
  });

  it('stays quiet when the remembered rule has been deleted', () => {
    expect(linkSuggestionFor(card, null, rules, {})).toBeNull();
  });

  it('stays quiet when the remembered rule was retired — never resurrects a projection', () => {
    expect(linkSuggestionFor(card, null, rules, { [PAYCHECK]: { ...payrollRule, active: false } }))
      .toBeNull();
  });
});
