import { describe, it, expect } from 'vitest';
import { linkMemoryVerdict, MIN_HISTORY_FOR_OUTLIER, UNUSUAL_SD } from '../auto-apply';
import { deriveMerchantLinks, type MerchantLinkRule } from '../merchant-link-memory';

/**
 * A LIMIT THAT CANNOT BIND READS AS A GUARANTEE.
 *
 * `autoApplyDecision`'s fifth gate is Tre's own named anomaly — "the difference is just so large
 * that it makes sense to confirm" — and it was INERT BY CONSTRUCTION. `MerchantLinkRule` carried no
 * amounts, so `isOrdinaryForMerchant` always hit its `history.length < MIN_HISTORY_FOR_OUTLIER`
 * guard and abstained, waving through the exact case the gate was written to catch. Nothing was
 * broken; the evidence simply never arrived, and the gate's presence in the reason list said
 * otherwise.
 *
 * ⚠️ SO THE LOAD-BEARING TEST IS THE POSITIVE ONE: a genuinely unusual amount must come back `ask`.
 * A suite of "ordinary amounts auto-apply" assertions passes perfectly against a gate that can
 * never fire — that is what a green suite over an inert gate looks like.
 */

const HABIT = { linkedCount: 25, conflictingCount: 0 };

describe('linkMemoryVerdict — the outlier gate can now actually fire', () => {
  it('ASKS about a wildly unusual amount, which the inert gate waved through', () => {
    const rule = { ...HABIT, amounts: [2000, 2010, 1995, 2005, 2000, 1998] };
    const v = linkMemoryVerdict(rule, { amount: 900 }, { amount: 2000 });
    expect(v.verdict).toBe('ask');
    expect(v.reason).toBe('unusual-for-this-merchant');
  });

  it('auto-applies the settled payroll case — 25 links, an ordinary amount', () => {
    // The control. Without it the test above is satisfied by a gate that asks about everything,
    // which would reintroduce every prompt this work exists to remove.
    const rule = { ...HABIT, amounts: [2000, 2010, 1995, 2005, 2000, 1998] };
    const v = linkMemoryVerdict(rule, { amount: 2002 }, { amount: 2000 });
    expect(v.verdict).toBe('auto');
    expect(v.reason).toBe('confident');
  });

  it('THE REGRESSION GUARD: an empty history makes the gate abstain, not bind', () => {
    // This is the pre-fix state, asserted deliberately so the difference is visible. `[]` looks
    // like "no history yet" and behaves like "never check" — which is why assembling the evidence
    // by hand at a call site is the thing `linkMemoryVerdict` exists to prevent.
    const v = linkMemoryVerdict({ ...HABIT, amounts: [] }, { amount: 900 }, { amount: 2000 });
    expect(v.verdict).toBe('auto');
  });

  it('abstains just below the history floor and binds at it — the boundary, from a clean pair', () => {
    const below = Array.from({ length: MIN_HISTORY_FOR_OUTLIER - 1 }, () => 2000);
    const at = Array.from({ length: MIN_HISTORY_FOR_OUTLIER }, () => 2000);
    expect(linkMemoryVerdict({ ...HABIT, amounts: below }, { amount: 900 }, { amount: 2000 }).verdict).toBe('auto');
    expect(linkMemoryVerdict({ ...HABIT, amounts: at }, { amount: 900 }, { amount: 2000 }).verdict).toBe('ask');
  });

  it('a dead-constant merchant treats ANY difference as unusual', () => {
    // CFX tolls, Banner Life and Apple.com have a measured CV of 0.0%. A z-score would divide by
    // zero; exact agreement is the rule instead.
    const rule = { ...HABIT, amounts: [9.5, 9.5, 9.5, 9.5, 9.5] };
    expect(linkMemoryVerdict(rule, { amount: 9.5 }, { amount: 9.5 }).verdict).toBe('auto');
    expect(linkMemoryVerdict(rule, { amount: 10.5 }, { amount: 9.5 }).reason).toBe('unusual-for-this-merchant');
  });

  it('a wildly variable merchant is NOT questioned for ordinary variation', () => {
    // Costco's measured CV is 111.5%. A fixed dollar or percent tolerance cannot serve both this
    // merchant and Apple; judging against the merchant's own spread is what does.
    const rule = { ...HABIT, amounts: [40, 250, 90, 600, 120, 310] };
    expect(linkMemoryVerdict(rule, { amount: 480 }, { amount: 200 }).verdict).toBe('auto');
  });

  it('the earlier gates still outrank it — an absurd pairing is never, not a question', () => {
    const rule = { ...HABIT, amounts: [1100, 1100, 1100, 1100, 1100] };
    // The $15-against-$1,100 case that started all of this.
    expect(linkMemoryVerdict(rule, { amount: 15 }, { amount: 1100 }).verdict).toBe('never');
  });

  it('passes the target amount through, so gate 1 can judge the pairing at all', () => {
    // Omitting the target makes `amountCouldSettle` abstain; a caller that forgot it would lose
    // the implausible-amount gate as silently as the missing history lost the outlier one.
    const rule = { ...HABIT, amounts: [1100, 1100, 1100, 1100, 1100] };
    expect(linkMemoryVerdict(rule, { amount: 15 }, null).verdict).not.toBe('never');
  });
});

