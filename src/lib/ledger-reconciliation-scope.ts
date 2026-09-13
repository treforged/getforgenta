// The LEDGER side of "my typed row should merge when the real bank row shows up".
//
// Tre, 2026-09-05: *"sometimes i will add a transaction that day if its unrelated to a auto move,
// that way i can already plan ahead. then it should merge when the real transaction shows."*
// Raised again 2026-09-13, because it was still only half built.
//
// ⚠️ WHY THIS EXISTS AT ALL: THE OFFER USED TO EXPIRE, SILENTLY AND FOREVER.
// "Link and correct" is real and it works — but it is only ever rendered on an UNREVIEWED bank
// charge in the Bank Activity queue (`BankActivity.tsx:1381`). The moment that charge is answered,
// it leaves the queue, and with it goes the only place the app was ever willing to offer the link.
// The typed row then keeps the typed figure for ever, beside a bank row saying something else,
// with nothing anywhere admitting the two are the same purchase.
//
// Measured on Tre's own ledger, 2026-09-13 — 18 hand-typed past-dated rows:
//   - 6 are linked. Every one of them via the queue, so the mechanism is sound and he uses it.
//   - His 2026-03-17 `$8.00` Subscriptions row has exactly ONE bank twin, `Spotify $7.93`, well
//     inside the tight band. It is unlinked, and it can NEVER be offered again, because that
//     Spotify charge was reviewed months ago. That is this hook's first customer.
//
// ⚠️ THIS ADDS NO MATCHING ARITHMETIC. `proposeReconciliations` already decides, and it has since
// `f8a87545` — it simply had no caller in `src/` at all, which is the defect this file closes. Its
// gates (one candidate or nothing, direction hard, settled only, same account, contested bank rows
// dropped) are the safety, and none of them are re-implemented or relaxed here.
import {
  proposeReconciliations,
  type PlannedTransaction,
  type ReconciliationProposal,
} from '@/lib/transaction-reconciliation';
import type { MatchableTransaction } from '@/lib/transaction-matching';

/**
 * The ledger fields a proposal needs. A page row carries far more; this is all that is read.
 *
 * ⚠️ `origin` IS OPTIONAL HERE AND REQUIRED ON `PlannedTransaction`, ON PURPOSE. A generated row
 * has none — it is a rule's output, not something anybody typed — so it arrives `undefined` and
 * must be REJECTED rather than defaulted to `'manual'`. Defaulting it would offer to rewrite the
 * amount of a projection that does not exist in the ledger at all.
 */
export type ReconcilableLedgerRow = Omit<PlannedTransaction, 'origin' | 'payment_source'> & {
  origin?: string | null;
  /** Absent on a row with no account, which `proposeReconciliation` refuses on its own. */
  payment_source?: string | null;
  isGenerated?: boolean;
};

/** The two review columns this reads. The table has many more; these are the whole decision. */
export interface ReconcilableReview {
  synced_transaction_id: string;
  /** The ledger row this charge was linked to, or null when it was answered some other way. */
  transaction_id?: string | null;
}

/**
 * WHICH ROWS ON SCREEN GET AN OFFER — the pure half, so the boundary can be asserted directly.
 *
 * ⚠️ THIS FUNCTION IS THE FEATURE, AND IT IS SEPARATE FROM THE HOOK BECAUSE A CLAIM ABOUT IT MUST
 * BE TESTABLE WITHOUT A RENDERER. Every rule that keeps this from becoming a second, competing way
 * to link lives here, and a rule that can only be exercised through mocked React queries is a rule
 * nobody will re-check when it changes.
 */
export function reconcilableLedgerRows(
  ledger: readonly ReconcilableLedgerRow[],
  syncedTxns: readonly MatchableTransaction[],
  reviews: readonly ReconcilableReview[],
): Record<string, ReconciliationProposal> {
  if (!syncedTxns.length || !ledger.length) return {};

  // ⚠️ ONLY THE CHARGES THE QUEUE CAN NO LONGER OFFER — ANSWERED, BUT NEVER LINKED.
  // This is the whole boundary and it is what keeps this from becoming a second, competing way to
  // link. An UNREVIEWED charge still sits in Bank Activity, which already offers "Link and correct"
  // and writes the review row as part of the press; duplicating that here would give one pair two
  // buttons in two places, only one of which records the link. An ALREADY-LINKED charge is settled
  // and must not be offered again. What is left is the gap: a charge the user answered months ago
  // whose typed twin still sits on the old figure with no route back to it. Tre's `Spotify $7.93`
  // against his typed `$8.00` is that case.
  const reviewedSyncedIds = new Set<string>();
  const claimedSyncedIds = new Set<string>();
  const claimedLedgerIds = new Set<string>();
  for (const r of reviews) {
    reviewedSyncedIds.add(r.synced_transaction_id);
    if (!r.transaction_id) continue;
    claimedSyncedIds.add(r.synced_transaction_id);
    claimedLedgerIds.add(r.transaction_id);
  }

  // Projections are a rule's output, not something anybody typed, and they are reconciled by the
  // occurrence matcher instead. Offering to rewrite one would edit a row that does not exist.
  const planned: PlannedTransaction[] = ledger
    .filter(t => !t.isGenerated && !claimedLedgerIds.has(t.id) && typeof t.origin === 'string')
    .map(t => ({ ...t, origin: t.origin as string, payment_source: t.payment_source ?? null }));
  if (!planned.length) return {};

  const candidates = syncedTxns.filter(
    s => reviewedSyncedIds.has(s.id) && !claimedSyncedIds.has(s.id),
  );
  if (!candidates.length) return {};

  const byId: Record<string, ReconciliationProposal> = {};
  for (const p of proposeReconciliations(planned, candidates)) byId[p.planned.id] = p;
  return byId;
}

