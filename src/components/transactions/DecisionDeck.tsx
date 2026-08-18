// THE DECISION DECK — the review queue's deciding surface. One charge per card, one decision per
// screen, the list still one tap away behind "Browse all".
//
// ⚠️ THIS IS A VIEW, NOT A SECOND DECISION ENGINE, and that is the rule the whole file is arranged
// around. The cards are `buildDeck(queue)` in the queue's own order; the writes are the ones
// `review-write-inputs.ts` defines and the Bank Activity list already performs, through the SAME
// mutation objects, passed in as props. Nothing here decides what a charge is, whether it may be
// imported, or in what order the user should be asked. If a `save`-shaped object is ever constructed
// in this file, the deck and the list have started recording the same decision differently.
//
// ⚠️ THE ONE CONTROL THAT CREATES MONEY IS DELIBERATELY ABSENT. "Add to my ledger" is the only
// action on Bank Activity that inserts into `public.transactions`, it is gated by `planLedgerImport`
// rather than by any component's conditionals, and it is not offered here. The deck can link, label
// and ignore — all annotations, none of which move a projected number. A charge that wants importing
// is skipped and dealt with in the list.
//
// ⚠️ THE CARDS ARE SNAPSHOTTED ON OPEN. Every write shrinks the live queue, so a deck that re-read
// it would renumber itself mid-run ("3 of 50" becoming "3 of 47") and slide unseen cards past the
// user. The run's population and its total are whatever they were when it opened.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import DeckShell from '@/components/shared/DeckShell';
import DeckEndCard from '@/components/shared/DeckEndCard';
import { type Category } from '@/lib/types';
import { isValidCategory } from '@/lib/plaid-category-map';
import { findExclusiveReview, type ReviewInput, type CarChargeKind } from '@/lib/synced-transaction-review';
import type { BankActivityRow, RuleRow, TransactionRow, SyncedTransactionReviewRow } from '@/hooks/useSupabaseData';
import type { ObligationPlan } from '@/lib/charge-obligations';
import { useMerchantMemory } from '@/hooks/useMerchantMemory';
import { merchantRuleFor, merchantLabel } from '@/lib/merchant-memory';
import { linkSuggestionFor } from '@/lib/merchant-link-memory';
import { usePrefersReducedMotion } from '@/hooks/use-reduced-motion';
import {
  planSuggestionAccept, ignoreInput, acceptRuleInput, acceptPlanInput, acceptCarInput,
  acceptLedgerTxnInput,
} from '@/lib/review-write-inputs';
import {
  pickableRules as buildPickableRules, pickablePlans as buildPickablePlans,
  pickableCarCharges as buildPickableCarCharges, nearestLedgerOptions, amountLabel,
} from '@/lib/review-link-options';
import {
  initialDeckState, advanceDeck, recordDeckDecision, isDeckComplete, deckProgress, planDeckUndo,
  deckSummary, deckChipRow, remainingCategories,
  type DeckCard, type DeckDecision,
} from '@/lib/decision-deck';
import DecisionDeckCard, { type DeckLinkKind, type DeckLinkOptions } from './DecisionDeckCard';

export type BankDeckCard = DeckCard<BankActivityRow, RuleRow, TransactionRow, ObligationPlan>;

export interface DecisionDeckProps {
  /** `buildDeck(queue)` — in the queue's order, already. Snapshotted here on mount. */
  cards: readonly BankDeckCard[];
  accountName: Readonly<Record<string, string>>;
  /** Every decision already on each charge, so a card can read the category it already carries. */
  reviewsByCharge: Readonly<Record<string, SyncedTransactionReviewRow[]>>;
  /**
   * The user's recurring rules — the SAME array the queue was built from.
   *
   * Needed because a remembered link names a rule by id, and `acceptRuleInput` needs the whole row
   * to place the occurrence (`ruleOccurrence` reads its frequency and due day). Passed in rather
   * than fetched so the deck cannot end up offering a rule the queue never saw.
   */
  rules: readonly RuleRow[];
  /** The parent's own mutations. Passed in rather than re-instantiated — see this file's header. */
  save: { mutateAsync: (input: ReviewInput) => Promise<unknown> };
  setCategory: { mutateAsync: (v: { syncedTransactionId: string; category: string | null }) => Promise<unknown> };
  remove: { mutateAsync: (syncedTransactionId: string) => Promise<unknown> };
  /**
   * The other three things a charge can be linked to, so the deck's pickers offer exactly what the
   * list's do. Passed in for the same reason `rules` is: the deck must never be able to offer a
   * destination the surface it is a view of would not.
   */
  paymentPlans: readonly { id: string; name: string; active?: boolean | null; payment_amount: number | string }[];
  carFunds: readonly Parameters<typeof buildPickableCarCharges>[0][number][];
  ledger: readonly { id: string; date: string; category: string; amount: number | string }[];
  /** "Browse all" — hands the user back to the list, which is never replaced or removed. */
  onClose: () => void;
}

