import { backdropAction } from '@/lib/form-dismiss';
import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { filterProfanity, LIMITS } from '@/lib/content-filter';
import type { CarBuild, CarFund } from '@/lib/types';

interface BuildFormModalProps {
  open: boolean;
  build?: CarBuild | null;
  /** The user's own car funds, for the "car loan plan" connection. Only these are offered, which
   * is also why `build-loan-link.ts` can resolve the saved id against the same list. */
  carFunds?: readonly CarFund[];
  onClose: () => void;
  onSave: (data: { name: string; year: number | null; make: string | null; model: string | null; notes: string | null; car_fund_id: string | null }) => void;
  saving?: boolean;
}

const empty = { name: '', year: '', make: '', model: '', notes: '', carFundId: '' };

export default function BuildFormModal({ open, build, carFunds = [], onClose, onSave, saving }: BuildFormModalProps) {
  const [form, setForm] = useState(empty);
  // The form as the modal opened. A backdrop tap compares against THIS, so opening an
  // existing build and changing nothing still counts as pristine (`lib/form-dismiss.ts`).
  // A ref, not state: nothing renders it, and setting state in the reset effect below
  // would be the cascading render the lint rule objects to.
  const baseline = useRef(empty);
  const [nameError, setNameError] = useState('');

  useEffect(() => {
    if (open) {
      // Resets the form to the build being edited each time the modal opens. The
      // component stays mounted while closed (it only returns null), so its state
      // survives between openings and has to be reset explicitly. The fields are
      // user-editable, so they cannot be derived from the `build` prop.
      const loaded = build ? {
        name: build.name,
        year: build.year ? String(build.year) : '',
        make: build.make ?? '',
        model: build.model ?? '',
        notes: build.notes ?? '',
        carFundId: build.car_fund_id ?? '',
      } : empty;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(loaded);
      baseline.current = loaded;
      setNameError('');
    }
  }, [open, build]);

  if (!open) return null;

  /** Pristine dismisses; anything typed goes through the validating save. */
  function dismiss() {
    if (backdropAction(form, baseline.current) === 'close') { onClose(); return; }
    handleSubmit();
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!form.name.trim()) { setNameError('Name is required'); return; }
    const nameResult = filterProfanity(form.name.trim().slice(0, LIMITS.buildName));
    const notesResult = filterProfanity(form.notes.trim().slice(0, LIMITS.buildNotes));
    if (nameResult.flagged) toast.warning('Build name contained inappropriate language and was cleaned.');
    if (notesResult.flagged) toast.warning('Notes contained inappropriate language and was cleaned.');
    onSave({
      name: nameResult.clean,
      year: form.year ? parseInt(form.year, 10) : null,
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      notes: notesResult.clean || null,
      // '' is the "Not connected" option, and it must save as NULL rather than as an empty
      // string — the column is a uuid FK and an empty string is not a uuid.
      car_fund_id: form.carFundId || null,
    });
  }

  const inputCls = 'w-full bg-secondary border border-border text-foreground text-sm px-3 py-2 rounded focus:outline-hidden focus:border-primary font-mono';
  const labelCls = 'block text-[11px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5';

  return (
    <div className="modal-overlay z-50 bg-black/60 backdrop-blur-sm" onClick={dismiss}>
      <div className="bg-card border border-border rounded w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <span className="text-sm font-semibold text-foreground">
            {build ? 'Edit Build' : 'New Build'}
          </span>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className={labelCls}>Build Name *</label>
            <input
              className={`${inputCls}${nameError ? ' border-destructive' : ''}`}
              value={form.name}
              maxLength={LIMITS.buildName}
              onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setNameError(''); }}
              placeholder="e.g. 2004 C5 Corvette"
              autoFocus
            />
            <span className="text-[10px] text-muted-foreground text-right block mt-0.5">{form.name.length}/{LIMITS.buildName}</span>
            {nameError && <p className="text-xs text-destructive mt-1">{nameError}</p>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Year</label>
              <input
                className={inputCls}
                type="number"
                value={form.year}
                onChange={e => setForm(f => ({ ...f, year: e.target.value }))}
                placeholder="2004"
                min="1900" max="2099"
              />
            </div>
            <div>
              <label className={labelCls}>Make</label>
              <input
                className={inputCls}
                value={form.make}
                onChange={e => setForm(f => ({ ...f, make: e.target.value }))}
                placeholder="Chevy"
              />
            </div>
            <div>
              <label className={labelCls}>Model</label>
              <input
                className={inputCls}
                value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                placeholder="Corvette"
              />
            </div>
          </div>

          {carFunds.length > 0 && (
            <div>
              <label className={labelCls}>Car Loan Plan</label>
              <select
                className={inputCls}
                value={form.carFundId}
                onChange={e => setForm(f => ({ ...f, carFundId: e.target.value }))}
              >
                <option value="">Not connected</option>
                {carFunds.map(cf => (
                  <option key={cf.id} value={cf.id}>
                    {cf.vehicle_name}{cf.phase === 'saving' ? ' — saving' : ' — loan'}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1">
                Shows what the car itself costs above your build totals. Never appears on a shared link.
              </p>
            </div>
          )}

          <div>
            <label className={labelCls}>Notes</label>
            <textarea
              className={`${inputCls} resize-none`}
              rows={2}
              value={form.notes}
              maxLength={LIMITS.buildNotes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Optional notes about this build..."
            />
            <span className="text-[10px] text-muted-foreground text-right block mt-0.5">{form.notes.length}/{LIMITS.buildNotes}</span>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 text-xs font-mono font-bold uppercase tracking-wider rounded transition-colors disabled:opacity-50"
              style={{ background: 'hsl(var(--primary))', color: '#000' }}
            >
              {saving ? 'Saving…' : build ? 'Save Changes' : 'Create Build'}
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
