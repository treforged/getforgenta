// §1B Stage 7B — "Rent has billed about $2,085 for 7 months, your rule says $1,915. Update it?"
//
// Self-contained on purpose: it reads its own data and writes its own change, so the page it sits on
// gains one line rather than a block of state. The detection and every number in the copy come from
// `@/lib/rule-drift`; nothing is computed here.
//
// ⚠️ ONE TAP UPDATES A RULE, AND A RULE FEEDS EVERY FORECAST SURFACE. That is why the accept button
// states the old and the new amount rather than saying "update", and why dismissing is per-session
// rather than persisted: a dismissal that outlives the session would hide a growing bill for good,
// and the honest failure mode of forgetting a dismissal is that the app asks once more next time.
import { useMemo, useState } from 'react';
import { TrendingUp, X } from 'lucide-react';
import { useAllSyncedTransactions, useRecurringRules } from '@/hooks/useSupabaseData';
import { detectAllRuleDrift, describeDrift, type RuleDrift } from '@/lib/rule-drift';
import { formatCurrency } from '@/lib/calculations';

export default function RuleDriftPanel() {
  const { data: synced = [] } = useAllSyncedTransactions();
  const { data: rules = [], update } = useRecurringRules();
  const [dismissed, setDismissed] = useState<Record<string, true>>({});
  const [applying, setApplying] = useState<string | null>(null);

  const drifts = useMemo(() => detectAllRuleDrift(rules, synced), [rules, synced]);
  const shown = drifts.filter(d => !dismissed[d.ruleId]);

  if (shown.length === 0) return null;

  const accept = async (drift: RuleDrift) => {
    setApplying(drift.ruleId);
    try {
      await update.mutateAsync({ id: drift.ruleId, amount: drift.observedAmount });
      // Dismiss after a successful write: the rule now matches, so the next detection run would
      // find nothing anyway — this only stops the card flickering while the query refetches.
      setDismissed(d => ({ ...d, [drift.ruleId]: true }));
    } finally {
      setApplying(null);
    }
  };

  return (
    <div className="card-forged p-3 space-y-3">
      <div className="flex items-start gap-2">
        <TrendingUp size={13} className="text-primary mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-medium">
            {shown.length === 1 ? 'One bill has' : `${shown.length} bills have`} been costing more than your budget says
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Your bank has billed these amounts for months running. Updating a rule changes what the
            forecast projects from here on; it never edits anything that already happened.
          </p>
        </div>
      </div>

      {shown.map(drift => (
        <div key={drift.ruleId} className="pl-5 space-y-1.5">
          <p className="text-[11px] leading-relaxed">{describeDrift(drift)}</p>
          {/* THE EVIDENCE, NOT JUST THE CONCLUSION. A one-tap change to a number that drives the
              forecast has to show its working, and the months are the working. */}
          <p className="text-[10px] text-muted-foreground">
            {drift.merchantLabel}
            {' · '}
            {drift.months.map(m => `${m.month.slice(5)} ${formatCurrency(m.amount, false)}`).join('  ')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => accept(drift)}
              disabled={applying === drift.ruleId}
              className="bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {applying === drift.ruleId
                ? 'Updating…'
                : `Update ${drift.ruleName} to ${formatCurrency(drift.observedAmount, false)}`}
            </button>
            <button
              onClick={() => setDismissed(d => ({ ...d, [drift.ruleId]: true }))}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X size={11} /> Not now
            </button>
            <span className="text-[10px] text-muted-foreground">
              was {formatCurrency(drift.ruleAmount, false)}
              {' · '}
              {drift.delta > 0 ? '+' : '−'}{formatCurrency(Math.abs(drift.delta), false)}/mo
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