/** What the app thinks a charge is, in the words the card asks its question with. */
function describeSuggestion(card: BankDeckCard): string | null {
  const suggestion = card.suggestion;
  if (!suggestion) return null;
  if (suggestion.rule) return suggestion.rule.name;
  if (suggestion.plan) return suggestion.plan.name;
  if (suggestion.carCharge) {
    // Names the OBLIGATION, not just the car — a vehicle bills a payment AND an insurance premium
    // every month, and "Civic" would not say which one the user just accounted for.
    const kind = suggestion.carCharge.kind === 'insurance' ? 'car insurance' : 'car payment';
    return `${suggestion.carCharge.vehicleName} ${kind}`;
  }
  if (suggestion.ledgerTxn) return `entry on ${suggestion.ledgerTxn.date}`;
  return null;
}

const errorMessage = (e: unknown): string =>
  e instanceof Error && e.message ? e.message : 'Something went wrong.';

export default function DecisionDeck({
  cards, accountName, reviewsByCharge, rules, paymentPlans, carFunds, ledger,
  save, setCategory, remove, onClose,
}: DecisionDeckProps) {
  // Snapshotted, deliberately — see this file's header. The prop may shrink under us as writes land.
  const [deck] = useState<readonly BankDeckCard[]>(cards);
  const [state, setState] = useState(() => initialDeckState(cards));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The decisions actually undone, so the end screen stops offering an undo it already performed. */
  const [undone, setUndone] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const { rules: merchantRules, linkRules, suppressed } = useMerchantMemory();
  const rulesById = useMemo(
    () => Object.fromEntries(rules.map(r => [r.id, r])) as Readonly<Record<string, RuleRow>>,
    [rules],
  );

  const card = deck[state.index] ?? null;
  const complete = isDeckComplete(state);
  const progress = deckProgress(state);
  const summary = useMemo(() => deckSummary(state.decisions), [state.decisions]);

  /** The category this charge already carries, off its EXCLUSIVE row and nowhere else. */
  const currentCategoryOf = useCallback((chargeId: string): string | null => {
    const override = findExclusiveReview(reviewsByCharge[chargeId] ?? [])?.category_override ?? null;
    return override && isValidCategory(override) ? override : null;
  }, [reviewsByCharge]);

  const chips = useMemo<Category[]>(() => {
    if (!card) return [];
    // This merchant's own answer, then the direction, then the frequency order — see `deckChipRow`.
    // The direction has to sit AHEAD of the frequency order, not behind it: behind it, a user who
    // has taught nine categories fills the row before `Income` is reached, which is what Tre saw.
    return deckChipRow(merchantRules, merchantRuleFor(card.charge, merchantRules, suppressed), card.charge.amount);
  }, [card, merchantRules, suppressed]);

  /**
   * The rest of the list, behind the card's "More" toggle.
   *
   * The nine chips are a shortlist, not the menu. Without this the deck could only ever offer a
   * category the user had already used, because their taught categories lead the row and nine of
   * them fill it — see `remainingCategories`.
   */
  const moreChips = useMemo<Category[]>(() => remainingCategories(chips), [chips]);

  /**
   * The rule this MERCHANT keeps getting linked to, when the matcher had nothing to say about this
   * charge. Gated entirely inside `linkSuggestionFor` — every one of its conditions is a reason to
   * stay silent, and it is never consulted when `card.suggestion` is set.
   */
  const linkOffer = useMemo(
    () => (card ? linkSuggestionFor(card.charge, card.suggestion, linkRules, rulesById, suppressed) : null),
    [card, linkRules, rulesById, suppressed],
  );

  const suggestionLabel = card ? describeSuggestion(card) ?? linkOffer?.rule.name ?? null : null;
  /** Provenance, always, when the offer came from memory rather than from matching this charge. */
  const suggestionNote = !card || describeSuggestion(card) || !linkOffer
    ? null
    : `You've linked ${linkOffer.memory.label} here ${linkOffer.memory.linkedCount} times before.`;

  /**
   * One decision: perform the write, then move on.
   *
   * ⚠️ THE CARD DOES NOT ADVANCE ON A FAILED WRITE, and the failure is stated on the card rather
   * than only in a toast. A deck that slides forward regardless would leave the user certain they
   * decided something the database never heard about — the exact silent failure this house has been
   * bitten by. The mutation's own `onError` still says what went wrong in the user's language; this
   * adds that nothing was recorded and the charge is still here.
   */
  const decide = useCallback(async (
    write: () => Promise<unknown>,
    decision: DeckDecision,
  ) => {
    setBusy(true);
    setError(null);
    try {
      await write();
      setState(current => recordDeckDecision(current, decision));
    } catch (e) {
      setError(`Not recorded — ${errorMessage(e)} This charge is still waiting on you.`);
    } finally {
      setBusy(false);
    }
  }, []);

  const onAccept = useCallback(() => {
    if (!card || busy) return;
    // Built by the shared planner, never here. A suggestion the planner cannot route is not accepted
    // — no fallback, no guess.
    // The matcher's answer first, then the merchant's remembered one. Both write through
    // `review-write-inputs.ts` — the deck never builds a row of its own (see this file's header).
    const input = planSuggestionAccept(card.charge, card.suggestion, currentCategoryOf(card.charge.id))
      ?? (linkOffer ? acceptRuleInput(card.charge, linkOffer.rule) : null);
    if (!input) return;
    const label = describeSuggestion(card) ?? linkOffer?.rule.name ?? null;
    void decide(() => save.mutateAsync(input), {
      chargeId: card.charge.id,
      kind: 'accepted',
      merchantLabel: merchantLabel(card.charge) || '—',
      detail: label ?? 'linked',
      previousCategory: currentCategoryOf(card.charge.id),
    });
  }, [card, busy, currentCategoryOf, decide, linkOffer, save]);

  const onCategory = useCallback((category: Category) => {
    if (!card || busy) return;
    void decide(
      () => setCategory.mutateAsync({ syncedTransactionId: card.charge.id, category }),
      {
        chargeId: card.charge.id,
        kind: 'categorized',
        merchantLabel: merchantLabel(card.charge) || '—',
        detail: category,
        previousCategory: currentCategoryOf(card.charge.id),
      },
    );
  }, [card, busy, currentCategoryOf, decide, setCategory]);

  const onIgnore = useCallback(() => {
    if (!card || busy) return;
    void decide(() => save.mutateAsync(ignoreInput(card.charge)), {
      chargeId: card.charge.id,
      kind: 'ignored',
      merchantLabel: merchantLabel(card.charge) || '—',
      detail: 'ignored',
      previousCategory: currentCategoryOf(card.charge.id),
    });
  }, [card, busy, currentCategoryOf, decide, save]);

  /**
   * What this charge could be linked to. Computed from the SAME selectors the list uses, so the two
   * surfaces cannot offer different destinations for the same charge.
   *
   * The ledger list is ordered around THIS card's date, which is why it is inside the memo on
   * `card` rather than computed once for the run.
   */
  const linkOptions = useMemo<DeckLinkOptions>(() => {
    if (!card) return { rule: [], plan: [], car: [], txn: [] };
    return {
      rule: buildPickableRules(rules).map(r => ({ value: r.id, label: amountLabel(r.name, r.amount) })),
      plan: buildPickablePlans(paymentPlans).map(p => ({ value: p.id, label: amountLabel(p.name, p.payment_amount) })),
      car: buildPickableCarCharges(carFunds),
      txn: nearestLedgerOptions(ledger, card.charge.date),
    };
  }, [card, rules, paymentPlans, carFunds, ledger]);

  /**
   * One manual link — Tre, 2026-08-18: *"why cant i choose to connect to an existing transaction?"*
   *
   * ⚠️ EVERY ROW HERE IS BUILT BY `review-write-inputs.ts`, exactly as the list's pickers build
   * theirs. This file constructs no `save`-shaped object of its own; see the header.
   *
   * ⚠️ THE LIST'S TRANSFER-PAIR SIDE EFFECT IS NOT REPRODUCED. Linking a leg of a transfer pair
   * in the list also ignores its partner, which is a fact about that surface's pair model rather
   * than about linking; performing it from here would decide a SECOND charge the user was never
   * shown, and the deck's contract is one card, one decision. The partner stays in the queue and
   * gets its own card.
   */
  const onLink = useCallback((kind: DeckLinkKind, value: string) => {
    if (!card || busy) return;
    const charge = card.charge;
    const previousCategory = currentCategoryOf(charge.id);
    let input: ReviewInput | null;
    let detail: string;
    if (kind === 'rule') {
      const picked = rules.find(r => r.id === value);
      if (!picked) return;
      input = acceptRuleInput(charge, picked);
      detail = picked.name;
    } else if (kind === 'plan') {
      const picked = paymentPlans.find(p => p.id === value);
      if (!picked) return;
      input = acceptPlanInput(charge, value);
      detail = picked.name;
    } else if (kind === 'car') {
      // `<fundId>:<kind>` — one value carrying both halves, see `pickableCarCharges`.
      const [carFundId, chargeKind] = value.split(':');
      if (!carFundId || !chargeKind) return;
      input = acceptCarInput(charge, carFundId, chargeKind as CarChargeKind);
      detail = linkOptions.car.find(o => o.value === value)?.label ?? 'vehicle charge';
    } else {
      // The category is KEPT: `linked_txn` IS the exclusive row, so dropping it would wipe a label.
      input = acceptLedgerTxnInput(charge, value, previousCategory);
      detail = linkOptions.txn.find(o => o.value === value)?.label ?? 'your entry';
    }
    if (!input) return;
    const write = input;
    void decide(() => save.mutateAsync(write), {
      chargeId: charge.id,
      kind: 'accepted',
      merchantLabel: merchantLabel(charge) || '—',
      detail,
      previousCategory,
    });
  }, [card, busy, currentCategoryOf, decide, linkOptions, paymentPlans, rules, save]);

  /** Skip writes NOTHING. The charge stays in the queue, which is the honest record of a non-answer. */
  const onSkip = useCallback(() => {
    if (busy) return;
    setError(null);
    setState(advanceDeck);
  }, [busy]);

  /**
   * Undo everything this run wrote, newest first.
   *
   * Sequential and stop-at-first-failure, like every other batch on this surface: both mutations are
   * find-then-write per charge, so parallel writes would race the read half against its own writes,
   * and a batch that ploughed on through a failure would leave a partial result nobody can read back.
   */
  const undoAll = useCallback(async () => {
    setBusy(true);
    const steps = planDeckUndo(state.decisions);
    let done = 0;
    try {
      for (const step of steps) {
        if (step.write === 'removeReviews') await remove.mutateAsync(step.chargeId);
        else await setCategory.mutateAsync({ syncedTransactionId: step.chargeId, category: step.category });
        done++;
      }
      setUndone(true);
      toast.success(`Undone — ${summary.total} ${summary.total === 1 ? 'decision is' : 'decisions are'} reversed`);
    } catch (e) {
      // How far it got, which the mutation's own error toast cannot know.
      toast.message(`Undid ${done} of ${steps.length} — the rest are unchanged. ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }, [remove, setCategory, state.decisions, summary.total]);

  /**
   * Keyboard: ← skip, → accept, 1-9 pick a chip, Esc back to the list.
   *
   * ⚠️ → DOES NOTHING WHEN THERE IS NOTHING TO ACCEPT. Falling back to some other decision would
   * make the same key mean two different things depending on data the user cannot see.
   */
  useEffect(() => {
    if (complete) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Never hijack a key the user is typing into something.
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); onSkip(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); onAccept(); return; }
      if (/^[1-9]$/.test(e.key)) {
        const chip = chips[Number(e.key) - 1];
        if (!chip) return;
        e.preventDefault();
        onCategory(chip);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chips, complete, onAccept, onCategory, onClose, onSkip]);

  return (
    <DeckShell
      label="Decide your bank charges"
      progress={progress}
      complete={complete}
      onClose={onClose}
      closeLabel="Browse all"
      testId="decision-deck"
      hint={card ? 'Swipe right to confirm, left to skip — or use ← → and 1-9 for the categories.' : undefined}
    >
        {!card || complete ? (
          <DeckEndCard
            // Never a confident zero: a run that decided nothing says so in words rather than
            // rendering "0 decided" as though that were an achievement.
            headline={summary.total > 0
              ? `${summary.total} ${summary.total === 1 ? 'charge' : 'charges'} decided`
              : 'Nothing was decided this time'}
            lines={summary.total > 0 ? (
              <>
                {summary.accepted > 0 && <p>{summary.accepted} linked to what the app already matched</p>}
                {summary.categorized > 0 && <p>{summary.categorized} given a category</p>}
                {summary.ignored > 0 && <p>{summary.ignored} ignored</p>}
                <p className="text-[10px]">
                  Nothing was added to your ledger and no projected number moved.
                </p>
              </>
            ) : undefined}
            onUndo={summary.total > 0 && !undone ? () => { void undoAll(); } : undefined}
            busy={busy}
            undoneNote={undone ? 'Reversed. These charges are waiting on you again.' : undefined}
            onDone={onClose}
            doneLabel="Back to your bank activity"
          />
        ) : (
          <DecisionDeckCard
            // Keyed on the charge, so React builds a new card rather than re-animating the old one.
            key={card.charge.id}
            merchantLabel={merchantLabel(card.charge) || card.charge.name || '—'}
            amount={Number(card.charge.amount)}
            date={card.charge.date}
            accountLabel={card.charge.account_id ? accountName[card.charge.account_id] ?? null : null}
            suggestionLabel={suggestionLabel}
            suggestionNote={suggestionNote}
            chips={chips}
            moreChips={moreChips}
            currentCategory={currentCategoryOf(card.charge.id)}
            busy={busy}
            error={error}
            reducedMotion={reducedMotion}
            onAccept={onAccept}
            onCategory={onCategory}
            onSkip={onSkip}
            onIgnore={onIgnore}
          linkOptions={linkOptions}
          onLink={onLink}
          />
        )}
    </DeckShell>
  );
}
