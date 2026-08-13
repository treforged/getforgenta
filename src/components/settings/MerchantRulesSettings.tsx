// §1B Stage 7A — merchant memory, editable and reversible, in ONE place.
//
// ⚠️ EDITING HERE EDITS THE DECISIONS THEMSELVES, because that is what a rule is. There is no
// `merchant_rules` table (see `@/lib/merchant-memory` for why that is deliberate rather than a
// shortcut): a rule is the `category_override` the user already recorded, read back by merchant. So
// changing a merchant's category rewrites the override on the charges that carry one, which is the
// only way to change it without creating a second, contradicting record. The copy says so — a user
// pressing a dropdown here is entitled to know it moves their old charges too.
//
// Switching a merchant OFF is the one thing with no such record, so it is a local preference. Stated
// in the UI rather than hidden: it is per device.
import { useState } from 'react';
import { toast } from 'sonner';
import { Tag } from 'lucide-react';
import { CATEGORIES } from '@/lib/types';
import { useMerchantMemory } from '@/hooks/useMerchantMemory';
import { useAllSyncedTransactions, useSyncedTransactionReviews } from '@/hooks/useSupabaseData';
import { normalizeMerchant, merchantLabel } from '@/lib/merchant-memory';

export default function MerchantRulesSettings() {
  const { rules, suppressed, setSuppressed, isLoading } = useMerchantMemory();
  const { data: synced = [] } = useAllSyncedTransactions();
  const { setCategory } = useSyncedTransactionReviews();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const list = Object.values(rules).sort((a, b) => b.decidedCount - a.decidedCount || a.label.localeCompare(b.label));

  /**
   * Re-label every charge of this merchant that already carries a category.
   *
   * ⚠️ ONLY THE ONES THAT CARRY ONE. Charges with no category are left alone here — changing the
   * rule must not become a second, unannounced bulk write over the backlog. The Bank Activity panel
   * is where a bulk apply is offered, with its own confirm and its own undo.
   */
  const relabel = async (key: string, category: string) => {
    setBusyKey(key);
    let done = 0;
    try {
      for (const charge of synced) {
        if (normalizeMerchant(merchantLabel(charge)) !== key) continue;
        // Only charges that already have an answer — see above.
        if (!rules[key]) continue;
        await setCategory.mutateAsync({ syncedTransactionId: charge.id, category });
        done++;
      }
      toast.success(`${done} ${done === 1 ? 'charge' : 'charges'} re-labelled ${category}`);
    } catch {
      if (done > 0) toast.message(`Stopped after ${done} — the rest are unchanged`);
    } finally {
      setBusyKey(null);
    }
  };

  if (isLoading) return null;

  return (
    <div className="card-forged p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Tag size={14} className="text-primary mt-0.5 shrink-0" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Merchant memory</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            When you categorise a bank charge, the app remembers it for that merchant and stops
            asking. Change one here and every charge of that merchant you have already labelled moves
            with it. Switching a merchant off leaves those labels exactly as they are — it only stops
            new charges being labelled automatically, and it applies on this device.
          </p>
        </div>
      </div>

      {list.length === 0 ? (
        // An honest empty state: nothing has been learned yet, and it says how learning happens.
        <p className="text-xs text-muted-foreground pl-6">
          Nothing learned yet. Pick a category for a charge on the Bank Activity tab and this is where
          it will be.
        </p>
      ) : (
        <div className="space-y-2 pl-6">
          {list.map(rule => (
            <div key={rule.key} className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium truncate max-w-[180px]" title={rule.key}>{rule.label}</span>
              <select
                value={rule.category}
                disabled={busyKey === rule.key}
                onChange={e => relabel(rule.key, e.target.value)}
                className="bg-secondary border border-border px-2 py-1 text-[11px] text-foreground disabled:opacity-60"
                style={{ borderRadius: 'var(--radius)' }}
                aria-label={`Category for ${rule.label}`}
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={!suppressed[rule.key]}
                  onChange={e => setSuppressed(rule.key, !e.target.checked)}
                  className="accent-primary"
                />
                remember
              </label>
              <span className="text-[10px] text-muted-foreground">
                from {rule.decidedCount} {rule.decidedCount === 1 ? 'charge' : 'charges'}
                {/* A merchant you have labelled two ways is one where "learn once" is the wrong
                    model — a warehouse run can be Groceries or Shopping. Say so rather than
                    quietly picking the newest and looking confident about it. */}
                {rule.conflictingCount > 0 && ` · ${rule.conflictingCount} labelled differently`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
