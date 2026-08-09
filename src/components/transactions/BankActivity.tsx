// §1B Stages 1+2 — the Bank Activity tab.
//
// WHAT THIS IS: what the bank says happened. `/transactions`'s other tab is a PLANNING stream —
// hand-entered rows merged with generated debt, payment-plan and car-loan rows — and the two are
// deliberately never interleaved, so there is no ambiguity about which rows are projections.
//
// ⚠️ EXACTLY ONE CONTROL HERE WRITES MONEY: "Add to my ledger" (Stage 3). Every other action —
// confirming a match, linking to a different rule, payment plan or entry, correcting a category,
// ignoring — is an ANNOTATION and creates no `public.transactions` row. That table is read by twelve surfaces
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
  useTransactions, usePaymentPlans, useCarFunds, isHandledReview, planLedgerImport,
  type BankActivityRow, type SyncedTransactionReviewRow, type TransactionRow, type RuleRow,
} from '@/hooks/useSupabaseData';
import type { CarChargeKind } from '@/lib/synced-transaction-review';
import { getActiveCarLoanPayments } from '@/lib/vehicle-loan-engine';
import { resolveRuleOccurrenceDate } from '@/lib/pay-schedule';
import { Link2, EyeOff, RotateCcw, Landmark, Plus, X } from 'lucide-react';

/** `YYYY-MM` for a `YYYY-MM-DD`. */
const monthOf = (date: string) => date.slice(0, 7);

/**
 * WHICH occurrence of a rule a charge on `chargeDate` settles — the month, and the day when the app
 * can name one.
 *
 * ⚠️ THE DAY IS WHAT MAKES A BIWEEKLY LINK HONEST. Keyed on the month alone, confirming one of a
 * biweekly rule's two charges in a month suppressed BOTH, over-raising projected cash by the amount
 * of the one the user never confirmed. Tre's `Fuel` rule ($65, biweekly) already carries two July
 * links, so this is a live shape, not a hypothetical.
 *
 * A monthly rule has exactly one occurrence a month, so for the overwhelming majority of links this
 * stores the same information twice and changes nothing. The date resolves to null — and the link
 * keeps today's month-wide behaviour — only when the rule bills nothing in the charge's month.
 */
