import CountUp from '@/components/shared/CountUp';
import type { CarBuildPhase, CarBuildItem } from '@/lib/types';

/** `$12,400` — the same formatting the totals had before they animated. */
const money = (n: number) => `$${n.toLocaleString()}`;

interface BuildSummaryProps {
  phases: CarBuildPhase[];
  items: CarBuildItem[];
}

export default function BuildSummary({ phases, items }: BuildSummaryProps) {
  const activePhaseIds = new Set(phases.filter(p => !p.hidden).map(p => p.id));
  const activeItems = items.filter(it => activePhaseIds.has(it.phase_id));

  const grandTotal = activeItems.reduce((s, it) => s + (it.price ?? 0), 0);
  const spent = activeItems.filter(it => it.completed).reduce((s, it) => s + (it.price ?? 0), 0);
  const remaining = grandTotal - spent;
  const hasTbd = activeItems.some(it => it.price === null);

  return (
    <div className="mt-8 border border-border rounded overflow-hidden">
      <div className="flex justify-between items-center px-5 py-[13px] border-b border-border bg-card/50">
        <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest" style={{ color: '#c8a84b' }}>
          Grand Total (active phases)
        </span>
        <span className="font-mono text-base font-medium" style={{ color: '#c8a84b' }}>
          {/* "+ TBD" stays outside the counter: it is not part of the number,
              and interpolating toward a caveat is meaningless. */}
          <CountUp value={grandTotal} format={money} />{hasTbd ? ' + TBD' : ''}
        </span>
      </div>
      <div className="flex justify-between items-center px-5 py-[13px] border-b border-border">
        <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">
          Spent (marked complete)
        </span>
        <span className="font-mono text-sm" style={{ color: '#3a8a5a' }}>
          <CountUp value={spent} format={money} />
        </span>
      </div>
      <div className="flex justify-between items-center px-5 py-[13px]">
        <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">
          Remaining
        </span>
        <span className="font-mono text-sm text-foreground">
          <CountUp value={remaining} format={money} />{hasTbd ? ' + TBD' : ''}
        </span>
      </div>
    </div>
  );
}
