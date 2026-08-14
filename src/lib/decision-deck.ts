// THE DECISION DECK — one charge per card, one decision per screen. Pure, no I/O, no React.
//
// This is the sequencing half of the flagship pattern in `design/DIRECTION.md`: "anywhere the app
// asks the user to decide N things, the default surface is a full-screen card deck." The rendering
// lives in `components/transactions/DecisionDeck.tsx`; every WRITE the deck performs goes through
// `review-write-inputs.ts` and the same mutations the Bank Activity list already calls.
//
// ⚠️ THE DECK IS A VIEW OVER THE QUEUE AND MUST NEVER BE A SECOND ONE. `buildReviewQueue` decides
// what needs a decision, what the app thinks each charge is, and the order — suggestion-carrying
// first, then newest first — and that order is load-bearing (see its header: a one-click decision
// buried among open-ended chores is the failure the whole slice exists to fix). `buildDeck` is
// therefore a passthrough on purpose: it attaches each charge's suggestion and changes NOTHING about
// the sequence. If a filter or a sort ever appears in this file, the deck and the list have started
// disagreeing about the same charges.
//
// ⚠️ THE CARD LIST IS SNAPSHOTTED BY ITS CALLER, not re-read per card. Every write shrinks the live
// queue, so a deck reading it live would renumber itself under the user's thumb — "3 of 50" becoming
// "3 of 47" mid-run — and cards would slide past unseen. The run's total is fixed when it opens.

import { isValidCategory } from './plaid-category-map';
import type { ReviewQueue, ChargeSuggestion, QueueCharge, QueueRule, QueueLedgerTxn } from './bank-activity-queue';
import type { ObligationPlan } from './charge-obligations';
import type { MerchantRule } from './merchant-memory';
import type { Category } from './types';

/**
 * How many category chips a card offers.
 *
 * ⚠️ NINE, BECAUSE THE KEYBOARD SHORTCUT IS `1`–`9`. A tenth chip would be reachable by thumb and
 * not by key, which is exactly the kind of quiet inconsistency that makes a shortcut untrustworthy.
 */
export const CHIP_LIMIT = 9;

/** One card: a charge, and what the app already thinks it is (or null if it thinks nothing). */
export interface DeckCard<
  C extends QueueCharge = QueueCharge,
  R extends QueueRule = QueueRule,
  T extends QueueLedgerTxn = QueueLedgerTxn,
  P extends ObligationPlan = ObligationPlan,
> {
  charge: C;
  suggestion: ChargeSuggestion<R, T, P> | null;
}

/**
 * The deck, in the queue's own order.
 *
 * A passthrough by design — see this file's header. The only thing it adds is the join between a
 * charge and the suggestion the queue computed for it, so the card can render both without a
 * component reaching into two structures.
 */
export function buildDeck<
  C extends QueueCharge, R extends QueueRule, T extends QueueLedgerTxn, P extends ObligationPlan,
>(queue: ReviewQueue<C, R, T, P>): DeckCard<C, R, T, P>[] {
  return queue.needsDecision.map(charge => ({
    charge,
    suggestion: queue.suggestions[charge.id] ?? null,
  }));
}

/** What the user did to one card. `'skipped'` is deliberately absent — a skip writes nothing. */
export type DeckDecisionKind = 'accepted' | 'categorized' | 'ignored';

/** One decision the run made, and everything needed to put it back. */
export interface DeckDecision {
  chargeId: string;
  kind: DeckDecisionKind;
  /** The merchant as it was shown on the card, for the end screen. */
  merchantLabel: string;
  /** What was decided, in the words the card used — the rule's name, the category, "ignored". */
  detail: string;
  /**
   * The charge's category BEFORE this run touched it.
   *
   * ⚠️ SNAPSHOT IT BEFORE THE WRITE, never derive it afterwards — the same idiom as
   * `planRetroactivePass`'s `previousCategory`. Undoing an accept or an ignore deletes every review
   * row on the charge, which takes a pre-existing label with it; without this the undo would destroy
   * a category the deck never wrote.
   */
  previousCategory: string | null;
}

/** Where a run has got to. Immutable — every transition returns a new object. */
export interface DeckState {
  /** Index of the card on screen. Equal to `total` once the run is finished. */
  index: number;
  /** Fixed when the run opens. See this file's header. */
  total: number;
  decisions: readonly DeckDecision[];
}

export function initialDeckState(cards: readonly unknown[]): DeckState {
  return { index: 0, total: cards.length, decisions: [] };
}

/** Move to the next card without recording anything. This is what Skip does. */
export function advanceDeck(state: DeckState): DeckState {
  return { ...state, index: Math.min(state.index + 1, state.total) };
}

