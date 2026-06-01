import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarDays, CheckCircle2, ArrowRight } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import type { MonthlyDebtBreakdown } from '@/lib/credit-card-engine';

type Props = {
  debtBreakdown: MonthlyDebtBreakdown;
};

export default function DebtRecommendationsWidget({ debtBreakdown }: Props) {
  const navigate = useNavigate();
  const {
    recommendations,
    totalMinimumsDue,
    totalRecommended,
    totalAvailableCash,
    strategyLabel,
    cashWarning,
    interestAvoided,
  } = debtBreakdown;

  const hasRecs = recommendations.length > 0;

  return (
    <div className="card-forged p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Debt — Recommended This Month
          </h3>
          {hasRecs && (
            <span className="text-[9px] px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 font-medium" style={{ borderRadius: 'var(--radius)' }}>
              {strategyLabel}
            </span>
          )}
        </div>
        <button
          onClick={() => navigate('/debt')}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors shrink-0"
        >
          Full details <ArrowRight size={11} />
        </button>
      </div>

      {!hasRecs && (
        <p className="text-xs text-muted-foreground py-4 text-center">No active debt recommendations this month.</p>
      )}

      {hasRecs && (
        <>
          {cashWarning && (
            <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 px-3 py-2 mb-4 text-[10px] text-destructive" style={{ borderRadius: 'var(--radius)' }}>
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>Safe to Pay ({formatCurrency(totalAvailableCash, false)}) is less than minimums due ({formatCurrency(totalMinimumsDue, false)}). Review cash flow.</span>
            </div>
          )}

          {/* Summary tiles */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="p-2 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
              <p className="text-[9px] text-muted-foreground uppercase">Safe to Pay</p>
              <p className="text-xs font-display font-bold text-primary">{formatCurrency(totalAvailableCash, false)}</p>
            </div>
            <div className="p-2 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
              <p className="text-[9px] text-muted-foreground uppercase">Minimums Due</p>
              <p className="text-xs font-display font-bold text-destructive">{formatCurrency(totalMinimumsDue, false)}</p>
            </div>
            <div className="p-2 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
              <p className="text-[9px] text-muted-foreground uppercase">Interest Avoided</p>
              <p className="text-xs font-display font-bold text-success">{formatCurrency(interestAvoided, true)}</p>
            </div>
          </div>

          {/* Per-card rows */}
          <div className="space-y-1.5">
            {recommendations.map(r => (
              <div
                key={r.cardId}
                className="flex items-center justify-between py-2 px-3 border border-border bg-muted/10 flex-wrap gap-1"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: r.color }} />
                  <span className="text-[10px] font-medium">{r.cardName}</span>
                  {r.reason === 'Autopay Full Balance' ? (
                    <span className="text-[9px] text-success bg-success/10 px-1.5 py-0.5 flex items-center gap-1" style={{ borderRadius: 'var(--radius)' }}>
                      <CheckCircle2 size={9} /> autopay
                    </span>
                  ) : r.isMinimumOnly ? (
                    <span className="text-[9px] text-muted-foreground bg-muted/50 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>min</span>
                  ) : (
                    <span className="text-[9px] text-primary bg-primary/10 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>priority</span>
                  )}
                  <span className="text-[9px] text-muted-foreground italic truncate">{r.reason}</span>
                  {r.dueDay && (
                    <span className={cn('text-[9px] text-muted-foreground flex items-center gap-0.5')}>
                      <CalendarDays size={8} /> Due {r.dueDay}th
                    </span>
                  )}
                </div>
                <span className="text-sm font-display font-bold text-primary shrink-0">{formatCurrency(r.payment, false)}</span>
              </div>
            ))}
          </div>

          {/* Total */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/40 text-xs">
            <span className="text-muted-foreground font-medium">Total recommended</span>
            <span className="font-display font-bold text-primary">{formatCurrency(totalRecommended, false)}</span>
          </div>
        </>
      )}
    </div>
  );
}
