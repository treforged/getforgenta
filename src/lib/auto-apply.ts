/**
 * WHEN THE APP SHOULD JUST ACT, AND WHEN IT SHOULD STILL ASK.
 *
 * Tre, 2026-09-12, across three separate reports that turn out to be one rule:
 *   * the payroll card — "it should be obvious and not have prompted me again after the first
 *     time", on a card that can itself state it has been linked 25 times
 *   * electricity — "it properly suggests it, I shouldn't have to select that... It should only
 *     come up in a case where it's like, oh, I was charged twice or something like that in the
 *     same month, or the difference is just so large that it makes sense to confirm"
 *   * the 28-charge batch — "this section shouldn't exist. it should auto apply"
 *
 * ⚠️ THE SAME EVIDENCE, THE WRONG VERB. `merchant-link-memory.ts` offering purely on merchant
 * history is what suggested $15 against an $1,100 rent rule. That is not an argument for trusting
 * merchant history less — it is an argument that history alone decides the SUGGESTION and must not
 * decide the ACTION. This module adds the terms history does not have: does the amount fit, is this
 * charge unremarkable for this merchant, and is anything odd about the month.
 *
 * ⚠️ ASKING IS THE SAFE DIRECTION AND IT IS NOT FREE. Every needless prompt is the complaint above.
 * So `ask` is returned for a REASON that can be named, never as a shrug — `reason` exists so the UI
 * can say why it is asking, and so a wrong threshold is debuggable rather than merely felt.
 */

import { amountCouldSettle } from './merchant-link-memory';

export type AutoApplyVerdict = 'auto' | 'ask' | 'never';

export interface AutoApplyReasoned {
  verdict: AutoApplyVerdict;
  /** Why, in a word a human could be shown. */
  reason:
    | 'implausible-amount'
    | 'conflicting-history'
    | 'too-few-links'
    | 'duplicate-this-period'
    | 'unusual-for-this-merchant'
    | 'confident';
}

export interface AutoApplyEvidence {
  /** How many times this merchant's charges have been linked to THIS destination. */
  linkedCount: number;
  /** How many were linked somewhere else. Any at all means the habit is not settled. */
  conflictingCount: number;
  /** This charge's amount. */
  amount: number;
  /** The destination's own amount, when it has one. */
  targetAmount?: number | null;
  /** Past amounts from this merchant, for judging whether THIS one is ordinary. */
  history: readonly number[];
  /** True when this merchant has already been seen in the same period — his named anomaly. */
  duplicateThisPeriod?: boolean;
}

/**
 * How many prior links before the app will act without asking.
 *
 * ⚠️ CHOSEN, NOT MEASURED, AND DELIBERATELY HIGHER THAN `MIN_LINKS_TO_REMEMBER` (which is 2).
 * Two is where a coincidence becomes a habit worth OFFERING; it is not where the app should stop
 * asking. Three is the first count that cannot be a pair of accidents, and the payroll case — his
 * strongest — has 25, so this is nowhere near binding on the example that motivated it.
 */
export const MIN_LINKS_TO_AUTO_APPLY = 3;

/**
 * How far from a merchant's usual amount a charge may sit and still be treated as ordinary,
 * in standard deviations.
 *
 * ⚠️ MEASURED CONTEXT, CHOSEN NUMBER. Per-merchant variation in his own data spans a coefficient
 * of variation of 0.0% (CFX tolls, Banner Life, Apple.com — dead constant) to 111.5% (Costco),
 * which is why a FIXED DOLLAR OR PERCENT TOLERANCE CANNOT WORK: anything loose enough for Costco
 * waves through everything, anything tight enough for Apple questions every grocery shop. Judging
 * each charge against ITS OWN merchant's spread is the only thing that serves both. 2.5 sd is the
 * conventional "unusual" line and is not fitted to anything here.
 */
export const UNUSUAL_SD = 2.5;

