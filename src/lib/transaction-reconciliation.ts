import {
  DATE_WINDOW_DAYS, daysBetween, matchCharge, normalizePaymentSource,
  type MatchConfidence, type MatchableTransaction,
} from '@/lib/transaction-matching';

/**
 * PAIR A TRANSACTION SOMEBODY TYPED IN ADVANCE WITH THE REAL BANK ROW WHEN IT ARRIVES.
 *
 * Tre, 2026-09-05: *"sometimes i will add a transaction that day if its unrelated to a auto move,
 * that way i can already plan ahead. then it should merge when the real transaction shows."*
 *
 * ⚠️ WHAT THIS IS FOR, AND IT IS NOT DEDUPLICATION. Checked before building: **he is not
 * double-counting.** `synced_transactions` never enters the cash math — `useForecastEngineInputs`
 * feeds it only to `buildAutoMatchedOccurrences`, and a typed row separately retires the rule
 * projection it answers. A ±1-cent, ±5-day join over his 641 synced rows produced 96 "duplicate"
 * pairs covering 63 of his 83 manual rows, and every one of them was a false alarm.
 *
 * **The real defect is a silently wrong number.** He types $50, the charge is $52.30, and the
 * ledger keeps $50 for ever with nothing ever telling him. So this exists to CORRECT THE AMOUNT
 * AND THE DATE, not to tidy a list — which is why a proposal carries both figures and says which
 * one is about to win.
 *
 * ── A SECOND CALLER, NOT A SECOND MATCHER ───────────────────────────────────
 * All of the hard matching already existed in `transaction-matching.ts`, aimed at RECURRING RULES
 * via `MatchableRule`. This file re-aims it at hand-entered `transactions` and adds no matching
 * arithmetic of its own. Cloning `amountConfidence`, `DATE_WINDOW_DAYS` and the direction gate
 * would have produced a second source of truth that drifts from the first within a release —
 * which is the failure this codebase spent 2026-09-05 finding five times over.
 *
 * ── PROPOSE, NEVER PERFORM ──────────────────────────────────────────────────
 * ⚠️ NOTHING HERE MUTATES ANYTHING. A confident auto-merge is the worst option available in a
 * finance app: a wrong match HIDES a real transaction the person never sees, which is strictly
 * worse than two rows they can reconcile themselves in one tap. Every function returns a
 * PROPOSAL, and an unmatched row stays visible and stays theirs.
 */

/** The fields of a hand-entered `public.transactions` row this reads. */
export interface PlannedTransaction {
  id: string;
  /** Stored positive; `type` carries the direction. */
  amount: number | string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** `'income'` or `'expense'`. */
  type: string;
  /** The `accounts.id` (possibly `account:`-prefixed) the money moved through. */
  payment_source: string | null;
  /** `'manual'` or `'synced'`. Only `'manual'` rows are ever proposed — see below. */
  origin: string;
  note?: string | null;
}

export interface ReconciliationProposal {
  planned: PlannedTransaction;
  synced: MatchableTransaction;
  confidence: MatchConfidence;
  /** What the person typed. */
  typedAmount: number;
  /** What the bank actually charged. THIS IS THE ONE THAT WINS on confirmation. */
  actualAmount: number;
  typedDate: string;
  actualDate: string;
  /** True when confirming would change the amount — the whole reason the feature exists. */
  amountDiffers: boolean;
  /** True when confirming would change the date. */
  dateDiffers: boolean;
}

/** Below this, two amounts are the same money and only the date is being corrected. */
const CENT = 0.005;

/**
 * How far a TYPED amount may be from the real charge and still be the same purchase.
 *
 * ⚠️ THIS IS DELIBERATELY MUCH WIDER THAN THE RULE MATCHER'S BAND, AND HERE IS WHY.
 * `transaction-matching.ts` uses `max($0.05, 1%)`, which is right for its own job: a recurring
 * rule's amount is a figure the user CONFIGURED, so a real charge that disagrees by more than a
 * percent is probably a different charge. **A hand-typed planned transaction is not that. It is an
 * ESTIMATE typed before the money moved** — the person knows they filled the tank, not that it
 * came to $52.30.
 *
 * Measured against the case that motivates the whole feature: typed $50, charged $52.30, a 4.6%
 * gap. Under the rule matcher's band that pair can NEVER be proposed — which would leave the
 * feature correcting only sub-1% discrepancies, i.e. almost nothing worth correcting.
 *
 * ⚠️ WIDENING IS SAFE HERE ONLY BECAUSE OF TWO PROPERTIES THAT MUST NOT BE REMOVED.
 * 1. **The one-candidate rule.** `transaction-matching.ts` says it of its own date window:
 *    "Widening it multiplies candidates, and more candidates means more ambiguity, which under the
 *    one-candidate rule means FEWER matches, not more." A wider band makes a contested match more
 *    likely, and a contested match produces NOTHING rather than a guess.
 * 2. **Propose, never perform.** A person is shown both figures and taps once. A band this wide
 *    would be indefensible behind a silent auto-merge; behind a proposal it costs a rejected
 *    suggestion at worst.
 *
 * ⚠️ IT IS A TUNING DECISION MADE ON REASONING, NOT ON MEASURED USER DATA, and it should be
 * revisited once there are real confirmations and rejections to count. 10% with a $5 floor covers
 * a tank of fuel, a restaurant tip and a grocery run guessed to the nearest ten; it does not span
 * a $50 and a $120 charge.
 */
