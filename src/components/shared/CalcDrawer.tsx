import { Info, X } from 'lucide-react';

/**
 * The "how was this calculated" drawer.
 *
 * Lifted verbatim out of `Dashboard.tsx`, where it was a page-local copy of the same
 * component `Forecast.tsx` also declares locally. Dashboard now imports this one; Forecast's
 * copy carries extra props (per-line `onClick`, a `zIndex` override) and migrates in the
 * Forecast slice — merging the two before those props have a home here would change
 * Forecast's behavior in a slice that is not reviewing Forecast.
 */
export interface CalcDrawerLine {
  label: string;
  value: string;
  op?: string;
}

export default function CalcDrawer({
  open,
  onClose,
  title,
  lines,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  lines: CalcDrawerLine[];
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)', paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      onClick={onClose}
    >
      <div
        className="card-forged p-4 sm:p-6 w-full max-w-sm sm:max-w-md space-y-3 max-h-[75vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-sm flex items-center gap-2">
            <Info size={14} className="text-primary" /> {title}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-3 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-muted-foreground uppercase tracking-wider">
          Calculation Breakdown
        </p>

        <div className="space-y-2 pt-2">
          {lines.map((l, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0"
            >
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                {l.op && <span className="text-primary font-bold">{l.op}</span>}
                {l.label}
              </span>
              <span className="text-xs font-display font-bold text-foreground">
                {l.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
