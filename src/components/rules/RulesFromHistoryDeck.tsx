// "WE FOUND THESE PATTERNS" — one deck run over the rules the user's history implies.
//
// ⚠️ THIS IS A VIEW, NOT A SECOND RULE EDITOR. The cards are `proposeRulesFromHistory` in its own
// order; every accept is `ruleInsertFromProposal` handed to the SAME `useRecurringRules().add`
// mutation the Budget rule editor calls, and the undo is that hook's own `remove`. If a payload is
// ever assembled in this file, the deck and the editor have started writing rules differently.
//
// ⚠️ THE CARDS ARE SNAPSHOTTED ON OPEN, like the charge deck. Accepting a rule makes its merchant
// "covered", so the live proposal list shrinks under every write — a deck reading it live would
// renumber itself mid-run and slide unseen cards past the user.
//
// ⚠️ ONE UNDO FOR THE WHOLE RUN, and it deletes exactly the rules this run created — the ids are
// snapshotted as each insert lands, never re-derived by name afterwards. A rule the user already had
// must not be reachable by this button.

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { usePrefersReducedMotion } from '@/hooks/use-reduced-motion';
import { useAccounts, useRecurringRules } from '@/hooks/useSupabaseData';
import {
  initialDeckState, advanceDeck, recordDeckDecision, isDeckComplete, deckProgress,
} from '@/lib/decision-deck';
import type { RuleProposal } from '@/lib/rules-from-history';
import { ruleInsertFromProposal } from '@/lib/rule-proposal-write';
import DeckShell from '@/components/shared/DeckShell';
import DeckEndCard from '@/components/shared/DeckEndCard';
import RuleProposalCard from './RuleProposalCard';

/** One rule this run created: the proposal it came from, and the row it became. */
interface AcceptedRule {
  proposalId: string;
  ruleId: string;
  name: string;
}

export interface RulesFromHistoryDeckProps {
  /** `proposeRulesFromHistory(...)` — snapshotted here on mount. Never empty; see `useRuleProposals`. */
  proposals: readonly RuleProposal[];
  /** Leaving. The whole screen is skippable and this is how — never a trap. */
  onClose: () => void;
}

const errorMessage = (e: unknown): string =>
  e instanceof Error && e.message ? e.message : 'Something went wrong.';

