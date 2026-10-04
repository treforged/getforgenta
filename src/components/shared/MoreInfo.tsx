/**
 * An explanation a user needs ONCE, not on every visit, goes behind this one tap (Tre, 2026-10-02,
 * ask 52898f88: "the overload of information, it's too complicated for a new user"). The words are
 * kept, not deleted - they move behind a labelled line. One component so every such tap in the app
 * looks and behaves the same (control-conventions rule).
 */
import { useState, useId, type ReactNode } from 'react';
import { Info, ChevronUp, ChevronDown } from 'lucide-react';

type MoreInfoProps = {
  label: string;
  children: ReactNode;
  className?: string;
  testId?: string;
};

export default function MoreInfo({ label, children, className, testId }: MoreInfoProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(prev => !prev)}
        className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info size={11} aria-hidden="true" />
        {label}
        {open ? <ChevronUp size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}
      </button>
      {open && (
        <div id={panelId} data-testid={testId} className="mt-1 text-[10px] sm:text-xs text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}
