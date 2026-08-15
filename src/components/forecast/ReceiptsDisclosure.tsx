import { ChevronDown } from 'lucide-react';

/**
 * "Show the receipts" — a `card-forged` summary bar that opens a table (DIRECTION.md:
 * tables live behind a tap, never as the landing view).
 *
 * Controlled, so the page owns where the open/closed state is persisted. The body is
 * unmounted while closed: a 60-row table rendered behind `hidden` would still cost the work
 * this disclosure exists to defer.
 */
type Props = {
  title: string;
  /** The one-line receipt count, e.g. "60 months". Rendered next to the title. */
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

export default function ReceiptsDisclosure({ title, summary, open, onToggle, children }: Props) {
  return (
    <div className="card-forged p-3 sm:p-5">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
          <span className="block text-[10px] text-muted-foreground/80 mt-0.5">
            {summary} · tap to {open ? 'close' : 'open'}
          </span>
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="mt-3 sm:mt-4">{children}</div>}
    </div>
  );
}
