// §1B Stages 1+2 — the Bank Activity tab.
//
// WHAT THIS IS: what the bank says happened. `/transactions`'s other tab is a PLANNING stream —
// hand-entered rows merged with generated debt, payment-plan and car-loan rows — and the two are
// deliberately never interleaved, so there is no ambiguity about which rows are projections.
//
// ⚠️ EXACTLY ONE CONTROL HERE WRITES MONEY: "Add to my ledger" (Stage 3). Every other action —
// confirming a match, linking to a different rule or entry, correcting a category, ignoring — is an
// ANNOTATION and creates no `public.transactions` row. That table is read by twelve surfaces
// including the forecast and card engines, so a row written there moves projected numbers app-wide
// while `recurring_rules` already projects the same bill.
//
// Import is therefore offered ONLY where nothing else in the app already describes the charge:
// either the matcher found nothing, or the user pressed "Not this" and overruled it. That rule is
// enforced in `planLedgerImport`, not in this file's conditionals — Tre's "otherwise it adds a
// transaction if the user says it doesn't match anything" is load-bearing, not UX.
//
// ⚠️ UNREVIEWED MEANS NOTHING AT ALL. All history is in scope (Tre, 2026-08-08) because history is
// the input to discovering recurring rules at onboarding (§1C), so the vast majority of rows are
// permanently unreviewed BY DESIGN. There is therefore no "N items need review" count, no badge,
// and no nagging anywhere in this file, and nothing may read an unreviewed row as "did not happen".

import { useMemo, useState } from 'react';
import { formatCurrency } from '@/lib/calculations';
import { CATEGORIES, CATEGORY_EMOJI } from '@/lib/types';
import { suggestCategory, hasCategorySuggestion, isValidCategory } from '@/lib/plaid-category-map';
import { matchOccurrence, matchCharge, normalizePaymentSource, type MatchableTransaction } from '@/lib/transaction-matching';
import {
  useAllSyncedTransactions, useSyncedTransactionReviews, useAccounts, useRecurringRules,
  useTransactions, isHandledReview, planLedgerImport,
  type BankActivityRow, type SyncedTransactionReviewRow, type TransactionRow, type RuleRow,
} from '@/hooks/useSupabaseData';
import { Link2, EyeOff, RotateCcw, Landmark, Plus, X } from 'lucide-react';

/** `YYYY-MM` for a `YYYY-MM-DD`. */
const monthOf = (date: string) => date.slice(0, 7);

/** How many rows render before the "show more" cut. All history is browsable; not all at once. */
const PAGE_SIZE = 100;

/** How many ledger entries the "link to a different entry" picker offers, nearest dates first. */
const LEDGER_PICKER_LIMIT = 40;