export default function RulesFromHistoryDeck({ proposals, onClose }: RulesFromHistoryDeckProps) {
  // Snapshotted, deliberately — see this file's header.
  const [deck] = useState<readonly RuleProposal[]>(proposals);
  const [state, setState] = useState(() => initialDeckState<AcceptedRule>(proposals));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const { data: accounts } = useAccounts();
  const { add, remove } = useRecurringRules();

  const proposal = deck[state.index] ?? null;
  const complete = isDeckComplete(state);
  const progress = deckProgress(state);
  const accountName = useMemo(
    () => Object.fromEntries((accounts ?? []).map(a => [a.id, a.name])),
    [accounts],
  );

  /**
   * Create one rule and move on.
   *
   * ⚠️ THE CARD DOES NOT ADVANCE ON A FAILED WRITE. A deck that slid forward regardless would leave
   * the user certain they added a rule the database never heard about — and this one moves projected
   * numbers, so the failure has to be visible where the decision was made.
   */
  const acceptOne = useCallback(async (target: RuleProposal): Promise<AcceptedRule | null> => {
    const ruleId = await add.mutateAsync({ ...ruleInsertFromProposal(target), quiet: true });
    return { proposalId: target.id, ruleId, name: target.name };
  }, [add]);

  const onAccept = useCallback(() => {
    if (!proposal || busy) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const accepted = await acceptOne(proposal);
        if (accepted) setState(current => recordDeckDecision(current, accepted));
      } catch (e) {
        setError(`Not saved — ${errorMessage(e)} This rule was not added.`);
      } finally {
        setBusy(false);
      }
    })();
  }, [proposal, busy, acceptOne]);

  /** Skip writes NOTHING. The proposal simply is not taken; nothing about it is remembered. */
  const onSkip = useCallback(() => {
    if (busy) return;
    setError(null);
    setState(advanceDeck);
  }, [busy]);

  /**
   * Accept everything still ahead, in one press.
   *
   * Sequential and stop-at-first-failure, like every other batch on these surfaces: a batch that
   * ploughed through a failure would leave a partial result nobody can read back, and the state
   * records every rule that DID land so the undo still covers them.
   */
  const acceptAll = useCallback(() => {
    if (busy || !proposal) return;
    setBusy(true);
    setError(null);
    void (async () => {
      const remaining = deck.slice(state.index);
      const landed: AcceptedRule[] = [];
      try {
        for (const target of remaining) {
          const accepted = await acceptOne(target);
          if (accepted) landed.push(accepted);
        }
      } catch (e) {
        setError(`Added ${landed.length} of ${remaining.length} — ${errorMessage(e)} The rest were not added.`);
      } finally {
        setState(current => landed.reduce(
          (next, accepted) => recordDeckDecision(next, accepted),
          // Everything asked about is behind us either way: what failed was offered and not taken.
          { ...current, index: current.total },
        ));
        setBusy(false);
      }
    })();
  }, [busy, proposal, deck, state.index, acceptOne]);

  /** Undo the whole run: delete exactly the rules it created, newest first. */
  const undoAll = useCallback(() => {
    setBusy(true);
    void (async () => {
      const created = [...state.decisions].reverse();
      let done = 0;
      try {
        for (const accepted of created) {
          await remove.mutateAsync(accepted.ruleId);
          done++;
        }
        setUndone(true);
        toast.success(`Undone — ${created.length} ${created.length === 1 ? 'rule was' : 'rules were'} removed`);
      } catch (e) {
        // How far it got, which the mutation's own error toast cannot know.
        toast.message(`Removed ${done} of ${created.length} — the rest are still there. ${errorMessage(e)}`);
      } finally {
        setBusy(false);
      }
    })();
  }, [remove, state.decisions]);

  const added = state.decisions.length;
  const remaining = deck.length - state.index;

  return (
    <DeckShell
      label="Rules we found in your bank history"
      progress={progress}
      complete={complete}
      onClose={onClose}
      closeLabel="Skip for now"
      testId="rules-from-history-deck"
      hint={proposal ? 'Nothing is added until you press Add — skipping a card leaves it out entirely.' : undefined}
    >
      {!proposal || complete ? (
        <DeckEndCard
          testId="rules-from-history-end"
          // Never a confident zero: a run that added nothing says so in words.
          headline={added > 0
            ? `${added} ${added === 1 ? 'rule' : 'rules'} added to your budget`
            : 'No rules were added'}
          lines={added > 0 ? (
            <>
              {state.decisions.map(accepted => <p key={accepted.ruleId}>{accepted.name}</p>)}
              <p className="text-[10px]">
                You can change the name, amount or day of any of them in Budget.
              </p>
            </>
          ) : (
            <p>Your history is still there — nothing was skipped permanently.</p>
          )}
          onUndo={added > 0 && !undone ? undoAll : undefined}
          busy={busy}
          undoLabel="Undo — remove them again"
          undoneNote={undone ? 'Removed. Your budget is exactly as it was.' : undefined}
          onDone={onClose}
          doneLabel="Done"
        />
      ) : (
        <>
          <RuleProposalCard
            // Keyed on the proposal, so React builds a new card rather than re-animating the old one.
            key={proposal.id}
            proposal={proposal}
            accountLabel={accountName[proposal.accountId] ?? null}
            busy={busy}
            error={error}
            reducedMotion={reducedMotion}
            onAccept={onAccept}
            onSkip={onSkip}
          />
          {remaining > 1 && (
            <button
              onClick={acceptAll}
              disabled={busy}
              className="w-full bg-secondary border border-border px-3 py-2.5 text-xs font-medium hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-60"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {busy ? 'Adding…' : `Add all ${remaining} and finish`}
            </button>
          )}
        </>
      )}
    </DeckShell>
  );
}
