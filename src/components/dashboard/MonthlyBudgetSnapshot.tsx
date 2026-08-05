import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { formatCurrency } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import type { Month0Snapshot, SnapshotRow, SnapshotRowTone } from '@/lib/month0-budget-snapshot';

/**
 * Findings §2.6/§2.3: this component used to ASSEMBLE the equation from a dozen separate props,
 * one of which (`availableToDeploy`) was an engine output the others were never derived from —
 * so the rows did not sum to their own total. It now RENDERS a snapshot built by
 * `buildMonth0Snapshot`, which sources every row from the engine's own month-0 cash chain and
 * emits the leftover as a computed row. Keep it that way: no arithmetic belongs in here.
 */
type Props = {
  snapshot: Month0Snapshot;
  onFloorClick?: () => void;
};

const C = {
  spent:    'hsl(0, 73%, 35%)',
  expected: 'hsl(30, 85%, 48%)',
  floor:    'hsl(220, 15%, 32%)',
  surplus:  'hsl(142, 50%, 40%)',
  shortfall:'hsl(0, 73%, 45%)',
  empty:    'hsl(0, 0%, 12%)',
};

const TONE_CLASS: Record<SnapshotRowTone, string> = {
  neutral:  'text-foreground',
  positive: 'text-success',
  negative: 'text-destructive',
  muted:    'text-muted-foreground',
  subtotal: 'text-primary',
};

function rowValueClass(row: SnapshotRow): string {
  if (row.tone === 'subtotal') return row.value >= 0 ? 'text-primary' : 'text-destructive';
  if (row.key === 'expenses') return 'text-orange-400';
  return TONE_CLASS[row.tone];
}

export default function MonthlyBudgetSnapshot({ snapshot, onFloorClick }: Props) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const { rows, pie, projectedRemaining, availableToDeploy } = snapshot;

  const pieData = useMemo(() => {
    const segments = [
      pie.spentSoFar > 0       && { name: 'Spent so far',        value: pie.spentSoFar,       color: C.spent },
      pie.billsAndReserves > 0 && { name: 'Bills & reserves',    value: pie.billsAndReserves, color: C.expected },
      pie.locked > 0           && { name: 'Floor & held back',   value: pie.locked,           color: C.floor },
      pie.deployable > 0       && { name: 'Available to deploy', value: pie.deployable,       color: C.surplus },
      pie.shortfall > 0        && { name: 'Shortfall',           value: pie.shortfall,        color: C.shortfall },
    ].filter(Boolean) as { name: string; value: number; color: string }[];

    return segments.length > 0 ? segments : [{ name: 'No data', value: 1, color: C.empty }];
  }, [pie]);

  const activeSlice = activeIdx !== null ? pieData[activeIdx] : null;

  return (
    <div className="card-forged p-5">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Monthly Budget Snapshot
        </h3>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-center">
        {/* Donut chart — hover shows slice details in center */}
        <div className="relative h-56 flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius="60%"
                outerRadius="82%"
                paddingAngle={2}
                dataKey="value"
                startAngle={90}
                endAngle={-270}
                strokeWidth={0}
                onMouseEnter={(_, index) => setActiveIdx(index)}
                onMouseLeave={() => setActiveIdx(null)}
              >
                {pieData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.color}
                    opacity={activeIdx === null || activeIdx === i ? 1 : 0.45}
                    style={{ cursor: 'default', outline: 'none' }}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>

          {/* Center: shows hovered slice info, or default remaining/shortfall */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-0.5">
            {activeSlice ? (
              <>
                <span className="text-[9px] text-muted-foreground uppercase tracking-wider leading-none text-center px-4">
                  {activeSlice.name}
                </span>
                <span className="text-xl font-display font-bold leading-tight" style={{ color: activeSlice.color }}>
                  {formatCurrency(activeSlice.value, false)}
                </span>
              </>
            ) : availableToDeploy > 0 ? (
              <>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider leading-none">
                  Available
                </span>
                <span className="text-2xl font-display font-bold leading-tight text-success">
                  {formatCurrency(availableToDeploy, false)}
                </span>
                <span className="text-[9px] text-muted-foreground leading-none">to deploy</span>
              </>
            ) : projectedRemaining >= 0 ? (
              <>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider leading-none">
                  At Floor
                </span>
                <span className="text-2xl font-display font-bold leading-tight text-muted-foreground">
                  {formatCurrency(projectedRemaining, false)}
                </span>
                <span className="text-[9px] text-muted-foreground leading-none">reserved</span>
              </>
            ) : (
              <>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider leading-none">
                  Shortfall
                </span>
                <span className="text-2xl font-display font-bold leading-tight text-destructive">
                  {formatCurrency(Math.abs(projectedRemaining), false)}
                </span>
                <span className="text-[9px] text-muted-foreground leading-none">projected</span>
              </>
            )}
          </div>
        </div>

        {/* Breakdown rows */}
        <div className="space-y-0">
          {rows.map((row, i) => {
            const isTotal = row.sign === '=';
            const isSubRow = row.sign === '−' && i > 0 && rows[i - 1].sign === '=';
            const onClick = row.interactive ? onFloorClick : undefined;
            return (
              <div key={row.key}>
                <div
                  className={cn(
                    'flex items-center justify-between py-2 text-xs',
                    isTotal
                      ? 'border-t border-border mt-1 pt-3'
                      : isSubRow
                      ? 'border-b border-border/20 opacity-70'
                      : 'border-b border-border/30',
                    row.note ? 'pb-1' : '',
                  )}
                >
                  <div className="flex items-center gap-2 text-muted-foreground min-w-0">
                    <span className="font-mono text-[10px] font-bold text-muted-foreground/50 w-3 shrink-0 text-center">
                      {row.sign}
                    </span>
                    {onClick ? (
                      <button
                        onClick={onClick}
                        className="text-left underline underline-offset-2 hover:text-foreground transition-colors"
                      >
                        {row.label}
                      </button>
                    ) : (
                      <span className={isTotal ? 'text-foreground font-semibold' : ''}>{row.label}</span>
                    )}
                  </div>
                  <span className={cn('font-display font-bold shrink-0 ml-3', rowValueClass(row))}>
                    {formatCurrency(Math.abs(row.value), false)}
                  </span>
                </div>
                {row.note && (
                  <p className="text-[10px] text-amber-400 pl-5 pb-2">
                    {row.note}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-border/30">
        {[
          { label: 'Spent',           color: C.spent },
          { label: 'Bills & reserves', color: C.expected },
          { label: 'Floor & held',    color: C.floor },
          { label: 'Available',       color: C.surplus },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: l.color }} />
            {l.label}
          </div>
        ))}
      </div>
    </div>
  );
}
