// §1B Stage 7A — charges with no category, from merchants the user has categorized before, get
// that category automatically, with ONE durable undo for the whole pass.
//
// ⚠️ IT APPLIES WITHOUT A PROMPT, AND IT IS STILL NEVER SILENT (Tre, 2026-10-01, b64a094e: apply by
// default). The toast says how many charges it labelled, and the undo stays on screen afterwards,
// survives a reload, and an undone charge is never labelled again automatically.
//
// ⚠️ IT WRITES NOTHING TO `public.transactions`. Like everything else on this tab except "Add to my
// ledger", a category is an annotation: no projected number moves. The undo row says so, because
// on a financial app a button that touches eight months of history has to state what it is NOT doing.
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Tag, RotateCcw } from 'lucide-react';
import { useMerchantMemory } from '@/hooks/useMerchantMemory';
import { useAppliedActions } from '@/hooks/useAppliedActions';
import { describeApplied } from '@/lib/applied-actions';
import { planRetroactiveUndo, type RetroPass } from '@/lib/merchant-memory';

interface MerchantMemoryPanelProps {
  /** The parent's `setCategory` mutation — one write path for a category, however it was decided. */
  setCategory: { mutateAsync: (v: { syncedTransactionId: string; category: string | null }) => Promise<unknown> };
}

