import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';
import { ArrowUpRight, Wallet } from 'lucide-react';
import { formatCurrency, formatYAxisTick } from '@/lib/calculations';
import { buildNetWorthTrend, monthlyNetWorthChange, type TrendSnapshotRow } from '@/lib/net-worth-trend';

interface NWTooltipProps {
  active?: boolean;
  payload?: { payload: { month: string }; value: number }[];
}

function NWTooltip({ active, payload }: NWTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border px-3 py-2 text-xs" style={{ borderRadius: 'var(--radius)' }}>
      <p className="font-medium">{payload[0].payload.month}</p>
      <p className="text-primary font-semibold">{formatCurrency(payload[0].value, false)}</p>
    </div>
  );
}

export interface NetWorthTrendCardProps {
  snapshots: readonly TrendSnapshotRow[];
  snapshotsLoading: boolean;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  /** Opens the same net-worth breakdown drawer the stat chip opens, when the host has one. */
  onNetWorthClick?: () => void;
}

/**
 * Net worth now, and net worth over time, in one card.
 *
 * This was the top of the Accounts panel until 2026-08-20, when Tre asked for it
 * on the Overview instead: *"move the data and net worth chart from the accounts
 * section to the overview section. it seems redundant and data is to spread
 * out."* The redundancy was real — the Overview's chip row already carried Net
 * Worth and Total Assets, so the same figures were being read on two panels and
 * the HISTORY, which existed on only one of them, was the part you had to go
 * hunting for. Bringing the chart up puts the trend next to the number it is the
 * trend OF, and the four figures here are the four the chip row does not fully
 * cover (Total Liabilities and Monthly Change were Accounts-only).
 *
 * ⚠️ The writer that feeds this chart, `useNetWorthSnapshotRecorder`, moved to
 * `Dashboard.tsx` in the same change and is mounted OUTSIDE the panel switch on
 * purpose. Net-worth recording has already died once by being left behind on a
 * surface nobody visits (2026-05-22). Never make it depend on this card being
 * on screen.
 *
 * Every empty state SAYS what is missing. A flat line at zero and a real zero
 * look the same, and only one of them is honest.
 */
export default function NetWorthTrendCard({
  snapshots,
  snapshotsLoading,
  netWorth,
  totalAssets,
  totalLiabilities,
  onNetWorthClick,
}: NetWorthTrendCardProps) {
  const trend = useMemo(() => buildNetWorthTrend(snapshots, netWorth), [snapshots, netWorth]);
  const monthlyChange = useMemo(() => monthlyNetWorthChange(snapshots), [snapshots]);

  return (
    <div key="net_worth_trend" className="card-forged p-4 sm:p-5 space-y-3 sm:space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 text-center">
        <div
          className={onNetWorthClick ? 'cursor-pointer' : undefined}
          onClick={onNetWorthClick}
          role={onNetWorthClick ? 'button' : undefined}
          tabIndex={onNetWorthClick ? 0 : undefined}
          onKeyDown={onNetWorthClick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNetWorthClick(); } } : undefined}
        >
          <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Net Worth</p>
          <p className={`text-lg sm:text-2xl font-display font-bold mt-0.5 ${netWorth >= 0 ? 'text-primary' : 'text-destructive'}`}>{formatCurrency(netWorth, false)}</p>
        </div>
        <div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total Assets</p>
          <p className="text-lg sm:text-2xl font-display font-bold mt-0.5 text-success">{formatCurrency(totalAssets, false)}</p>
        </div>
        <div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total Liabilities</p>
          <p className="text-lg sm:text-2xl font-display font-bold mt-0.5 text-destructive">{formatCurrency(totalLiabilities, false)}</p>
        </div>
        <div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium flex items-center justify-center gap-1">
            <ArrowUpRight size={9} /> Monthly Change
          </p>
          <p className={`text-lg sm:text-2xl font-display font-bold mt-0.5 ${monthlyChange === null ? 'text-muted-foreground' : monthlyChange >= 0 ? 'text-success' : 'text-destructive'}`}>
            {monthlyChange !== null ? (monthlyChange >= 0 ? '+' : '') + formatCurrency(monthlyChange, false) : '—'}
          </p>
          {monthlyChange === null && <p className="text-[9px] text-muted-foreground">no history yet</p>}
        </div>
      </div>

      <div className="border-t border-border/40" />

      <div>
        <h3 className="text-[9px] sm:text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
          {snapshots.length > 1 ? 'Net Worth History' : 'Current Net Worth'}
        </h3>
        {snapshotsLoading ? (
          <div className="h-[140px] flex items-end gap-2 px-2 pb-4 animate-pulse">
            {[40, 55, 48, 62, 70, 58, 75, 80].map((h, i) => (
              <div key={i} className="flex-1 bg-muted/40 rounded-sm" style={{ height: `${h}%` }} />
            ))}
          </div>
        ) : trend.length <= 1 ? (
          <div className="flex flex-col items-center justify-center h-[140px] text-center">
            <Wallet size={20} className="text-primary mb-2" />
            <p className="text-xs text-muted-foreground max-w-md">
              {snapshots.length > 0
                ? 'First snapshot saved — the trend line fills in over the coming weeks.'
                : 'The trend line appears once monthly snapshots are saved. See Forecast for projected trends.'}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={trend} margin={{ left: 0, right: 8, top: 5, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 15%)" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 9, fill: 'hsl(240, 4%, 46%)' }}
                axisLine={false}
                tickLine={false}
                interval={Math.max(0, Math.ceil(trend.length / 6) - 1)}
                height={18}
              />
              <YAxis
                width={44}
                tick={{ fontSize: 9, fill: 'hsl(240, 4%, 46%)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatYAxisTick}
              />
              <Tooltip content={<NWTooltip />} />
              <Line
                dataKey="value"
                stroke="hsl(43, 56%, 52%)"
                strokeWidth={2}
                dot={{ r: 2.5, fill: 'hsl(43, 56%, 52%)', strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
