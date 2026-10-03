import {
  Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Line, CartesianGrid, ComposedChart,
} from 'recharts';
import { formatCurrency, formatYAxisTick } from '@/lib/calculations';
import { useMonthlyCashFlow } from '@/hooks/useMonthlyCashFlow';
import { AXIS_TICK_FILL, AXIS_TEXT_CLASS } from '@/lib/chart-axis';

interface ChartTooltipProps {
  active?: boolean;
  payload?: { dataKey: string | number; name: string; value: number; color: string }[];
  label?: string;
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border px-3 py-2 text-xs" style={{ borderRadius: 'var(--radius)' }}>
      <p className="font-medium text-foreground mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{p.name}</span>
          <span className="font-semibold" style={{ color: p.color }}>{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * CASH FLOW OVERVIEW - six months of income against expenses, with the net line.
 *
 * ⚠️ ITS ONLY HOME SINCE 2026-09-22 IS /forecast. It was the Overview dashboard's
 * `cash_flow_chart` widget until Tre approved the move (ask 035ffb29, "8. approved."): the
 * recommendation was to put it "where the rest of the time series lives". The markup is the
 * dashboard's, unchanged, and the figures come from `useMonthlyCashFlow` - the same derivation
 * the dashboard reads - so this card cannot print a different month than the dashboard does.
 */
export default function CashFlowOverviewCard() {
  const { cashFlowData } = useMonthlyCashFlow();

  return (
    <div className="card-forged p-4 sm:p-5" data-testid="cash-flow-overview">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-5">Cash Flow Overview</h3>
      {cashFlowData.some(d => d.income > 0 || d.expenses > 0) ? (
        <ResponsiveContainer className={AXIS_TEXT_CLASS} width="100%" height={260}>
          <ComposedChart data={cashFlowData} margin={{ left: 0, right: 0, top: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 15%)" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: AXIS_TICK_FILL, textAnchor: 'end' }} angle={-45} height={50} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: AXIS_TICK_FILL }} axisLine={false} tickLine={false} tickFormatter={formatYAxisTick} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="income" name="Income" fill="hsl(142, 50%, 40%)" radius={[2, 2, 0, 0]} barSize={20} />
            <Bar dataKey="expenses" name="Expenses" fill="hsl(0, 73%, 35%)" radius={[2, 2, 0, 0]} barSize={20} />
            <Line dataKey="net" name="Net Cash Flow" stroke="hsl(43, 56%, 52%)" strokeWidth={2} dot={{ r: 4, fill: 'hsl(43, 56%, 52%)' }} />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-8">No transaction data yet. Add transactions or set up recurring rules in Budget Control.</p>
      )}
    </div>
  );
}
