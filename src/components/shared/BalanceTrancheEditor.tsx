// The editor for `accounts.balance_tranches` — the sub-balances of a credit card that sit at their
// own rate (a balance transfer at 7.99% until 2028-01-04 riding on a 16.6% card). Until this
// existed the only way to record one was SQL, so a real promo cliff was invisible to everyone
// except the owner. Rendered as FormModal children; all state lives in the parent form.
import { Plus, X } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import DateScrollPicker from './DateScrollPicker';
import {
  newTrancheRow, trancheOverage, DEFAULT_TRANCHE_LABEL, type TrancheFormRow,
} from '@/lib/tranche-form';

type Props = {
  rows: TrancheFormRow[];
  onChange: (rows: TrancheFormRow[]) => void;
  /** The account balance as typed in the form — the tranches are parts of it. */
  accountBalance: string;
};

export default function BalanceTrancheEditor({ rows, onChange, accountBalance }: Props) {
  const overage = trancheOverage(rows, accountBalance);

  const patch = (id: string, field: keyof TrancheFormRow, value: string) =>
    onChange(rows.map(r => (r.id === id ? { ...r, [field]: value } : r)));

  return (
    <div data-testid="balance-tranche-editor">
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Rate Tiers (optional)</label>
      <p className="text-[10px] text-muted-foreground mt-0.5">
        Parts of the balance at their own rate — a balance transfer or a promo. The APR above is the
        standard rate each tier returns to when its promo ends. Leave empty for a single-rate card.
      </p>

      <div className="space-y-2 mt-2">
        {rows.map((row, i) => (
          <div key={row.id} className="border border-border/40 p-2" style={{ borderRadius: 'var(--radius)' }}>
            <div className="flex items-start justify-between gap-1 mb-1.5">
              <span className="text-xs font-semibold text-foreground">Tier {i + 1}</span>
              <button
                type="button"
                onClick={() => onChange(rows.filter(r => r.id !== row.id))}
                className="text-muted-foreground hover:text-destructive shrink-0 p-1.5 -mr-1.5"
                title="Remove tier"
                aria-label={`Remove tier ${i + 1}`}
              >
                <X size={14} />
              </button>
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-[9px] text-muted-foreground uppercase">Label</label>
                <input
                  type="text"
                  value={row.label}
                  onChange={e => patch(row.id, 'label', e.target.value)}
                  className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                  placeholder={DEFAULT_TRANCHE_LABEL}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] text-muted-foreground uppercase">Balance</label>
                  <input
                    type="number"
                    step="0.01"
                    value={row.balance}
                    onChange={e => patch(row.id, 'balance', e.target.value)}
                    className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold"
                    style={{ borderRadius: 'var(--radius)' }}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-muted-foreground uppercase">APR %</label>
                  <input
                    type="number"
                    step="0.01"
                    value={row.apr}
                    onChange={e => patch(row.id, 'apr', e.target.value)}
                    className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold"
                    style={{ borderRadius: 'var(--radius)' }}
                    placeholder="0"
                  />
                </div>
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase">Promo Ends (optional)</label>
                {!row.promo_end_date ? (
                  <div className="mt-1">
                    <button
                      type="button"
                      onClick={() => patch(row.id, 'promo_end_date', new Date().toISOString().split('T')[0])}
                      className="text-xs text-primary hover:text-primary/80 py-1"
                    >
                      + Set date
                    </button>
                  </div>
                ) : (
                  <div className="mt-1 space-y-1">
                    <DateScrollPicker value={row.promo_end_date} onChange={v => patch(row.id, 'promo_end_date', v)} />
                    <button
                      type="button"
                      onClick={() => patch(row.id, 'promo_end_date', '')}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Clear — rate never expires
                    </button>
                  </div>
                )}
              </div>
              {/* Paired with the expiry above on purpose: an instalment only exists while the promo
                  is live (trancheMinimumAsOf), and a 0% plan sized to retire exactly at its end
                  date is the case this field exists for. Without it the allocator sends nothing to
                  a 0% tranche and the model invents a reprice cliff — see BalanceTranche.min_payment. */}
              <div>
                <label className="text-[9px] text-muted-foreground uppercase">Monthly Instalment (optional)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.min_payment}
                  onChange={e => patch(row.id, 'min_payment', e.target.value)}
                  placeholder="e.g. 49.89"
                  className="w-full mt-1 px-2 py-1.5 bg-background border border-border rounded text-xs"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  For a fixed plan (Chase Equal Pay, Citi Flex). Leave blank for an ordinary promo rate.
                </p>
              </div>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() => onChange([...rows, newTrancheRow()])}
          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          <Plus size={13} /> Add Rate Tier
        </button>

        {/* Soft, never blocking: tranches summing past the balance is wrong but recoverable, and the
            engine already clamps it. Saying nothing would let a stale tier quietly distort the split.
            `text-gold` rather than `text-warning` — no `--color-warning` token is defined in
            index.css, so `text-warning` generates no rule and renders as ordinary body text. */}
        {overage && (
          <p className="text-[10px] text-gold mt-1" role="status" data-testid="tranche-overage-note">
            Tiers total {formatCurrency(overage.total)}, more than this card's {formatCurrency(overage.balance)} balance.
            Tiers are parts of the balance — the excess is ignored, so check the amounts.
          </p>
        )}
      </div>
    </div>
  );
}
