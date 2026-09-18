/**
 * A SINGLE STRAY LINK MUST NOT VETO A SETTLED HABIT — on both paths.
 *
 * Tre, 2026-09-18: "the transactions still aren't automatically connecting to the planned
 * purchases ... some of my subscriptions or my income with similar amounts that are planned are
 * not automatically matching and they're still asking me about them. I don't know if I was
 * supposed to do one sweep of transaction selecting to connect them or what."
 *
 * ⚠️ THE ANSWER TO HIS QUESTION IS NO, AND THAT IS WHAT THIS FILE PINS. Measured on his real
 * ledger: `APPLE.COM/BILL` carries 6 links to one rule and 1 to another, and the old
 * `conflictingCount > 0` test returned `ask` at 6, 10, 25, 100 and 1000 links to the winner. A
 * sweep ADDS links, and links were never what the gate counted — so no amount of answering could
 * ever have stopped the prompts.
 *
 * ⚠️ BOTH PATHS ARE ASSERTED ON PURPOSE. The veto existed TWICE — `linkSuggestionFor` (whether to
 * OFFER) and `autoApplyDecision` (whether to ACT). Fixing either alone is inert, because the
 * suggestion gate runs first and returning null there means the act gate is never reached. That is
 * this repo's recorded "the fix was applied at five sites and a sixth would look exactly like
 * this" shape, and it is why these are two separate assertions rather than one.
 */
import { describe, it, expect } from 'vitest';
import { linkMemoryVerdict } from '@/lib/auto-apply';
import {
  habitIsSettled, linkSuggestionFor, MIN_DOMINANCE_RATIO,
  type MerchantLinkRule,
} from '@/lib/merchant-link-memory';

const none = new Set<string>();
const APPLE_HISTORY = [9.99, 9.99, 9.99, 9.99, 9.99, 9.99];

/** His real Apple merchant: 6 links to the winning rule, 1 stray elsewhere. */
const appleMemory: MerchantLinkRule = {
  key: 'APPLE.COM/BILL', label: 'APPLE.COM/BILL',
  ruleId: 'rule-apple', linkedCount: 6, conflictingCount: 1, amounts: APPLE_HISTORY,
};

describe('habitIsSettled', () => {
  it('no conflict at all is settled', () => {
    expect(habitIsSettled(3, 0)).toBe(true);
  });

  it('HIS CASE: 6 links against 1 stray is a settled habit', () => {
    expect(habitIsSettled(6, 1)).toBe(true);
  });

  // CONTROLS — the bar must still REFUSE a genuine split, or this is not a gate.
  it('CONTROL: 3 against 1 is still split', () => {
    expect(habitIsSettled(3, 1)).toBe(false);
  });
  it('CONTROL: 10 against 4 is still split', () => {
    expect(habitIsSettled(10, 4)).toBe(false);
  });
  it('the bar is the documented ratio, exactly at the boundary', () => {
    expect(habitIsSettled(MIN_DOMINANCE_RATIO, 1)).toBe(true);
    expect(habitIsSettled(MIN_DOMINANCE_RATIO - 1, 1)).toBe(false);
  });
});

describe('PATH 1 — the app OFFERS the remembered rule', () => {
  const rulesByKey = { 'APPLE.COM/BILL': appleMemory };
  const rulesById = { 'rule-apple': { id: 'rule-apple', active: true, amount: 9.99 } };
  const charge = { id: 'c1', name: 'APPLE.COM/BILL', merchant_name: 'APPLE.COM/BILL', amount: 9.99 };

  it('HIS CASE: the suggestion is offered despite the one stray link', () => {
    const s = linkSuggestionFor(charge as never, null, rulesByKey, rulesById as never);
    expect(s).not.toBeNull();
    expect(s!.rule.id).toBe('rule-apple');
  });

  it('CONTROL: a genuinely split merchant is still offered nothing', () => {
    const split = { ...appleMemory, linkedCount: 3, conflictingCount: 1 };
    const s = linkSuggestionFor(
      charge as never, null, { 'APPLE.COM/BILL': split }, rulesById as never);
    expect(s).toBeNull();
  });
});

describe('PATH 2 — the app ACTS without asking', () => {
  it('HIS CASE: a $9.99 Apple charge auto-applies', () => {
    const v = linkMemoryVerdict(appleMemory, { amount: 9.99, id: 'c1' }, { amount: 9.99 }, false, none);
    expect(v).toEqual({ verdict: 'auto', reason: 'confident' });
  });

  it('CONTROL: a genuinely split merchant still asks, and says why', () => {
    const v = linkMemoryVerdict(
      { ...appleMemory, linkedCount: 3, conflictingCount: 1 },
      { amount: 9.99, id: 'c1' }, { amount: 9.99 }, false, none);
    expect(v).toEqual({ verdict: 'ask', reason: 'conflicting-history' });
  });

  /**
   * ⚠️ THE LOAD-BEARING CONTROL. Dominance decides whether the HABIT is settled; it must not have
   * weakened the check on whether THIS CHARGE is ordinary. His stray Apple link is a $7.98 among
   * $9.99s — with the conflict gate now passing, the outlier gate is the only thing standing
   * between him and an unwatched write of the wrong amount.
   */
  it('CONTROL: the odd amount is STILL caught, by the outlier gate', () => {
    const v = linkMemoryVerdict(appleMemory, { amount: 7.98, id: 'c2' }, { amount: 9.99 }, false, none);
    expect(v).toEqual({ verdict: 'ask', reason: 'unusual-for-this-merchant' });
  });

  it('CONTROL: an explicit undo still outranks a settled habit', () => {
    const v = linkMemoryVerdict(
      appleMemory, { amount: 9.99, id: 'c1' }, { amount: 9.99 }, false, new Set(['c1']));
    expect(v).toEqual({ verdict: 'ask', reason: 'previously-undone' });
  });
});
