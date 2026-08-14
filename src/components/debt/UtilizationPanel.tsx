import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import type { CardData } from '@/lib/credit-card-engine';
import {
  summarizeUtilization, rankByUtilizationImpact, previewCardPaymentImpact,
} from '@/lib/credit-utilization';

type Props = {
  cards: CardData[];
  /** Card ids sorted highest-APR-first — the same order the avalanche strategy pays in
   * (credit-card-engine.ts generateRecommendations), shown here read-only for comparison. */
  avalancheOrder: string[];
};

/**
 * Utilization is a second goal alongside interest cost: the avalanche order minimizes
 * interest, this ranks cards by fastest score impact per dollar. Read-only — it never
 * changes what generateRecommendations actually pays; the user picks which order to
 * follow themselves.
 */
export default function UtilizationPanel({ cards, avalancheOrder }: Props) {
  const now = useMemo(() => new Date(), []);
  const [previewAmount, setPreviewAmount] = useState(100);

  const summary = useMemo(() => summarizeUtilization(cards, now), [cards, now]);
  const ranked = useMemo(() => rankByUtilizationImpact(cards, now), [cards, now]);

  if (cards.length === 0) return null;

  return (
    <div className="card-forged p-3 sm:p-4 space-y-3 sm:space-y-4">
      <span className="text-[10px] sm:text-[11px] text-muted-foreground uppercase font-medium tracking-wider">
        Utilization — a second goal alongside interest
      </span>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Overall Utilization</p>
          <p className="text-base sm:text-lg font-display font-bold mt-0.5">
            {summary.utilizationPct != null ? `${summary.utilizationPct.toFixed(1)}%` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Interest-Bearing</p>
          <p className="text-base sm:text-lg font-display font-bold mt-0.5 text-destructive">
            {formatCurrency(summary.interestBearingBalance, false)}
          </p>
        </div>
        <div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Utilization-Only (0%)</p>
          <p className="text-base sm:text-lg font-display font-bold mt-0.5 text-primary">
            {formatCurrency(summary.utilizationOnlyBalance, false)}
          </p>
        </div>
        <div>
          <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Open Limit</p>
          <p className="text-base sm:text-lg font-display font-bold mt-0.5">{formatCurrency(summary.totalLimit, false)}</p>
        </div>
      </div>

      {summary.utilizationOnlyBalance > 0 && (
        <p className="text-[10px] sm:text-[11px] text-muted-foreground">
          {formatCurrency(summary.utilizationOnlyBalance, false)} of the balance above is on 0%-interest
          installment plans — paying it down lowers utilization (and your score) but saves no interest.
          Paying down interest-bearing balance does both.
        </p>
      )}

      {summary.futureCards.length > 0 && (
        <div className="flex items-start gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground">
          <AlertTriangle size={12} className="shrink-0 mt-0.5 text-primary" />
          <span>
            Not counted in the utilization above yet:{' '}
            {summary.futureCards.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ', '}
                {c.name} ({formatCurrency(c.creditLimit, false)} limit, opens in {c.opensInMonths} mo)
              </span>
            ))}
          </span>
        </div>
      )}

      {ranked.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-[10px] sm:text-[11px] text-muted-foreground uppercase font-medium tracking-wider">
              Pay-down order for score (lowest utilization per dollar)
            </p>
            <label className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground">
              Preview payment
              <input
                type="number" min={0} step={25} value={previewAmount}
                onChange={e => setPreviewAmount(Math.max(0, Number(e.target.value) || 0))}
                className="w-16 border border-border bg-background px-1.5 py-0.5 text-[10px] sm:text-[11px]"
                style={{ borderRadius: 'var(--radius)' }}
              />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] sm:text-[11px]">
              <thead>
                <tr className="text-muted-foreground uppercase tracking-wider text-left">
                  <th className="py-1 pr-2 font-medium">Score order</th>
                  <th className="py-1 pr-2 font-medium">Card</th>
                  <th className="py-1 pr-2 font-medium text-right">Utilization</th>
                  <th className="py-1 pr-2 font-medium text-right">Interest order</th>
                  <th className="py-1 pr-2 font-medium text-right">{formatCurrency(previewAmount, false)} pays down</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((row, i) => {
                  const avalanchePos = avalancheOrder.indexOf(row.id);
                  const card = cards.find(c => c.id === row.id);
                  const preview = card ? previewCardPaymentImpact(card, previewAmount, now) : null;
                  return (
                    <tr key={row.id} className="border-t border-border/50">
                      <td className="py-1 pr-2">#{i + 1}</td>
                      <td className="py-1 pr-2">{row.name}</td>
                      <td className="py-1 pr-2 text-right">
                        {row.utilizationPct != null ? `${row.utilizationPct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="py-1 pr-2 text-right text-muted-foreground">
                        {avalanchePos >= 0 ? `#${avalanchePos + 1}` : '—'}
                      </td>
                      <td className="py-1 pr-2 text-right">
                        {preview?.deltaPoints != null ? `-${preview.deltaPoints.toFixed(1)}pt` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
