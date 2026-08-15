// One card of the rules-from-history deck: one rule the app thinks the history implies.
//
// This file is the LOOK. It performs no writes and holds no run state — every action is a callback
// into `RulesFromHistoryDeck.tsx`, which routes acceptance to the same `add` mutation the rule
// editor on Budget calls.
//
// ⚠️ THE CARD SAYS THIS IS A DRAFT, IN WORDS, ON THE CARD. Not in a tooltip and not in an onboarding
// blurb three screens back. The app is reading a rhythm off a merchant name; it can be wrong, the
// user is the one who knows, and `plaid-category-map.ts`'s rule ("a suggestion is a first draft the
// user corrects, never a claim") is only true if the surface actually admits it.
//
// ⚠️ THE EVIDENCE IS ON THE CARD TOO. "Seen 4 months in a row" is why the app is asking, and a
// proposal without its reason is a claim wearing a question mark. Same instinct as `describeDrift`.

import { motion } from 'framer-motion';
import { Check, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import type { RuleProposal } from '@/lib/rules-from-history';
import { describeCadence, describeEvidence } from '@/lib/rule-proposal-write';

export interface RuleProposalCardProps {
  proposal: RuleProposal;
  /** The account's name, or null when the account cannot be resolved. */
  accountLabel: string | null;
  busy: boolean;
  /** A write that failed, in the user's language. Never swallowed — the card says so and stays put. */
  error: string | null;
  reducedMotion: boolean;
  onAccept: () => void;
  onSkip: () => void;
}

export default function RuleProposalCard({
  proposal, accountLabel, busy, error, reducedMotion, onAccept, onSkip,
}: RuleProposalCardProps) {
  const income = proposal.direction === 'income';

  return (
    <motion.div
      initial={reducedMotion ? false : { x: 64, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
      className="card-forged p-5 space-y-5"
      data-testid="rule-proposal-card"
    >
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          {income ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {income ? 'Money in' : 'Bill'}
        </p>
        <p className="text-lg font-semibold leading-tight break-words">{proposal.name}</p>
      </div>

      <p
        data-testid="rule-proposal-amount"
        className={`text-5xl font-display font-bold leading-none ${income ? 'text-success' : 'text-foreground'}`}
      >
        {income ? '+' : '-'}{formatCurrency(proposal.amount, false)}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{describeCadence(proposal)}</span>
        {accountLabel && (
          <span
            className="text-[11px] text-muted-foreground bg-secondary border border-border px-2 py-0.5"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {accountLabel}
          </span>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">{describeEvidence(proposal)}</p>

      <p className="text-sm font-medium leading-snug">Add this as a recurring rule?</p>

      {error && (
        <p className="text-[11px] text-destructive" role="alert">{error}</p>
      )}

      <div className="space-y-3">
        <button
          onClick={onAccept}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-3 text-sm font-semibold disabled:opacity-60"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <Check size={15} /> {busy ? 'Saving…' : 'Add this rule'}
        </button>
        <button
          onClick={onSkip}
          disabled={busy}
          className="w-full flex items-center justify-center gap-1.5 bg-secondary border border-border px-3 py-2.5 text-xs font-medium hover:text-foreground disabled:opacity-60"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Not a rule <ChevronRight size={12} />
        </button>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          This is our reading of your history, not a fact — the amount is the median of the last
          three months. Add it and you can change the name, amount or day any time in Budget.
        </p>
      </div>
    </motion.div>
  );
}
