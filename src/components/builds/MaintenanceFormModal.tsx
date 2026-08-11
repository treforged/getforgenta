import { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import DateScrollPicker from '@/components/shared/DateScrollPicker';
import { SERVICE_PRESETS, computeNextDue } from '@/lib/car-maintenance';
import type { CarMaintenanceLog } from '@/lib/types';
import type { TransactionRow } from '@/hooks/useSupabaseData';

export type MaintenanceFormValues = {
  service: string;
  service_date: string;
  odometer: number | null;
  cost: number | null;
  vendor: string | null;
  notes: string | null;
  interval_months: number | null;
  interval_miles: number | null;
  next_due_date: string | null;
  next_due_odometer: number | null;
};

export type MaintenanceTransactionIntent =
  | { mode: 'none' }
  | { mode: 'existing'; transactionId: string }
  | { mode: 'new'; date: string; amount: number; note: string; payment_source?: string };

interface MaintenanceFormModalProps {
  open: boolean;
  log?: CarMaintenanceLog | null;
  /** Highest odometer recorded on this build, used to pre-fill a new entry. */
  lastOdometer: number | null;
  transactions: TransactionRow[];
  paymentSourceOptions: { value: string; label: string }[];
  onClose: () => void;
  onSave: (values: MaintenanceFormValues, tx: MaintenanceTransactionIntent) => void;
  saving?: boolean;
}

const NOTES_MAX = 300;

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

type FormState = {
  service: string;
  serviceDate: string;
  odometer: string;
  cost: string;
  vendor: string;
  notes: string;
  intervalMonths: string;
  intervalMiles: string;
  nextDueDate: string;
  nextDueOdometer: string;
  txMode: 'none' | 'existing' | 'new';
  txId: string;
  txDate: string;
  txAmount: string;
  txPaymentSource: string;
};

function emptyForm(lastOdometer: number | null): FormState {
  return {
    service: '',
    serviceDate: todayISO(),
    odometer: lastOdometer !== null ? String(lastOdometer) : '',
    cost: '',
    vendor: '',
    notes: '',
    intervalMonths: '',
    intervalMiles: '',
    nextDueDate: '',
    nextDueOdometer: '',
    txMode: 'none',
    txId: '',
    txDate: todayISO(),
    txAmount: '',
    txPaymentSource: '',
  };
}

export default function MaintenanceFormModal({
  open, log, lastOdometer, transactions, paymentSourceOptions, onClose, onSave, saving,
}: MaintenanceFormModalProps) {
  const [form, setForm] = useState<FormState>(() => emptyForm(lastOdometer));
  const [serviceError, setServiceError] = useState('');

  const linkedTx = useMemo(
    () => (log ? transactions.find(t => t.car_maintenance_log_id === log.id) ?? null : null),
    [log, transactions],
  );

  useEffect(() => {
    if (!open) return;
    // The modal stays mounted while closed, so its state survives between openings
    // and has to be reset explicitly against the entry being edited.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(log ? {
      service: log.service,
      serviceDate: log.service_date,
      odometer: log.odometer !== null ? String(log.odometer) : '',
      cost: log.cost !== null ? String(log.cost) : '',
      vendor: log.vendor ?? '',
      notes: log.notes ?? '',
      intervalMonths: log.interval_months !== null ? String(log.interval_months) : '',
      intervalMiles: log.interval_miles !== null ? String(log.interval_miles) : '',
      nextDueDate: log.next_due_date ?? '',
      nextDueOdometer: log.next_due_odometer !== null ? String(log.next_due_odometer) : '',
      txMode: linkedTx ? 'existing' : 'none',
      txId: linkedTx?.id ?? '',
      txDate: linkedTx?.date ?? log.service_date,
      txAmount: linkedTx ? String(linkedTx.amount) : (log.cost !== null ? String(log.cost) : ''),
      txPaymentSource: linkedTx?.payment_source ?? '',
    } : emptyForm(lastOdometer));
    setServiceError('');
  }, [open, log, lastOdometer, linkedTx]);

  if (!open) return null;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  /** Applies a preset's intervals and re-projects the due fields from them. */
  function applyPreset(name: string) {
    const preset = SERVICE_PRESETS.find(p => p.name === name);
    setForm(f => {
      const intervalMonths = preset?.intervalMonths ?? null;
      const intervalMiles = preset?.intervalMiles ?? null;
      const odo = f.odometer === '' ? null : Number(f.odometer);
      const due = computeNextDue({
        serviceDate: f.serviceDate,
        odometer: Number.isFinite(odo as number) ? odo : null,
        intervalMonths,
        intervalMiles,
      });
      return {
        ...f,
        service: name,
        intervalMonths: intervalMonths !== null ? String(intervalMonths) : '',
        intervalMiles: intervalMiles !== null ? String(intervalMiles) : '',
        nextDueDate: due.nextDueDate ?? f.nextDueDate,
        nextDueOdometer: due.nextDueOdometer !== null ? String(due.nextDueOdometer) : f.nextDueOdometer,
      };
    });
  }

  /** Recomputes the due fields from whatever intervals are currently entered. */
  function recalcDue() {
    setForm(f => {
      const odo = f.odometer === '' ? null : Number(f.odometer);
      const due = computeNextDue({
        serviceDate: f.serviceDate,
        odometer: Number.isFinite(odo as number) ? odo : null,
        intervalMonths: f.intervalMonths === '' ? null : Number(f.intervalMonths),
        intervalMiles: f.intervalMiles === '' ? null : Number(f.intervalMiles),
      });
      return {
        ...f,
        nextDueDate: due.nextDueDate ?? f.nextDueDate,
        nextDueOdometer: due.nextDueOdometer !== null ? String(due.nextDueOdometer) : f.nextDueOdometer,
      };
    });
  }

  function numOrNull(raw: string): number | null {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.service.trim()) { setServiceError('Service is required'); return; }

    const values: MaintenanceFormValues = {
      service: form.service.trim().slice(0, 80),
      service_date: form.serviceDate,
      odometer: numOrNull(form.odometer),
      cost: numOrNull(form.cost),
      vendor: form.vendor.trim() || null,
      notes: form.notes.trim().slice(0, NOTES_MAX) || null,
      interval_months: numOrNull(form.intervalMonths),
      interval_miles: numOrNull(form.intervalMiles),
      next_due_date: form.nextDueDate || null,
      next_due_odometer: numOrNull(form.nextDueOdometer),
    };

    let tx: MaintenanceTransactionIntent = { mode: 'none' };
    if (form.txMode === 'existing' && form.txId) {
      tx = { mode: 'existing', transactionId: form.txId };
    } else if (form.txMode === 'new') {
      const amount = numOrNull(form.txAmount) ?? values.cost;
      if (amount !== null && amount > 0) {
        tx = {
          mode: 'new',
          date: form.txDate || values.service_date,
          amount,
          note: values.service,
          payment_source: form.txPaymentSource || undefined,
        };
      }
    }

    onSave(values, tx);
  }

  const inputCls = 'w-full bg-[#1a1a1a] border border-border text-foreground text-sm px-3 py-2 rounded focus:outline-hidden focus:border-[#c8a84b] font-mono';
  const labelCls = 'block text-[11px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5';
  const modeBtnCls = (active: boolean) => cn(
    'px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider rounded border transition-colors',
    active ? 'text-black border-transparent' : 'text-muted-foreground border-border hover:text-foreground',
  );
  const modeBtnStyle = (active: boolean) => (active ? { background: '#c8a84b' } : undefined);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-card border border-border rounded w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
          <span className="text-sm font-semibold text-foreground">
            {log ? 'Edit Service' : 'Log Service'}
          </span>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className={labelCls}>Service *</label>
            <input
              list="maintenance-service-presets"
              className={`${inputCls}${serviceError ? ' border-destructive' : ''}`}
              value={form.service}
              maxLength={80}
              onChange={e => {
                const v = e.target.value;
                setServiceError('');
                if (SERVICE_PRESETS.some(p => p.name === v)) applyPreset(v);
                else set('service', v);
              }}
              placeholder="e.g. Oil Change"
              autoFocus
            />
            <datalist id="maintenance-service-presets">
              {SERVICE_PRESETS.map(p => <option key={p.name} value={p.name} />)}
            </datalist>
            {serviceError && <p className="text-xs text-destructive mt-1">{serviceError}</p>}
          </div>

          <div>
            <label className={labelCls}>Date</label>
            <DateScrollPicker value={form.serviceDate} onChange={v => set('serviceDate', v)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Odometer</label>
              <input
                className={`${inputCls} text-right`}
                type="number"
                value={form.odometer}
                onChange={e => set('odometer', e.target.value)}
                onBlur={recalcDue}
                placeholder="miles"
                min="0"
                step="1"
              />
            </div>
            <div>
              <label className={labelCls}>Cost ($)</label>
              <input
                className={`${inputCls} text-right`}
                type="number"
                value={form.cost}
                onChange={e => {
                  const v = e.target.value;
                  // Keep a not-yet-edited new-transaction amount in step with the cost.
                  setForm(f => ({ ...f, cost: v, txAmount: f.txAmount === f.cost ? v : f.txAmount }));
                }}
                placeholder="0.00"
                min="0"
                step="0.01"
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Shop / Vendor</label>
            <input
              className={inputCls}
              value={form.vendor}
              maxLength={80}
              onChange={e => set('vendor', e.target.value)}
              placeholder="e.g. Discount Tire, DIY"
            />
          </div>

          {/* ── Next due ─────────────────────────────────────── */}
          <div className="pt-3 border-t border-[#1e1e1e] space-y-3">
            <div className="text-[11px] font-mono uppercase tracking-widest" style={{ color: '#c8a84b' }}>
              Next Due
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Every (months)</label>
                <input
                  className={`${inputCls} text-right`}
                  type="number"
                  value={form.intervalMonths}
                  onChange={e => set('intervalMonths', e.target.value)}
                  onBlur={recalcDue}
                  placeholder="6"
                  min="0"
                  step="1"
                />
              </div>
              <div>
                <label className={labelCls}>Every (miles)</label>
                <input
                  className={`${inputCls} text-right`}
                  type="number"
                  value={form.intervalMiles}
                  onChange={e => set('intervalMiles', e.target.value)}
                  onBlur={recalcDue}
                  placeholder="5000"
                  min="0"
                  step="1"
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Due Date</label>
              <DateScrollPicker value={form.nextDueDate || form.serviceDate} onChange={v => set('nextDueDate', v)} />
              {form.nextDueDate && (
                <button
                  type="button"
                  onClick={() => set('nextDueDate', '')}
                  className="text-[10px] font-mono text-muted-foreground hover:text-foreground mt-1"
                >
                  Clear due date
                </button>
              )}
            </div>

            <div>
              <label className={labelCls}>Due Odometer</label>
              <input
                className={`${inputCls} text-right`}
                type="number"
                value={form.nextDueOdometer}
                onChange={e => set('nextDueOdometer', e.target.value)}
                placeholder="miles"
                min="0"
                step="1"
              />
            </div>
            <p className="text-[10px] font-mono text-muted-foreground">
              Intervals fill these in — edit either one and it wins.
            </p>
          </div>

          {/* ── Transaction ──────────────────────────────────── */}
          <div className="pt-3 border-t border-[#1e1e1e] space-y-2">
            <label className={labelCls}>Transaction</label>
            <div className="flex gap-1.5">
              {(['none', 'existing', 'new'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => set('txMode', m)}
                  className={modeBtnCls(form.txMode === m)}
                  style={modeBtnStyle(form.txMode === m)}
                >
                  {m === 'none' ? 'None' : m === 'existing' ? 'Existing' : '＋ New'}
                </button>
              ))}
            </div>

            {form.txMode === 'existing' && (
              <select className={inputCls} value={form.txId} onChange={e => set('txId', e.target.value)}>
                <option value="">Select transaction…</option>
                {transactions
                  .filter(t => t.type === 'expense')
                  .slice(0, 100)
                  .map(t => (
                    <option key={t.id} value={t.id}>
                      {t.date} · ${Number(t.amount).toLocaleString()} · {t.note || t.category}
                    </option>
                  ))}
              </select>
            )}

            {form.txMode === 'new' && (
              <div className="space-y-2">
                <div>
                  <label className={labelCls}>Date</label>
                  <DateScrollPicker value={form.txDate} onChange={v => set('txDate', v)} />
                </div>
                <div>
                  <label className={labelCls}>Amount ($)</label>
                  <input
                    className={`${inputCls} text-right`}
                    type="number"
                    value={form.txAmount}
                    onChange={e => set('txAmount', e.target.value)}
                    placeholder={form.cost || '0.00'}
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className={labelCls}>Payment Method</label>
                  <select className={inputCls} value={form.txPaymentSource} onChange={e => set('txPaymentSource', e.target.value)}>
                    <option value="">Unassigned</option>
                    {paymentSourceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Files an expense under Car so this service shows up in your spending.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className={labelCls}>Notes</label>
            <textarea
              className={`${inputCls} resize-none`}
              rows={2}
              value={form.notes}
              maxLength={NOTES_MAX}
              onChange={e => set('notes', e.target.value)}
              placeholder="Parts used, torque specs, what the shop said…"
            />
            <span className="text-[10px] text-muted-foreground text-right block mt-0.5">{form.notes.length}/{NOTES_MAX}</span>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 text-xs font-mono font-bold uppercase tracking-wider rounded transition-colors disabled:opacity-50"
              style={{ background: '#c8a84b', color: '#000' }}
            >
              {saving ? 'Saving…' : log ? 'Save Changes' : 'Log Service'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-mono text-muted-foreground border border-border rounded hover:border-muted-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
