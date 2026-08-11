import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, ChevronDown, Wrench, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  overdue: '#e05a5a',
  'due-soon': '#c8a84b',
  scheduled: '#6b7280',
  none: '#6b7280',
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
          style={{ color: '#c8a84b' }}
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
          style={{ background: '#c8a84b', color: '#000' }}
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
              <div className="font-mono text-sm text-foreground mt-0.5">{money(total)}</div>
            </div>
            <div className="px-4 py-3 border-r border-border">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Last 12 Mo</div>
              <div className="font-mono text-sm text-foreground mt-0.5">{money(last12)}</div>
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
              {dueNow.map(({ log, status }) => (
                <div key={log.id} className="flex items-center justify-between px-5 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-foreground truncate">{log.service}</span>
                    <StatusBadge status={status} />
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground shrink-0 ml-3">
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
            ordered.map(log => {
              const status = maintenanceStatus(log, ctx);
              const due = dueSummary(log);
              const linked = txByLog[log.id] ?? [];
              return (
                <div key={log.id} className="px-5 py-3 border-b border-border last:border-b-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-foreground">{log.service}</span>
                        <StatusBadge status={status} />
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground mt-0.5">
                        {log.service_date}
                        {log.odometer !== null && ` · ${log.odometer.toLocaleString()} mi`}
                        {log.vendor && ` · ${log.vendor}`}
                      </div>
                      {due && (
                        <div className="font-mono text-[11px] mt-0.5" style={{ color: STATUS_COLORS[status] }}>
                          {due}
                        </div>
                      )}
                      {log.notes && (
                        <div className="text-[11px] text-muted-foreground mt-1 whitespace-pre-wrap">{log.notes}</div>
                      )}
                      {linked.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-1 text-[11px] font-mono" style={{ color: '#3a8a5a' }}>
                          <Receipt size={11} />
                          {linked.map(t => `${money(Number(t.amount))} · ${t.date}`).join('  |  ')}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="font-mono text-sm text-foreground mr-1">
                        {log.cost !== null ? money(log.cost) : '—'}
                      </span>
                      <button
                        onClick={() => onEdit(log)}
                        title="Edit service"
                        className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => onDelete(log)}
                        title="Delete service"
                        className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
