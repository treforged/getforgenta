import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDown, ArrowUp, Banknote, Car, CreditCard, GripVertical, Link2, Target, Unlink,
} from 'lucide-react';
import { Link } from 'react-router';
import { useIsTouch } from '@/hooks/use-mobile';
import { formatCurrency } from '@/lib/calculations';
import { useSurplusRanking } from '@/hooks/useSurplusRanking';
import {
  DEFAULT_SPLIT_SHARE, joinSurplusRankRow, moveSurplusRankRow, moveSurplusRankRowBy,
  separateSurplusRankRow, setSurplusRankAutoExtra,
  type SurplusRankRow,
} from '@/lib/surplus-ranking';
import {
  assessReachability, assessSurplusCollision, type Reachability,
} from '@/lib/surplus-reachability';

const KIND_ICON = {
  cards: CreditCard, card: CreditCard, car_fund: Car, goal: Target, loan: Banknote,
} as const;

/**
 * How a row travels when its rank changes.
 *
 * A spring rather than a fixed-duration tween because the distance varies: a tap on the touch
 * arrows swaps two neighbours, while a drag can carry a row the length of the list, and one
 * duration cannot flatter both — the short hop looks sluggish and the long one looks rushed.
 *
 * `layout="position"` (not plain `layout`) is deliberate. The rows are not all the same height —
 * a long goal name wraps onto a second line — and full layout animation would interpolate WIDTH
 * and HEIGHT too, so a tall row visibly squashed as it moved. Position-only leaves the box alone
 * and animates just the travel.
 *
 * Motion-sensitive users never see any of it: `<MotionConfig reducedMotion="user">` in `App.tsx`
 * neutralises layout animations wholesale, so the rows snap the way they did before.
 */
const ROW_SETTLE = { type: 'spring', stiffness: 520, damping: 40, mass: 0.7 } as const;

function RowIcon({ kind }: { kind: SurplusRankRow['kind'] }) {
  const Icon = KIND_ICON[kind];
  return <Icon size={14} className="text-primary shrink-0" />;
}

export type SurplusRankingSectionProps = {
  cardsSubtitle?: string;
  /**
   * What each target is PROJECTED to receive per month, index 0 the current month — the forecast's
   * own `autoExtraByTarget`, re-keyed by `buildAutoExtraByTarget`.
   *
   * ⚠️ Omitted means "nothing was measured", and every verdict below then reads `unknown` and
   * prints nothing. That is the point: a row that says "on track" because no schedule was supplied
   * is indistinguishable from a row that is genuinely on track, and this app does not print
   * numbers it cannot stand behind.
   */
  autoExtraByTarget?: ReadonlyMap<string, number[]>;
  /** Each target's own scheduled monthly contribution, which fills the same need the reserve does
   *  and so belongs in the same schedule. Keyed by goal / car-fund id. */
  ownMonthlyByTarget?: Readonly<Record<string, number>>;
  /** The whole deployable surplus per month, before it is split between debt and everything else.
   *  The honest ceiling on what every target combined can receive. */
  capacityByMonth?: readonly number[];
  /** Local `YYYY-MM-DD`. Only used to turn a target date into a month index. */
  asOf?: string;
};

