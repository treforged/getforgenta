import { useState, useEffect } from 'react';
import { LUMP_SUM_AUTO_EXTRA_NOTE } from '@/lib/lump-sum-guard';
import { Plus, X, Edit2, Check } from 'lucide-react';
import DateScrollPicker from '@/components/shared/DateScrollPicker';
import { formatCurrency } from '@/lib/calculations';
import type { LumpSumPayment } from '@/lib/vehicle-loan-engine';
import { addMonthsStr } from './vehicle-format';

/**
 * Planned extra payments against a vehicle loan — the modal that adds them, the grouping that
 * collapses a run of identical months into one row, and the panel itself.
 *
 * Lifted VERBATIM out of `Vehicles.tsx` on 2026-08-27 when the vehicle-money panels moved to
 * /debt's Auto Loans tab. Nothing about the arithmetic or the copy changed — only the file it
 * lives in.
 */

function LumpSumModal({
  mode, initialDate, initialAmount, initialCount, schedule, liquidCash, onSave, onClose,
}: {
  mode: 'add' | 'edit';
  initialDate: string;
  initialAmount: string;
  initialCount?: string;
  schedule: { date: string; startBalance: number }[];
  liquidCash?: number;
  onSave: (entries: { date: string; amount: number }[]) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [amount, setAmount] = useState(initialAmount);
  // Editable in both modes - lets the user grow/shrink a range or turn a single month into one.
  const [repeatMonths, setRepeatMonths] = useState(initialCount ?? '1');

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const bal = date
    ? (schedule.find(r => r.date.substring(0, 7) === date.substring(0, 7))?.startBalance ?? null)
    : null;
  const canSave = !!date && parseFloat(amount) > 0;

  const handleSave = () => {
    const amt = parseFloat(amount);
    if (!date || !amt || amt <= 0) return;
    const count = Math.max(1, Math.min(60, parseInt(repeatMonths) || 1));
    const entries = Array.from({ length: count }, (_, k) => ({ date: addMonthsStr(date, k), amount: amt }));
    onSave(entries);
  };

  return (
    <div
      className="modal-overlay z-60"
      style={{ touchAction: 'none', background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <div
        className="card-forged w-full sm:max-w-md flex flex-col rounded-(--radius)"
        style={{ maxHeight: '100%', paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 pt-5 sm:pt-6 pb-3 shrink-0">
          <h2 className="font-display font-semibold text-sm">{mode === 'add' ? 'Add Extra Payment' : 'Edit Extra Payment'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-3 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 space-y-4 pb-2 popup-scroll" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Date</p>
            <DateScrollPicker value={date} onChange={setDate} />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Amount</p>
            <input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full bg-secondary border border-border px-3 py-3 text-sm text-foreground"
              style={{ borderRadius: 'var(--radius)' }}
            />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              Months <span className="text-muted-foreground/60">(consecutive, starting this date)</span>
            </p>
            <input
              type="number"
              min={1}
              max={60}
              placeholder="1"
              value={repeatMonths}
              onChange={e => setRepeatMonths(e.target.value)}
              className="w-full bg-secondary border border-border px-3 py-3 text-sm text-foreground"
              style={{ borderRadius: 'var(--radius)' }}
            />
          </div>
          {date && (bal !== null || liquidCash !== undefined) && (
            <div className="flex flex-wrap gap-4 text-[10px] text-muted-foreground p-2.5 bg-secondary/30 border border-border/30" style={{ borderRadius: 'var(--radius)' }}>
              {bal !== null && <span>Balance at date: <span className="text-foreground font-medium">{formatCurrency(bal, false)}</span></span>}
              {liquidCash !== undefined && <span>Cash available: <span className="text-success font-medium">{formatCurrency(liquidCash, false)}</span></span>}
            </div>
          )}
        </div>

        <div className="px-4 sm:px-6 pt-3 pb-5 sm:pb-6 shrink-0 border-t border-border mt-1">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full bg-primary text-primary-foreground py-3.5 text-sm font-semibold btn-press disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <Check size={14} />
            {mode === 'add' ? 'Add Payment' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface LumpSumGroup {
  ids: string[];
  startDate: string;
  endDate: string;
  amount: number;
  count: number;
}

// Merges consecutive same-amount monthly entries (e.g. from the "Repeat" add option) into a
// single range row, so 5 separate $500 rows for Jun–Oct show as one "Jun 2026 – Oct 2026" row.
function groupConsecutiveLumpSums(lumpSums: LumpSumPayment[]): LumpSumGroup[] {
  const sorted = [...lumpSums].sort((a, b) => a.date.localeCompare(b.date));
  const groups: LumpSumGroup[] = [];
  for (const ls of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.amount === ls.amount && addMonthsStr(last.endDate, 1) === ls.date) {
      last.ids.push(ls.id);
      last.endDate = ls.date;
      last.count += 1;
    } else {
      groups.push({ ids: [ls.id], startDate: ls.date, endDate: ls.date, amount: ls.amount, count: 1 });
    }
  }
  return groups;
}

export default function LumpSumPanel({
  schedule,
  lumpSums,
  baseTotalInterest,
  withLumpsTotalInterest,
  basePayoffDate,
  withLumpsPayoffDate,
  onAdd,
  onRemove,
  onReplace,
  label = 'Planned Extra Payments',
  liquidCash,
  autoExtraOn,
}: {
  schedule: { date: string; startBalance: number }[];
  lumpSums: LumpSumPayment[];
  baseTotalInterest: number;
  withLumpsTotalInterest: number;
  basePayoffDate: string;
  withLumpsPayoffDate: string;
  onAdd: (entries: LumpSumPayment[]) => void;
  onRemove: (ids: string[]) => void;
  onReplace: (oldIds: string[], entries: { date: string; amount: number }[]) => void;
  label?: string;
  liquidCash?: number;
  /** The ranked auto-extra SWITCH for this target, not whether the waterfall currently
   *  reaches it. A user who opted in should not be typing manual extras even in a month
   *  the surplus never arrives, because the two are two answers to the same question. */
  autoExtraOn?: boolean;
}) {
  const [modal, setModal] = useState<null | { mode: 'add' } | { mode: 'edit'; ids: string[]; date: string; amount: string; count: string }>(null);

  const getBalanceBefore = (dateStr: string) => {
    const month = dateStr.substring(0, 7);
    return schedule.find(r => r.date.substring(0, 7) === month)?.startBalance ?? null;
  };

  const baseD = new Date(basePayoffDate + 'T00:00:00');
  const newD = new Date(withLumpsPayoffDate + 'T00:00:00');
  const monthsSaved = (baseD.getFullYear() - newD.getFullYear()) * 12 + (baseD.getMonth() - newD.getMonth());
  const interestSaved = Math.max(0, Math.round((baseTotalInterest - withLumpsTotalInterest) * 100) / 100);
  const hasLumps = lumpSums.length > 0;

  return (
    <div className="space-y-2 border-t border-border/30 pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
        <button
          onClick={() => setModal({ mode: 'add' })}
          disabled={!!autoExtraOn}
          className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={10} /> Add
        </button>
      </div>

      {autoExtraOn && (
        <p className="text-[10px] text-muted-foreground">{LUMP_SUM_AUTO_EXTRA_NOTE}</p>
      )}

      {!autoExtraOn && !hasLumps && (
        <p className="text-[10px] text-muted-foreground">No extra payments planned. Add one to see how it shortens your payoff.</p>
      )}

      {hasLumps && (
        <div className="space-y-1">
          {groupConsecutiveLumpSums(lumpSums).map(g => {
            const bal = getBalanceBefore(g.startDate);
            const isRange = g.count > 1;
            const startLabel = new Date(g.startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            const endLabel = new Date(g.endDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            return (
              <div key={g.ids.join(',')} className="flex items-center justify-between py-1 px-2 bg-secondary/20 border border-border/30" style={{ borderRadius: 'var(--radius)' }}>
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="text-[10px] font-medium shrink-0">{isRange ? `${startLabel} – ${endLabel}` : startLabel}</span>
                  <span className="text-[10px] text-primary font-semibold shrink-0">
                    {formatCurrency(g.amount, false)}{isRange ? `/mo × ${g.count}` : ''}
                  </span>
                  {bal !== null && <span className="text-[10px] text-muted-foreground">Balance before: {formatCurrency(bal, false)}</span>}
                </div>
                <div className="flex items-center gap-1 ml-2 shrink-0">
                  <button onClick={() => setModal({ mode: 'edit', ids: g.ids, date: g.startDate, amount: String(g.amount), count: String(g.count) })} className="text-muted-foreground hover:text-foreground"><Edit2 size={11} /></button>
                  <button onClick={() => onRemove(g.ids)} className="text-muted-foreground hover:text-destructive"><X size={11} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasLumps && (monthsSaved > 0 || interestSaved > 0) && (
        <div className="p-2 bg-success/5 border border-success/20 text-[10px] space-y-0.5" style={{ borderRadius: 'var(--radius)' }}>
          <p className="text-success font-semibold">Impact of extra payments:</p>
          <div className="flex flex-wrap gap-3">
            <span>Payoff: {new Date(withLumpsPayoffDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              {monthsSaved > 0 && <span className="text-muted-foreground"> ({monthsSaved} mo earlier)</span>}
            </span>
            {interestSaved > 0 && <span className="text-success">saves {formatCurrency(interestSaved, false)} interest</span>}
          </div>
        </div>
      )}

      {modal && (
        <LumpSumModal
          key={modal.mode === 'edit' ? modal.ids.join(',') : 'add'}
          mode={modal.mode}
          initialDate={modal.mode === 'edit' ? modal.date : ''}
          initialAmount={modal.mode === 'edit' ? modal.amount : ''}
          initialCount={modal.mode === 'edit' ? modal.count : '1'}
          schedule={schedule}
          liquidCash={liquidCash}
          onSave={(entries) => {
            if (modal.mode === 'add') {
              onAdd(entries.map(e => ({ id: crypto.randomUUID(), date: e.date, amount: e.amount })));
            } else {
              onReplace(modal.ids, entries);
            }
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
