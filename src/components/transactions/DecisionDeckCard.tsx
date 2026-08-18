// One card of the Decision Deck: one charge, one question, and the decision in thumb reach.
//
// This file is the LOOK. It performs no writes and holds no run state — every action is a callback
// into `DecisionDeck.tsx`, which routes it to the same mutations the Bank Activity list calls.
//
// ⚠️ SWIPE IS AN ENHANCEMENT, NEVER THE CONTROL. Every action here is a real button that is always
// on screen and always keyboard-reachable; the drag gesture is a shortcut to two of them. A gesture
// is invisible, undiscoverable and unavailable to anyone using a keyboard or a screen reader, so an
// action reachable only by swiping is an action a portion of users simply do not have.
//
// Visual language, per `design/DIRECTION.md`: obsidian ground, `card-forged`, `font-display` on the
// hero amount, section labels as `text-xs uppercase tracking-wider text-muted-foreground`, and GOLD
// (`primary`) on the primary action only. Laid out for 390px first — everything below the amount is
// in the lower two thirds of the screen, where a thumb reaches.

import { motion, type PanInfo } from 'framer-motion';
import { EyeOff, Check, ChevronRight, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import type { Category } from '@/lib/types';

/**
 * How far a drag must travel before it counts as a decision, in px.
 *
 * Deliberately well past a scroll wobble: a swipe that fires at 40px would turn an attempt to scroll
 * the chip row into an accepted link, and an accidental decision is far more expensive here than a
 * gesture that did not take.
 */
const SWIPE_COMMIT_PX = 110;

export interface DecisionDeckCardProps {
  merchantLabel: string;
  /** Outflow positive, inflow negative — Stage A's convention, as it arrives from the queue. */
  amount: number;
  /** `YYYY-MM-DD`. */
  date: string;
  /** The account's name, or null when the charge names no account we can resolve. */
  accountLabel: string | null;
  /** What the app already thinks this is, in one phrase, or null when it thinks nothing. */
  suggestionLabel: string | null;
  /**
   * WHERE that suggestion came from, when it did not come from matching this charge.
   *
   * ⚠️ REQUIRED FOR A REMEMBERED OFFER, and the reason is that the two are not equally strong. A
   * matched suggestion is evidence about THIS row — same amount, same window. A remembered one is
   * evidence about the merchant ("you have linked this one 22 times"), which is often the better
   * answer and is never the same claim. Rendering them identically would tell the user the app
   * matched something it did not.
   */
  suggestionNote?: string | null;
  chips: readonly Category[];
  /** The category the charge already carries, so the chip row can show which one is current. */
  currentCategory: string | null;
  busy: boolean;
  /** A write that failed, in the user's language. Never swallowed — the card says so and stays put. */
  error: string | null;
  reducedMotion: boolean;
  onAccept: () => void;
  onCategory: (category: Category) => void;
  onSkip: () => void;
  onIgnore: () => void;
}

export default function DecisionDeckCard({
  merchantLabel, amount, date, accountLabel, suggestionLabel, suggestionNote = null, chips,
  currentCategory, busy, error, reducedMotion, onAccept, onCategory, onSkip, onIgnore,
}: DecisionDeckCardProps) {
  const isInflow = amount < 0;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (busy) return;
    // Right is the affirmative and left is "not now", matching the buttons' left-to-right order and
    // every other card deck a phone user has met. A right-swipe with nothing to accept does nothing
    // rather than falling back to some other decision — see `DecisionDeck.tsx`.
    if (info.offset.x > SWIPE_COMMIT_PX) { if (suggestionLabel) onAccept(); return; }
    if (info.offset.x < -SWIPE_COMMIT_PX) onSkip();
  };

  return (
    <motion.div
      // Slide + spring, 150-250ms band. Reduced motion gets the same card with no travel at all —
      // an instant swap, not a faster slide.
      initial={reducedMotion ? false : { x: 64, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
      drag={reducedMotion ? false : 'x'}
      dragSnapToOrigin
      dragElastic={0.18}
      onDragEnd={onDragEnd}
      className="card-forged p-5 space-y-5 touch-pan-y"
      data-testid="decision-deck-card"
    >
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {isInflow ? 'Money in' : 'Charge'}
        </p>
        {/* The merchant is what a person recognises, so it reads before the figure even though the
            figure is the hero. Wrapped rather than truncated: a card has the room a list row did
            not, and a cut-off merchant name is the reason a decision gets deferred. */}
        <p className="text-lg font-semibold leading-tight break-words">{merchantLabel}</p>
      </div>

      <p
        data-testid="decision-deck-amount"
        className={`text-5xl font-display font-bold leading-none ${isInflow ? 'text-success' : 'text-foreground'}`}
      >
        {isInflow ? '+' : '-'}{formatCurrency(Math.abs(amount), false)}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{date}</span>
        {accountLabel && (
          <span
            className="text-[11px] text-muted-foreground bg-secondary border border-border px-2 py-0.5"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {accountLabel}
          </span>
        )}
      </div>

      {/* ONE question per card. With a suggestion it is a yes/no; without one it is open. */}
      <p className="text-sm font-medium leading-snug">
        {suggestionLabel ? `Is this your ${suggestionLabel}?` : 'What is this?'}
      </p>

      {suggestionLabel && suggestionNote && (
        <p className="text-[11px] text-muted-foreground">{suggestionNote}</p>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-destructive" role="alert">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="space-y-3">
        {/* THE ONLY GOLD ON THE CARD. Offered only when there is something to accept — a disabled
            primary action asserting "nothing matched" would be a claim dressed as a button. */}
        {suggestionLabel && (
          <button
            onClick={onAccept}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-3 text-sm font-semibold disabled:opacity-60"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <Check size={15} /> {busy ? 'Saving…' : `Yes — ${suggestionLabel}`}
          </button>
        )}

        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Or give it a category</p>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip, i) => (
              <button
                key={chip}
                onClick={() => onCategory(chip)}
                disabled={busy}
                className={`flex items-center gap-1.5 border px-2.5 py-2 text-xs font-medium transition-colors disabled:opacity-60 ${
                  currentCategory === chip
                    ? 'border-primary/40 text-primary bg-primary/10'
                    : 'border-border bg-secondary text-foreground hover:border-primary/40'
                }`}
                style={{ borderRadius: 'var(--radius)' }}
              >
                {/* The digit that picks this chip. Shown rather than documented elsewhere — a
                    shortcut nobody can see is a shortcut nobody uses. */}
                <span className="text-[10px] text-muted-foreground">{i + 1}</span>
                {chip}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onSkip}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 bg-secondary border border-border px-3 py-2.5 text-xs font-medium hover:text-foreground disabled:opacity-60"
            style={{ borderRadius: 'var(--radius)' }}
          >
            Skip <ChevronRight size={12} />
          </button>
          <button
            onClick={onIgnore}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 bg-secondary border border-border px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <EyeOff size={12} /> Ignore
          </button>
        </div>
        {/* Says what Skip is NOT. On a financial surface, "I'll come back to this" and "this is
            nothing" have to be visibly different actions. */}
        <p className="text-[10px] text-muted-foreground">
          Skip decides nothing and leaves the charge here. Ignore records that nothing about it
          belongs in your ledger. Neither adds an entry or moves a projected number.
        </p>
      </div>
    </motion.div>
  );
}
