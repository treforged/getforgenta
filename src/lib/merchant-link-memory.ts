// §1B — LINK memory: the RULE a merchant's charges keep getting linked to.
//
// WHY THIS FILE EXISTS, on a real row. Tre's card 1 was `LOCKHEED MARTIN PAYROLL PPD ID: 4521893632`,
// +$815.75, MONEY IN. The same merchant already carried **22** `linked_rule` decisions, every one of
// them to the same income rule (`Weekly Paycheck`), and the deck asked a 23rd time as though it had
// never been told. It asked with expense chips, because nothing in the app had noticed.
//
// The reason it had not noticed is precise and worth stating, because the obvious fix is the wrong
// one. `merchant-memory.ts` learns from `category_override`, and a LINK row may not carry one — that
// asymmetry is deliberate and load-bearing (`review-write-inputs.ts`'s header, Tre 2026-08-09: the
// label describes the CHARGE and lives on its exclusive row). So a merchant the user has answered 22
// times through the link path has taught category memory exactly nothing, and always will. This is
// the second kind of memory that path implies, kept separate rather than smuggled into the first.
//
// ⚠️ THIS IS NOT A LOOSER MATCHER, AND MUST NEVER BECOME ONE. `transaction-matching.ts` stays silent
// on this charge for a good reason: the paycheck genuinely varies ($848.46, $848.47, $815.75) and the
// strong tolerance is 1% ($8.49). Widening that band to catch a paycheck would start matching things
// that are not the paycheck, and its header forbids it outright — "a tolerance to raise the hit rate
// trades a harmless silence for a harmful assertion". Nothing here touches amounts, dates or
// candidacy. The evidence this file uses is of a different kind entirely: not "this charge looks like
// that occurrence" but "you have told us what this merchant is, repeatedly". A wrong answer here is
// the user's own previous answer — the one thing they can actually correct.
//
// ⚠️ AND IT NEVER WRITES BY ITSELF. What this produces is a one-tap SUGGESTION on a card the user is
// already looking at. It is offered only when the matcher has said nothing, it is accepted through
// `acceptRuleInput` unchanged, and it is a first draft the user corrects, never a claim.

import { normalizeMerchant, merchantLabel, type MerchantCharge } from './merchant-memory';

/** The fields of a review row link memory reads. */
export interface MerchantLinkReview {
  status: string;
  /** Which rule the charge was linked to. Meaningless unless `status === 'linked_rule'`. */
  rule_id?: string | null;
  /** ISO timestamp. Breaks ties between two rules linked the same number of times. */
  updated_at?: string | null;
}

/**
 * How many times a merchant must have been linked to the same rule before the app will say so.
 *
 * ⚠️ TWO, AND THE ASYMMETRY WITH CATEGORY MEMORY IS DELIBERATE. `deriveMerchantRules` learns from a
 * SINGLE `category_override`, and it is right to: an override is a standing statement about what a
 * merchant IS. A link is a narrower thing — it says one charge settled one occurrence — so one link
 * is as likely to be a one-off as a pattern, and offering it back as "this is what this merchant is"
 * would be the app over-reading a single answer. Two is where a coincidence becomes a habit.
 */
export const MIN_LINKS_TO_REMEMBER = 2;

/** One remembered link: this merchant's charges settle this rule. */
export interface MerchantLinkRule {
  /** The normalized merchant key. Exact equality is the whole matching rule. */
  key: string;
  /** The most recent raw name seen for this key, for display. */
  label: string;
  ruleId: string;
  /** How many of this merchant's links point at `ruleId`. */
  linkedCount: number;
  /**
   * How many point somewhere else.
   *
   * Surfaced rather than hidden, exactly as `MerchantRule.conflictingCount` is: a merchant whose
   * charges have been linked to two different rules is a merchant where "learn once" is the wrong
   * model, and a caller may decide that is too ambiguous to offer.
   */
  conflictingCount: number;
}

interface Link {
  key: string;
  label: string;
  ruleId: string;
  at: string;
}

/**
 * Every link rule the user's own decisions imply, keyed by normalized merchant.
 *
 * ⚠️ THE MOST FREQUENT LINK WINS HERE, where `deriveMerchantRules` takes the most RECENT. That is not
 * an inconsistency, it is the difference between the two kinds of decision. A category override is a
 * standing statement, so changing it is a correction and the newest must win or the correction looks
 * ignored. A link is a statement about ONE charge, so a single link to a different rule is one
 * charge that went elsewhere — a paycheck the user once split, say — not a retraction of the other
 * twenty-one. Recency only breaks ties, so a genuine switch still takes over as soon as it is the
 * habit rather than the exception.
 *
 * Merchants below `MIN_LINKS_TO_REMEMBER` are absent from the result rather than present with a low
 * count: a caller cannot then accidentally offer one.
 */
