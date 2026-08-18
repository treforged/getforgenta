import { useState } from 'react';
import { BookOpen, X, Info, BarChart2 } from 'lucide-react';

type Section = { title: string; body: string; group?: string };

type Props = {
  pageTitle: string;
  sections: Section[];
};

export default function InstructionsModal({ pageTitle, sections }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold text-primary border border-primary/30 hover:border-primary hover:bg-primary/8 transition-colors shrink-0 cursor-pointer"
        style={{ borderRadius: 'var(--radius)' }}
        title={`How to use ${pageTitle}`}
      >
        <BookOpen size={11} /> Guide
      </button>

      {open && (
        <div
          className="modal-overlay z-50"
          style={{ background: 'rgba(0,0,0,0.85)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="card-forged w-full max-w-lg flex flex-col"
            style={{ maxHeight: '100%' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Sticky header — always visible */}
            <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-4 border-b border-border shrink-0">
              <h2 className="font-display font-semibold text-sm flex items-center gap-2 min-w-0">
                <BookOpen size={14} className="text-primary shrink-0" />
                <span className="truncate">{pageTitle}</span>
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground shrink-0 p-1 min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Close guide"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
              {sections.map((s, i) => (
                <div key={i}>
                  {/* A group heading only where the group CHANGES, so a combined guide reads
                      as one document with parts rather than as a label repeated per block. */}
                  {s.group && s.group !== sections[i - 1]?.group && (
                    <p className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-2 mt-2 first:mt-0">
                      {s.group}
                    </p>
                  )}
                  <h3 className="text-xs font-semibold text-foreground mb-1">{s.title}</h3>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{s.body}</p>
                </div>
              ))}
              <div className="pt-3 border-t border-border/50">
                <h3 className="text-xs font-semibold text-foreground mb-1">Interactive tiles</h3>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Tiles with a{' '}
                  <Info size={11} className="inline align-middle text-foreground" />
                  {' '}or{' '}
                  <BarChart2 size={11} className="inline align-middle text-foreground" />
                  {' '}icon in the bottom-right corner are interactive — tap or click anywhere on the tile to see a detailed breakdown or navigate to a related page.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