export const TYPED_AMOUNT_TOLERANCE_PCT = 0.10;
export const TYPED_AMOUNT_TOLERANCE_ABS = 5;

function typedTolerance(typed: number): number {
  return Math.max(TYPED_AMOUNT_TOLERANCE_ABS, typed * TYPED_AMOUNT_TOLERANCE_PCT);
}

/**
 * The single bank row that corresponds to one planned transaction, or null.
 *
 * Null means "no confident match" and must be shown as NO INFORMATION — never as evidence the
 * charge has not happened. The row simply stays as the person entered it.
 *
 * ⚠️ A ROW THE BANK ALREADY SUPPLIED IS NEVER A CANDIDATE. `origin === 'synced'` rows were
 * imported from the aggregator; proposing to merge one with a synced row would offer to reconcile
 * a transaction with itself.
 */
export function proposeReconciliation(
  planned: PlannedTransaction,
  syncedTxns: readonly MatchableTransaction[],
): ReconciliationProposal | null {
  if (planned.origin !== 'manual') return null;

  const accountId = normalizePaymentSource(planned.payment_source);
  if (!accountId) return null;

  const typedAmount = Math.abs(Number(planned.amount));
  if (!Number.isFinite(typedAmount) || typedAmount === 0) return null;

  // Direction is a hard gate: a refund must never satisfy a purchase.
  const isInflow = planned.type === 'income';

  // ── TIGHT FIRST, THEN WIDE ──────────────────────────────────────────────
  // `matchCharge` is asked first and unchanged, so anything the rule matcher would call a match is
  // matched here by exactly the same arithmetic — one source of truth for the easy case.
  const tight = matchCharge(
    { accountId, amount: typedAmount, dueDate: planned.date, isInflow },
    syncedTxns,
  );

  // Only when it finds nothing does the wider typed-estimate band run, using the SAME account,
  // direction, settled and date gates. It differs from `matchCharge` in the amount band alone.
  const match = tight ?? wideMatch(accountId, typedAmount, planned.date, isInflow, syncedTxns);
  if (!match) return null;

  return describeReconciliation(planned, match.txn, match.confidence);
}

/**
 * The proposal for a pair somebody ELSE already decided on.
 *
 * ⚠️ EXTRACTED 2026-09-06 SO THE COMPARISON HAS ONE DEFINITION. `bank-activity-queue.ts` has
 * matched charges to hand-typed ledger rows since long before this file existed — the
 * `ledgerTxn` suggestion — and `BankActivity` needs to say **how far apart** that pair is without
 * running the match a second time. Recomputing "do these differ?" at the call site is how two
 * screens end up disagreeing about the same two numbers.
 *
 * It performs no matching and applies no gates: the caller has already decided these two rows go
 * together. `proposeReconciliation` above is the version that decides.
 */
export function describeReconciliation(
  planned: PlannedTransaction,
  synced: MatchableTransaction,
  confidence: MatchConfidence,
): ReconciliationProposal {
  const typedAmount = Math.abs(Number(planned.amount));
  const actualAmount = Math.abs(Number(synced.amount));
  return {
    planned,
    synced,
    confidence,
    typedAmount,
    actualAmount,
    typedDate: planned.date,
    actualDate: synced.date,
    amountDiffers: Math.abs(actualAmount - typedAmount) > CENT,
    dateDiffers: synced.date !== planned.date,
  };
}

/**
 * The estimate-band pass: same gates as `matchCharge`, a wider amount tolerance, same
 * exactly-one-candidate rule.
 *
 * Confidence is reported as `'strong'` and never `'exact'` — an exact pair would already have been
 * found by `matchCharge`, so anything reaching here disagrees on the amount by construction and
 * must not be presented as certain.
 */
