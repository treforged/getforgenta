import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import { goalStages, type GoalStageInput } from '@/lib/ranked-extra-payment-targets';

/**
 * A stop as the FORM holds it: strings, because a half-typed number is a string and coercing on
 * every keystroke fights the user's cursor. `uid` is local and never stored — it keys the React
 * list so a row does not lose focus when the one above it is deleted.
 */
export type StopDraft = {
  uid: string;
  name: string;
  /** Which way this stop is sized. The two inputs are mutually exclusive by construction rather
   *  than by validation, so the form cannot produce a shape the database will reject. */
  mode: 'amount' | 'months';
  amount: string;
  months: string;
  targetDate: string;
  afterCards: boolean;
};

let uidSeq = 0;
export function newStopDraft(partial: Partial<StopDraft> = {}): StopDraft {
  uidSeq += 1;
  return {
    uid: `stop-${uidSeq}`,
    name: '', mode: 'amount', amount: '', months: '', targetDate: '', afterCards: false,
    ...partial,
  };
}

/** The stored `stages` column read back into form drafts. Anything unreadable is skipped rather
 *  than shown as an empty row the user did not create. */
export function stopDraftsFrom(stored: unknown): StopDraft[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((raw): StopDraft[] => {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const s = raw as GoalStageInput;
    const hasMonths = s.months != null && Number.isFinite(Number(s.months));
    return [newStopDraft({
      name: (s.name ?? '') || '',
      mode: hasMonths ? 'months' : 'amount',
      amount: hasMonths || s.amount == null ? '' : String(s.amount),
      months: hasMonths ? String(s.months) : '',
      targetDate: s.target_date ?? '',
      afterCards: s.after_cards === true,
    })];
  });
}

/**
 * The drafts as the database wants them. A stop with no usable size is DROPPED, not stored as a
 * zero: a zero-size stop reads as already filled the moment it is created, which would put a row in
 * the user's plan that silently does nothing.
 */
export function stopsToStages(drafts: readonly StopDraft[]): GoalStageInput[] {
  return drafts.flatMap((d): GoalStageInput[] => {
    const n = Number(d.mode === 'amount' ? d.amount : d.months);
    if (!Number.isFinite(n) || n <= 0) return [];
    return [{
      id: d.uid,
      ...(d.name.trim() ? { name: d.name.trim().slice(0, 60) } : {}),
      ...(d.mode === 'amount' ? { amount: n } : { months: n }),
      ...(d.targetDate ? { target_date: d.targetDate } : {}),
      ...(d.afterCards ? { after_cards: true } : {}),
    }];
  });
}

export type GoalStopsEditorProps = {
  stops: StopDraft[];
  onChange: (next: StopDraft[]) => void;
  /** One month of essential cost. Zero means we could not read one, and a months-sized stop then
   *  has nothing to multiply — the editor says so instead of printing a confident $0. */
  essentialMonthlyExpenses: number;
};

/**
 * THE PLANNED STOPS EDITOR (Tre, 2026-08-26).
 *
 * His words: *"the original $5,730 should show as the first stage since its only for the move fund
 * part (that stage should immediately stop/drop once its done) ... also be able to add multiple
 * planned stops with target amounts."*
 *
 * So a goal is a SEQUENCE, not a number. Each stop is sized either in dollars or in months of what
 * the user actually spends, carries its own date, and can be marked as waiting for the credit cards
 * to clear — which is the hand-off the two-column design could only express once.
 *
 * ⚠️ THE RUNNING TOTAL IS PRINTED PER ROW, and that is the whole reason this is a component rather
 * than three inputs. Thresholds are CUMULATIVE, so "3 months" on row 2 does not mean the goal stops
 * at three months of expenses — it means three months ON TOP of row 1. A user who cannot see the
 * cumulative figure is picking numbers blind.
 */