/** How a verdict reads on the row, and how loudly. `null` prints nothing at all. */
function reachabilityNote(r: Reachability, targetDate: string | null): { text: string; tone: string } | null {
  const by = targetDate
    ? new Date(`${targetDate.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : '';
  switch (r.verdict) {
    case 'never':
      return {
        text: `Will not reach it by ${by} — ${formatCurrency(r.shortfall, false)} short`,
        tone: 'text-destructive',
      };
    case 'late':
      return {
        text: `${r.monthsLate} month${r.monthsLate === 1 ? '' : 's'} late — ${formatCurrency(r.shortfall, false)} short at ${by}`,
        tone: 'text-destructive',
      };
    case 'on_track':
      return { text: `On track for ${by}`, tone: 'text-muted-foreground' };
    // 'unknown' prints nothing on purpose; 'funded' and 'undated' are already clear from the row.
    default:
      return null;
  }
}

/**
 * "Where the extra money goes" — the user's ranked list, with the credit cards in it.
 *
 * Three things this section can express that it could not before 2026-08-21, all of them asked
 * for by name ("chase card first. move fund split with discover. … extra car payments should be
 * on the list", and "the app should tell me and have these abilities"):
 *
 *   1. A CARD CAN LEAVE THE BLOCK, so a goal can be ranked BETWEEN two cards. The block is still
 *      the default — the payoff strategy orders the cards on marginal APR, and a rank that
 *      overrode it would cost interest — but a block cannot express "after the Visa, before the
 *      Discover", which is an ordinary thing to want.
 *   2. TWO ROWS CAN SHARE A RANK and divide its money by weight, instead of the upper one filling
 *      before the lower is offered a cent.
 *   3. A ROW SAYS WHETHER IT ACTUALLY GETS THERE. A goal that cannot be met by its own date now
 *      says so, in dollars, on the row — and the section as a whole prices total demand against
 *      total capacity. Every one of those numbers comes from a measured schedule; where none was
 *      supplied the row stays quiet rather than printing a reassuring zero.
 *
 * The `Auto extra` checkbox is still the only switch that turns the feature on at all:
 * `auto_extra` defaults FALSE on both tables, so a user who never touches this section keeps
 * exactly today's behaviour.
 */
export default function SurplusRankingSection({
  cardsSubtitle, autoExtraByTarget, ownMonthlyByTarget, capacityByMonth, asOf,
}: SurplusRankingSectionProps) {
  const { rows, cards, commit, setCardSeparated, saving, loading, readOnly } = useSurplusRanking();
  const isTouch = useIsTouch();

  // Local copy so a drag or a tap moves the list at once and does not wait on the round trip.
  // Re-seeded whenever the persisted order changes underneath.
  const [draft, setDraft] = useState<SurplusRankRow[]>(rows);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const signature = rows.map(r => `${r.id}:${r.sortOrder}:${r.autoExtra}:${r.share}`).join('|');
  const seededRef = useRef(signature);
  useEffect(() => {
    if (seededRef.current === signature) return;
    seededRef.current = signature;
    setDraft(rows);
  }, [signature, rows]);

  const today = asOf ?? new Date().toISOString().slice(0, 10);

  /**
   * Each row's verdict. The schedule a target is measured on is the ranked extra it is projected
   * to receive PLUS its own monthly contribution — they fill the same need, so leaving the
   * contribution out would call a goal unreachable that its own standing transfer reaches.
   */
  const verdicts = useMemo(() => {
    const out = new Map<string, Reachability>();
    if (!autoExtraByTarget) return out;
    for (const row of rows) {
      if (row.remaining === null) continue;
      const extra = autoExtraByTarget.get(row.id);
      const own = ownMonthlyByTarget?.[row.id] ?? 0;
      const months = extra ?? (capacityByMonth ? new Array(capacityByMonth.length).fill(0) : undefined);
      const monthly = months?.map(m => m + own);
      out.set(row.id, assessReachability({
        id: row.id, remaining: row.remaining, targetDate: row.targetDate, monthly,
      }, today));
    }
    return out;
  }, [rows, autoExtraByTarget, ownMonthlyByTarget, capacityByMonth, today]);

  /** Total demand against total capacity — the collision, priced. */
  const collision = useMemo(() => {
    if (!capacityByMonth || capacityByMonth.length === 0) return null;
    const c = assessSurplusCollision(
      rows
        .filter(r => r.remaining !== null)
        .map(r => ({
          id: r.id,
          remaining: r.remaining as number,
          targetDate: r.targetDate,
          monthly: autoExtraByTarget?.get(r.id),
        })),
      capacityByMonth, today,
    );
    return c.shortfall > 0 ? c : null;
  }, [rows, autoExtraByTarget, capacityByMonth, today]);

  function apply(next: SurplusRankRow[]) {
    setDraft(next);
    commit(next);
  }

  // ── Desktop drag ─────────────────────────────────────────
  //
  // ⚠️ `dragIdRef` is a ref ON PURPOSE, for the reason `Builds.tsx` documents at its own phase-drag
  // handlers: promoting it to state re-renders the dragged node mid-drag, which cancels the native
  // HTML5 drag. It is written ONLY from DOM drag handlers (onDragStart / onDragEnd / onDrop) and
  // read only from the same, so unlike Builds' pair it needs no `react-hooks/immutability` waiver.
  const dragIdRef = useRef<string | null>(null);

  function onDragStart(e: React.DragEvent, id: string) {
    dragIdRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('surplus-rank-id', id);
    setDraggingId(id);
  }

  function onDragOver(e: React.DragEvent, id: string) {
    if (!dragIdRef.current || dragIdRef.current === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(id);
  }

  function onDragEnd() {
    dragIdRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
  }

  function onDrop(e: React.DragEvent, toId: string) {
    e.preventDefault();
    const fromId = e.dataTransfer.getData('surplus-rank-id') || dragIdRef.current;
    dragIdRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
    if (!fromId || fromId === toId) return;
    apply(moveSurplusRankRow(draft, fromId, toId));
  }

  function move(id: string, delta: number) {
    apply(moveSurplusRankRowBy(draft, id, delta));
  }

  function toggleAutoExtra(id: string, value: boolean) {
    apply(setSurplusRankAutoExtra(draft, id, value));
  }

  function toggleSplit(row: SurplusRankRow, index: number) {
    const inSplit = draft.some(r => r.id !== row.id && r.sortOrder === row.sortOrder && r.share !== null && row.share !== null);
    apply(inSplit
      ? separateSurplusRankRow(draft, row.id)
      : joinSurplusRankRow(draft, row.id, DEFAULT_SPLIT_SHARE));
    void index;
  }

  // Cards still inside the block — the ones that can be pulled out and ranked on their own.
  const blockedCards = useMemo(() => {
    const solo = new Set(draft.filter(r => r.kind === 'card').map(r => r.id));
    return (cards ?? []).filter(c => !solo.has(c.id));
  }, [cards, draft]);

  // One row is the cards, always. A list with nothing else in it cannot express a priority, so
  // there is nothing to show yet.
  if (loading || draft.length < 2) return null;

  return (
    <div className="card-forged p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Where the extra money goes</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Left-over cash after the bills is offered to these in order. Card minimums are always
            paid first — this ranks what happens to the surplus.
          </p>
        </div>
        {saving && <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground shrink-0 mt-0.5">Saving…</span>}
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Tick <span className="text-foreground font-medium">Auto extra</span> on anything that should
        take a share. Nothing is diverted until you do.
      </p>

      {/* THE COLLISION, PRICED. Session 6 worked this out by hand and put it in a handoff file;
          the app diverts the money, so the app is what has to say the money does not go round. */}
      {collision && (
        <div className="mb-3 px-3 py-2 border border-destructive/40 bg-destructive/5" style={{ borderRadius: 'var(--radius)' }}>
          <p className="text-xs font-medium text-destructive">
            {formatCurrency(collision.demand, false)} wanted over the next {collision.horizonMonths} months,{' '}
            {formatCurrency(collision.capacity, false)} available —{' '}
            {formatCurrency(collision.shortfall, false)} short.
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Something has to give: a target amount, a date, or the ranking below.
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {draft.map((row, i) => {
          const isCards = row.kind === 'cards';
          const isCard = row.kind === 'card';
          const prev = draft[i - 1];
          const inSplit = draft.some(r => r.id !== row.id && r.sortOrder === row.sortOrder && r.share !== null && row.share !== null);
          const startsSplit = inSplit && (!prev || prev.sortOrder !== row.sortOrder);
          const verdict = verdicts.get(row.id);
          const note = verdict ? reachabilityNote(verdict, row.targetDate) : null;
          return (
            <motion.li
              key={row.id}
              layout="position"
              transition={ROW_SETTLE}
              onDragOver={e => !isTouch && !readOnly && onDragOver(e, row.id)}
              onDrop={e => !isTouch && !readOnly && onDrop(e, row.id)}
              className={[
                // ⚠️ NOT `transition-all`. That included `transform`, so the CSS transition and
                // framer's own per-frame transform writes fought over the same property and the
                // row juddered to its new rank instead of gliding. The tween is framer's job;
                // CSS keeps only the properties framer never touches.
                'flex items-center gap-2.5 px-2.5 py-2 bg-secondary/40 border',
                'transition-[background-color,border-color,box-shadow,opacity] duration-150',
                draggingId === row.id ? 'opacity-40' : '',
                dragOverId === row.id ? 'border-primary shadow-[0_0_0_1px_hsl(var(--primary))]' : 'border-transparent',
                inSplit && !startsSplit ? 'ml-4' : '',
              ].join(' ')}
              style={{ borderRadius: 'var(--radius)' }}
            >
              {readOnly ? (
                <span className="w-4 shrink-0" />
              ) : !isTouch ? (
                <div
                  draggable
                  onDragStart={e => onDragStart(e, row.id)}
                  onDragEnd={onDragEnd}
                  className="cursor-grab text-muted-foreground opacity-30 hover:opacity-70 shrink-0"
                  title="Drag to reorder"
                >
                  <GripVertical size={14} />
                </div>
              ) : (
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    type="button"
                    aria-label={`Move ${row.name} up`}
                    disabled={i === 0}
                    onClick={() => move(row.id, -1)}
                    className="text-muted-foreground disabled:opacity-20 hover:text-foreground transition-colors p-1"
                  ><ArrowUp size={16} /></button>
                  <button
                    type="button"
                    aria-label={`Move ${row.name} down`}
                    disabled={i === draft.length - 1}
                    onClick={() => move(row.id, 1)}
                    className="text-muted-foreground disabled:opacity-20 hover:text-foreground transition-colors p-1"
                  ><ArrowDown size={16} /></button>
                </div>
              )}

              {/* A split rank prints ONE number for both its rows. Printing 2 and 3 beside two rows
                  that share the money would say the opposite of what happens. */}
              <span className="font-mono text-xs text-muted-foreground w-4 text-right shrink-0">
                {inSplit && !startsSplit ? '' : row.sortOrder + 1}
              </span>
              <RowIcon kind={row.kind} />

              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground wrap-break-word">
                  {row.name}
                  {inSplit && row.share !== null && (
                    <span className="ml-1.5 text-[10px] font-mono text-primary">
                      {Math.round(row.share)}%
                    </span>
                  )}
                </p>
                <p className="text-[11px] font-mono text-muted-foreground">
                  {isCards
                    ? (cardsSubtitle ?? 'Minimums always paid · surplus follows your strategy')
                    : row.kind === 'loan'
                      // A loan is RANKABLE but not yet FUNDED by the engine — the projection has
                      // nowhere to credit an extra principal payment, so it must not take one.
                      // Saying so is the only honest option; see `includeLoanTargets`.
                      ? `${formatCurrency(row.remaining ?? 0, false)} owed · ranking only for now`
                      : isCard
                        ? `${formatCurrency(row.remaining ?? 0, false)} balance · minimum always paid`
                        : row.remaining && row.remaining > 0
                          ? `${formatCurrency(row.remaining, false)} to go`
                          : 'Fully funded'}
                </p>
                {note && <p className={`text-[11px] ${note.tone}`}>{note.text}</p>}
              </div>

              {!readOnly && i > 0 && (
                <button
                  type="button"
                  onClick={() => toggleSplit(row, i)}
                  title={inSplit ? 'Give this its own rank' : 'Split this rank with the one above'}
                  aria-label={inSplit ? `Unsplit ${row.name}` : `Split ${row.name} with the row above`}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 shrink-0"
                >
                  {inSplit ? <Unlink size={13} /> : <Link2 size={13} />}
                </button>
              )}

              {isCards || isCard ? (
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground shrink-0">Always</span>
              ) : (
                <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={row.autoExtra}
                    disabled={readOnly}
                    onChange={e => toggleAutoExtra(row.id, e.target.checked)}
                    className="accent-primary"
                    aria-label={`Auto extra for ${row.name}`}
                  />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Auto extra</span>
                </label>
              )}

              {isCard && !readOnly && (
                <button
                  type="button"
                  onClick={() => setCardSeparated(row.id, false)}
                  className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  aria-label={`Put ${row.name} back in the card block`}
                >
                  Re-block
                </button>
              )}
            </motion.li>
          );
        })}
      </ul>

      {/* Pulling a card out of the block is deliberately an explicit act, and deliberately not a
          drag: the default — one block, ordered by the payoff strategy — is the only arrangement
          that cannot cost the user interest, so leaving it should take a decision. */}
      {!readOnly && blockedCards.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Rank a card on its own
          </span>
          {blockedCards.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCardSeparated(c.id, true)}
              className="text-[11px] px-2 py-0.5 border border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {readOnly && (
        <p className="text-xs text-muted-foreground mt-3">
          This is a demo — <Link to="/auth" className="text-primary hover:underline">use it with your own data</Link> to set a priority.
        </p>
      )}
    </div>
  );
}
