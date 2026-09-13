/**
 * "CLEAR ALL MERCHANT MEMORY" DELETES THE USER'S OWN LABELS, because that is what a rule is.
 *
 * Tre, 2026-09-13: "it doesn't need to explicitly have every single one in merchant memory and
 * settings. We could just have a section that says how many are linked and then give them the
 * option to clear it... give them the option to delete all saved data, and they can restart from
 * scratch."
 *
 * ⚠️ THE THING A READER GETS WRONG. There is no `merchant_rules` table — verified against the
 * database on 2026-09-13, no table matching %merchant% or %memory% exists. A rule is the
 * `category_override` already recorded on a charge. So "clear the memory" and "delete every
 * category I have set" are the same operation, and on Tre's account that is **516 decisions across
 * 21 categories**. The plan below is what makes the size sayable before the button runs, and what
 * makes it reversible afterwards.
 */
import { describe, it, expect } from 'vitest';
import { planMerchantMemoryClear } from '../merchant-memory';

const charge = (id: string, merchant: string) => ({ id, merchant_name: merchant, name: merchant });
const labelled = (category: string) => [{ status: 'categorized', category_override: category, updated_at: '2026-09-01' }];

describe('planMerchantMemoryClear — every label it would destroy, and the way back', () => {
  it('plans one entry per labelled charge, carrying what to restore', () => {
    const plan = planMerchantMemoryClear(
      [charge('c1', 'COSTCO'), charge('c2', 'NETFLIX')],
      { c1: labelled('Groceries'), c2: labelled('Subscriptions') },
    );
    expect(plan).toHaveLength(2);
    // The undo value, not the new one — this is what puts the user's answer back.
    expect(plan.find(p => p.chargeId === 'c1')?.previousCategory).toBe('Groceries');
    expect(plan.find(p => p.chargeId === 'c2')?.previousCategory).toBe('Subscriptions');
  });

  it('SKIPS a charge with no category — a write that changes nothing inflates the number shown', () => {
    // The count is what the user decides on, so it has to be the count of real losses.
    const plan = planMerchantMemoryClear([charge('c1', 'COSTCO')], { c1: [] });
    expect(plan).toHaveLength(0);
  });

  it('SKIPS a charge with no readable merchant — no rule was ever derived from it', () => {
    // Clearing it would delete a label the memory never used, which is outside what the button
    // promises. The control that keeps this honest is the labelled case above.
    const plan = planMerchantMemoryClear([charge('c1', '   ')], { c1: labelled('Groceries') });
    expect(plan).toHaveLength(0);
  });

  it('covers EVERY merchant, not one — that is the difference from a re-label', () => {
    // planMerchantRelabel takes a key and touches one merchant. This one takes none and must touch
    // all of them; a copy-paste that kept the key filter would silently clear only the last.
    const plan = planMerchantMemoryClear(
      [charge('c1', 'COSTCO'), charge('c2', 'NETFLIX'), charge('c3', 'SHELL')],
      { c1: labelled('Groceries'), c2: labelled('Subscriptions'), c3: labelled('Gas') },
    );
    expect(plan.map(p => p.chargeId).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('counts each charge once even when one merchant has many', () => {
    const plan = planMerchantMemoryClear(
      [charge('c1', 'COSTCO'), charge('c2', 'COSTCO'), charge('c3', 'COSTCO')],
      { c1: labelled('Groceries'), c2: labelled('Groceries'), c3: labelled('Shopping') },
    );
    expect(plan).toHaveLength(3);
    // The conflicting one keeps ITS own previous value, not the merchant's winning rule — the undo
    // restores what each charge actually said.
    expect(plan.find(p => p.chargeId === 'c3')?.previousCategory).toBe('Shopping');
  });
});
