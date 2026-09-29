import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import type { BreachLeverReport, MonthShortfall } from '@/lib/breach-levers';

/**
 * "What would cover this?" — shown only when months ahead end below the cash floor.
 *
 * The answer re-runs the whole forecast once per candidate, so it is computed on the tap and
 * never on render. `compute` is injected: the page builds it from the provider's own inputs,
 * and a test can hand it a report without running the engine.
 *
 * Every figure it prints is a measured re-run (breach-levers.ts). It offers only the user's own
 * savings goals and transfers, never retirement, and never anything that adds card interest.
 */
type Props = {
  shortMonths: MonthShortfall[];
  compute: () => BreachLeverReport;
};

type State = { status: 'idle' } | { status: 'working' } | { status: 'done'; report: BreachLeverReport } | { status: 'failed' };

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export default function ShortfallLevers({ shortMonths, compute }: Props) {
  const [state, setState] = useState<State>({ status: 'idle' });
  if (shortMonths.length === 0) return null;

  const total = shortMonths.reduce((s, m) => s + m.shortfall, 0);
  const one = shortMonths.length === 1;

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
    <div className="card-forged p-3 sm:p-5">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Short months ahead</p>
      <p className="text-sm text-foreground mt-1">
        {shortMonths.length} {one ? 'month' : 'months'} in the next year {one ? 'ends' : 'end'} below your cash floor, {formatCurrency(total, false)} short in total.
      </p>

      {state.status === 'idle' && (
        <button
          type="button"
          onClick={run}
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary"
        >
          What would cover this?
          <ChevronDown size={14} />
        </button>
      )}

      {state.status === 'working' && (
        <p className="mt-3 text-xs text-muted-foreground" role="status">Working it out from your forecast...</p>
      )}

      {state.status === 'failed' && (
        <p className="mt-3 text-xs text-destructive-text" role="alert">That could not be worked out right now. Your forecast above is unchanged.</p>
      )}

      {state.status === 'done' && (
        <div className="mt-3">
          {state.report.levers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              None of your savings goals or transfers would close this gap on its own.
            </p>
          ) : (
            <ol className="space-y-2" aria-label="Moves that would cover the shortfall">
              {state.report.levers.map(l => (
                <li key={`${l.kind}:${l.id}`} className="text-xs">
                  <p className="text-foreground">
                    <span className="font-semibold">
                      {l.kind === 'pause_goal' ? 'Pause saving to' : 'Pause'} {l.name}
                    </span>
                    {' '}({formatCurrency(l.monthlyAmount, false)}/mo) covers {formatCurrency(l.coveredDollars, false)}
                    {l.monthsCleared.length > 0 && <>, and clears {listNames(l.monthsCleared)}</>}.
                  </p>
                  {l.paysRules.length > 0 && (
                    <p className="text-muted-foreground mt-0.5">
                      That account still pays {listNames(l.paysRules)}, so those need another way to be paid.
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="text-[10px] text-muted-foreground/80 mt-3">
            Each figure comes from re-running your forecast without that one item. Retirement contributions are never suggested.
          </p>
        </div>
      )}
    </div>
  );
}
