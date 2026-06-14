import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { filterProfanity, LIMITS } from '@/lib/content-filter';
import type { CarBuild } from '@/lib/types';

interface BuildFormModalProps {
  open: boolean;
  build?: CarBuild | null;
  onClose: () => void;
  onSave: (data: { name: string; year: number | null; make: string | null; model: string | null; notes: string | null }) => void;
  saving?: boolean;
}

const empty = { name: '', year: '', make: '', model: '', notes: '' };

export default function BuildFormModal({ open, build, onClose, onSave, saving }: BuildFormModalProps) {
  const [form, setForm] = useState(empty);
  const [nameError, setNameError] = useState('');

  useEffect(() => {
    if (open) {
      setForm(build ? {
        name: build.name,
        year: build.year ? String(build.year) : '',
        make: build.make ?? '',
        model: build.model ?? '',
        notes: build.notes ?? '',
      } : empty);
      setNameError('');
    }
  }, [open, build]);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    });
  }

  const inputCls = 'w-full bg-[#1a1a1a] border border-border text-foreground text-sm px-3 py-2 rounded focus:outline-none focus:border-[#c8a84b] font-mono';
  const labelCls = 'block text-[11px] font-mono text-muted-foreground uppercase tracking-[0.1em] mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
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
              style={{ background: '#c8a84b', color: '#000' }}
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
