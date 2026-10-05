import type { ViewMode } from '@/lib/view-mode';

/**
 * The Simple | Advanced segmented control. Built from the same `seg-*` classes as every panel
 * row in the app (control-conventions.md: one kind of control, one look), so its state reads
 * the way every other segment does. Tabs with aria-selected, as segment-selected-state.gate.test.ts requires of every seg-item.
 */
export function ViewModeSwitch({ mode, onChange }: { mode: ViewMode; onChange: (next: ViewMode) => void }) {
  const opts: { id: ViewMode; label: string }[] = [
    { id: 'simple', label: 'Simple' },
    { id: 'advanced', label: 'Advanced' },
  ];
  return (
    <div role="tablist" aria-label="How much detail to show" className="seg-track shrink-0" data-testid="view-mode-switch">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={mode === o.id}
          onClick={() => onChange(o.id)}
          className={`seg-item btn-press ${mode === o.id ? 'seg-item-active' : ''}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
