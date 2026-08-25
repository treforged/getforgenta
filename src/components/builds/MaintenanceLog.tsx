import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Pencil, Trash2, ChevronDown, Wrench, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import CountUp from '@/components/shared/CountUp';
import { fadeRise, staggerFor } from '@/lib/motion';
import {
  currentOdometer,
  maintenanceStatus,
  sortByServiceDateDesc,
  statusLabel,
  totalMaintenanceCost,
  costLast12Months,
  upcomingMaintenance,
  type MaintenanceStatus,
} from '@/lib/car-maintenance';
import type { CarMaintenanceLog } from '@/lib/types';
import type { TransactionRow } from '@/hooks/useSupabaseData';

interface MaintenanceLogProps {
  logs: CarMaintenanceLog[];
  transactions: TransactionRow[];
  loading?: boolean;
  onAdd: () => void;
  onEdit: (log: CarMaintenanceLog) => void;
  onDelete: (log: CarMaintenanceLog) => void;
}

const STATUS_COLORS: Record<MaintenanceStatus, string> = {
  overdue: 'hsl(var(--destructive))',
  'due-soon': 'hsl(var(--primary))',
  // Token, not a grey: on a light page a hardcoded #6b7280 is the only status that does not
  // move with the theme, and 'no schedule' would read as the loudest state on the row.
  scheduled: 'hsl(var(--muted-foreground))',
  none: 'hsl(var(--muted-foreground))',
};

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function StatusBadge({ status }: { status: MaintenanceStatus }) {
  const label = statusLabel(status);
  if (!label || status === 'scheduled') return null;
  return (
    <span
      className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border"
      style={{ color: STATUS_COLORS[status], borderColor: STATUS_COLORS[status] }}
    >
      {label}
    </span>
  );
}

/** "Due 12 Mar 2027 · 92,400 mi" — whichever of the two the entry actually has. */
function dueSummary(log: CarMaintenanceLog): string | null {
  const parts: string[] = [];
  if (log.next_due_date) parts.push(log.next_due_date);
  if (log.next_due_odometer !== null) parts.push(`${log.next_due_odometer.toLocaleString()} mi`);
  return parts.length > 0 ? `Due ${parts.join(' · ')}` : null;
}

