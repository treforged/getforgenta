import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDown, ArrowUp, Banknote, Car, CreditCard, GripVertical, Landmark, Link2, Target, Unlink,
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
  assessReachability, assessSurplusCollision, monthIndexOf, type Reachability,
} from '@/lib/surplus-reachability';
import { contributionStartIdx } from '@/lib/savings-growth';

const KIND_ICON = {
  cards: CreditCard, card: CreditCard, car_fund: Car, goal: Target, loan: Banknote,
  liability: Landmark,
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

/**
 * A target's own standing transfer: how much a month, and the month it starts.
 *
 * ⚠️ THE DATE TRAVELS WITH THE AMOUNT, in one value rather than a second parallel record. A
 * contribution that has not begun yet funds nothing, and while this was a bare number the ranked
 * list read "On track for Jul 2027" for a goal whose transfer was dated to start Nov 2027 — the
 * verdict counting money the savings-growth chart, reading the same goal, correctly did not.
 */
export type OwnContribution = {
  /** Dollars a month once it is running. */
  monthly: number;
  /** `contribution_start_date`, `YYYY-MM-DD`. Null means "already running". */
  startDate: string | null;
};

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
  ownMonthlyByTarget?: Readonly<Record<string, OwnContribution>>;
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
  const {
    rows, cards, liabilities, commit, setCardRankMode, setLiabilityRanked, saving, loading,
    readOnly,
  } = useSurplusRanking();
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
   * ONE schedule per target, built once and used by BOTH the per-row verdict and the banner.
   *
   * ⚠️ THIS IS DELIBERATELY NOT DUPLICATED, and it was a real defect for one build when it was:
   * the banner built its own targets without `ownMonthlyByTarget`, so the panel printed
   * "$3,720 short at Jul 2027" on the row and "$6,120 short in total" three inches above it, for
   * the same single target. A total that disagrees with the row under it is the number nobody can
   * stand behind — the same rule `non-cc-liabilities.ts` was written to enforce.
   *
   * The schedule is the ranked extra a target is projected to receive PLUS its own monthly
   * contribution from the month that contribution starts: they fill the same need, so leaving the
   * contribution out calls a goal unreachable that its own standing transfer reaches — and
   * starting it early calls a goal reachable that its transfer has not begun funding. Both the row
   * verdict and the banner read this one map, so neither can hold the other's answer.
   */
  const inputsById = useMemo(() => {
    // The month `today` falls in, parsed exactly the way `savings-growth.ts` parses its own base
    // month, so the two models measure the same offsets from the same origin.
    const base = new Date(`${today}T00:00:00`);
    const out = new Map<string, { id: string; remaining: number; targetDate: string | null; monthly?: number[] }>();
    for (const row of rows) {
      if (row.remaining === null) continue;
      const extra = autoExtraByTarget?.get(row.id);
      // ⚠️ THE GOAL'S OWN MONTHLY CONTRIBUTION BELONGS TO THE FIRST STOP ONLY. It is one standing
      // transfer into one account, and the thresholds are cumulative, so it fills stop 1 and only
      // reaches stop 2 through it. Crediting it to every stop would call a three-stop plan reachable
      // on three times the money that actually arrives.
      const contribution = row.stage != null && row.stage > 1
        ? undefined
        : ownMonthlyByTarget?.[row.goalId ?? row.id];
      const own = Math.max(0, Number(contribution?.monthly) || 0);
      // ⚠️ AND IT ONLY COUNTS FROM THE MONTH IT STARTS. Live on 2026-08-27 a goal whose
      // `contribution_start_date` was 2027-11-21 read "On track for Jul 2027" — four months before
      // the first dollar was scheduled to move — because this credited it from month 0. The start
      // month is READ from `savings-growth.ts` rather than re-derived here, so the verdict and the
      // growth chart above it can never disagree about the same goal. A goal with no start date, or
      // one already past, resolves to 0 and lands on exactly the schedule it had before.
      const startsAt = contributionStartIdx(contribution?.startDate, base.getFullYear(), base.getMonth());
      const months = extra ?? (capacityByMonth ? new Array(capacityByMonth.length).fill(0) : undefined);
      out.set(row.id, {
        id: row.id,
        remaining: row.remaining,
        targetDate: row.targetDate,
        monthly: autoExtraByTarget ? months?.map((m, i) => m + (i >= startsAt ? own : 0)) : undefined,
      });
    }
    return out;
  }, [rows, autoExtraByTarget, ownMonthlyByTarget, capacityByMonth, today]);

  const verdicts = useMemo(() => {
    const out = new Map<string, Reachability>();
    if (!autoExtraByTarget) return out;
    for (const input of inputsById.values()) out.set(input.id, assessReachability(input, today));
    return out;
  }, [inputsById, autoExtraByTarget, today]);

  /**
   * Total demand against total capacity — the collision, priced.
   *
   * ⚠️ THE HORIZON IS THE LAST DATED TARGET, not the whole projection. Measured over sixty months
   * almost nothing collides: the surplus eventually covers everything, so a shortfall that is real
   * and dated — $10,340 wanted by Jul 2027 out of a pool that size — disappears into the years
   * after it was needed. The window that answers the user's question is the one their own deadlines
   * define, so demand and capacity are both measured to the furthest date they actually set.
   */
  const collision = useMemo(() => {
    if (!capacityByMonth || capacityByMonth.length === 0) return null;
    const targets = [...inputsById.values()];
    const lastDated = targets.reduce(
      (m, t) => (t.targetDate ? Math.max(m, monthIndexOf(today, t.targetDate) + 1) : m), 0,
    );
    if (lastDated <= 0) return null;
    const c = assessSurplusCollision(targets, capacityByMonth, today, lastDated);
    // Fires on either failure, and they are NOT the same failure. `shortfall` is "there is not
    // enough money in these months"; `unreachable` is "there is, and the ranking does not send it
    // here" — which is the live case: the Move fund misses Jul 2027 by 22 months while capacity
    // over the same window is larger than what it needs, because the cards are ranked above it.
    // A banner that only fired on the first would stay silent on the one the user can actually fix.
    return c.shortfall > 0 || c.unreachable.length > 0 ? c : null;
  }, [inputsById, capacityByMonth, today]);

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

  /**
   * The number printed beside each row: its POSITION in the list, counted by rank.
   *
   * ⚠️ Not `sortOrder + 1`. `sort_order` defaults to 0 on every table, so rows routinely share a
   * stored rank without being a split — live on 2026-08-21 a car loan and a Roth IRA both printed
   * "4". A split prints ONE number for its rows, which is the truth about where their money comes
   * from; anything else counts up.
   */
  const displayRank = useMemo(() => {
    const out = new Map<string, number>();
    let n = 0;
    draft.forEach((row, i) => {
      const prev = draft[i - 1];
      const joined = prev && prev.sortOrder === row.sortOrder && prev.share !== null && row.share !== null;
      if (i > 0 && !joined) n += 1;
      out.set(row.id, n + 1);
    });
    return out;
  }, [draft]);

  // Cards still inside the block — the ones that can be pulled out and ranked on their own.
  const blockedCards = useMemo(() => {
    const solo = new Set(draft.filter(r => r.kind === 'card').map(r => r.id));
    return (cards ?? []).filter(c => !solo.has(c.id));
  }, [cards, draft]);

  /**
   * Which mode the list is CURRENTLY in. Derived rather than stored, so no flag can disagree with
   * the rows on screen.
   *
   * ⚠️ THREE STATES, NOT TWO, and the third is the whole point. A first version of this asked only
   * whether ANY card had been pulled out, which reported "One row each" while two of Tre's four
   * cards were still inside the block - the toggle claiming the exact arrangement it exists to
   * prevent (Tre, 2026-08-26: "why does it show both credit cards, and the individual cards
   * still?"). A list can be MIXED because that is what the old per-card control left behind, so
   * the honest reading is: individual only when NOTHING is left in the block, block only when
   * nothing has been pulled out, and mixed otherwise - in which case neither button is pressed and
   * the user is told what they are looking at.
   */
  const soloCardCount = rows.filter(r => r.kind === 'card').length;
  const cardMode: 'block' | 'individual' | 'mixed' =
    soloCardCount === 0 ? 'block'
      : blockedCards.length === 0 ? 'individual'
        : 'mixed';


  // Student loans / mortgages / other liabilities NOT yet on the list — the ones that can be added
  // to it. Keyed off the DRAFT rather than off `surplus_sort_order` so a row that was just added
  // stops being offered at once, the same way a card leaves `blockedCards` the moment it is
  // pulled out.
  const unrankedLiabilities = useMemo(() => {
    const ranked = new Set(draft.filter(r => r.kind === 'liability').map(r => r.id));
    return (liabilities ?? []).filter(l => !ranked.has(l.id));
  }, [liabilities, draft]);

  // Only the load is hidden. An empty list and an unread one are the same pixels, and this section
  // used to stay dark below two rows, which meant a user with no goals yet never saw that the
  // feature existed at all, and could not find the thing that would have populated it.
  if (loading) return null;

  // One row cannot be put in front of anything, so the sparse list drops the reorder affordances
  // and says what the list is for instead of offering controls that do nothing.
  //
  // NOTE: `buildSurplusRankRows` now covers cards, goals, car funds, vehicle loans and ranked
  // non-CC liabilities, so most users pass two rows on their own and this state is short-lived.
  const canReorder = draft.length >= 2;

  return (
    <div className="card-forged p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Where the extra money goes</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Left-over cash after the bills goes to these one at a time, in order. Card minimums are
            always paid first; this ranks what happens to the surplus.
          </p>
        </div>
        {saving && <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground shrink-0 mt-0.5">Saving…</span>}
      </div>

      {/* With one row there is nothing to tick, so the instruction to tick something would be
          telling the user to look for a control that is not on screen. The sparse list says how it
          grows instead. */}
      {canReorder ? (
        <p className="text-xs text-muted-foreground mb-3">
          Tick <span className="text-foreground font-medium">Auto extra</span> on anything that should
          take a share. Nothing is diverted until you do. Only the highest one that is not finished
          gets the money; when it is done the tick comes off and the next one takes over.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground mb-3">
          Savings goals, car funds and loans you add will show up here, and you choose which one gets
          the money first.
        </p>
      )}

      {/* THE COLLISION, PRICED. Session 6 worked this out by hand and put it in a handoff file;
          the app diverts the money, so the app is what has to say the money does not go round. */}
      {collision && (
        <div className="mb-3 px-3 py-2 border border-destructive/40 bg-destructive/5" style={{ borderRadius: 'var(--radius)' }}>
          <p className="text-xs font-medium text-destructive">
            {collision.shortfall > 0
              ? `${formatCurrency(collision.demand, false)} wanted over the next ${collision.horizonMonths} months, ${formatCurrency(collision.capacity, false)} available — ${formatCurrency(collision.shortfall, false)} short.`
              : `${collision.unreachable.length} ${collision.unreachable.length === 1 ? 'target does' : 'targets do'} not reach ${collision.unreachable.length === 1 ? 'its' : 'their'} own date — ${formatCurrency(collision.unreachable.reduce((s, u) => s + u.shortfall, 0), false)} short in total.`}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {collision.shortfall > 0
              ? 'Something has to give: a target amount, a date, or the ranking below.'
              : `There is ${formatCurrency(collision.capacity, false)} of surplus over those months — it is going somewhere higher in this list.`}
          </p>
        </div>
      )}

      {/* ABOVE the list, not below it: this decides how every card row underneath is
          arranged, and it spent one session sitting under eight rows where Tre could not find it
          and reported the feature missing. A control that governs a list belongs before it.
          ONE ANSWER AT A TIME. This used to be a per-card "rank this one on its own" button, which
          let the list show a Credit Cards block AND individual card rows together - two different
          answers to "how are my cards ranked" on one screen, and genuinely misleading on a split
          rank, where the block's weight and a pulled-out card's weight are partly about the same
          debt (Tre, 2026-08-26: "or just credit cards in general, never both"). It is a mode now.
          Either way the payoff strategy still decides which card the money actually hits. */}
      {!readOnly && (cards?.length ?? 0) > 0 && (
        <div
          className={`mt-3 space-y-1.5 ${cardMode === 'mixed' ? 'border border-amber-500/40 bg-amber-500/5 p-2.5' : ''}`}
          style={cardMode === 'mixed' ? { borderRadius: 'var(--radius)' } : undefined}
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Rank credit cards
            </span>
            {/* ALWAYS REQUIRE A SELECTION (Tre, 2026-08-26). A mixed list is an unanswered question,
                not a working state, so it is marked as one rather than left looking settled. */}
            {cardMode === 'mixed' && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-amber-500">Choose one</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCardRankMode('block')}
              aria-pressed={cardMode === 'block'}
              className={`text-[11px] px-2 py-1.5 min-h-[36px] border transition-colors ${
                cardMode === 'block'
                  ? 'border-primary text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-primary'
              }`}
              style={{ borderRadius: 'var(--radius)' }}
            >
              As one group
            </button>
            <button
              type="button"
              onClick={() => setCardRankMode('individual')}
              aria-pressed={cardMode === 'individual'}
              className={`text-[11px] px-2 py-1.5 min-h-[36px] border transition-colors ${
                cardMode === 'individual'
                  ? 'border-primary text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-primary'
              }`}
              style={{ borderRadius: 'var(--radius)' }}
            >
              One row each
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {cardMode === 'mixed'
              ? `Right now it is both: ${soloCardCount} on their own and ${blockedCards.length} sharing one spot. Until you pick, treat it as one group — that is the arrangement that cannot cost you extra interest.`
              : cardMode === 'individual'
                ? 'Each card sits in the list on its own, so you can fund a goal between two of them. Which card the money actually pays is still decided by your payoff strategy.'
                : 'All your cards share one spot in the list, ordered by your payoff strategy. That is the arrangement that cannot cost you extra interest.'}
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {draft.map((row, i) => {
          const isCards = row.kind === 'cards';
          const isCard = row.kind === 'card';
          const isLiability = row.kind === 'liability';
          // A LATER STOP of a staged goal. Since 2026-08-26 it IS a row the user owns — its own
          // rank, its own tick — so the only thing it still cannot do is join a SPLIT: a weight is
          // stored in `savings_goals.surplus_share`, one column, which belongs to the first stop.
          const isLaterStop = row.stage != null && row.stage > 1;
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
              onDragOver={e => !isTouch && !readOnly && canReorder && onDragOver(e, row.id)}
              onDrop={e => !isTouch && !readOnly && canReorder && onDrop(e, row.id)}
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
              {/* ── ARROWS, ON EVERY DEVICE ────────────────────────────────────────
                  Tre, 2026-08-26: "make the reorganizer arrows instead. especially so its easier
                  on mobile." The desktop drag handle is gone: a grip is a 16px target that needs a
                  press, a travel and a release to move one rank, and it was the ONLY control here
                  a phone could not use — so the list had two different reorder gestures depending
                  on what you were holding, and only one of them was ever tested on a phone.

                  `icon-btn` is the app's 44px tap target from index.css (the Builds tab adopted it
                  2026-08-24 after 24x24 arrows measured unhittable at 390x844). `min-w-[36px]`
                  narrows the pair back down because it is a VERTICAL stack and two 44px-wide cells
                  would eat a quarter of a 390px row. Drag-and-drop still WORKS on the row itself
                  for anyone who reaches for it; it is just no longer the only way in. */}
              {readOnly || !canReorder ? (
                <span className="w-9 shrink-0" />
              ) : (
                <div className="flex flex-col shrink-0">
                  <button
                    type="button"
                    aria-label={`Move ${row.name} up`}
                    disabled={i === 0}
                    onClick={() => move(row.id, -1)}
                    className="icon-btn min-w-[36px] text-muted-foreground disabled:opacity-20 hover:text-foreground transition-colors"
                  ><ArrowUp size={18} /></button>
                  <button
                    type="button"
                    aria-label={`Move ${row.name} down`}
                    disabled={i === draft.length - 1}
                    onClick={() => move(row.id, 1)}
                    className="icon-btn min-w-[36px] text-muted-foreground disabled:opacity-20 hover:text-foreground transition-colors"
                  ><ArrowDown size={18} /></button>
                </div>
              )}

              {/* A split rank prints ONE number for both its rows. Printing 2 and 3 beside two rows
                  that share the money would say the opposite of what happens. */}
              <span className="font-mono text-xs text-muted-foreground w-4 text-right shrink-0">
                {inSplit && !startsSplit ? '' : displayRank.get(row.id)}
              </span>
              <RowIcon kind={row.kind} />

              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground wrap-break-word">
                  {row.name}
                  {/* Which stop this row is. Without it two rows carrying the same goal name read
                      as a duplicate rather than as a sequence. The stop's own NAME leads when the
                      user gave it one, because "Move fund" says more than "Stop 1 of 3" — the
                      count follows it so the sequence is still legible either way. */}
                  {row.stage != null && (
                    <span className={`ml-1.5 text-[10px] font-mono uppercase tracking-wider ${isLaterStop ? 'text-primary' : 'text-muted-foreground'}`}>
                      {row.stageLabel ?? `Stop ${row.stage}`}
                      {row.stageCount != null && row.stageCount > 1 && ` · ${row.stage}/${row.stageCount}`}
                    </span>
                  )}
                  {inSplit && row.share !== null && (
                    <span className="ml-1.5 text-[10px] font-mono text-primary">
                      {Math.round(row.share)}%
                    </span>
                  )}
                </p>
                <p className="text-[11px] font-mono text-muted-foreground">
                  {isCards
                    ? (cardsSubtitle ?? 'Minimums always paid · surplus follows your strategy')
                    : row.kind === 'loan' || isLiability
                      // Extra PRINCIPAL, not the scheduled payment — that is already a bill by the
                      // time any of this runs, and saying "owed" rather than "to go" is what keeps
                      // a debt being paid down from reading like a pot being filled. A student
                      // loan and a vehicle loan read identically here because they ARE the same
                      // thing to the user: a balance the surplus can attack.
                      ? `${formatCurrency(row.remaining ?? 0, false)} owed · extra principal`
                      : isCard
                        // A card the user has PLANNED but not opened prints the same sentence as a
                        // real card with nothing owed, and "$0 balance · minimum always paid" is the
                        // opposite news from "this does not exist yet".
                        ? row.notOpenYet
                          ? `Not open yet · opens ${row.opensLabel ?? 'later'}`
                          : `${formatCurrency(row.remaining ?? 0, false)} balance · minimum always paid`
                        : row.remaining && row.remaining > 0
                          // A later stop is not "to go" yet: the money physically passes through
                          // the stop above it first, whatever rank either of them sits at, and
                          // printing the same phrase as an active row would say it is being funded
                          // now when it is deliberately next.
                          ? isLaterStop
                            ? `${formatCurrency(row.remaining, false)} more, after stop ${(row.stage ?? 2) - 1}`
                            : `${formatCurrency(row.remaining, false)} to go`
                          : 'Fully funded'}
                </p>
                {note && <p className={`text-[11px] ${note.tone}`}>{note.text}</p>}
              </div>

              {!readOnly && i > 0 && !isLaterStop && (
                <button
                  type="button"
                  onClick={() => toggleSplit(row, i)}
                  title={inSplit ? 'Give this its own rank' : 'Split this rank with the one above'}
                  aria-label={inSplit ? `Unsplit ${row.name}` : `Split ${row.name} with the row above`}
                  className="icon-btn min-w-[36px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  {inSplit ? <Unlink size={16} /> : <Link2 size={16} />}
                </button>
              )}

              {isCards || isCard ? (
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground shrink-0">Always</span>
              ) : isLiability ? (
                // ⚠️ DELIBERATELY NOT A CHECKBOX. `accounts` has no `auto_extra` column, so there
                // is nowhere to persist "on the list but switched off" — `setSurplusRankAutoExtra`
                // refuses a liability for exactly that reason, and a tick that moved on screen,
                // wrote nothing and reverted on the next refetch is the worst of both. Being on
                // this list IS the opt-in, and Remove beside it is the way off.
                <span
                  className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground shrink-0"
                  title="On this list means it takes a share of the surplus"
                >
                  Ranked
                </span>
              ) : (
                // EVERY STOP HAS ITS OWN TICK (Tre, 2026-08-26: "each part of the stagger should
                // always have the choice of extra payments"). A later stop's lives inside
                // `savings_goals.stages`, which is what makes it a real switch rather than one that
                // moves on screen and reverts on the next refetch.
                //
                // The whole label is the target and it carries `icon-btn`'s 44px height, because at
                // 390px a bare 13px checkbox is the smallest thing on the row and the one most
                // often mis-tapped.
                <label className="flex items-center gap-2 shrink-0 cursor-pointer select-none min-h-[44px] px-1">
                  <input
                    type="checkbox"
                    checked={row.autoExtra}
                    disabled={readOnly}
                    onChange={e => toggleAutoExtra(row.id, e.target.checked)}
                    className="accent-primary w-4 h-4"
                    aria-label={`Auto extra for ${row.name}${row.stage != null ? `, stop ${row.stage}` : ''}`}
                  />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Auto extra</span>
                </label>
              )}


              {/* The liability's own "Re-block": a debt leaves the list by leaving the LIST, which
                  is a write that exists (`planLiabilityRankWrites`). Its scheduled payment carries
                  on regardless — this only stops the extra principal. */}
              {isLiability && !readOnly && (
                <button
                  type="button"
                  onClick={() => setLiabilityRanked(row.id, false)}
                  className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  aria-label={`Take ${row.name} off the ranked list`}
                >
                  Remove
                </button>
              )}
            </motion.li>
          );
        })}
      </ul>

      {/* Putting a student loan or a mortgage on the list is explicit for a harder reason than the
          card block is: `accounts` has no `auto_extra` column, so being listed IS being opted in.
          A debt that appeared here already ranked would divert surplus every existing user never
          asked to divert, and there would be no switch to turn it off — only this list to leave.
          New arrivals join at the END (`planLiabilityRankWrites`), below the goals the user placed
          on purpose. */}
      {!readOnly && unrankedLiabilities.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Add a loan or mortgage
          </span>
          {unrankedLiabilities.map(l => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLiabilityRanked(l.id, true)}
              aria-label={`Add ${l.name} to the ranked list`}
              className="text-[11px] px-2 py-0.5 border border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {l.name}
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
