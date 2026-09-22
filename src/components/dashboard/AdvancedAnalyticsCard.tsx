import { ResponsiveContainer, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { Percent, TrendingUp, Shield, Wallet } from 'lucide-react';
import MetricCard from '@/components/shared/MetricCard';
import PremiumGate from '@/components/shared/PremiumGate';
import { formatCurrency } from '@/lib/calculations';
import { useMonthlyCashFlow } from '@/hooks/useMonthlyCashFlow';
import { useSubscription } from '@/hooks/useSubscription';
import { useDemo } from '@/contexts/DemoContext';

const BREAKDOWN_COLORS = [
  'hsl(43, 56%, 52%)', 'hsl(142, 50%, 42%)', 'hsl(200, 65%, 52%)',
  'hsl(280, 55%, 58%)', 'hsl(30, 80%, 52%)', 'hsl(170, 60%, 42%)',
  'hsl(320, 55%, 52%)', 'hsl(60, 65%, 44%)', 'hsl(240, 55%, 62%)',
  'hsl(15, 75%, 52%)', 'hsl(100, 45%, 44%)', 'hsl(0, 65%, 52%)',
];

interface BreakdownTooltipProps {
  active?: boolean;
  payload?: { payload: { name: string }; value: number }[];
}

function BreakdownTooltip({ active, payload }: BreakdownTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border px-3 py-2 text-xs" style={{ borderRadius: 'var(--radius)' }}>
      <p className="font-medium">{payload[0].payload.name}</p>
      <p className="text-primary font-semibold">{formatCurrency(payload[0].value, false)}</p>
    </div>
  );
}

/**
 * ADVANCED ANALYTICS - debt-to-income, projected annual savings, emergency runway, average spend,
 * and the asset and liability breakdowns.
 *
 * ⚠️ ITS ONLY HOME SINCE 2026-09-22 IS THE ANALYTICS SECTION OF /account. It was the Overview
 * dashboard's `advanced_analytics` widget - the largest card on that page, 1,028px of 5,674 at
 * 390x844 - until Tre approved moving it (ask 035ffb29, "8. approved."), the same move he made
 * for Learn and Achievements on 2026-09-17. The markup and the premium gate are the dashboard's,
 * unchanged, and every figure comes from `useMonthlyCashFlow`, which is the derivation the
 * dashboard itself reads. So the move changes WHERE it is, never WHAT it says.
 */
export default function AdvancedAnalyticsCard() {
  const { isPremium } = useSubscription();
  const { isDemo } = useDemo();
  const { dti, summary, emergencyRunwayMonths, avgMonthlySpend, netWorthBreakdown } = useMonthlyCashFlow();
  const allAssetsForBreakdown = netWorthBreakdown.assets;
  const allLiabilitiesForBreakdown = netWorthBreakdown.liabilities;

  return (
    <PremiumGate
      isPremium={isPremium || isDemo}
      title="Advanced Analytics"
      features={[
        'Emergency runway — months your liquid cash covers at current burn rate',
        'Projected annual savings based on your live cash flow',
        'Average monthly spend trend from the last 5 months',
      ]}
    >
      <div className="card-forged p-5 space-y-6" data-testid="advanced-analytics">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Advanced Analytics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Debt-to-Income" value={dti !== null ? `${dti.toFixed(1)}%` : '—'} sub={dti === null ? 'no debt data' : dti < 28 ? 'healthy' : dti < 43 ? 'caution' : 'high risk'} accent={dti === null ? 'silver' : dti < 28 ? 'success' : dti < 43 ? 'gold' : 'crimson'} icon={Percent} />
          <MetricCard label="Annual Savings" value={formatCurrency(summary.cashFlow * 12, false)} sub="projected" accent={summary.cashFlow >= 0 ? 'success' : 'crimson'} icon={TrendingUp} />
          <MetricCard label="Emergency Runway" value={emergencyRunwayMonths !== null ? `${emergencyRunwayMonths.toFixed(1)} mo` : '—'} sub="above floor / monthly burn" accent={emergencyRunwayMonths === null ? 'silver' : emergencyRunwayMonths >= 3 ? 'success' : emergencyRunwayMonths >= 1 ? 'gold' : 'crimson'} icon={Shield} />
          <MetricCard label="Avg Monthly Spend" value={avgMonthlySpend > 0 ? formatCurrency(avgMonthlySpend, false) : '—'} sub="5-month avg" accent="silver" icon={Wallet} />
        </div>
        <div className="grid lg:grid-cols-2 gap-5 pt-2 border-t border-border/40">
          {/* Assets Breakdown */}
          <div className="min-w-0 overflow-hidden">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Assets Breakdown</h4>
            <div className="flex flex-col sm:flex-row gap-4">
              {allAssetsForBreakdown.length > 0 && (
                <div className="flex justify-center sm:block shrink-0">
                  <ResponsiveContainer width={140} height={140}>
                    <PieChart>
                      <Pie data={allAssetsForBreakdown.map(a => ({ name: a.name, value: Number(a.value) }))} cx="50%" cy="50%" innerRadius={36} outerRadius={62} dataKey="value" strokeWidth={0}>
                        {allAssetsForBreakdown.map((_, i) => <Cell key={i} fill={BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<BreakdownTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="flex-1 min-w-0 space-y-1">
                {allAssetsForBreakdown.map((a, idx) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 py-1 text-xs min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: BREAKDOWN_COLORS[idx % BREAKDOWN_COLORS.length] }} />
                      <span className="font-medium truncate">{a.name}</span>
                    </div>
                    <span className="font-bold font-display text-success whitespace-nowrap shrink-0">{formatCurrency(Number(a.value), false)}</span>
                  </div>
                ))}
                {allAssetsForBreakdown.length === 0 && <p className="text-xs text-muted-foreground">No assets yet.</p>}
              </div>
            </div>
          </div>
          {/* Liabilities Breakdown */}
          <div className="min-w-0 overflow-hidden">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Liabilities Breakdown</h4>
            <div className="flex flex-col sm:flex-row gap-4">
              {allLiabilitiesForBreakdown.length > 0 && (
                <div className="flex justify-center sm:block shrink-0">
                  <ResponsiveContainer width={140} height={140}>
                    <PieChart>
                      <Pie data={allLiabilitiesForBreakdown.map(l => ({ name: l.name, value: Number(l.balance) }))} cx="50%" cy="50%" innerRadius={36} outerRadius={62} dataKey="value" strokeWidth={0}>
                        {allLiabilitiesForBreakdown.map((_, i) => <Cell key={i} fill={BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<BreakdownTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="flex-1 min-w-0 space-y-1">
                {allLiabilitiesForBreakdown.map((l, idx) => (
                  <div key={l.id} className="flex items-center justify-between gap-2 py-1 text-xs min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: BREAKDOWN_COLORS[idx % BREAKDOWN_COLORS.length] }} />
                      <span className="font-medium truncate">{l.name}</span>
                    </div>
                    <span className="font-bold font-display text-destructive-text whitespace-nowrap shrink-0">{formatCurrency(Number(l.balance), false)}</span>
                  </div>
                ))}
                {allLiabilitiesForBreakdown.length === 0 && <p className="text-xs text-muted-foreground">No liabilities yet.</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PremiumGate>
  );
}
