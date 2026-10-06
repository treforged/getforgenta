import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import type { PayMoreReport } from '@/lib/pay-more-payoff';

/**
 * "Pay $X more, done by <date>" - the Debt Simple line (docs/simple-view/PROPOSAL.md, ask e1b0fffc).
 *
 * Each option is a full re-run of the forecast with $X more coming in every month from next month,
 * so it is computed on the tap and never on render (the ShortfallLevers pattern). `compute` is
 * injected: the page builds it from the provider's own inputs, and a test can hand it a report.
 *
 * Every date it prints is the engine's own debt-free month for that run. It never invents a rate or
 * a payment: the extra simply joins the cash the engine already sends to the cards.
 */
type Props = { compute: () => PayMoreReport };

type State = { status: 'idle' } | { status: 'working' } | { status: 'done'; report: PayMoreReport } | { status: 'failed' };

export default function PayMoreCard({ compute }: Props) {
  const [state, setState] = useState<State>({ status: 'idle' });

  const run = () => {
    setState({ status: 'working' });
    // Yield one frame so "Working it out" paints before the synchronous re-runs start.
    setTimeout(() => {
      try {
        setState({ status: 'done', report: compute() });
      } catch {
        setState({ status: 'failed' });
      }
    }, 0);
  };

  return (
    <div className="card-forged p-4 sm:p-5" data-testid="pay-more-card">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Finish sooner</p>
      <p className="text-sm text-foreground mt-1">What if you put a little more toward your cards each month?</p>

      {state.status === 'idle' && (
        <button type="button" onClick={run} data-testid="pay-more-run"
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary btn-press">
          Show me <ChevronDown size={12} />
        </button>
      )}
      {state.status === 'working' && <p className="mt-3 text-xs text-muted-foreground">Working it out…</p>}
      {state.status === 'failed' && <p className="mt-3 text-xs text-destructive-text">Could not work that out. Try again later.</p>}
      {state.status === 'done' && (
        state.report.options.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground" data-testid="pay-more-none">
            {state.report.basePayoff
              ? 'Up to $500 more a month would not change your debt-free month.'
              : 'Even $500 more a month would not pay your cards off within the forecast.'}
          </p>
        ) : (
          <>
          {state.report.basePayoff === undefined && (
            <p className="mt-3 text-xs text-muted-foreground">Today your cards are not paid off within the forecast. With a little more:</p>
          )}
          <ul className="mt-3 space-y-1.5" data-testid="pay-more-options">
            {state.report.options.map(o => (
              <li key={o.extraMonthly} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0">{formatCurrency(o.extraMonthly)} more a month</span>
                <span className="shrink-0 text-right">
                  <span className="font-semibold">Debt-free {o.payoffMonth}</span>
                  {o.monthsSooner !== null && (
                    <span className="ml-1.5 text-xs text-success-text">{o.monthsSooner} {o.monthsSooner === 1 ? 'month' : 'months'} sooner</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          </>
        )
      )}
    </div>
  );
}
