import { useEffect, type ReactNode } from 'react';
import { X, Info, Check, Loader2 } from 'lucide-react';
import DateScrollPicker from './DateScrollPicker';

export type Field = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  clearable?: boolean;
  step?: string;
  disabled?: boolean;
  hint?: string;
};

type Props = {
  title: string;
  fields: Field[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onSave: () => void;
  onClose: () => void;
  saving?: boolean;
  saveLabel?: string;
  notice?: string;
  children?: ReactNode;
};

export default function FormModal({ title, fields, values, onChange, onSave, onClose, saving, saveLabel = 'Save', notice, children }: Props) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4"
      style={{ touchAction: 'none', background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <div
        className="card-forged w-full sm:max-w-md flex flex-col rounded-t-[var(--radius)] rounded-b-none sm:rounded-b-[var(--radius)]"
        style={{
          maxHeight: 'calc(88dvh - env(safe-area-inset-bottom))',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="flex items-center justify-between px-4 sm:px-6 pt-5 sm:pt-6 pb-3 shrink-0">
          <h2 className="font-display font-semibold text-sm">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-3 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center"><X size={16} /></button>
        </div>

        {/* Scrollable fields */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 space-y-3 pb-2 popup-scroll" style={{ WebkitOverflowScrolling: 'touch' }}>
          {notice && (
            <div className="flex items-start gap-2 bg-primary/8 border border-primary/20 px-3 py-2.5" style={{ borderRadius: 'var(--radius)' }}>
              <Info size={12} className="text-primary mt-0.5 shrink-0" />
              <p className="text-[10px] text-muted-foreground leading-relaxed">{notice}</p>
            </div>
          )}
          {fields.map(f => (
            <div key={f.key}>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{f.label}</label>
              {f.type === 'select' ? (
                <select
                  value={values[f.key] || ''}
                  onChange={e => onChange(f.key, e.target.value)}
                  disabled={f.disabled}
                  className={`w-full mt-1 bg-secondary border border-border px-3 py-3 text-sm ${!values[f.key] ? 'text-muted-foreground' : 'text-foreground'} ${f.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {f.required && <option value="" disabled>{f.placeholder || 'Select…'}</option>}
                  {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === 'date' ? (
                <div className="mt-1">
                  {!values[f.key] ? (
                    <button type="button"
                      onClick={() => onChange(f.key, new Date().toISOString().split('T')[0])}
                      className="text-xs text-primary hover:text-primary/80 py-1">
                      + Set date
                    </button>
                  ) : (
                    <div className="space-y-1">
                      <DateScrollPicker value={values[f.key]} onChange={v => onChange(f.key, v)} />
                      {f.clearable && (
                        <button type="button" onClick={() => onChange(f.key, '')}
                          className="text-[10px] text-muted-foreground hover:text-foreground">
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <input
                  type={f.type}
                  step={f.step}
                  value={values[f.key] || ''}
                  onChange={e => !f.disabled && onChange(f.key, e.target.value)}
                  readOnly={f.disabled}
                  className={`w-full mt-1 bg-secondary border border-border px-3 py-3 text-sm text-foreground ${f.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                  style={{ borderRadius: 'var(--radius)' }}
                  placeholder={f.placeholder}
                />
              )}
              {f.hint && <p className="text-[10px] text-muted-foreground mt-0.5">{f.hint}</p>}
            </div>
          ))}
          {children}
        </div>

        {/* Sticky save button — always visible */}
        <div className="px-4 sm:px-6 pt-3 pb-5 sm:pb-6 shrink-0 border-t border-border mt-1">
          <button
            onClick={onSave}
            disabled={saving}
            className="w-full bg-primary text-primary-foreground py-3.5 text-sm font-semibold btn-press disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? 'Saving...' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
