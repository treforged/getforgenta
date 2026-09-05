import { formatCurrency } from '@/lib/calculations';
import type { DebtPayoffOrderEntry } from '@/lib/debt-payoff-order';
import { useState, type KeyboardEvent } from 'react';

/**
 * The payoff order as a numbered build list — #1, #2, #3 in the order the engine actually attacks
 * the cards. `entries` come from `getStrategyPayoffOrder`, which mirrors generateRecommendations'
 * own sort; this component never re-sorts, because for a card carrying a promo tranche the
 * MARGINAL rate ranks it and a flat-APR sort prints a different order than the plan pays
 * (88d8ac6d). Visual shape is copied from the Other Debts tab's list (DebtPayoff.tsx) so the two
 * numbered lists on this page read as one thing.
 * 
 * Cards with unknown APRs are listed separately because the avalanche strategy ranks on rate,
 * and we do not have a rate for those cards yet.
 */

type Props = {
  entries: DebtPayoffOrderEntry[];
  strategy: 'avalanche' | 'snowball';
  unrated: DebtPayoffOrderEntry[];
  onSetApr: (cardId: string, apr: number) => void;
};

const STRATEGY_COPY = {
  avalanche: 'Highest effective rate first — minimizes total interest',
  snowball: 'Smallest balance first — fastest first win',
} as const;

export default function AvalancheOrderList({ entries, strategy, unrated, onSetApr }: Props) {
  // Hooks first: an early return above useState is a rules-of-hooks violation, and this component
  // does return null when there is nothing to list.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  /** A rate is only accepted when it is a real number in [0, 100]. Anything else saves nothing —
   * the whole point of this row is that no rate beats a wrong rate. */
  const draftApr = (cardId: string): number | null => {
    const parsed = Number.parseFloat(drafts[cardId] ?? '');
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
  };

  const handleSave = (cardId: string) => {
    const parsed = draftApr(cardId);
    if (parsed !== null) onSetApr(cardId, parsed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, cardId: string) => {
    if (e.key === 'Enter') {
      handleSave(cardId);
    }
  };

  if (entries.length === 0 && unrated.length === 0) return null;

  return (
    <div className="card-forged p-3 sm:p-4 space-y-3">
      {entries.length > 0 && (
        <>
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
        </>
      )}

      {unrated.length > 0 && (
        <>
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Needs your rate
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              We do not know these rates, so they are not ranked. Their minimum is still paid.
            </p>
          </div>
          <div className="space-y-1">
            {unrated.map((entry) => (
              <div key={entry.cardId} className="flex items-center justify-between gap-2 py-1.5 border-b border-border last:border-0">
                <div className="min-w-0">
                  <span className="text-xs">{entry.cardName}</span>
                  <p className="text-xs font-medium">{formatCurrency(entry.balance, false)}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="APR %"
                    aria-label={`APR for ${entry.cardName}`}
                    value={drafts[entry.cardId] ?? ''}
                    onChange={(e) => setDrafts(prev => ({ ...prev, [entry.cardId]: e.target.value }))}
                    onKeyDown={(e) => handleKeyDown(e, entry.cardId)}
                    className="w-20 rounded border border-border bg-background px-1.5 py-1 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => handleSave(entry.cardId)}
                    disabled={draftApr(entry.cardId) === null}
                    className="btn btn-sm btn-primary"
                  >
                    Save
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