/** Days between two `YYYY-MM-DD` dates, for ordering the ledger picker around the charge. */
const daysApart = (a: string, b: string) =>
  Math.abs(new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86_400_000;

interface RowSuggestion {
  /** The rule this charge appears to settle, per the app's single definition of "matched". */
  rule?: RuleRow;
  /** A ledger row the user already entered by hand for this charge. */
  ledgerTxn?: TransactionRow;
}

/**
 * Ledger rows in the shape the §1A matcher consumes.
 *
 * Reusing `matchCharge` rather than writing a second amount/date comparison is the whole point: the
 * app has ONE definition of when two money movements are the same event, and a parallel one here
 * could disagree with the badge and the capture gate about the same charge.
 *
 * `payment_source` needs `normalizePaymentSource` because the two tables disagree on a convention —
 * `transactions.payment_source` is `account:`-prefixed on every live row while
 * `recurring_rules.payment_source` is a bare uuid. That helper already accepts both; do not write a
 * second parser.
 */
function asMatchable(txns: readonly TransactionRow[]): MatchableTransaction[] {
  return txns.map(t => ({
    id: t.id,
    account_id: normalizePaymentSource(t.payment_source),
    // Stage A's convention: OUTFLOW POSITIVE, inflow negative. The ledger stores a positive amount
    // and puts direction in `type`, so it is re-signed here to match.
    amount: t.type === 'income' ? -Math.abs(Number(t.amount)) : Math.abs(Number(t.amount)),
    date: t.date,
    pending: false,
  }));
}

export default function BankActivity() {
  const { data: synced = [], isLoading } = useAllSyncedTransactions();
  const { data: reviews, save, setCategory, remove, importToLedger, undoImport } = useSyncedTransactionReviews();
  const { data: accounts } = useAccounts();
  const { data: rules } = useRecurringRules();
  const { data: ledger } = useTransactions();

  const currentMonth = new Date().toISOString().slice(0, 7);
  // Defaults to the current month. All history is available, but opening the tab on seven months of
  // rows would present an archive as a workload.
  const [filterMonth, setFilterMonth] = useState<string>(currentMonth);
  const [filterAccount, setFilterAccount] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  /**
   * Charges whose suggestion the user has overruled with "Not this".
   *
   * Deliberately NOT persisted. Tre's decision (2026-08-09) is that a rejection has to land
   * somewhere — a different rule, a different entry, or a new ledger row — and each of those writes
   * its own review row, which persists. The only case this state loses is a user who rejects and
   * then walks away, which recorded no decision, which is the honest outcome. Storing a sixth status
   * to remember a non-decision would put "I don't know what this is" in the database.
   */
  const [rejected, setRejected] = useState<Record<string, true>>({});
  /** Which row, if any, has a link picker open — and which of the two it is. */
  const [picker, setPicker] = useState<{ id: string; kind: 'rule' | 'txn' } | null>(null);

  const accountName = useMemo(() => {
    const map: Record<string, string> = {};
    accounts.forEach(a => { map[a.id] = a.name; });
    return map;
  }, [accounts]);

  const reviewByTxn = useMemo(() => {
    const map: Record<string, SyncedTransactionReviewRow> = {};
    reviews.forEach(r => { map[r.synced_transaction_id] = r; });
    return map;
  }, [reviews]);

  const monthOptions = useMemo(() => {
    const months = new Set(synced.map(t => monthOf(t.date)));
    return [...months].sort().reverse();
  }, [synced]);

  const rows = useMemo(() => {
    return synced
      .filter(t => (filterMonth === 'all' || monthOf(t.date) === filterMonth))
      .filter(t => (filterAccount === 'all' || t.account_id === filterAccount));
  }, [synced, filterMonth, filterAccount]);

  /**
   * Rule suggestions, computed the only correct way round.
   *
   * `matchOccurrence` answers "which transaction settles THIS rule's occurrence", and its
   * one-candidate-only rule is what keeps it honest. So the index is built by asking every rule that
   * question and inverting the answer — never by scoring rules against a transaction, which would be
   * a second matcher with different ambiguity behaviour.
   *
   * It is matched against the FULL synced history, not the filtered rows: a bill due on the 1st can
   * settle in the prior month, and matching within the visible slice would drop those.
   */
  const ruleByTxnId = useMemo(() => {
    const months = new Set(rows.map(r => monthOf(r.date)));
    const index: Record<string, RuleRow> = {};
    for (const month of months) {
      for (const rule of rules) {
        // `due_day` is optional on `RuleRow` and required by the matcher — a rule without one has
        // no locatable occurrence. Same guard and same adapter as `BudgetControl.tsx:549`.
        if (typeof rule.due_day !== 'number') continue;
        const match = matchOccurrence(
          { ...rule, due_day: rule.due_day, payment_source: rule.payment_source ?? null },
          month,
          synced,
        );
        // First rule to claim a transaction keeps it. A charge settling two rules is a data
        // problem, and silently showing the second rule would misattribute it.
        if (match && !index[match.txn.id]) index[match.txn.id] = rule;
      }
    }
    return index;
  }, [rows, rules, synced]);

  const ledgerMatchable = useMemo(() => asMatchable(ledger), [ledger]);

  /** Rules a charge may be linked to by hand. An inactive rule describes nothing that still bills. */
  const pickableRules = useMemo(
    () => rules.filter(r => r.active).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [rules],
  );

  const suggestionFor = (txn: BankActivityRow): RowSuggestion => {
    const rule = ruleByTxnId[txn.id];
    if (rule) return { rule };
    const amount = Number(txn.amount);
    const hit = matchCharge(
      { accountId: txn.account_id, amount: Math.abs(amount), dueDate: txn.date, isInflow: amount < 0 },
      ledgerMatchable,
    );
    const ledgerTxn = hit ? ledger.find(l => l.id === hit.txn.id) : undefined;
    return ledgerTxn ? { ledgerTxn } : {};
  };

  if (isLoading) {
    return <div className="card-forged p-8 text-center"><p className="text-sm text-muted-foreground">Loading bank activity…</p></div>;
  }

  if (synced.length === 0) {
    return (
      <div className="card-forged p-8 text-center space-y-2">
        <Landmark size={20} className="mx-auto text-muted-foreground" />
        <p className="text-sm font-medium">No bank activity yet</p>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          Connect an account on the Accounts page and settled transactions will appear here after the
          next sync. Pending charges are left out until your bank finalises them.
        </p>
      </div>
    );
  }

  const visible = rows.slice(0, visibleCount);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filterMonth}
          onChange={e => { setFilterMonth(e.target.value); setVisibleCount(PAGE_SIZE); }}
          className="bg-secondary border border-border px-2 py-1 text-xs text-foreground font-medium min-w-[120px]"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <option value="all">All Time</option>
          {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select
          value={filterAccount}
          onChange={e => { setFilterAccount(e.target.value); setVisibleCount(PAGE_SIZE); }}
          className="bg-secondary border border-border px-2 py-1 text-xs text-foreground"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <option value="all">All Accounts</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">
          {rows.length} settled {rows.length === 1 ? 'transaction' : 'transactions'}
        </span>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        What your connected accounts actually reported. Linking a charge to a bill or to an entry you
        already made just labels it and changes no projected number. Only "Add to my ledger" creates
        a new entry, and it is offered only where nothing you already track covers the charge.
      </p>

      <div className="card-forged divide-y divide-border">
        {visible.length === 0 ? (
          <div className="p-8 text-center"><p className="text-sm text-muted-foreground">Nothing settled in this period.</p></div>
        ) : visible.map(txn => {
          const review = reviewByTxn[txn.id];
          const handled = isHandledReview(review);
          const suggestion = handled ? {} : suggestionFor(txn);
          const hasSuggestion = !!(suggestion.rule || suggestion.ledgerTxn);
          const suggestionRejected = !!rejected[txn.id];
          const showSuggestion = hasSuggestion && !suggestionRejected;
          // The guard and the row it would write are ONE decision, made in one place. This file must
          // never decide importability from its own conditionals — the button appears iff the plan
          // says yes, and it inserts exactly the row the plan produced.
          const plan = handled ? null : planLedgerImport(txn, {
            accountName: txn.account_id ? accountName[txn.account_id] : null,
            categoryOverride: review?.category_override ?? null,
            hasSuggestion,
            suggestionRejected,
            review: review ?? null,
          });
          const openPicker = picker?.id === txn.id ? picker.kind : null;
          const amount = Number(txn.amount);
          const isInflow = amount < 0;
          const mapped = suggestCategory(txn.category);
          const category = review?.category_override && isValidCategory(review.category_override)
            ? review.category_override
            : mapped;
          const isGuess = !review?.category_override && !hasCategorySuggestion(txn.category);
          const linkedRule = review?.rule_id ? rules.find(r => r.id === review.rule_id) : undefined;

          return (
            <div key={txn.id} className="px-4 py-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="text-base leading-none w-5 text-center shrink-0 mt-0.5">
                    {isInflow ? '💰' : (CATEGORY_EMOJI[category] ?? '📦')}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{txn.merchant_name || txn.name || '—'}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {txn.date}
                      {txn.account_id && accountName[txn.account_id] ? ` · ${accountName[txn.account_id]}` : ''}
                    </p>
                  </div>
                </div>
                <span className={`text-xs font-semibold font-display whitespace-nowrap ${isInflow ? 'text-success' : 'text-destructive'}`}>
                  {isInflow ? '+' : '-'}{formatCurrency(Math.abs(amount), false)}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 pl-8">
                <select
                  value={category}
                  onChange={e => setCategory.mutate({ syncedTransactionId: txn.id, category: e.target.value })}
                  className="bg-secondary border border-border px-2 py-1 text-[11px] text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                  aria-label="Category"
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                {/* An unmapped provider category is uncategorised, not "Other". Saying "Other"
                    asserts the charge is miscellaneous; the honest claim is that we do not know. */}
                {isGuess && <span className="text-[10px] text-muted-foreground">uncategorised — pick one</span>}

                {handled ? (
                  <>
                    <span className="text-[10px] text-success bg-success/10 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>
                      {review?.status === 'ignored' ? 'ignored'
                        : review?.status === 'imported' ? 'added to ledger'
                          : review?.status === 'linked_rule'
                            // A link whose rule was later deleted is still handled. `rule_id` is
                            // ON DELETE SET NULL precisely so the decision survives the rule, so this
                            // must never assume the rule is still there.
                            ? (linkedRule ? `linked · ${linkedRule.name}` : 'linked · rule deleted')
                            : 'linked'}
                    </span>
                    {review?.status === 'imported' && review.transaction_id ? (
                      // ⚠️ Undoing an import must delete the LEDGER ROW, not the review. Deleting the
                      // review alone would report the import undone while leaving the money in
                      // `public.transactions`, where twelve surfaces still count it. The FK cascades,
                      // so removing the entry also clears this decision and re-offers the charge.
                      <button
                        onClick={() => undoImport.mutate(review.transaction_id!)}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        title="Removes the entry this created from your transactions"
                      >
                        <RotateCcw size={11} /> Undo — deletes the entry
                      </button>
                    ) : (
                      <button
                        onClick={() => remove.mutate(txn.id)}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <RotateCcw size={11} /> Undo
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {showSuggestion && suggestion.rule && (
                      <button
                        onClick={() => save.mutate({
                          synced_transaction_id: txn.id,
                          status: 'linked_rule',
                          rule_id: suggestion.rule!.id,
                          occurrence_month: monthOf(txn.date),
                          category_override: review?.category_override ?? null,
                        })}
                        className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 font-medium"
                      >
                        <Link2 size={11} /> Confirm: {suggestion.rule.name}
                      </button>
                    )}
                    {showSuggestion && !suggestion.rule && suggestion.ledgerTxn && (
                      <button
                        onClick={() => save.mutate({
                          synced_transaction_id: txn.id,
                          status: 'linked_txn',
                          transaction_id: suggestion.ledgerTxn!.id,
                          category_override: review?.category_override ?? null,
                        })}
                        className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 font-medium"
                      >
                        <Link2 size={11} /> Matches your entry on {suggestion.ledgerTxn.date}
                      </button>
                    )}

                    {/* "Not this" is a RE-TARGET, not a dismissal (Tre, 2026-08-09). Rejecting the
                        guess opens the same three destinations a row with no suggestion gets, so the
                        rejection lands somewhere instead of just hiding a wrong answer. */}
                    {showSuggestion && (
                      <button
                        onClick={() => { setRejected(r => ({ ...r, [txn.id]: true })); setPicker(null); }}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <X size={11} /> Not this
                      </button>
                    )}

                    {/* The pickers are offered on rows with NO suggestion too, not only after a
                        rejection: the matcher missing a link is the same user need as the matcher
                        getting it wrong, and the write is identical. */}
                    {!showSuggestion && (
                      <>
                        <button
                          onClick={() => setPicker(p => (p?.id === txn.id && p.kind === 'rule' ? null : { id: txn.id, kind: 'rule' }))}
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          <Link2 size={11} /> Link to a bill
                        </button>
                        <button
                          onClick={() => setPicker(p => (p?.id === txn.id && p.kind === 'txn' ? null : { id: txn.id, kind: 'txn' }))}
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          <Link2 size={11} /> Link to an entry
                        </button>
                        {/* THE ONE CONTROL ON THIS PAGE THAT CREATES MONEY. It appears only when the
                            plan says yes, and there is deliberately no disabled version asserting a
                            reason nobody asked for. */}
                        {plan?.ok && (
                          <button
                            onClick={() => importToLedger.mutate({ syncedTransactionId: txn.id, draft: plan.draft })}
                            className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 font-medium"
                          >
                            <Plus size={11} /> Add to my ledger
                          </button>
                        )}
                      </>
                    )}

                    <button
                      onClick={() => save.mutate({ synced_transaction_id: txn.id, status: 'ignored' })}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <EyeOff size={11} /> Ignore
                    </button>
                  </>
                )}
              </div>

              {openPicker === 'rule' && !handled && (
                <div className="pl-8">
                  <select
                    defaultValue=""
                    onChange={e => {
                      if (!e.target.value) return;
                      save.mutate({
                        synced_transaction_id: txn.id,
                        status: 'linked_rule',
                        rule_id: e.target.value,
                        occurrence_month: monthOf(txn.date),
                        category_override: review?.category_override ?? null,
                      });
                      setPicker(null);
                    }}
                    className="bg-secondary border border-border px-2 py-1 text-[11px] text-foreground max-w-full"
                    style={{ borderRadius: 'var(--radius)' }}
                    aria-label="Link this charge to a bill"
                  >
                    <option value="">Which bill does this pay?</option>
                    {pickableRules.map(r => (
                      <option key={r.id} value={r.id}>{r.name} · {formatCurrency(Math.abs(Number(r.amount)), false)}</option>
                    ))}
                  </select>
                </div>
              )}

              {openPicker === 'txn' && !handled && (
                <div className="pl-8">
                  <select
                    defaultValue=""
                    onChange={e => {
                      if (!e.target.value) return;
                      save.mutate({
                        synced_transaction_id: txn.id,
                        status: 'linked_txn',
                        transaction_id: e.target.value,
                        category_override: review?.category_override ?? null,
                      });
                      setPicker(null);
                    }}
                    className="bg-secondary border border-border px-2 py-1 text-[11px] text-foreground max-w-full"
                    style={{ borderRadius: 'var(--radius)' }}
                    aria-label="Link this charge to an entry you already made"
                  >
                    <option value="">Which of your entries is this?</option>
                    {/* Nearest dates first: the entry a bank charge belongs to is almost always
                        within days of it, and the ledger spans months. */}
                    {[...ledger]
                      .sort((a, b) => daysApart(a.date, txn.date) - daysApart(b.date, txn.date))
                      .slice(0, LEDGER_PICKER_LIMIT)
                      .map(l => (
                        <option key={l.id} value={l.id}>
                          {l.date} · {l.category} · {formatCurrency(Math.abs(Number(l.amount)), false)}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {rows.length > visible.length && (
        <button
          onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
          className="w-full bg-secondary border border-border px-4 py-2 text-xs font-medium hover:border-primary/40 hover:text-primary transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Show {Math.min(PAGE_SIZE, rows.length - visible.length)} more
        </button>
      )}
    </div>
  );
}
