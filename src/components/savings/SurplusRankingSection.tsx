import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDown, ArrowUp, CreditCard, Car, Target, GripVertical } from 'lucide-react';
import { Link } from 'react-router';
import { useIsTouch } from '@/hooks/use-mobile';
import { formatCurrency } from '@/lib/calculations';
import { useSurplusRanking } from '@/hooks/useSurplusRanking';
import {
  moveSurplusRankRow, moveSurplusRankRowBy, setSurplusRankAutoExtra,
  type SurplusRankRow,
} from '@/lib/surplus-ranking';

const KIND_ICON = { cards: CreditCard, car_fund: Car, goal: Target } as const;

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

/**
 * "Where the extra money goes" — the user's ranked list, with the credit cards in it.
 *
 * The card block is a ROW, not a fixed header, and that is the whole point of the section: until
 * the cards can be dragged below a goal there is no way for a user to say "this goal matters more
 * than my debt", which is what the ranked-surplus engine was built to honour. The block is one row
 * because the payoff strategy already orders the cards among themselves on marginal APR.
 *
 * The `Auto extra` checkbox is the only switch that turns the feature on at all: `auto_extra`
 * defaults FALSE on both tables, so a user who never touches this section keeps exactly today's
 * behaviour.
 */
export default function SurplusRankingSection({ cardsSubtitle }: { cardsSubtitle?: string }) {
  const { rows, commit, saving, loading, readOnly } = useSurplusRanking();
  const isTouch = useIsTouch();

  // Local copy so a drag or a tap moves the list at once and does not wait on the round trip.
  // Re-seeded whenever the persisted order changes underneath.
  const [draft, setDraft] = useState<SurplusRankRow[]>(rows);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const signature = rows.map(r => `${r.id}:${r.sortOrder}:${r.autoExtra}`).join('|');
  const seededRef = useRef(signature);
  useEffect(() => {
    if (seededRef.current === signature) return;
    seededRef.current = signature;
    setDraft(rows);
  }, [signature, rows]);

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

      <ul className="flex flex-col gap-1.5">
        {draft.map((row, i) => {
          const isCards = row.kind === 'cards';
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

              <span className="font-mono text-xs text-muted-foreground w-4 text-right shrink-0">{i + 1}</span>
              <RowIcon kind={row.kind} />

              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground wrap-break-word">{row.name}</p>
                <p className="text-[11px] font-mono text-muted-foreground">
                  {isCards
                    ? (cardsSubtitle ?? 'Minimums always paid · surplus follows your strategy')
                    : row.remaining && row.remaining > 0
                      ? `${formatCurrency(row.remaining, false)} to go`
                      : 'Fully funded'}
                </p>
              </div>

              {isCards ? (
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
            </motion.li>
          );
        })}
      </ul>

      {readOnly && (
        <p className="text-xs text-muted-foreground mt-3">
          This is a demo — <Link to="/auth" className="text-primary hover:underline">use it with your own data</Link> to set a priority.
        </p>
      )}
    </div>
  );
}