function wideMatch(
  accountId: string,
  typedAmount: number,
  typedDate: string,
  isInflow: boolean,
  txns: readonly MatchableTransaction[],
): { txn: MatchableTransaction; confidence: MatchConfidence } | null {
  const band = typedTolerance(typedAmount);
  const candidates: MatchableTransaction[] = [];

  for (const txn of txns) {
    if (txn.pending) continue;                       // settled evidence only
    if (txn.account_id !== accountId) continue;

    const signed = Number(txn.amount);
    if (!Number.isFinite(signed) || signed === 0) continue;
    if (isInflow !== signed < 0) continue;           // direction stays a hard gate

    if (Math.abs(Math.abs(signed) - typedAmount) > band) continue;
    if (Math.abs(daysBetween(typedDate, txn.date)) > DATE_WINDOW_DAYS) continue;

    candidates.push(txn);
  }

  // ⚠️ EXACTLY ONE, OR NOTHING. This is what makes the wide band safe: ambiguity produces silence.
  return candidates.length === 1 ? { txn: candidates[0], confidence: 'strong' } : null;
}

/**
 * Proposals for a whole ledger, with contested matches dropped.
 *
 * ⚠️ THE CONTESTED CASE IS THE ONE THAT LOSES SOMEBODY'S MONEY, and single-row matching cannot
 * see it. `matchCharge` already refuses when one planned row has two equally good bank rows — "a
 * coin flip presented as evidence is worse than silence". The mirror image is invisible from
 * inside it: TWO planned rows both matching the SAME bank row. Two $40 fill-ups typed on the same
 * day against one $40 bank charge would each be offered that charge, and confirming both would
 * quietly merge away a real transaction the person never sees again.
 *
 * So a bank row claimed more than once is dropped from EVERY proposal rather than awarded to a
 * winner. Both rows stay visible and stay theirs, which is the honest outcome: the person can see
 * two entries and one charge, and that is a question only they can answer.
 */
export function proposeReconciliations(
  planned: readonly PlannedTransaction[],
  syncedTxns: readonly MatchableTransaction[],
): ReconciliationProposal[] {
  const proposals = planned
    .map(p => proposeReconciliation(p, syncedTxns))
    .filter((p): p is ReconciliationProposal => p !== null);

  const claims = new Map<string, number>();
  for (const p of proposals) claims.set(p.synced.id, (claims.get(p.synced.id) ?? 0) + 1);

  return proposals.filter(p => claims.get(p.synced.id) === 1);
}

/**
 * The row a confirmed proposal should write — the BANK's figures, on the person's own entry.
 *
 * Their category and note are kept: those are the part the bank does not know and the part they
 * came to the categorize prompt to supply. The amount and date are replaced, because the bank is
 * the authority on what actually left the account and the typed figure was always a prediction.
 *
 * Returns a patch rather than performing one. Nothing in this module writes.
 */
export function reconciledPatch(proposal: ReconciliationProposal): {
  id: string; amount: number; date: string; origin: string;
} {
  return {
    id: proposal.planned.id,
    amount: proposal.actualAmount,
    date: proposal.actualDate,
    // It is no longer a prediction once the bank has confirmed it, and marking it stops this
    // proposal being offered again on the next render.
    origin: 'synced',
  };
}

/**
 * Whether a charge may be settled by the BULK "Accept all suggested" button.
 *
 * ⚠️ THE INVARIANT THIS PROTECTS IS STATED ON THE BUTTON ITSELF: *"THIS CANNOT CREATE MONEY, BY
 * CONSTRUCTION. It only ever writes `linked_rule` and `linked_txn`"* (`BankActivity.tsx`). A
 * correction changes an AMOUNT, so it can never happen inside a bulk action.
 *
 * ⚠️ BUT THE OTHER OPTION IS WORSE, WHICH IS WHY THIS EXISTS RATHER THAN NOTHING. Linking a
 * discrepant pair in bulk WITHOUT the correction would leave the typed guess standing under a
 * button the person believes settled the row — a silently wrong number produced by pressing
 * "accept". So those rows are held back for a per-row decision that shows both figures, which is
 * this module's "propose, never perform" rule applied to the bulk path.
 *
 * A row with no suggestion is not acceptable either; that is the pre-existing rule, unchanged.
 */
export function isBulkAcceptable(
  hasSuggestion: boolean,
  discrepancy: ReconciliationProposal | undefined | null,
): boolean {
  if (!hasSuggestion) return false;
  if (!discrepancy) return true;
  return !(discrepancy.amountDiffers || discrepancy.dateDiffers);
}