export function deriveMerchantLinks(
  charges: readonly MerchantCharge[],
  reviewsByCharge: Readonly<Record<string, readonly MerchantLinkReview[]>>,
): Record<string, MerchantLinkRule> {
  const links: Record<string, Link[]> = {};
  for (const charge of charges) {
    const key = normalizeMerchant(merchantLabel(charge));
    if (!key) continue;
    for (const review of reviewsByCharge[charge.id] ?? []) {
      // A charge may hold SEVERAL link rows (§1B split link), so every one of them is a decision —
      // this loops rather than picking one.
      if (review.status !== 'linked_rule') continue;
      const ruleId = review.rule_id ?? null;
      if (!ruleId) continue;
      (links[key] ??= []).push({
        key, ruleId, label: merchantLabel(charge), at: review.updated_at ?? '',
      });
    }
  }

  const rules: Record<string, MerchantLinkRule> = {};
  for (const [key, list] of Object.entries(links)) {
    const counts: Record<string, number> = {};
    const latestAt: Record<string, string> = {};
    for (const link of list) {
      counts[link.ruleId] = (counts[link.ruleId] ?? 0) + 1;
      if (link.at > (latestAt[link.ruleId] ?? '')) latestAt[link.ruleId] = link.at;
    }
    // Most links, then most recent, then the id — so the answer never depends on iteration order.
    const winner = Object.keys(counts).sort((a, b) =>
      counts[b] - counts[a]
      || (latestAt[b] ?? '').localeCompare(latestAt[a] ?? '')
      || a.localeCompare(b),
    )[0];
    const linkedCount = counts[winner];
    if (linkedCount < MIN_LINKS_TO_REMEMBER) continue;
    // The name shown is the one on the most recent link, not whichever charge iterated last.
    const newest = list.slice().sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? 1 : -1))[0];
    rules[key] = {
      key,
      label: newest.label || key,
      ruleId: winner,
      linkedCount,
      conflictingCount: list.length - linkedCount,
    };
  }
  return rules;
}

/**
 * The link rule that speaks for a charge, or null.
 *
 * `suppressed` is the same per-merchant "stop remembering this" set category memory honours — one
 * switch, both kinds of memory, because a user who turned a merchant off meant the merchant.
 */
export function merchantLinkFor(
  charge: MerchantCharge,
  rules: Readonly<Record<string, MerchantLinkRule>>,
  suppressed: Readonly<Record<string, true>> = {},
): MerchantLinkRule | null {
  const key = normalizeMerchant(merchantLabel(charge));
  if (!key || suppressed[key]) return null;
  return rules[key] ?? null;
}

/** A rule in the shape link memory needs to offer it: identity, name, and whether it still applies. */
export interface LinkableRule {
  id: string;
  name: string;
  active?: boolean;
}

/** What the deck renders and writes when memory has something to offer. */
export interface LinkSuggestion<R extends LinkableRule = LinkableRule> {
  rule: R;
  memory: MerchantLinkRule;
}

/**
 * The rule to offer for a charge the matcher said nothing about, or null.
 *
 * ⚠️ EVERY GATE HERE IS A REASON TO STAY SILENT, and silence is always the safe direction.
 *
 * - `suggestion` set ⇒ null. The matcher looked at THIS charge and found an occurrence; memory is
 *   about the merchant in general and must not overrule evidence about the row in front of the user.
 * - a merchant with conflicting links ⇒ null. Two answers is not a remembered answer, and picking
 *   the more popular one silently is the coin flip §1A refused (`matchCharge`'s one-candidate rule).
 * - a rule that is gone or inactive ⇒ null. Offering to link a charge to a rule the user retired
 *   would quietly resurrect a projection they deliberately ended.
 */
export function linkSuggestionFor<R extends LinkableRule>(
  charge: MerchantCharge,
  suggestion: unknown | null | undefined,
  rules: Readonly<Record<string, MerchantLinkRule>>,
  rulesById: Readonly<Record<string, R>>,
  suppressed: Readonly<Record<string, true>> = {},
): LinkSuggestion<R> | null {
  if (suggestion) return null;
  const memory = merchantLinkFor(charge, rules, suppressed);
  if (!memory || memory.conflictingCount > 0) return null;
  const rule = rulesById[memory.ruleId];
  if (!rule || rule.active === false) return null;
  return { rule, memory };
}
