// THE DECK, AS A SHELL: full-bleed ground, "N of M", the thin gold bar, and the way out.
//
// Extracted from `transactions/DecisionDeck.tsx` when the second deck arrived (the rules-from-
// history run). `design/REDESIGN-PLAN.md` decision 5: "the deck is a shared primitive — a second
// deck implementation is a review-blocker." Nothing about a charge, a rule or a queue reaches this
// file; it holds the chrome, and the deck above it holds the decisions.
//
// ⚠️ NO PROGRESS MEANS NO BAR, never a 0% track. A bar reading zero and a bar that failed to compute
// look identical, and `deckProgress` already returns null rather than `0 of 0` — this renders that
// honestly instead of drawing an empty rail. Same rule as every other gauge in the app.

import { X, ListChecks } from 'lucide-react';
import type { DeckProgress } from '@/lib/decision-deck';

export interface DeckShellProps {
  /** What a screen reader calls this run. */
  label: string;
  /** `deckProgress(state)` — null when there is no run to report on. */
  progress: DeckProgress | null;
  /** True once the run is finished: the header reads "Done" and the bar fills. */
  complete: boolean;
  /** The way out, always available. Never a trap. */
  onClose: () => void;
  /** What leaving is called here — "Browse all" on the queue, "Skip for now" on a first run. */
  closeLabel: string;
  testId: string;
  /** The line under the card: what the gestures and keys do. Absent on the end screen. */
  hint?: React.ReactNode;
  children: React.ReactNode;
}

export default function DeckShell({
  label, progress, complete, onClose, closeLabel, testId, hint, children,
}: DeckShellProps) {
  return (
    <div
      className="fixed inset-0 z-50 bg-background overflow-y-auto overscroll-contain"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-testid={testId}
    >
      <div className="mx-auto w-full max-w-md px-4 pt-4 pb-10 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {complete ? 'Done' : `${progress?.position ?? 0} of ${progress?.total ?? 0}`}
          </p>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ListChecks size={12} /> {closeLabel} <X size={12} />
          </button>
        </div>

        {progress && (
          <div className="h-0.5 w-full bg-secondary" style={{ borderRadius: 'var(--radius)' }}>
            <div
              className="h-full bg-primary transition-[width] duration-200"
              style={{ width: `${complete ? 100 : progress.percent}%` }}
              data-testid={`${testId}-progress`}
            />
          </div>
        )}

        {children}

        {!complete && hint && (
          <p className="text-[10px] text-muted-foreground text-center">{hint}</p>
        )}
      </div>
    </div>
  );
}
