// "Clear all merchant memory" — the Danger Zone half of Tre's 2026-09-13 request.
//
// HIS WORDS: "I want to hide the merchant memory... We could just have a section that says how many
// are linked and then give them the option to clear it. So that should be part of a danger zone in
// that section. Just give them the option to delete all saved data, and they can restart from
// scratch if they want to."
//
// ⚠️ THIS DELETES THE USER'S OWN LABELS, NOT A CACHE, and every line of copy below exists because
// of that. There is no `merchant_rules` table — verified against the database, no table matching
// %merchant% or %memory% exists — so a rule IS the `category_override` they recorded. On Tre's
// account that is 516 category decisions across 21 categories, eight months of answers. A button
// that reads "clear merchant memory" and silently costs that much is a trap, so the confirmation
// names the real number and the act records a durable undo.
import { useState } from 'react';
import { toast } from 'sonner';
import { Eraser } from 'lucide-react';
import { useMerchantMemory } from '@/hooks/useMerchantMemory';
import { useAllSyncedTransactions, useSyncedTransactionReviews } from '@/hooks/useSupabaseData';
import { useAppliedActions } from '@/hooks/useAppliedActions';
import { planMerchantMemoryClear } from '@/lib/merchant-memory';
import type { UndoStep } from '@/lib/applied-actions';

export default function ClearMerchantMemory() {
  const { rules, reviewsByCharge, isLoading } = useMerchantMemory();
  const { data: synced = [] } = useAllSyncedTransactions();
  const { setCategory } = useSyncedTransactionReviews();
  const { record: recordApplied } = useAppliedActions();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const merchantCount = Object.keys(rules).length;
  /**
   * ⚠️ THE PLAN IS THE COUNT, and it is not `rules.length` or a row count of the reviews table.
   * It is exactly the charges this button would strip a label from, computed by the same function
   * that performs the clear — so the number the user agrees to and the number destroyed cannot
   * drift apart. A count taken from anywhere else would eventually disagree with the act.
   */
  const plan = planMerchantMemoryClear(synced, reviewsByCharge);

  // Nothing learned yet means nothing to offer. An empty Danger Zone entry is a control that can
  // only disappoint.
  if (isLoading || merchantCount === 0) return null;

  const run = async () => {
    setBusy(true);
    const done: UndoStep[] = [];
    try {
      for (const write of plan) {
        await setCategory.mutateAsync({ syncedTransactionId: write.chargeId, category: null });
        // Built as it goes, so a stopped run records an undo for exactly what landed — never for
        // work it did not do.
        done.push({ write: 'setCategory', chargeId: write.chargeId, category: write.previousCategory });
      }
      toast.success(`Cleared — ${done.length} ${done.length === 1 ? 'label is' : 'labels are'} gone`);
    } catch {
      toast.message(`Stopped after ${done.length} — the rest are unchanged`);
    } finally {
      if (done.length > 0) {
        try {
          await recordApplied.mutateAsync({
            kind: 'merchant_memory_clear',
            label: `Cleared merchant memory (${done.length} ${done.length === 1 ? 'label' : 'labels'})`,
            steps: done as never,
          });
        } catch {
          // The writes LANDED and only the record failed. Say so rather than implying the clear did
          // not happen — a silent failure here is the "promised an undo it does not have" defect.
          toast.message('Cleared, but the undo could not be saved.');
        }
      }
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-medium flex items-center gap-1.5">
          <Eraser size={12} className="text-destructive-text shrink-0" />
          Clear merchant memory
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          The app remembers {merchantCount} {merchantCount === 1 ? 'merchant' : 'merchants'} from
          labels you have set, and stops asking about them.
        </p>
        {confirming && (
          /* ⚠️ THE NUMBER, THE CONSEQUENCE, AND THE WAY BACK — in that order, because the size is
             the part nobody expects. "Restart from scratch" is what Tre asked for; it is also
             eight months of his own answers, so it is said plainly rather than softened. */
          <div
            className="mt-2 bg-destructive/10 border border-destructive/30 px-3 py-2.5 text-xs text-destructive-text leading-relaxed"
            style={{ borderRadius: 'var(--radius)' }}
          >
            This removes the category from <strong>{plan.length} {plan.length === 1 ? 'charge' : 'charges'}</strong>,
            across {merchantCount} {merchantCount === 1 ? 'merchant' : 'merchants'}. Those are labels
            you set yourself, and the app will start asking about these merchants again.
            <span className="block mt-1 text-muted-foreground">
              You can take it back afterwards from the undo banner on Transactions.
            </span>
          </div>
        )}
      </div>
      {confirming ? (
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setConfirming(false)} disabled={busy} className="btn btn-md btn-ghost">
            Keep it
          </button>
          <button onClick={run} disabled={busy} className="btn btn-md btn-danger">
            {busy ? 'Clearing…' : `Clear ${plan.length}`}
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} className="btn btn-md btn-danger shrink-0 w-full sm:w-auto">
          Clear all
        </button>
      )}
    </div>
  );
}