export default function MaintenanceLog({ logs, transactions, loading, onAdd, onEdit, onDelete }: MaintenanceLogProps) {
  const [expanded, setExpanded] = useState(true);
  const today = todayISO();

  const odometerNow = useMemo(() => currentOdometer(logs), [logs]);
  const ctx = useMemo(() => ({ today, odometerNow }), [today, odometerNow]);
  const ordered = useMemo(() => sortByServiceDateDesc(logs), [logs]);
  const upcoming = useMemo(() => upcomingMaintenance(logs, ctx), [logs, ctx]);
  const dueNow = upcoming.filter(u => u.status === 'overdue' || u.status === 'due-soon');

  const total = totalMaintenanceCost(logs);
  const last12 = costLast12Months(logs, today);

  const txByLog = useMemo(() => {
    const map: Record<string, TransactionRow[]> = {};
    for (const t of transactions) {
      const id = t.car_maintenance_log_id;
      if (!id) continue;
      (map[id] ??= []).push(t);
    }
    return map;
  }, [transactions]);

  return (
    <div className="mt-6 border border-border rounded overflow-hidden">
      <div className="flex items-center justify-between px-5 py-[13px] border-b border-border bg-card/50">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest"
          style={{ color: 'hsl(var(--primary))' }}
        >
          <ChevronDown size={14} className={cn('transition-transform', !expanded && '-rotate-90')} />
          <Wrench size={13} />
          Maintenance Log
          {dueNow.length > 0 && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded border"
              style={{
                color: dueNow.some(d => d.status === 'overdue') ? STATUS_COLORS.overdue : STATUS_COLORS['due-soon'],
                borderColor: dueNow.some(d => d.status === 'overdue') ? STATUS_COLORS.overdue : STATUS_COLORS['due-soon'],
              }}
            >
              {dueNow.length} due
            </span>
          )}
        </button>
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider rounded transition-colors"
          style={{ background: 'hsl(var(--primary))', color: '#000' }}
        >
          <Plus size={12} /> Log Service
        </button>
      </div>

      {expanded && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 border-b border-border">
            <div className="px-4 py-3 border-r border-border">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Total Spent</div>
              <div className="font-mono text-sm text-foreground mt-0.5">
                <CountUp value={total} format={money} decimals={2} />
              </div>
            </div>
            <div className="px-4 py-3 border-r border-border">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Last 12 Mo</div>
              <div className="font-mono text-sm text-foreground mt-0.5">
                <CountUp value={last12} format={money} decimals={2} />
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Odometer</div>
              <div className="font-mono text-sm text-foreground mt-0.5">
                {odometerNow !== null ? `${odometerNow.toLocaleString()} mi` : '—'}
              </div>
            </div>
          </div>

          {/* Coming due */}
          {dueNow.length > 0 && (
            <div className="border-b border-border">
              <div className="px-5 pt-3 pb-1 text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                Coming Due
              </div>
              {/* ⚠️ WRAPS, IT DOES NOT TRUNCATE. Tre, 2026-08-24: *"the text in the maintenance
                  log gets cut off instead of wrapping."* This row carried `truncate` on the
                  service name AND `shrink-0` on the due summary, so at 390px the name lost every
                  argument for space and "Transmission Fluid" read as "Transmi…", the one thing
                  the row exists to say. Nothing is taken away to fix it: the row wraps to a
                  second line instead. */}
              {dueNow.map(({ log, status }) => (
                <div key={log.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5 px-5 py-2">
                  <div className="flex items-start gap-2 flex-wrap min-w-0">
                    <span className="text-sm text-foreground wrap-break-word min-w-0">{log.service}</span>
                    <StatusBadge status={status} />
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground wrap-break-word">
                    {dueSummary(log)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* History */}
          {loading ? (
            <div className="p-5 space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
            </div>
          ) : ordered.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <div className="text-sm font-mono text-muted-foreground mb-3">No services logged yet</div>
              <div className="text-[11px] font-mono text-muted-foreground">
                Track oil changes, rotations and fluids — with what they cost and when they are due again.
              </div>
            </div>
          ) : (
            /* Rows are the record of something the user just did, so they
               arrive rather than appear. `layout="position"` is what makes a
               delete read as the list closing up instead of the remaining rows
               teleporting — and it is position-only on purpose: animating size
               as well squashes and stretches the text inside a row while it
               moves. Both the entry and the layout shift are transform-based,
               so `<MotionConfig reducedMotion="user">` neutralises them for
               anyone who asked for that, with no check needed here. */
            <AnimatePresence>
              {ordered.map((log, i) => {
                const status = maintenanceStatus(log, ctx);
                const due = dueSummary(log);
                const linked = txByLog[log.id] ?? [];
                return (
                  <motion.div
                    key={log.id}
                    layout="position"
                    variants={fadeRise}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    transition={{ delay: staggerFor(i, ordered.length) }}
                    className="px-5 py-3 border-b border-border last:border-b-0"
                  >
                  <div className="flex items-start justify-between gap-3">
                    {/* `flex-1` as well as `min-w-0`: without it the column is shrink-to-fit and a
                        long service name or vendor is squeezed against the price instead of using
                        the width that is there. `wrap-break-word` is what stops an unbroken token
                        (a part number, a URL-ish vendor) from running under the price column and
                        being clipped by the card's `overflow-hidden`. */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className="text-sm text-foreground wrap-break-word min-w-0">{log.service}</span>
                        <StatusBadge status={status} />
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground mt-0.5 wrap-break-word">
                        {log.service_date}
                        {log.odometer !== null && ` · ${log.odometer.toLocaleString()} mi`}
                        {log.vendor && ` · ${log.vendor}`}
                      </div>
                      {due && (
                        <div className="font-mono text-[11px] mt-0.5 wrap-break-word" style={{ color: STATUS_COLORS[status] }}>
                          {due}
                        </div>
                      )}
                      {log.notes && (
                        <div className="text-[11px] text-muted-foreground mt-1 whitespace-pre-wrap wrap-break-word">{log.notes}</div>
                      )}
                      {linked.length > 0 && (
                        <div className="flex items-start gap-1.5 mt-1 text-[11px] font-mono" style={{ color: 'hsl(var(--success))' }}>
                          <Receipt size={11} className="shrink-0 mt-0.5" />
                          <span className="min-w-0 wrap-break-word">
                            {linked.map(t => `${money(Number(t.amount))} · ${t.date}`).join('  |  ')}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0 -my-1.5">
                      <span className="font-mono text-sm text-foreground mr-1">
                        {log.cost !== null ? money(log.cost) : '—'}
                      </span>
                      <button
                        onClick={() => onEdit(log)}
                        title="Edit service"
                        className="icon-btn min-w-[36px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => onDelete(log)}
                        title="Delete service"
                        className="icon-btn min-w-[36px] -mr-2 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </>
      )}
    </div>
  );
}