export default function GoalStopsEditor({ stops, onChange, essentialMonthlyExpenses }: GoalStopsEditorProps) {
  const monthly = Number(essentialMonthlyExpenses);
  const hasMonthly = Number.isFinite(monthly) && monthly > 0;

  // Resolved through the SAME function the engine uses, so the number on the row is the number that
  // will be chased. A second local sum here is exactly how a preview drifts from the plan.
  const resolved = goalStages({ target_amount: 0, stages: stopsToStages(stops) }, monthly);
  const thresholdByStoredId = new Map(resolved.stops.map(s => [s.id, s]));

  const patch = (uid: string, next: Partial<StopDraft>) =>
    onChange(stops.map(s => (s.uid === uid ? { ...s, ...next } : s)));

  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= stops.length) return;
    const next = [...stops];
    const [row] = next.splice(index, 1);
    next.splice(to, 0, row);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Planned stops (optional)</label>
        <button
          type="button"
          onClick={() => onChange([...stops, newStopDraft()])}
          className="flex items-center gap-1 text-[10px] text-primary hover:underline"
        >
          <Plus size={11} /> Add stop
        </button>
      </div>

      {stops.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">
          Add stops to break this goal into stages — a move fund first, then months of expenses.
          Each stop can wait for your credit cards to clear before it starts. Leave this empty and
          the goal keeps its single target amount and date.
        </p>
      ) : (
        <>
          {/* Says the one thing about this design that is not obvious from looking at it. */}
          <p className="text-[10px] text-muted-foreground">
            Stops fill in order and add up. Each stop drops off your list the moment it is filled.
          </p>
          <ul className="space-y-2">
            {stops.map((s, i) => {
              const at = thresholdByStoredId.get(s.uid);
              return (
                <li
                  key={s.uid}
                  className="p-2.5 bg-secondary/30 border border-border/50 space-y-2"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground w-4 shrink-0">{i + 1}</span>
                    <input
                      type="text"
                      value={s.name}
                      maxLength={60}
                      placeholder={`Stop ${i + 1} name (optional)`}
                      onChange={e => patch(s.uid, { name: e.target.value })}
                      className="flex-1 min-w-0 bg-secondary/40 border border-border/50 px-2 py-1.5 text-xs"
                      style={{ borderRadius: 'var(--radius)' }}
                    />
                    <button
                      type="button" aria-label={`Move stop ${i + 1} up`} disabled={i === 0}
                      onClick={() => move(i, -1)}
                      className="icon-btn min-w-[32px] text-muted-foreground disabled:opacity-20 hover:text-foreground"
                    ><ArrowUp size={14} /></button>
                    <button
                      type="button" aria-label={`Move stop ${i + 1} down`} disabled={i === stops.length - 1}
                      onClick={() => move(i, 1)}
                      className="icon-btn min-w-[32px] text-muted-foreground disabled:opacity-20 hover:text-foreground"
                    ><ArrowDown size={14} /></button>
                    <button
                      type="button" aria-label={`Remove stop ${i + 1}`}
                      onClick={() => onChange(stops.filter(r => r.uid !== s.uid))}
                      className="icon-btn min-w-[32px] text-muted-foreground hover:text-destructive"
                    ><Trash2 size={14} /></button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Size this stop by</span>
                      <select
                        value={s.mode}
                        onChange={e => patch(s.uid, { mode: e.target.value === 'months' ? 'months' : 'amount' })}
                        className="w-full bg-secondary/40 border border-border/50 px-2 py-1.5 text-xs"
                        style={{ borderRadius: 'var(--radius)' }}
                      >
                        <option value="amount">Dollar amount</option>
                        <option value="months">Months of expenses</option>
                      </select>
                    </label>
                    {s.mode === 'amount' ? (
                      <label className="block">
                        <span className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Amount</span>
                        <input
                          type="number" min="0" step="0.01" inputMode="decimal"
                          value={s.amount}
                          onChange={e => patch(s.uid, { amount: e.target.value })}
                          className="w-full bg-secondary/40 border border-border/50 px-2 py-1.5 text-xs"
                          style={{ borderRadius: 'var(--radius)' }}
                        />
                      </label>
                    ) : (
                      <label className="block">
                        <span className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Months</span>
                        <input
                          type="number" min="0" step="1" inputMode="decimal"
                          value={s.months}
                          onChange={e => patch(s.uid, { months: e.target.value })}
                          className="w-full bg-secondary/40 border border-border/50 px-2 py-1.5 text-xs"
                          style={{ borderRadius: 'var(--radius)' }}
                        />
                      </label>
                    )}
                  </div>

                  <label className="block">
                    <span className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Target date for this stop (optional)</span>
                    <input
                      type="date"
                      value={s.targetDate}
                      onChange={e => patch(s.uid, { targetDate: e.target.value })}
                      className="w-full bg-secondary/40 border border-border/50 px-2 py-1.5 text-xs"
                      style={{ borderRadius: 'var(--radius)' }}
                    />
                  </label>

                  {/* The hand-off, and it only makes sense from the second stop onwards: a first
                      stop that waited for the cards would be a goal that never starts. */}
                  {i > 0 && (
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={s.afterCards}
                        onChange={e => patch(s.uid, { afterCards: e.target.checked })}
                        className="mt-0.5 shrink-0"
                      />
                      <span className="text-[10px] text-muted-foreground">
                        Wait until my credit cards are clear before funding this stop
                      </span>
                    </label>
                  )}

                  <p className="text-[10px] text-muted-foreground">
                    {s.mode === 'months' && !hasMonthly
                      ? 'We cannot read a monthly expense figure from your recurring rules yet, so there is nothing to multiply here.'
                      : at
                        ? <>This stop adds {formatCurrency(at.size, false)} — filled at {formatCurrency(at.threshold, false)} saved.</>
                        : 'Enter an amount to size this stop.'}
                  </p>
                </li>
              );
            })}
          </ul>
          {resolved.staged && (
            <p className="text-[11px] text-foreground">
              Full plan: {formatCurrency(resolved.total, false)} across {resolved.stops.length} stop{resolved.stops.length === 1 ? '' : 's'}.
              {hasMonthly && stops.some(s => s.mode === 'months') && (
                <span className="text-muted-foreground"> One month of essentials is {formatCurrency(monthly, false)}.</span>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
