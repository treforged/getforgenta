import { Info, X, ChevronRight } from 'lucide-react';

/**
 * The "how was this calculated" drawer.
 *
 * Lifted out of `Dashboard.tsx` by the Dashboard slice, then merged with `Forecast.tsx`'s
 * page-local copy by the Forecast slice — there is now one implementation, not three
 * (`BudgetControl.tsx` still declares its own; that page belongs to the token-sweep slice).
 *
 * The merge kept Forecast's structure rather than Dashboard's, because Forecast's month
 * breakdown runs to ~60 rows: the header stays put while the body scrolls, and long labels
 * wrap instead of overflowing. Dashboard's drawers are short enough that they render the
 * same either way. The extra props Forecast needed — a per-line `onClick` (the Cash Floor
 * row opens a second drawer) and a `zIndex` override (so that second drawer stacks above the
 * first) — are optional, so Dashboard's call site is unchanged.
 */
export interface CalcDrawerLine {
  label: string;
  value: string;
  op?: string;
  /** Makes the row a control — used where a figure opens its own breakdown. */
  onClick?: () => void;
}

export default function CalcDrawer({
  open,
  onClose,
  title,
  lines,
  footnote,
  zIndex = 60,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  lines: CalcDrawerLine[];
  /** Caveat printed under the rows. Absent unless the caller has one — no filler. */
  footnote?: string;
  zIndex?: number;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)', paddingTop: 'max(1rem, env(safe-area-inset-top))', zIndex }}
      onClick={onClose}
    >
      <div
        className="card-forged w-full max-w-sm sm:max-w-md flex flex-col"
        style={{ maxHeight: 'min(85vh, calc(100dvh - 2rem))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-4 border-b border-border shrink-0">
          <h2 className="font-display font-semibold text-sm flex items-center gap-2 min-w-0">
            <Info size={14} className="text-primary shrink-0" />
            <span className="truncate">{title}</span>
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-4 sm:px-6 py-4 space-y-2">
          {/* Kept from Dashboard's copy so its drawer reads exactly as it did before the merge. */}
          <p className="text-xs text-muted-foreground uppercase tracking-wider pb-1">Calculation Breakdown</p>
          {lines.map((l, i) => (
            <div
              key={i}
              className={`flex items-start justify-between py-1.5 border-b border-border/30 last:border-0 gap-2 ${l.onClick ? 'cursor-pointer hover:bg-secondary/40 rounded px-1 -mx-1' : ''}`}
              onClick={l.onClick ? (e) => { e.stopPropagation(); l.onClick!(); } : undefined}
            >
              <span className="text-xs flex items-start gap-1.5 min-w-0 flex-1" style={{ color: l.onClick ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}>
                {l.op && <span className="text-primary font-bold shrink-0 mt-px">{l.op}</span>}
                <span className={`wrap-break-word ${l.onClick ? 'underline decoration-dotted underline-offset-2' : ''}`}>{l.label}</span>
                {l.onClick && <ChevronRight size={11} className="shrink-0 mt-px text-muted-foreground" />}
              </span>
              <span className="text-xs font-display font-bold text-foreground whitespace-nowrap shrink-0">{l.value}</span>
            </div>
          ))}
          {footnote && (
            <p className="text-xs text-muted-foreground pt-2 border-t border-border/30">{footnote}</p>
          )}
        </div>
      </div>
    </div>
  );
}