/** Record what the user just decided and move on, in one transition. */
export function recordDeckDecision(state: DeckState, decision: DeckDecision): DeckState {
  return {
    ...state,
    index: Math.min(state.index + 1, state.total),
    decisions: [...state.decisions, decision],
  };
}

export function isDeckComplete(state: DeckState): boolean {
  return state.index >= state.total;
}

/**
 * "N of M", and how full the bar is.
 *
 * ⚠️ NULL FOR AN EMPTY DECK, never `0 of 0` with an empty bar. A progress bar reading zero and a
 * progress bar that failed to compute look identical, and there is no run to report on anyway — the
 * caller renders the honest empty state instead.
 */
export function deckProgress(state: DeckState): { position: number; total: number; percent: number } | null {
  if (state.total === 0) return null;
  return {
    // Pinned to the last card at the end: a finished run reads "4 of 4", not "5 of 4".
    position: Math.min(state.index + 1, state.total),
    total: state.total,
    percent: (state.index / state.total) * 100,
  };
}

/** One write that undoing a run performs. Each step is exactly one call to one existing mutation. */
export type DeckUndoStep =
  | { chargeId: string; write: 'removeReviews' }
  | { chargeId: string; write: 'setCategory'; category: string | null };

/**
 * The writes that reverse a whole run, in the order they should be made.
 *
 * NEWEST FIRST, exactly like `planRetroactiveUndo`: a partially-applied undo then unwinds the most
 * recent decision first, so a stopped batch never interleaves with itself and the user is left with
 * a prefix of their run rather than a scatter of it.
 *
 * An accept or an ignore is reversed by deleting the charge's reviews — the same `remove` the list's
 * own "Undo all" calls — followed by putting back any category that delete took with it. A chip pick
 * is reversed by writing the previous category back, which `setCategory` clears when it is null.
 */
export function planDeckUndo(decisions: readonly DeckDecision[]): DeckUndoStep[] {
  const steps: DeckUndoStep[] = [];
  for (const decision of [...decisions].reverse()) {
    if (decision.kind === 'categorized') {
      steps.push({ chargeId: decision.chargeId, write: 'setCategory', category: decision.previousCategory });
      continue;
    }
    steps.push({ chargeId: decision.chargeId, write: 'removeReviews' });
    // Only when there is something to put back. A write that changes nothing is still a write.
    if (decision.previousCategory !== null) {
      steps.push({ chargeId: decision.chargeId, write: 'setCategory', category: decision.previousCategory });
    }
  }
  return steps;
}

/** What the end screen says the run did. */
export interface DeckSummary {
  accepted: number;
  categorized: number;
  ignored: number;
  total: number;
}

export function deckSummary(decisions: readonly DeckDecision[]): DeckSummary {
  return {
    accepted: decisions.filter(d => d.kind === 'accepted').length,
    categorized: decisions.filter(d => d.kind === 'categorized').length,
    ignored: decisions.filter(d => d.kind === 'ignored').length,
    total: decisions.length,
  };
}

/**
 * The categories the user has taught the app, most-used first — this merchant's own answer leading.
 *
 * ⚠️ THIS GUESSES NOTHING. Every category here is one the user typed, read back off their own
 * `category_override` rows by `deriveMerchantRules`. It is the same distinction that lets merchant
 * memory exist at all next to `plaid-category-map.ts`'s "do not improve this with merchant-name
 * heuristics": a wrong answer here is the user's own previous answer, which is the one thing they
 * can actually correct.
 */
export function taughtCategoryOrder(
  rules: Readonly<Record<string, MerchantRule>>,
  merchantRule: MerchantRule | null,
): Category[] {
  const ordered = Object.values(rules)
    .slice()
    .sort((a, b) => b.decidedCount - a.decidedCount || a.category.localeCompare(b.category))
    .map(rule => rule.category);
  // This merchant's own remembered category first: on a card about Publix, "Groceries" is the answer
  // the user already gave for Publix, and it should not be behind whatever they use most overall.
  return dedupe(merchantRule ? [merchantRule.category, ...ordered] : ordered);
}

/**
 * The chip row: what the user has taught first, then the app's common categories, capped.
 *
 * Anything that is not one of the app's own categories is dropped rather than rendered — a chip that
 * writes a value `isValidCategory` rejects would fail at the mutation with nothing on screen
 * explaining why.
 */
export function orderCategoryChips(
  taught: readonly string[],
  common: readonly string[],
  limit: number = CHIP_LIMIT,
): Category[] {
  return dedupe([...taught, ...common].filter(isValidCategory)).slice(0, limit);
}

const dedupe = (values: readonly string[]): Category[] => {
  const seen = new Set<string>();
  const out: Category[] = [];
  for (const value of values) {
    if (seen.has(value) || !isValidCategory(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
};
