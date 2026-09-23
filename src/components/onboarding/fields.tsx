// The wizard's form primitives. They lived inside Onboarding.tsx until the debt and goal steps were
// extracted; they are shared rather than copied so the steps cannot drift apart visually.

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{children}</label>;
}

// `label` is REQUIRED: it is the field's accessible name. The visible caption is a sibling FieldLabel with no
// htmlFor link, so without it a screen reader announced every wizard field as "edit text" (2026-09-23).
export function Input({ label, value, onChange, onBlur, placeholder, type = 'text', prefix }: {
  label: string; value: string; onChange: (v: string) => void; onBlur?: () => void; placeholder?: string;
  type?: string; prefix?: string;
}) {
  return (
    <div className="relative">
      {prefix && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{prefix}</span>
      )}
      <input
        aria-label={label}
        type={type}
        inputMode={type === 'number' ? 'decimal' : undefined}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={`w-full bg-secondary border border-border py-2.5 text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring ${prefix ? 'pl-7 pr-3' : 'px-3'}`}
        style={{ borderRadius: 'var(--radius)' }}
      />
    </div>
  );
}

export function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-secondary border border-border px-3 py-2.5 text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
      style={{ borderRadius: 'var(--radius)' }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
