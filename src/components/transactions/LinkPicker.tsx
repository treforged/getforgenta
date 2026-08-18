import type { LinkOption } from '@/lib/review-link-options';

/**
 * The one `<select>` a charge is linked through, on every surface.
 *
 * ⚠️ IT IS DELIBERATELY DUMB. It renders options and reports the picked value; it does not know what
 * a rule is, does not build a write, and does not decide whether it should be shown. Those three
 * belong to `review-link-options.ts` (what may be picked), `review-write-inputs.ts` (the row that
 * gets written) and the caller (whether this destination is offered at all — the list hides "link
 * to an entry" once the charge already holds links). Keeping them apart is why the deck and the
 * list cannot drift; putting any of them in here is how they would.
 *
 * ⚠️ IT RESETS TO THE PLACEHOLDER AFTER EVERY PICK. `value=""` with the pick handled in `onChange`
 * means the select never displays a stale choice — the charge's real state is the row that got
 * written and is rendered elsewhere, and a select still showing "Rent" after the link was recorded
 * reads as an unsaved edit.
 */
export interface LinkPickerProps {
  options: readonly LinkOption[];
  /** The question, shown as the disabled first option. */
  placeholder: string;
  ariaLabel: string;
  onPick: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export default function LinkPicker({
  options, placeholder, ariaLabel, onPick, disabled, className,
}: LinkPickerProps) {
  return (
    <select
      value=""
      disabled={disabled}
      onChange={e => {
        const picked = e.target.value;
        if (!picked) return;
        onPick(picked);
      }}
      className={className ?? 'bg-secondary border border-border px-2 py-1 text-[11px] text-foreground max-w-full'}
      style={{ borderRadius: 'var(--radius)' }}
      aria-label={ariaLabel}
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
