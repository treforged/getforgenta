// The way into the rules-from-history deck, from wherever a user might be when it becomes true.
//
// Two mount points, one component: the onboarding bank step once a link has synced, and the Budget
// page for an existing user who has just linked something new. A second entry point with its own
// copy and its own open-state would be the same drift `DeckShell` was extracted to stop.
//
// ⚠️ IT RENDERS NOTHING WHEN THERE IS NOTHING, AND NOTHING WHILE IT IS STILL COUNTING. "We found 0
// patterns" is a confident zero; a card that appears and then changes its number is worse. So the
// gate is `hasProposals`, which is false until every input has landed.
//
// ⚠️ IT IS AN OFFER, NEVER A BADGE. No count on a tab, no dot on a nav item, nothing that follows
// the user around — the same standing rule that keeps unreviewed rows off the Bank Activity badge.

import { useState } from 'react';
import { Sparkles, ChevronRight } from 'lucide-react';
import { useRuleProposals } from '@/hooks/useRuleProposals';
import RulesFromHistoryDeck from './RulesFromHistoryDeck';

export interface RulesFoundCardProps {
  /** Called when the deck run ends, however it ends. */
  onFinished?: () => void;
  className?: string;
}

export default function RulesFoundCard({ onFinished, className }: RulesFoundCardProps) {
  const { proposals, hasProposals } = useRuleProposals();
  const [open, setOpen] = useState(false);

  if (!hasProposals) return null;

  const count = proposals.length;

  return (
    <>
      <div className={`card-forged p-4 space-y-3 ${className ?? ''}`} data-testid="rules-found-card">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 bg-primary/15 border border-primary/30 rounded-full flex items-center justify-center shrink-0">
            <Sparkles size={14} className="text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              We found {count} {count === 1 ? 'pattern' : 'patterns'} in your bank history
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Bills and paychecks that have repeated for months. Take a look — one card each, and
              nothing is added to your budget until you say so.
            </p>
          </div>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-1.5 bg-primary text-primary-foreground px-3 py-2.5 text-xs font-semibold"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Review {count === 1 ? 'it' : 'them'} <ChevronRight size={13} />
        </button>
      </div>

      {open && (
        <RulesFromHistoryDeck
          // Snapshotted by the deck itself on mount — see its header.
          proposals={proposals}
          onClose={() => { setOpen(false); onFinished?.(); }}
        />
      )}
    </>
  );
}
