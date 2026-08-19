import CountUp from '@/components/shared/CountUp';
import type { CarBuild, CarBuildPhase, CarBuildItem } from '@/lib/types';

/** `$12,400` — the same formatting the total had before it animated. */
const money = (n: number) => `$${n.toLocaleString()}`;

const PHASE_COLORS = [
  '#c8a84b', '#ba4a4a', '#4a8cba', '#8a5ba3', '#3a8a5a',
  '#c87a3a', '#8aaa3a', '#5a7ab8', '#c84b8a', '#4bb8c8',
  '#c84b4b', '#7ab85a', '#b8a84b', '#7a5ab8', '#4ba8b8',
];

interface BuildHeaderProps {
  build: CarBuild;
  phases: CarBuildPhase[];
  items: CarBuildItem[];
}

export default function BuildHeader({ build, phases, items }: BuildHeaderProps) {
  const activePhaseIds = new Set(phases.filter(p => !p.hidden).map(p => p.id));
  const activeItems = items.filter(it => activePhaseIds.has(it.phase_id));

  const totalConfirmed = activeItems.reduce((s, it) => s + (it.price ?? 0), 0);
  const hasTbd = activeItems.some(it => it.price === null);
  const totalItems = activeItems.length;
  const doneItems = activeItems.filter(it => it.completed).length;
  const pct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

  const subLabel = [build.year, build.make, build.model].filter(Boolean).join(' ');

  return (
    <div className="mb-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-5 border-b border-border mb-5">
        <div>
          <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-[0.2em] mb-1">
            Forgenta — Build Log
          </div>
          <h1 className="text-4xl sm:text-5xl font-display font-bold tracking-tight text-foreground leading-none">
            {build.name}
          </h1>
          {subLabel && (
            <div className="text-[13px] font-mono text-muted-foreground mt-2 tracking-widest uppercase">
              {subLabel}
            </div>
          )}
        </div>
        <div className="sm:text-right shrink-0">
          <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-[0.15em] mb-0.5">
            Total Budget
          </div>
          <div className="text-4xl font-display font-bold tracking-wide leading-none" style={{ color: 'hsl(var(--primary))' }}>
            {/* The biggest figure on the page, and the one the brief named:
                it moves when an item is priced or a phase is hidden, so it
                counts rather than jumping. The "+ TBD items" caveat below
                stays outside the counter — it is not part of the number. */}
            <CountUp value={totalConfirmed} format={money} />
          </div>
          {hasTbd && (
            <div className="text-[12px] font-mono text-muted-foreground mt-0.5">+ TBD items</div>
          )}
        </div>
      </div>

      <div>
        <div className="flex justify-between text-[11px] font-mono text-muted-foreground uppercase tracking-[0.15em] mb-2">
          <span>Build Progress</span>
          <span>{doneItems} / {totalItems} items complete · {pct}%</span>
        </div>
        <div className="h-[3px] bg-border rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(90deg, #7a1f1f, #c8a84b)',
            }}
          />
        </div>

        {phases.length > 0 && (
          <div className="flex gap-px mt-2 h-1 rounded-full overflow-hidden">
            {phases.filter(p => !p.hidden).map((ph, i) => {
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
                    opacity: 0.25 + (phPct / 100) * 0.75,
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
