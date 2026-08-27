import { Car, ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { formatCurrency } from '@/lib/calculations';
import type { BuildCarSummary } from '@/lib/build-loan-link';

/**
 * "The car itself" — the loan or saving plan the build is connected to, shown above the build's
 * own totals.
 *
 * The Build page has always answered "what are the modifications costing me"; the Vehicles page
 * has always answered "what does the car itself cost me". Until `car_builds.car_fund_id` existed
 * nothing put those two on the same screen, which is what Tre asked for on 2026-08-20.
 *
 * Presentational only. Every figure arrives already resolved by `summarizeBuildCarFund`, which
 * reads the same `vehicle-loan-engine` the Vehicles page and the forecast read — this component
 * must never compute a payment, a balance or a payoff date of its own, or the two pages start
 * disagreeing (the §2.5 bug class).
 */

/** `Aug 2030` — the month-and-year convention the Vehicles page already uses for loan dates. */
function monthYear(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'primary' }) {
  return (
    <div>
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.15em] mb-0.5">
        {label}
      </div>
      <div
        className="font-mono text-sm text-foreground"
        style={tone === 'primary' ? { color: 'hsl(var(--primary))' } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

export default function BuildCarStrip({ summary }: { summary: BuildCarSummary }) {
  return (
    <div className="card-forged p-4 sm:p-5 mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Car size={14} className="text-primary shrink-0" />
          <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-[0.15em]">
            The car
          </span>
          <span className="text-xs font-medium text-foreground truncate">{summary.vehicleName}</span>
        </div>
        {/* The plan is EDITED on /debt's Auto Loans tab, not here (it moved off the Garage on
            2026-08-27). This page connects to it and reads it. */}
        <Link
          to="/debt?tab=auto"
          className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors shrink-0"
        >
          Plan <ArrowRight size={11} />
        </Link>
      </div>

      {summary.kind === 'loan' && (
        <div className="grid grid-cols-3 gap-4">
          <Figure label="Still owed" value={formatCurrency(summary.remainingBalance, false)} tone="primary" />
          <Figure label="Monthly" value={formatCurrency(summary.payment, false)} />
          <Figure label="Paid off" value={monthYear(summary.payoffDate)} />
        </div>
      )}

      {summary.kind === 'saving' && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <Figure label="Saved" value={formatCurrency(summary.saved, false)} tone="primary" />
            <Figure label="Down payment" value={formatCurrency(summary.downPaymentGoal, false)} />
            <Figure
              label="Buying"
              value={summary.plannedPurchaseDate ? monthYear(summary.plannedPurchaseDate) : 'No date set'}
            />
          </div>
          <div className="h-[3px] bg-border rounded-full overflow-hidden mt-3">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${summary.pct}%`, background: 'linear-gradient(90deg, #7a1f1f, #c8a84b)' }}
            />
          </div>
          <p className="text-[11px] font-mono text-muted-foreground mt-2">
            {Math.round(summary.pct)}% of the down payment · {formatCurrency(summary.estimatedLoan, false)} loan expected
          </p>
        </>
      )}

      {/* ⚠️ The two states below deliberately print NO figures. A loan-phase plan with no active
          payment has no balance and no payoff date to quote, and rendering `$0 · —` would read as
          a paid-off car in one case and a broken page in the other. */}
      {summary.kind === 'loan_pending' && (
        <p className="text-xs text-muted-foreground">
          {summary.paymentStartDate
            ? `Payments start ${monthYear(summary.paymentStartDate)}. Nothing is due yet.`
            : 'This loan has no start date yet — finish setting it up on the Vehicles page.'}
        </p>
      )}

      {summary.kind === 'loan_paid' && (
        <p className="text-xs" style={{ color: 'hsl(var(--success))' }}>
          Paid off — the car is yours.
        </p>
      )}
    </div>
  );
}
