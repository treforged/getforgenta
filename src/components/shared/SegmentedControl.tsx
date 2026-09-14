// THE row of mutually-exclusive filter pills. One implementation, used on every tab.
//
// Tre, 2026-09-13: "consider design of other apps when thinking about our design always. and
// consistency across tabs."
//
// ⚠️ THE DRIFT HAD ALREADY COST TWO REAL DEFECTS, which is why this is a component and not a
// tidy-up. Measured across the four copies on 2026-09-14:
//
//   - `Accounts.tsx` passed an EMPTY string as its inactive class, where every other row used
//     `border-border text-muted-foreground`. So its unselected pills had no visible border and no
//     muted text — on the same screen shape that looks correct everywhere else.
//   - THREE of the four announced NOTHING about which pill was selected. Only the year row in
//     `CreditCardEngine` carried `aria-pressed`. A screen-reader user heard four plain buttons and
//     could not tell which filter was active — the same family as the six switches that shipped
//     without declaring the switch role at all.
//
// ⚠️ `aria-pressed` RATHER THAN `role="radio"`, chosen deliberately. A radiogroup is the textbook
// answer and it carries a keyboard contract this app does not implement — roving tabindex, arrow
// keys to move selection. Claiming the role without the behaviour is worse than not claiming it,
// because assistive tech then promises arrow keys that do nothing. A group of toggle buttons is
// honest about what it is, and it fixes the actual defect: the selected one now says so.
//
// ⚠️ WHAT THIS DOES NOT COVER, said plainly so the next person does not force it: the strategy row
// in `CreditCardEngine` (icons + per-option tooltips) and the FILLED, joined segmented groups
// (`pct|flat` in ForecastAssumptionsPanel, `upfront|monthly_charge` in Transactions,
// MaintenanceFormModal's mode row). Those are a different control — a joined block with a filled
// active state, not separated outline pills — and folding them in here would produce a component
// configured by flags rather than one that means something. They are their own count; see the
// handoff.
import type { MouseEvent, ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  /** What the person reads. Not derived from `value` — several rows relabel ("All 60 Months"). */
  label: ReactNode;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onSelect,
  label,
  size = 'md',
  wrap = true,
  gap = 'normal',
  className = '',
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  /** The event is passed through so a row nested in a clickable parent (the card accordion in
   *  `CreditCardEngine`) can `stopPropagation` without this component needing a flag for it. */
  onSelect: (next: T, event: MouseEvent<HTMLButtonElement>) => void;
  /** Names the GROUP, e.g. "Filter transactions by type". Required — an unnamed group of pills
   *  is announced as loose buttons with no indication of what they filter. */
  label: string;
  /** `sm` is the denser row used inside cards; `md` is the page-level default. */
  size?: 'sm' | 'md';
  /**
   * ⚠️ A PROP RATHER THAN A CLASS OVERRIDE, ON PURPOSE. Passing `flex-nowrap` through
   * `className` does NOT reliably beat this component's own `flex-wrap`: they have equal CSS
   * specificity, so the winner is decided by the order Tailwind emits them in its stylesheet,
   * not by the order they appear in the class string. That is a coin toss dressed as an
   * override. `gap` is the same story — it only worked above because `!gap-1.5` forced it with
   * `!important`, and reaching for `!important` is the tell that the API was missing something.
   */
  wrap?: boolean;
  /** Row gap. `tight` is the in-card row; `normal` is the page-level default. */
  gap?: 'tight' | 'normal';
  className?: string;
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-3 py-1 text-xs';
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex items-center ${wrap ? 'flex-wrap' : 'flex-nowrap'} ${gap === 'tight' ? 'gap-1.5' : 'gap-2'} ${className}`}
    >
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={e => onSelect(o.value, e)}
            aria-pressed={active}
            className={`${pad} font-medium border btn-press whitespace-nowrap transition-colors ${
              active
                ? 'border-primary text-primary bg-primary/5'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
            style={{ borderRadius: 'var(--radius)' }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