const ruleOccurrence = (rule: RuleRow, chargeDate: string) => ({
  occurrence_month: monthOf(chargeDate),
  occurrence_date: resolveRuleOccurrenceDate(rule, chargeDate),
});

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
  const { data: paymentPlans } = usePaymentPlans();
  const { data: carFunds } = useCarFunds();

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
  /** Which row, if any, has a link picker open — and which of the three it is. */
  const [picker, setPicker] = useState<{ id: string; kind: 'rule' | 'txn' | 'plan' | 'car' } | null>(null);

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

  /**
   * §1B Stage 4C — payment plans a charge may be linked to. Active only, same reasoning as the
   * rules: a finished or cancelled plan bills nothing that a bank charge could be settling.
   *
   * A plan is a THIRD kind of thing a charge can pay, not a variant of the other two: an instalment
   * is projected from `payment_plans` by `getMonthlyPlanCashExpenses`, never from `recurring_rules`
   * and never as a ledger row — so before this existed, the only honest thing a user could do with a
   * BNPL/Plan-It charge was ignore it.
   */
  const pickablePlans = useMemo(
    () => paymentPlans.filter(p => p.active).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [paymentPlans],
  );

  /**
   * §1B Stage 4B — the vehicle charges a bank row may be linked to.
   *
   * TWO DESTINATIONS PER VEHICLE, not one. A `phase='loan'` car fund bills a loan payment AND an
   * insurance premium every month, usually from the same account, and the engines gate the two
   * independently (`forecast-engine.ts:307` vs `:356`). Offering one "link to this vehicle" entry
   * would record a decision the number-moving half could only disambiguate by comparing amounts —
   * the heuristic §1A demoted — so the user picks the obligation, not just the car. Tre's own
   * request named them separately ("link to car insurance and car payment").
   *
   * The loan payment's amount comes from `getActiveCarLoanPayments`, the same helper the engines
   * charge against cash, rather than `actual_monthly_payment`: it is the authoritative figure, it
   * already excludes lump sums, and it yields nothing at all for a loan that has not started or has
   * paid off — which is exactly the set of payments a charge could be settling.
   */
  const pickableCarCharges = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const active = getActiveCarLoanPayments(carFunds);
    for (const p of active) {
      options.push({
        value: `${p.carFundId}:loan_payment`,
        label: `${p.vehicleName} · car payment · ${formatCurrency(p.payment, false)}`,
      });
    }
    // Insurance is an OWNERSHIP cost, not a financing one — it outlives the loan and is anchored to
    // `insurance_start_date ?? loan_start_date`, so it is listed off the fund's own premium rather
    // than off the payment list above. A vehicle with no premium recorded bills nothing to link to.
    for (const cf of carFunds) {
      const premium = Number(cf.monthly_insurance || 0);
      if (cf.phase !== 'loan' || premium <= 0) continue;
      options.push({
        value: `${cf.id}:insurance`,
        label: `${cf.vehicle_name} · car insurance · ${formatCurrency(premium, false)}`,
      });
    }
    return options;
  }, [carFunds]);

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
        What your connected accounts actually reported. Linking a charge to a bill, a payment plan or
        an entry you already made just labels it and changes no projected number. Only "Add to my
        ledger" creates a new entry, and it is offered only where nothing you already track covers
        the charge.
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
          const linkedPlan = review?.payment_plan_id
            ? paymentPlans.find(p => p.id === review.payment_plan_id)
            : undefined;
          const linkedCar = review?.car_fund_id
            ? carFunds.find(c => c.id === review.car_fund_id)
            : undefined;

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
                            : review?.status === 'linked_plan'
                              // Same ON DELETE SET NULL degraded state as a rule link, for the same
                              // reason: the decision outlives the plan it named.
                              ? (linkedPlan ? `linked · ${linkedPlan.name}` : 'linked · plan deleted')
                              : review?.status === 'linked_car'
                                // The charge KIND is named, not just the vehicle: a car bills two
                                // obligations a month and "linked · Civic" would not say which one
                                // the user just accounted for.
                                ? (linkedCar
                                  ? `linked · ${linkedCar.vehicle_name} ${review.car_charge_kind === 'insurance' ? 'insurance' : 'payment'}`
                                  : 'linked · vehicle deleted')
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
                          ...ruleOccurrence(suggestion.rule!, txn.date),
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
                        {/* Offered only when a plan exists to link to — an empty picker asserts a
                            destination the user does not have. */}
                        {pickablePlans.length > 0 && (
                          <button
                            onClick={() => setPicker(p => (p?.id === txn.id && p.kind === 'plan' ? null : { id: txn.id, kind: 'plan' }))}
                            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            <Link2 size={11} /> Link to a payment plan
                          </button>
                        )}
                        {/* Same rule as the plan picker: offered only when a vehicle charge exists
                            to link to. A user with no active car loan has no such obligation. */}
                        {pickableCarCharges.length > 0 && (
                          <button
                            onClick={() => setPicker(p => (p?.id === txn.id && p.kind === 'car' ? null : { id: txn.id, kind: 'car' }))}
                            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            <Link2 size={11} /> Link to a vehicle charge
                          </button>
                        )}
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
                      const picked = pickableRules.find(r => r.id === e.target.value);
                      if (!picked) return;
                      save.mutate({
                        synced_transaction_id: txn.id,
                        status: 'linked_rule',
                        rule_id: picked.id,
                        ...ruleOccurrence(picked, txn.date),
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

              {openPicker === 'plan' && !handled && (
                <div className="pl-8">
                  <select
                    defaultValue=""
                    onChange={e => {
                      if (!e.target.value) return;
                      save.mutate({
                        synced_transaction_id: txn.id,
                        status: 'linked_plan',
                        payment_plan_id: e.target.value,
                        // A plan bills every month, so the link needs the month it settles for the
                        // same reason a rule link does.
                        occurrence_month: monthOf(txn.date),
                        category_override: review?.category_override ?? null,
                      });
                      setPicker(null);
                    }}
                    className="bg-secondary border border-border px-2 py-1 text-[11px] text-foreground max-w-full"
                    style={{ borderRadius: 'var(--radius)' }}
                    aria-label="Link this charge to a payment plan"
                  >
                    <option value="">Which plan does this pay?</option>
                    {pickablePlans.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {formatCurrency(Math.abs(Number(p.payment_amount)), false)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {openPicker === 'car' && !handled && (
                <div className="pl-8">
                  <select
                    defaultValue=""
                    onChange={e => {
                      if (!e.target.value) return;
                      // `<fundId>:<kind>` — one option value carrying both halves of the decision,
                      // because a vehicle and a charge kind are only meaningful together and two
                      // selects would let a user submit half of one.
                      const [carFundId, kind] = e.target.value.split(':');
                      save.mutate({
                        synced_transaction_id: txn.id,
                        status: 'linked_car',
                        car_fund_id: carFundId,
                        car_charge_kind: kind as CarChargeKind,
                        // A car payment and its insurance both bill every month, so the link needs
                        // the month it settles for the same reason a rule or plan link does.
                        occurrence_month: monthOf(txn.date),
                        category_override: review?.category_override ?? null,
                      });
                      setPicker(null);
                    }}
                    className="bg-secondary border border-border px-2 py-1 text-[11px] text-foreground max-w-full"
                    style={{ borderRadius: 'var(--radius)' }}
                    aria-label="Link this charge to a vehicle charge"
                  >
                    <option value="">Which vehicle charge is this?</option>
                    {pickableCarCharges.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
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