export default function MerchantMemoryPanel({ setCategory }: MerchantMemoryPanelProps) {
  const { pass, isLoading } = useMerchantMemory();
  const [busy, setBusy] = useState(false);
  /** The pass that was actually applied, kept so it can be undone as one act. */
  /**
   * ⚠️ THE UNDO IS NO LONGER HELD IN THIS COMPONENT, and that is the whole point of the change.
   * It used to be `useState<RetroPass | null>`, so the copy below — "undoes in one press" — was
   * true only while this panel was on screen. Navigate away or reload and the promise silently
   * became false. It now comes from `public.applied_actions`, so it survives both.
   */
  const { latest, record, markUndone, stepsOf, undoneChargeIds, undoneUnknown } = useAppliedActions();
  const applied = latest && latest.kind === 'merchant_retro_pass' ? latest : null;

  /**
   * Apply a set of writes. Tre, 2026-09-12: "this section shouldn't exist. it should auto apply."
   *
   * ⚠️ ONE WRITE PATH FOR BOTH, deliberately. The automatic half and the confirmed half run through
   * exactly this function, so they cannot drift into recording their undo differently — which is
   * how the automatic half would end up the one without a reversal.
   */
  /**
   * ⚠️ EVERY MERCHANT APPLIES BY DEFAULT NOW, with no prompt (Tre, 2026-10-01, b64a094e). The old
   * split kept merchants labelled more than one way behind an "Apply to N past charges" button. He
   * asked for no prompt, so the pass takes each merchant's recorded rule and the undo carries the
   * risk: it stays on screen and survives a reload.
   *
   * ⚠️ AND A CHARGE THE USER UNDID IS LEFT OUT FOR GOOD. The undo makes those charges uncategorized
   * again, so without this the next mount's pass would label them straight back. The record lives
   * in `applied_actions` (durable, every device), the same guard DecisionDeck uses. The merchant
   * itself is NOT switched off: its new charges still apply, which is what "by default" means.
   */
  const pending = pass.writes.filter(w => !undoneChargeIds.has(w.chargeId));

  /**
   * ⚠️ AUTO-APPLIES ONCE PER MOUNT, guarded by a ref. `pass` recomputes as the writes land, so a
   * state-guarded effect would re-enter against a shrinking list; and a second automatic pass would
   * write a second undo record for work the first already recorded.
   *
   * ⚠️ AND IT COULD ONLY SHIP BECAUSE THE UNDO IS DURABLE NOW. Auto-applying against the old
   * `useState` undo would have removed the prompt AND the reversibility its own copy promises,
   * for a write he is not watching. See supabase/migrations/20260913_applied_actions.sql.
   */
  const run = async (toWrite: readonly RetroPass['writes'][number][] = pass.writes) => {
    setBusy(true);
    // Snapshot BEFORE writing. The live `pass` recomputes as the writes land and would shrink to
    // nothing underneath the undo button, leaving the user holding an undo for zero charges.
    const snapshot: RetroPass = { writes: [...toWrite], byMerchant: [...pass.byMerchant] };
    const done: RetroPass = { writes: [], byMerchant: snapshot.byMerchant };
    try {
      // Sequential and stop-at-first-failure, like every other batch on this page: `setCategory` is
      // find-then-write per charge, so parallel writes race the read half against its own writes.
      for (const write of snapshot.writes) {
        await setCategory.mutateAsync({ syncedTransactionId: write.chargeId, category: write.category });
        // Recorded as it goes, so the undo only ever offers to reverse what actually landed.
        done.writes.push(write);
      }
      toast.success(`Categorized ${done.writes.length} ${done.writes.length === 1 ? 'charge' : 'charges'} from merchants you have labeled before`);
    } catch {
      if (done.writes.length > 0) {
        toast.message(`Stopped after ${done.writes.length} of ${snapshot.writes.length} — the rest were left alone`);
      }
    } finally {
      if (done.writes.length > 0) {
        // ⚠️ RECORDED HERE, NOT LATER, because the plan needs the PREVIOUS categories and they are
        // only knowable now. Re-deriving a reversal after the fact is exactly what made the $15
        // link unrecoverable. `done` holds only what actually landed, so a batch that stopped
        // half way records an undo for the half that happened.
        try {
          await record.mutateAsync({
            kind: 'merchant_retro_pass',
            label: `Categorized ${done.writes.length} ${done.writes.length === 1 ? 'charge' : 'charges'} from merchants you have labeled before`,
            steps: planRetroactiveUndo(done).map(step => ({
              write: 'setCategory' as const, chargeId: step.chargeId, category: step.category,
            })),
          });
        } catch {
          // The writes LANDED; only the undo record failed. Say so rather than implying the pass
          // did not happen — and never swallow it, because a silent failure here is precisely the
          // "promised an undo it does not have" defect this work exists to remove.
          toast.message('Applied, but the undo could not be saved — use Settings to change any of these.');
        }
      }
      setBusy(false);
    }
  };

  const autoRan = useRef(false);
  useEffect(() => {
    // `undoneUnknown` holds it until the undo record is current: straight after an undo the cached
    // set is the pre-undo one, and acting on it would re-apply what was just taken back.
    if (autoRan.current || isLoading || undoneUnknown || busy || pending.length === 0) return;
    autoRan.current = true;
    void run(pending);
  }, [isLoading, undoneUnknown, busy, pending]);

  const undo = async () => {
    if (!applied) return;
    setBusy(true);
    const steps = stepsOf(applied);
    let undone = 0;
    try {
      for (const step of steps) {
        if (step.write !== 'setCategory') continue;
        await setCategory.mutateAsync({ syncedTransactionId: step.chargeId, category: step.category });
        undone++;
      }
      // ⚠️ MARKED ONLY AFTER THE REPLAY, and only on success. Marking first would retire the record
      // while the writes were still in flight, so a failure half way would leave the user with a
      // half-undone pass and no undo left to finish it.
      await markUndone.mutateAsync(applied.id);
      toast.success(`Undone — ${undone} ${undone === 1 ? 'charge is' : 'charges are'} uncategorized again`);
    } catch {
      // Deliberately NOT marked undone: the remainder is still reversible and must stay offered.
      toast.message(`Undid ${undone} of ${steps.length} — the rest are unchanged`);
    } finally {
      setBusy(false);
    }
  };

  // The undo outlives the pass and is offered first: immediately after a bulk write, "put it back"
  // is the only thing the user might want, and it must not be behind anything.
  if (applied) {
    return (
      <div className="card-forged p-3 flex flex-wrap items-center gap-2">
        <Tag size={13} className="text-primary shrink-0" />
        {/* The stored label already says what happened and how many, so it is shown rather than
            recomputed here — one wording, written once at apply time, that a reload cannot lose. */}
        <p className="text-xs font-medium">
          {describeApplied(applied)}.
        </p>
        <button
          onClick={undo}
          disabled={busy}
          className="flex items-center gap-1.5 bg-secondary border border-border px-3 py-1.5 text-xs font-medium hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-60"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <RotateCcw size={12} /> {busy ? 'Undoing…' : 'Undo all'}
        </button>
        <span className="text-[10px] text-muted-foreground">Nothing was added to your ledger.</span>
      </div>
    );
  }

  // Nothing to show until a pass has been applied: the apply itself is automatic, and its undo
  // is the only thing the user might want from this panel.
  return null;
}
