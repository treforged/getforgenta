// WHAT HAPPENS TO A SUPERSEDED ACCOUNT — delete the noise, never the thing someone built on.
//
// Tre, 2026-09-02: "the duplicates need to actually be deleted automatically." Right, and the
// reason this is a split rather than a DELETE is his own data: on the same day, one superseded
// Robinhood account had a $100,000 savings goal pointing at it and the manual card it replaced
// carried a $230/month rule. Deleting a referenced row breaks the thing that references it.
//
// Re-pointing automatically is the move already proven wrong here - Robinhood returned two
// accounts BOTH named "Robinhood individual" and a session guessed backwards - so the rule is
// delete what is provably safe and hide the rest.
//
// Would-fail check: make planAccountRetirement return everything as deletable and the two
// "referenced" cases fail; invert the referenced test and the plain-duplicate case fails.

import { describe, it, expect } from 'vitest';
import { planAccountRetirement } from '../../../supabase/functions/_shared/retire-accounts.ts';

describe('planAccountRetirement', () => {
  it('DELETES a duplicate nothing points at — the whole point of the ask', () => {
    const plan = planAccountRetirement(['a', 'b'], new Set());
    expect(plan.deletable).toEqual(['a', 'b']);
    expect(plan.deactivateOnly).toEqual([]);
  });

  it('KEEPS one a goal or a rule still points at', () => {
    // 'a' is the Robinhood account the $100k "Brokerage" goal was linked to.
    const plan = planAccountRetirement(['a', 'b'], new Set(['a']));
    expect(plan.deletable).toEqual(['b']);
    expect(plan.deactivateOnly).toEqual(['a']);
  });

  it('keeps every stale account when all of them are referenced', () => {
    const plan = planAccountRetirement(['a', 'b'], new Set(['a', 'b']));
    expect(plan.deletable).toEqual([]);
    expect(plan.deactivateOnly).toEqual(['a', 'b']);
  });

  it('ignores references to accounts that are not being retired', () => {
    // A goal pointing at a LIVE account must not stop a stale one being removed.
    const plan = planAccountRetirement(['stale'], new Set(['some-live-account']));
    expect(plan.deletable).toEqual(['stale']);
  });

  it('does nothing at all when there is nothing stale', () => {
    const plan = planAccountRetirement([], new Set(['a']));
    expect(plan.deletable).toEqual([]);
    expect(plan.deactivateOnly).toEqual([]);
  });

  it('every stale id lands in exactly one bucket, always', () => {
    // The property that matters: this decides deletion, so an id that fell out of both lists
    // would be a row silently left counting in net worth.
    const stale = ['a', 'b', 'c', 'd'];
    const plan = planAccountRetirement(stale, new Set(['b', 'd']));
    expect([...plan.deletable, ...plan.deactivateOnly].sort()).toEqual(stale);
    expect(plan.deletable.filter(id => plan.deactivateOnly.includes(id))).toEqual([]);
  });
});
