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
import { Tag, RotateCcw } from 'lucide-react';
import { CATEGORIES, type Category } from '@/lib/types';
import { useMerchantMemory } from '@/hooks/useMerchantMemory';
import { useAllSyncedTransactions, useSyncedTransactionReviews } from '@/hooks/useSupabaseData';
import { planMerchantRelabel, type MerchantRelabel } from '@/lib/merchant-memory';

/** A re-label that actually landed, kept whole so it reverses as one act. */
interface AppliedRelabel {
  label: string;
  category: Category;
  writes: MerchantRelabel[];
}

export default function MerchantRulesSettings() {
  const { rules, reviewsByCharge, suppressed, setSuppressed, isLoading } = useMerchantMemory();
  const { data: synced = [] } = useAllSyncedTransactions();
  const { setCategory } = useSyncedTransactionReviews();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [applied, setApplied] = useState<AppliedRelabel | null>(null);

  const list = Object.values(rules).sort((a, b) => b.decidedCount - a.decidedCount || a.label.localeCompare(b.label));

  /**
   * Re-label every charge of this merchant that already carries a category.
   *
   * ⚠️ ONLY THE ONES THAT CARRY ONE, and the decision about WHICH ones is `planMerchantRelabel`'s,
   * not this component's — the guard that used to live here compared the RULE and so skipped
   * nothing, turning one dropdown change into a silent bulk write over the un-categorised backlog.
   * That backlog has its own panel on Bank Activity, with its own confirm and its own undo.
   *
   * What the plan returns is each charge's PREVIOUS category, so this edit is reversible too: the
   * user is changing their own past answers, and one of them being wrong must cost one press.
   */
  const relabel = async (key: string, label: string, category: Category) => {
    const plan = planMerchantRelabel(synced, reviewsByCharge, key, category);
    if (plan.length === 0) {
      toast.message(`${label} is already ${category} on every charge you have labelled`);
      return;
    }
    setBusyKey(key);
    const done: MerchantRelabel[] = [];
    try {
      for (const write of plan) {
        await setCategory.mutateAsync({ syncedTransactionId: write.chargeId, category });
        // Recorded as it goes, so the undo only offers to reverse what actually landed.
        done.push(write);
      }
      toast.success(`${done.length} ${done.length === 1 ? 'charge' : 'charges'} re-labelled ${category}`);
    } catch {
      if (done.length > 0) toast.message(`Stopped after ${done.length} — the rest are unchanged`);
    } finally {
      setApplied(done.length > 0 ? { label, category, writes: done } : null);
      setBusyKey(null);
    }
  };

  const undoRelabel = async () => {
    if (!applied) return;
    setBusyKey(applied.label);
    let undone = 0;
    try {
      // Reversed, so a stopped undo unwinds the most recent write first.
      for (const write of [...applied.writes].reverse()) {
        await setCategory.mutateAsync({ syncedTransactionId: write.chargeId, category: write.previousCategory });
        undone++;
      }
      toast.success(`Undone — ${undone} ${undone === 1 ? 'charge is' : 'charges are'} back as they were`);
    } catch {
      toast.message(`Undid ${undone} of ${applied.writes.length} — the rest are unchanged`);
    } finally {
      setApplied(null);
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
            with it — charges with no category yet are left alone, and undo puts a change back.
            Switching a merchant off leaves those labels exactly as they are — it only stops new
            charges being labelled automatically, and it applies on this device.
          </p>
        </div>
      </div>

      {/* The undo stays on screen after a change, because immediately after a write across months of
          history "put it back" is the only thing the user might want. */}
      {applied && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <p className="text-[11px] text-muted-foreground">
            {applied.writes.length} {applied.writes.length === 1 ? 'charge' : 'charges'} of{' '}
            <span className="text-foreground font-medium">{applied.label}</span> re-labelled {applied.category}.
          </p>
          <button
            onClick={undoRelabel}
            disabled={busyKey !== null}
            className="flex items-center gap-1.5 bg-secondary border border-border px-2.5 py-1 text-[11px] font-medium hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-60"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <RotateCcw size={11} /> Undo
          </button>
        </div>
      )}

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
                onChange={e => relabel(rule.key, rule.label, e.target.value as Category)}
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
