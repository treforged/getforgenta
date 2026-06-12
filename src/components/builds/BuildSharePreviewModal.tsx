import { useState } from 'react';
import { X, Check, ExternalLink, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CarBuild, CarBuildPhase, CarBuildItem } from '@/lib/types';

const PHASE_COLORS = [
  '#c8a84b', '#ba4a4a', '#4a8cba', '#8a5ba3', '#3a8a5a',
  '#c87a3a', '#8aaa3a', '#5a7ab8', '#c84b8a', '#4bb8c8',
  '#c84b4b', '#7ab85a', '#b8a84b', '#7a5ab8', '#4ba8b8',
];

function itemLabel(phaseIndex: number, itemIndex: number, total: number): string {
  if (total === 1) return String(phaseIndex + 1);
  return `${phaseIndex + 1}${String.fromCharCode(97 + itemIndex)}`;
}

interface Props {
  build: CarBuild;
  phases: CarBuildPhase[];
  items: CarBuildItem[];
  shareUrl: string;
  onClose: () => void;
}

export default function BuildSharePreviewModal({ build, phases, items, shareUrl, onClose }: Props) {
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [includePlanned, setIncludePlanned] = useState(false);

  function togglePhase(id: string) {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const hasPlannedPhases = phases.some(p => p.hidden);
  const activePhaseIds = new Set(phases.filter(p => !p.hidden).map(p => p.id));
  const budgetItems = includePlanned ? items : items.filter(it => activePhaseIds.has(it.phase_id));
  const totalConfirmed = budgetItems.reduce((s, it) => s + (it.price ?? 0), 0);
  const hasTbd = budgetItems.some(it => it.price === null);

  const activeItems = items.filter(it => activePhaseIds.has(it.phase_id));
  const totalItems = activeItems.length;
  const doneItems = activeItems.filter(it => it.completed).length;
  const pct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

  const subLabel = [build.year, build.make, build.model].filter(Boolean).join(' ');

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Sticky top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background flex-shrink-0">
        <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-[0.2em]">Share Preview</div>
        <div className="flex items-center gap-3">
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-mono font-bold uppercase tracking-wider px-3 py-1.5 rounded transition-all hover:opacity-90 flex items-center gap-1"
            style={{ background: '#c8a84b', color: '#000' }}
          >
            Open <ExternalLink size={10} />
          </a>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto py-6 px-4">

          {/* Header */}
          <div className="flex flex-col gap-4 pb-5 border-b border-border mb-5">
            <div>
              <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-[0.2em] mb-1">
                Forgenta — Build Log
              </div>
              <h1 className="text-3xl font-display font-bold tracking-tight leading-none break-words">
                {build.name}
              </h1>
              {subLabel && (
                <div className="text-[13px] font-mono text-muted-foreground mt-2 tracking-[0.1em] uppercase">
                  {subLabel}
                </div>
              )}
            </div>
            <div>
              <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-[0.15em] mb-0.5">
                {includePlanned ? 'Total Mod Cost' : 'Total Budget'}
              </div>
              <div className="text-3xl font-display font-bold tracking-wide leading-none" style={{ color: '#c8a84b' }}>
                ${totalConfirmed.toLocaleString()}
              </div>
              {hasTbd && (
                <div className="text-[12px] font-mono text-muted-foreground mt-0.5">+ TBD items</div>
              )}
              {hasPlannedPhases && (
                <button
                  onClick={() => setIncludePlanned(v => !v)}
                  className="mt-2 text-[11px] font-mono font-bold uppercase tracking-wider px-3 py-1.5 rounded transition-all"
                  style={includePlanned
                    ? { background: '#c8a84b', color: '#000' }
                    : { background: '#1a1a1a', color: '#c8a84b', border: '1px solid #c8a84b' }
                  }
                >
                  {includePlanned ? '✓ Planned included' : '+ Include planned'}
                </button>
              )}
            </div>
          </div>

          {/* Progress */}
          <div className="mb-6">
            <div className="flex justify-between text-[11px] font-mono text-muted-foreground uppercase tracking-[0.15em] mb-2">
              <span>Build Progress</span>
              <span>{doneItems} / {totalItems} items complete · {pct}%</span>
            </div>
            <div className="h-[3px] bg-border rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #7a1f1f, #c8a84b)' }}
              />
            </div>
            {phases.length > 0 && (
              <div className="flex gap-px mt-2 h-1 rounded-full overflow-hidden">
                {phases.map((ph, i) => {
                  const phItems = items.filter(it => it.phase_id === ph.id);
                  const phDone = phItems.filter(it => it.completed).length;
                  const phPct = phItems.length > 0 ? (phDone / phItems.length) * 100 : 0;
                  return (
                    <div
                      key={ph.id}
                      title={`${ph.title}: ${phDone}/${phItems.length}`}
                      style={{
                        flex: Math.max(phItems.length, 1),
                        background: PHASE_COLORS[i % PHASE_COLORS.length],
                        opacity: ph.hidden ? 0.2 + (phPct / 100) * 0.4 : 0.35 + (phPct / 100) * 0.65,
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Phases */}
          <div className="space-y-2">
            {phases.map((ph, i) => {
              const phItems = items.filter(it => it.phase_id === ph.id);
              const doneCount = phItems.filter(it => it.completed).length;
              const allDone = phItems.length > 0 && doneCount === phItems.length;
              const phTotal = phItems.reduce((s, it) => s + (it.price ?? 0), 0);
              const color = PHASE_COLORS[i % PHASE_COLORS.length];
              const isExpanded = expandedPhases.has(ph.id);

              return (
                <div
                  key={ph.id}
                  className="border border-border rounded overflow-hidden"
                  style={ph.hidden ? { opacity: 0.6 } : undefined}
                >
                  <div
                    className="flex items-center gap-3 px-4 py-3 bg-card cursor-pointer hover:bg-card/80 select-none"
                    onClick={() => togglePhase(ph.id)}
                  >
                    <div className="text-2xl font-display font-bold leading-none flex-shrink-0" style={{ color }}>
                      <span className="inline-block w-2 h-2 rounded-full mr-1.5 mb-0.5 align-middle" style={{ background: color }} />
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-semibold uppercase tracking-wide text-foreground break-words">
                          {ph.title}
                        </span>
                        {allDone && !ph.hidden && (
                          <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border flex-shrink-0"
                            style={{ color: '#3a8a5a', borderColor: '#3a8a5a' }}>
                            ✓ Done
                          </span>
                        )}
                        {ph.hidden && (
                          <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border flex-shrink-0"
                            style={{ color: '#666', borderColor: '#444' }}>
                            Planned
                          </span>
                        )}
                      </div>
                      <div className="text-[12px] font-mono text-muted-foreground mt-0.5">
                        {doneCount > 0 ? `${doneCount} / ${phItems.length} complete` : `${phItems.length} item${phItems.length !== 1 ? 's' : ''}`}
                      </div>
                    </div>
                    <div className="font-mono text-base font-medium text-right flex-shrink-0 mr-2" style={{ color: '#c8a84b' }}>
                      {phTotal > 0 ? `$${phTotal.toLocaleString()}` : <span className="text-[13px] text-muted-foreground">TBD</span>}
                    </div>
                    <ChevronDown
                      size={14}
                      className={cn('flex-shrink-0 text-muted-foreground transition-transform duration-200', isExpanded && 'rotate-180')}
                    />
                  </div>

                  {isExpanded && phItems.length > 0 && (
                    <div className="border-t border-border">
                      {phItems.map((item, ii) => (
                        <div
                          key={item.id}
                          className={`flex items-center gap-2.5 px-4 py-3 border-b border-[#141414] ${item.completed ? 'opacity-50' : ''}`}
                        >
                          <div className={`w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center flex-shrink-0 ${item.completed ? 'border-[#3a8a5a] bg-[#3a8a5a] text-white' : 'border-border bg-transparent'}`}>
                            {item.completed && <Check size={11} strokeWidth={3} />}
                          </div>
                          <div className="text-[13px] font-mono text-muted-foreground flex-shrink-0 w-7 text-center">
                            {itemLabel(i, ii, phItems.length)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm text-[#c8c2b8] leading-snug break-words ${item.completed ? 'line-through' : ''}`}>
                              {item.name}
                            </div>
                            {item.brand && (
                              <div className="text-[12px] font-mono text-muted-foreground mt-0.5 break-words">{item.brand}</div>
                            )}
                            {item.link && (
                              <a
                                href={item.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-[11px] font-mono mt-0.5 transition-colors hover:underline"
                                style={{ color: '#6a90c0' }}
                              >
                                <ExternalLink size={10} /> VIEW LISTING
                              </a>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            {item.price !== null
                              ? <span className="font-mono text-sm text-foreground">${item.price.toLocaleString()}</span>
                              : <span className="font-mono text-[12px] text-muted-foreground">TBD</span>
                            }
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
