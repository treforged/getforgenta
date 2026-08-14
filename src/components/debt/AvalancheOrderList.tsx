import { formatCurrency } from '@/lib/calculations';
import type { DebtPayoffOrderEntry } from '@/lib/debt-payoff-order';

/**
 * The payoff order as a numbered build list — #1, #2, #3 in the order the engine actually attacks
 * the cards. `entries` come from `getStrategyPayoffOrder`, which mirrors generateRecommendations'
 * own sort; this component never re-sorts, because for a card carrying a promo tranche the
 * MARGINAL rate ranks it and a flat-APR sort prints a different order than the plan pays
 * (88d8ac6d). Visual shape is copied from the Other Debts tab's list (DebtPayoff.tsx) so the two
 * numbered lists on this page read as one thing.
 */

type Props = {
  entries: DebtPayoffOrderEntry[];
  strategy: 'avalanche' | 'snowball';
};

const STRATEGY_COPY = {
  avalanche: 'Highest effective rate first — minimizes total interest',
  snowball: 'Smallest balance first — fastest first win',
} as const;

export default function AvalancheOrderList({ entries, strategy }: Props) {
  if (entries.length === 0) return null;

  return (
    <div className="card-forged p-3 sm:p-4 space-y-3">
      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {strategy === 'avalanche' ? 'Avalanche order' : 'Snowball order'}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">{STRATEGY_COPY[strategy]}</p>
      </div>
      <div className="space-y-1">
        {entries.map((entry, i) => (
          <div key={entry.cardId} className="flex items-center justify-between gap-2 py-1.5 border-b border-border last:border-0">
            <div className="min-w-0">
              <span className="text-xs">
                <span className="text-primary font-semibold mr-1.5">#{i + 1}</span>
                {entry.cardName}
              </span>
              <p className="text-[9px] text-muted-foreground ml-4">
                {entry.apr}% APR
                {entry.marginalApr !== entry.apr && ` · attacking ${entry.marginalApr}% tranche`}
              </p>
            </div>
            <p className="text-xs font-medium shrink-0">{formatCurrency(entry.balance, false)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
