// The last screen of a deck run: what it did, one press to undo all of it, and the way back.
//
// Extracted alongside `DeckShell` for the second deck (rules-from-history). The COPY is the
// caller's — a run of charges and a run of proposed rules did different things and must say so in
// their own words — but the shape, and the two honesty rules baked into it, are shared:
//
// ⚠️ A RUN THAT DECIDED NOTHING SAYS SO IN WORDS. Never "0 decided", which reads as an achievement
// and is indistinguishable from a screen that failed to count.
//
// ⚠️ THE UNDO IS OFFERED ONLY WHILE IT IS STILL TRUE. Once a run has been undone the button goes and
// a plain sentence replaces it, so nobody presses a second time and wonders what it did.

import { RotateCcw, PartyPopper } from 'lucide-react';

export interface DeckEndCardProps {
  /** One line: "6 charges decided". The caller's words, because the caller knows what it wrote. */
  headline: string;
  /** The receipts under it. Empty for a run that did nothing. */
  lines?: React.ReactNode;
  /** Absent when there is nothing to undo — a run that wrote nothing, or one already reversed. */
  onUndo?: () => void;
  busy?: boolean;
  undoLabel?: string;
  /** Shown instead of the button once the undo has run. */
  undoneNote?: React.ReactNode;
  onDone: () => void;
  doneLabel: string;
  testId?: string;
}

export default function DeckEndCard({
  headline, lines, onUndo, busy = false, undoLabel = 'Undo all', undoneNote, onDone, doneLabel, testId,
}: DeckEndCardProps) {
  return (
    <div className="card-forged p-6 space-y-4 text-center" data-testid={testId}>
      <PartyPopper size={20} className="mx-auto text-primary" />
      <p className="text-sm font-medium">{headline}</p>
      {lines && <div className="space-y-0.5 text-xs text-muted-foreground">{lines}</div>}
      {onUndo && (
        <button
          onClick={onUndo}
          disabled={busy}
          className="w-full flex items-center justify-center gap-1.5 bg-secondary border border-border px-3 py-2.5 text-xs font-medium hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-60"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <RotateCcw size={12} /> {busy ? 'Undoing…' : undoLabel}
        </button>
      )}
      {undoneNote && <p className="text-xs text-muted-foreground">{undoneNote}</p>}
      <button
        onClick={onDone}
        className="w-full bg-primary text-primary-foreground px-3 py-2.5 text-xs font-semibold"
        style={{ borderRadius: 'var(--radius)' }}
      >
        {doneLabel}
      </button>
    </div>
  );
}