/**
 * The smallest history that can say anything about spread.
 *
 * ⚠️ WITH FEWER THAN THIS, THE APP DOES NOT CLAIM TO KNOW WHAT IS NORMAL — it skips the outlier
 * test rather than computing a confident number from three points. Half his merchants have 8-12
 * charges, so an sd from a handful is a weak estimate and treating it as strong would produce
 * exactly the confident-wrong prompts this is meant to remove.
 */
export const MIN_HISTORY_FOR_OUTLIER = 5;

function meanOf(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Sample standard deviation. Zero for a merchant that always charges the same amount. */
function sdOf(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = meanOf(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Whether this charge is unremarkable for this merchant.
 *
 * ⚠️ A CONSTANT MERCHANT IS THE INTERESTING CASE. When sd is 0 — Apple.com at $9.99 every month —
 * ANY difference is remarkable, and a z-score would divide by zero and say nothing. So a zero
 * spread falls back to exact agreement: the same amount is ordinary, a different one is not. That
 * is the behaviour a person would expect and the one a naive z-score gets silently wrong.
 */
export function isOrdinaryForMerchant(amount: number, history: readonly number[]): boolean {
  if (history.length < MIN_HISTORY_FOR_OUTLIER) return true; // not enough to judge; do not pretend
  const m = meanOf(history);
  const sd = sdOf(history);
  if (sd === 0) return Math.abs(amount - m) < 0.01;
  return Math.abs(amount - m) / sd <= UNUSUAL_SD;
}

/**
 * Whether to act, ask, or refuse outright.
 *
 * The order of the gates is the order of their severity, and it matters: an implausible amount is
 * `never` — not a question — because offering it at all is the defect that started this.
 */
export function autoApplyDecision(e: AutoApplyEvidence): AutoApplyReasoned {
  // 1. The pairing is absurd. This is the $15-against-$1,100 case, and it is not a question to put
  //    to a human — a suggestion the app can see is wrong should not reach them at all.
  if (!amountCouldSettle(e.amount, e.targetAmount)) {
    return { verdict: 'never', reason: 'implausible-amount' };
  }
  // 2. The merchant has been linked two different ways. Picking the more popular one silently is
  //    the coin flip the matcher already refuses.
  if (e.conflictingCount > 0) return { verdict: 'ask', reason: 'conflicting-history' };

  // 3. Not yet a habit.
  if (e.linkedCount < MIN_LINKS_TO_AUTO_APPLY) return { verdict: 'ask', reason: 'too-few-links' };

  // 4. His own named anomaly: "oh, I was charged twice or something like that in the same month".
  if (e.duplicateThisPeriod) return { verdict: 'ask', reason: 'duplicate-this-period' };

  // 5. His other named anomaly: "the difference is just so large that it makes sense to confirm".
  if (!isOrdinaryForMerchant(e.amount, e.history)) {
    return { verdict: 'ask', reason: 'unusual-for-this-merchant' };
  }

  return { verdict: 'auto', reason: 'confident' };
}

/**
 * The same rule, applied to CATEGORY memory rather than link memory.
 *
 * ⚠️ THE AMOUNT GATES GO INERT HERE, AND THAT IS CORRECT RATHER THAN A SHORTCUT. A category is a
 * label: it has no amount to fit and no money attached, so "could this charge have settled that?"
 * is not a question about it. Passing no target and no history makes `amountCouldSettle` and
 * `isOrdinaryForMerchant` both abstain by their own documented rules, leaving exactly the two
 * terms that DO apply — has this merchant been labelled enough times, and has it been labelled
 * two different ways.
 *
 * ⚠️ AND THE OUTLIER TEST IS DELIBERATELY NOT APPLIED. Asking "is this amount unusual?" before
 * putting a LABEL on a charge would reintroduce the prompts this removes, for a change that moves
 * no money and undoes in one press. Tre's complaint about that panel was solely that it asks.
 */
export function categoryMemoryVerdict(
  rule: { decidedCount: number; conflictingCount: number },
): AutoApplyReasoned {
  return autoApplyDecision({
    linkedCount: rule.decidedCount,
    conflictingCount: rule.conflictingCount,
    amount: 0,
    targetAmount: null,
    history: [],
  });
}