describe('deriveMerchantLinks — the amounts the gate reads come from real links', () => {
  const charge = (id: string, amount: number | null) => ({
    id, merchant_name: 'PAYROLL CO', name: 'PAYROLL CO', amount,
  });
  const linked = (ruleId: string, at: string) => [{ status: 'linked_rule', rule_id: ruleId, updated_at: at }];

  /**
   * The single derived rule. Asserting there is EXACTLY ONE is the point: reading `rules[someKey]`
   * with a hand-written key couples these tests to merchant normalisation, and a key that stopped
   * matching would surface as `undefined.amounts` rather than as the real finding.
   */
  function only(rules: Record<string, MerchantLinkRule>): MerchantLinkRule {
    const keys = Object.keys(rules);
    expect(keys).toHaveLength(1);
    return rules[keys[0]];
  }

  it('collects the amounts of charges linked to the WINNING rule', () => {
    const rules = deriveMerchantLinks(
      [charge('a', 2000), charge('b', 2010), charge('c', 1995)],
      { a: linked('r1', '3'), b: linked('r1', '2'), c: linked('r1', '1') },
    );
    expect(only(rules).amounts.sort()).toEqual([1995, 2000, 2010]);
  });

  it('EXCLUDES amounts linked somewhere else — a different obligation is a different population', () => {
    // Folding them in widens the spread with another bill's figures and makes a real outlier look
    // ordinary. That fails permissively, which is the wrong direction.
    const rules = deriveMerchantLinks(
      [charge('a', 2000), charge('b', 2010), charge('c', 55), charge('d', 1995)],
      { a: linked('r1', '4'), b: linked('r1', '3'), c: linked('r2', '2'), d: linked('r1', '1') },
    );
    expect(only(rules).ruleId).toBe('r1');
    expect(only(rules).amounts).not.toContain(55);
    expect(only(rules).amounts).toHaveLength(3);
  });

  it('DROPS a missing amount rather than counting it as $0', () => {
    // A zero would be a real charge of nothing: it pulls the mean down and the spread up, making
    // the outlier test MORE permissive. Absent evidence must leave the gate abstaining instead.
    const rules = deriveMerchantLinks(
      [charge('a', 2000), charge('b', null), charge('c', 1995)],
      { a: linked('r1', '3'), b: linked('r1', '2'), c: linked('r1', '1') },
    );
    expect(only(rules).amounts).not.toContain(0);
    expect(only(rules).amounts.sort()).toEqual([1995, 2000]);
    // The count is unchanged — the link happened; only its amount is unknown.
    expect(only(rules).linkedCount).toBe(3);
  });

  it('END TO END: derived amounts make a real outlier ask', () => {
    // The two halves joined. Either alone can be green while the gate is still inert.
    const history = [2000, 2010, 1995, 2005, 2000];
    const rules = deriveMerchantLinks(
      history.map((a, i) => charge(`c${i}`, a)),
      Object.fromEntries(history.map((_, i) => [`c${i}`, linked('r1', String(i))])),
    );
    const v = linkMemoryVerdict(only(rules), { amount: 850 }, { amount: 2000 });
    expect(v.reason).toBe('unusual-for-this-merchant');
  });
});

describe('the chosen constants are still the chosen constants', () => {
  it('pins the thresholds these tests reason from', () => {
    // A silent change to either would alter every verdict above while leaving the suite green in a
    // way that looked like the behaviour was unchanged.
    expect(MIN_HISTORY_FOR_OUTLIER).toBe(5);
    expect(UNUSUAL_SD).toBe(2.5);
  });
});
