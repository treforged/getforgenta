// §1B Stage 7A — "You have categorised these merchants before. Apply it to the N charges that have
// no category yet?" — with ONE undo for the whole pass.
//
// ⚠️ IT IS ONE TAP AND IT IS NEVER SILENT, which is the same call `detectTransferPairs`' batch made
// and for the same reason: a bulk write nobody was shown is indistinguishable from a bug the moment
// it is wrong, because the only evidence is rows that quietly changed. So the merchants and their
// counts are listed, the button says how many charges it touches, and the undo stays on screen
// afterwards.
//
// ⚠️ IT WRITES NOTHING TO `public.transactions`. Like everything else on this tab except "Add to my
// ledger", a category is an annotation: no projected number moves. The confirm copy says so, because
// on a financial app a button that touches eight months of history has to state what it is NOT doing.
import { useState } from 'react';
import { toast } from 'sonner';
import { Tag, RotateCcw } from 'lucide-react';
import { useMerchantMemory } from '@/hooks/useMerchantMemory';
import { planRetroactiveUndo, type RetroPass } from '@/lib/merchant-memory';

interface MerchantMemoryPanelProps {
  /** The parent's `setCategory` mutation — one write path for a category, however it was decided. */
  setCategory: { mutateAsync: (v: { syncedTransactionId: string; category: string | null }) => Promise<unknown> };
}

export default function MerchantMemoryPanel({ setCategory }: MerchantMemoryPanelProps) {
  const { pass, isLoading } = useMerchantMemory();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The pass that was actually applied, kept so it can be undone as one act. */
  const [applied, setApplied] = useState<RetroPass | null>(null);

  const run = async () => {
    setBusy(true);
    // Snapshot BEFORE writing. The live `pass` recomputes as the writes land and would shrink to
    // nothing underneath the undo button, leaving the user holding an undo for zero charges.
    const snapshot: RetroPass = { writes: [...pass.writes], byMerchant: [...pass.byMerchant] };
    const done: RetroPass = { writes: [], byMerchant: snapshot.byMerchant };
    try {
      // Sequential and stop-at-first-failure, like every other batch on this page: `setCategory` is
      // find-then-write per charge, so parallel writes race the read half against its own writes.
      for (const write of snapshot.writes) {
        await setCategory.mutateAsync({ syncedTransactionId: write.chargeId, category: write.category });
        // Recorded as it goes, so the undo only ever offers to reverse what actually landed.
        done.writes.push(write);
      }
      toast.success(`Categorised ${done.writes.length} ${done.writes.length === 1 ? 'charge' : 'charges'} from merchants you have labelled before`);
    } catch {
      if (done.writes.length > 0) {
        toast.message(`Stopped after ${done.writes.length} of ${snapshot.writes.length} — the rest were left alone`);
      }
    } finally {
      setApplied(done.writes.length > 0 ? done : null);
      setBusy(false);
      setConfirming(false);
    }
  };

  const undo = async () => {
    if (!applied) return;
    setBusy(true);
    let undone = 0;
    try {
      for (const step of planRetroactiveUndo(applied)) {
        await setCategory.mutateAsync({ syncedTransactionId: step.chargeId, category: step.category });
        undone++;
      }
      toast.success(`Undone — ${undone} ${undone === 1 ? 'charge is' : 'charges are'} uncategorised again`);
    } catch {
      toast.message(`Undid ${undone} of ${applied.writes.length} — the rest are unchanged`);
    } finally {
      setApplied(null);
      setBusy(false);
    }
  };

  // The undo outlives the pass and is offered first: immediately after a bulk write, "put it back"
  // is the only thing the user might want, and it must not be behind anything.
  if (applied) {
    return (
      <div className="card-forged p-3 flex flex-wrap items-center gap-2">
        <Tag size={13} className="text-primary shrink-0" />
        <p className="text-xs font-medium">
          {applied.writes.length} {applied.writes.length === 1 ? 'charge' : 'charges'} categorised from what you had already decided.
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

  // No badge and no panel at zero — a "0 to apply" and a panel that failed to compute look the same,
  // and there is nothing to say either way. Loading is silence for the same reason.
  if (isLoading || pass.writes.length === 0) return null;

  return (
    <div className="card-forged p-3 space-y-2">
      <div className="flex items-start gap-2">
        <Tag size={13} className="text-primary mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-medium">
            {pass.writes.length} {pass.writes.length === 1 ? 'charge' : 'charges'} from merchants you have already categorised
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            You picked a category for each of these merchants once. These charges never got one.
            Applying it labels them the same way — it adds nothing to your ledger, changes no
            projected number, and undoes in one press.
          </p>
        </div>
      </div>
      {/* Every merchant and its count, because the whole point of not doing this silently is that a
          person can look at what would change before it does. */}
      <div className="space-y-0.5 pl-5">
        {pass.byMerchant.slice(0, 12).map(m => (
          <p key={m.key} className="text-[11px] text-muted-foreground truncate">
            <span className="text-foreground font-medium">{m.label}</span>
            {' → '}{m.category}
            {' · '}{m.count} {m.count === 1 ? 'charge' : 'charges'}
          </p>
        ))}
        {pass.byMerchant.length > 12 && (
          <p className="text-[10px] text-muted-foreground">and {pass.byMerchant.length - 12} more merchants</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <button
              onClick={run}
              disabled={busy}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <Tag size={12} /> {busy ? 'Applying…' : `Confirm — label ${pass.writes.length}`}
            </button>
            <button onClick={() => setConfirming(false)} disabled={busy} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-60">
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="flex items-center gap-1.5 bg-secondary border border-border px-3 py-1.5 text-xs font-medium hover:border-primary/40 hover:text-primary transition-colors"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <Tag size={12} /> Apply to {pass.writes.length} past {pass.writes.length === 1 ? 'charge' : 'charges'}
          </button>
        )}
        <span className="text-[10px] text-muted-foreground">Manage these in Settings → Merchant memory.</span>
      </div>
    </div>
  );
}
