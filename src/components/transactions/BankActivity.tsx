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
//
// ⚠️ §1B STAGE 5 (2026-08-13) DID NOT OVERTURN THAT, AND THE DISTINCTION IS THE WHOLE DESIGN —
// read `@/lib/bank-activity-queue`'s header before touching any count on this surface. Nothing here
// counts unreviewed rows. What is counted and badged is SUGGESTIONS AWAITING A DECISION: charges
// where the app already computed an answer and is waiting for a yes/no. The two are different sets
// by an order of magnitude — 517 of 586 settled rows were unreviewed, and a handful carried a live
// suggestion. A count of the former is a number nobody can drive to zero; a count of the latter is
// the app admitting it has something to show, and driving it to zero is exactly what the user does.
//
// The bug that forced this: THIS TAB USED TO OPEN ON THE CURRENT CALENDAR MONTH. Verified in the
// live app on 2026-08-13 — the matcher was fine (the Zelle from ARIANA on 2026-05-01 rendered
// "Matches your entry on 2026-05-01" and linked correctly when clicked), but three correct
// suggestions had sat unseen since May and June because they were behind a month dropdown nobody
// opens. Nothing was double-counted; the cost was that a correct answer went unused for three
// months, and each of those rows could have been turned into a genuine duplicate with "Add to my
// ledger". So the entry point is now the DECISION QUEUE across all months, and the month select is
// what it always should have been: a filter, not the door.

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/calculations';
import { CATEGORIES, CATEGORY_EMOJI } from '@/lib/types';
import { suggestCategory, hasCategorySuggestion, isValidCategory } from '@/lib/plaid-category-map';
import {
  useAllSyncedTransactions, useSyncedTransactionReviews, useAccounts, useRecurringRules,
  useTransactions, usePaymentPlans, useCarFunds, isHandledReview, planLedgerImport,
  isLinkStatus, findExclusiveReview,
  type BankActivityRow, type RuleRow, type SyncedTransactionReviewRow,
} from '@/hooks/useSupabaseData';
import { useBankReviewQueue } from '@/hooks/useBankReviewQueue';
import { monthOf, isChargeHandled } from '@/lib/bank-activity-queue';
import { detectTransferPairs, indexPairsByLeg, collapseTransferLegs, describeTransfer, type TransferPair } from '@/lib/transfer-pair-detection';
import type { CarChargeKind } from '@/lib/synced-transaction-review';
import { getActiveCarLoanPayments } from '@/lib/vehicle-loan-engine';
import { resolveRuleOccurrenceDate } from '@/lib/pay-schedule';
import { Link2, EyeOff, RotateCcw, Landmark, Plus, X, ListChecks, ArrowLeftRight } from 'lucide-react';

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

/**
 * The two ways to read this tab.
 *
 * `'needs'` is the DEFAULT and the reason this slice exists: everything still awaiting a decision,
 * across all months, best answers first. `'all'` is the archive — what the bank reported, decided or
 * not — and it is where the month filter earns its keep.
 */
type ViewMode = 'needs' | 'all';

export default function BankActivity() {
  const { data: synced = [], isLoading } = useAllSyncedTransactions();
  const {
    data: reviews, save, setCategory, remove, removeLink, importToLedger, undoImport,
  } = useSyncedTransactionReviews();
  const { data: accounts } = useAccounts();
  const { data: rules } = useRecurringRules();
  const { data: ledger } = useTransactions();
  const { data: paymentPlans } = usePaymentPlans();
  const { data: carFunds } = useCarFunds();

  /**
   * ⚠️ `'all'`, NOT THE CURRENT MONTH, AND THIS ONE LINE IS THE BUG FIX.
   *
   * It used to default to `currentMonth`, with the reasoning that opening on months of rows would
   * present an archive as a workload. That reasoning was right about the ARCHIVE and wrong about the
   * QUEUE, and it made a correct answer about a May charge unreachable from June onward. The archive
   * is now behind the "All activity" view, where the same reasoning still applies and this filter is
   * the tool for it; the door is the decision queue, which is small by construction.
   */
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [filterAccount, setFilterAccount] = useState<string>('all');
  const [view, setView] = useState<ViewMode>('needs');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  /** Two-step confirm for the batch accept — see `acceptAllSuggested`. */
  const [confirmingAcceptAll, setConfirmingAcceptAll] = useState(false);
  const [accepting, setAccepting] = useState(false);
  /**
   * §1B TRANSFER PAIRS — which detected movements the user has UNTICKED in the batch.
   *
   * ⚠️ STORED AS THE EXCEPTIONS, because the batch is PRE-CHECKED and that was a decision rather
   * than a default (Tre did not specify; recorded here so it is not silently re-decided). A silently
   * auto-applied version is indistinguishable from a bug the moment it mispairs — the rows would
   * simply be gone, with nothing on screen that says why. Pre-checked and confirmed in one tap keeps
   * it to one press while leaving a person a chance to look. Keyed by `TransferPair.key`.
   */
  const [untickedTransfers, setUntickedTransfers] = useState<Record<string, true>>({});
  const [recordingTransfers, setRecordingTransfers] = useState(false);

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

  /**
   * §1B SPLIT LINK — EVERY decision on a charge, not the last one to be iterated.
   *
   * ⚠️ THIS WAS A `Record<string, Row>` AND THE SHAPE CHANGE IS THE FEATURE. One bank debit
   * routinely settles more than one obligation: Tre's rent charge pays Rent, Internet and Smart Home
   * for THIS month and the Water/Sewer/Trash rider for the PREVIOUS one, billed in arrears. Keyed by
   * charge alone, the second link overwrote the first in this map and the user saw one badge for two
   * decisions — the variable rider staying invisible inside the bundled charge, which is the exact
   * thing Tre asked for this feature to fix.
   *
   * Safe to build BEFORE the migration: under today's `UNIQUE (synced_transaction_id)` every array
   * is length 1, so this renders identically until the constraint is relaxed.
   */
  const { queue, reviewsByCharge: reviewsByTxn } = useBankReviewQueue(rejected);

  /**
   * §1B TRANSFER PAIRS — the movements between Tre's own accounts, derived over ALL history.
   *
   * ⚠️ NOT over the filtered rows. A movement's two legs can straddle a month boundary (the live
   * $5,037.73 balance transfer posts 06-21 and 06-23) and its legs are on two different accounts by
   * definition, so detecting inside the month or account filter would break exactly the pairs the
   * filters are most likely to be pointed at. The filters then choose what is SHOWN; they never
   * change what is TRUE about a row.
   *
   * Derived at read time and never persisted, for the same reason `matchOccurrence`'s answer is: the
   * accounts and the synced set move under it, and a stored pair would need invalidating on every
   * one of those. Only Tre's confirmation is stored, and only once he gives it.
   */
  const transferPairs = useMemo(() => detectTransferPairs(synced, accounts), [synced, accounts]);
  const pairByLeg = useMemo(() => indexPairsByLeg(transferPairs), [transferPairs]);

  const monthOptions = useMemo(() => {
    const months = new Set(synced.map(t => monthOf(t.date)));
    return [...months].sort().reverse();
  }, [synced]);

  /**
   * The rows on screen.
   *
   * ⚠️ THE MONTH AND ACCOUNT FILTERS APPLY IN BOTH VIEWS, and that is deliberate — the queue is
   * filterable, it is just not month-gated by default. What changes between views is only WHICH
   * population is filtered: everything, or everything still awaiting a decision (already sorted
   * suggestion-first by `buildReviewQueue`).
   */
  const rows = useMemo(() => {
    const population = view === 'needs' ? queue.needsDecision : synced;
    const shown = population
      .filter(t => (filterMonth === 'all' || monthOf(t.date) === filterMonth))
      .filter(t => (filterAccount === 'all' || t.account_id === filterAccount));

    // ⚠️ ONE MOVEMENT, ONE ROW — but only when BOTH legs are on screen. The rule and the reason it
    // keeps a filtered-apart leg live with the detector, next to the pair shape it reads, and are
    // covered there. Called LAST, on the already-filtered list: "on screen" means what survived the
    // two filters above, not what exists.
    return collapseTransferLegs(shown, pairByLeg);
  }, [view, queue.needsDecision, synced, filterMonth, filterAccount, pairByLeg]);

  /**
   * The movements the pre-checked batch would record: on screen, still ticked, and still undecided.
   *
   * Scoped to what is visible for the same reason the "Accept all suggested" batch is — a button
   * whose blast radius the user cannot see is a button they cannot check before pressing.
   */
  const recordableTransfers = useMemo(() => {
    const seen = new Set<string>();
    const out: TransferPair[] = [];
    for (const t of rows) {
      const pair = pairByLeg.get(t.id);
      if (!pair || seen.has(pair.key) || untickedTransfers[pair.key]) continue;
      // Already-decided legs are excluded: `needsDecision` has filtered them out of the queue view,
      // and in the archive view a handled leg is history, not work. BOTH legs are checked, because
      // recording a movement writes to both and a batch must never re-decide a decided row.
      if (isChargeHandled(reviewsByTxn[pair.out.id] ?? []) || isChargeHandled(reviewsByTxn[pair.in.id] ?? [])) continue;
      seen.add(pair.key);
      out.push(pair);
    }
    return out;
  }, [rows, pairByLeg, untickedTransfers, reviewsByTxn]);

  /**
   * The rows "Accept all suggested" would act on: what is ON SCREEN and carries a suggestion.
   *
   * Scoped to the filtered list rather than the whole queue on purpose. A batch button that acts on
   * rows the user cannot see is a button whose blast radius they cannot check before pressing it.
   */
  const acceptable = useMemo(
    () => rows.filter(t => queue.suggestions[t.id]),
    [rows, queue.suggestions],
  );

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

  /**
   * What one link badge says.
   *
   * ⚠️ EVERY BRANCH TOLERATES THE THING BEING GONE. `rule_id`, `payment_plan_id` and `car_fund_id`
   * are all `ON DELETE SET NULL` precisely so a decision outlives the rule, plan or vehicle it named
   * — so "linked · rule deleted" is a legitimate state to render, not a bug to guard against.
   *
   * The vehicle branch names the CHARGE KIND, not just the car: a vehicle bills a loan payment AND
   * an insurance premium every month, and "linked · Civic" would not say which one the user just
   * accounted for.
   */
  const linkLabel = (link: SyncedTransactionReviewRow): string => {
    if (link.status === 'linked_rule') {
      const rule = link.rule_id ? rules.find(r => r.id === link.rule_id) : undefined;
      return rule ? `linked · ${rule.name}` : 'linked · rule deleted';
    }
    if (link.status === 'linked_plan') {
      const plan = link.payment_plan_id ? paymentPlans.find(p => p.id === link.payment_plan_id) : undefined;
      return plan ? `linked · ${plan.name}` : 'linked · plan deleted';
    }
    if (link.status === 'linked_car') {
      const car = link.car_fund_id ? carFunds.find(c => c.id === link.car_fund_id) : undefined;
      const kind = link.car_charge_kind === 'insurance' ? 'insurance' : 'payment';
      return car ? `linked · ${car.vehicle_name} ${kind}` : 'linked · vehicle deleted';
    }
    return 'linked';
  };

  /**
   * The write that accepting a rule suggestion performs.
   *
   * ⚠️ `ruleOccurrence` USED TO BE MISSING HERE and it is a real fix, not a tidy-up. The picker path
   * below always sent the occurrence; the one-click "Confirm: {rule}" button sent only `rule_id`, so
   * accepting a suggested BIWEEKLY link recorded no day — and per this file's own `ruleOccurrence`
   * doc, a month-wide link suppresses BOTH of that month's charges and over-raises projected cash by
   * the one the user never confirmed. Tre's `Fuel` rule ($65, biweekly) is exactly that shape. The
   * batch accept below multiplies the same write, which is what made fixing it non-optional.
   */
  /**
   * The writes accepting a PLAN or a VEHICLE suggestion performs — byte-identical to what the
   * pickers below already write, deliberately. §1B Stage 6 added the suggestions, not a new kind of
   * decision: a suggestion is the app filling in the dropdown the user would otherwise have opened,
   * so if these two ever diverge from the picker the same charge would mean different things
   * depending on how it was decided.
   */
  const acceptPlanInput = (txn: BankActivityRow, planId: string) => ({
    synced_transaction_id: txn.id,
    status: 'linked_plan' as const,
    payment_plan_id: planId,
    occurrence_month: monthOf(txn.date),
  });

  const acceptCarInput = (txn: BankActivityRow, carFundId: string, kind: CarChargeKind) => ({
    synced_transaction_id: txn.id,
    status: 'linked_car' as const,
    car_fund_id: carFundId,
    car_charge_kind: kind,
    occurrence_month: monthOf(txn.date),
  });

  const acceptRuleInput = (txn: BankActivityRow, rule: RuleRow) => ({
    synced_transaction_id: txn.id,
    status: 'linked_rule' as const,
    rule_id: rule.id,
    ...ruleOccurrence(rule, txn.date),
    // ⚠️ NO `category_override`. It used to be carried forward here so that converting a
    // `'categorized'` row into a link did not wipe the user's label — correct while a charge had ONE
    // row, and wrong now: a link is a new row and the label stays on the exclusive one, untouched.
    // Passing it would put the same category on two rows with no rule for which wins, which
    // `validateReviewSet` rejects outright (Tre, 2026-08-09).
  });

  /**
   * §1B TRANSFER PAIRS — record BOTH legs of one movement as dealt with.
   *
   * ⚠️ WHY `'ignored'` AND NOT A NEW `'transfer'` STATUS. `ReviewStatus` is mirrored by a CHECK
   * constraint in the database, so a sixth value is a MIGRATION — and an unattended session may not
   * apply one (`AGENT.md`), on a free-tier project with no PITR. `'ignored'` is not a workaround
   * chosen for convenience either: it is the existing status meaning "nothing about this charge
   * belongs in the ledger", which is exactly and literally true of a movement between two accounts
   * the same person owns. Both balances already moved; no third record is owed.
   *
   * The pairing is not thrown away by using it — `detectTransferPairs` re-derives it on every read
   * from the same rows, so the badge on a recorded leg still says "transfer", not "ignored". If a
   * future change wants the fact stored, that is a migration and its own decision.
   *
   * BOTH legs, always. Recording one and leaving the other is the noise this slice exists to remove,
   * only halved — and the surviving leg would still offer the import trap.
   */
  const recordTransfer = async (pair: TransferPair) => {
    for (const leg of [pair.out, pair.in]) {
      await save.mutateAsync({
        synced_transaction_id: leg.id,
        status: 'ignored',
        // `save` writes every column including the nulls, so a label the user already corrected
        // would be silently cleared if this were omitted. `'ignored'` may legitimately carry one.
        category_override: findExclusiveReview(reviewsByTxn[leg.id] ?? [])?.category_override ?? null,
      });
    }
  };

  /**
   * The pre-checked batch, confirmed in one tap.
   *
   * Sequential and stop-at-first-failure, for the same two reasons `acceptAllSuggested` is: `save` is
   * find-then-write per charge, so parallel writes would race the read half against its own writes;
   * and a batch that ploughs on through a failure leaves a partial result nobody can read back.
   */
  const recordAllTransfers = async () => {
    setRecordingTransfers(true);
    let done = 0;
    try {
      for (const pair of recordableTransfers) {
        await recordTransfer(pair);
        done++;
      }
      if (done > 0) toast.success(`Recorded ${done} ${done === 1 ? 'transfer' : 'transfers'} between your accounts`);
    } catch {
      // `save`'s own `onError` has already said what went wrong in the user's language; all this adds
      // is how far the batch got, which that toast cannot know.
      if (done > 0) toast.message(`Stopped after ${done} of ${recordableTransfers.length} — nothing else was changed`);
    } finally {
      setRecordingTransfers(false);
    }
  };

  /**
   * §1B Stage 5 — accept every suggestion currently on screen, in one press.
   *
   * ⚠️ THIS CANNOT CREATE MONEY, BY CONSTRUCTION. It only ever writes `linked_rule` and `linked_txn`
   * review rows — annotations, exactly what the per-row buttons write. It never touches
   * `planLedgerImport` and never presses "Add to my ledger", which is still the one control on this
   * page that inserts into `public.transactions`. If a future edit makes this loop capable of an
   * import, that is a new feature needing its own decision, not a batch of this one.
   *
   * Writes are SEQUENTIAL and STOP AT THE FIRST FAILURE. `save` is find-then-write per charge, so
   * firing them in parallel would race the read half against its own writes; and a batch that
   * ploughs on through a failing write would leave the user with a partial result and N toasts
   * describing it. Every row it did write is individually undoable, which is what makes stopping
   * safe rather than merely tidy.
   */
  const acceptAllSuggested = async () => {
    setAccepting(true);
    let done = 0;
    try {
      for (const txn of acceptable) {
        const suggestion = queue.suggestions[txn.id];
        if (suggestion?.rule) {
          await save.mutateAsync(acceptRuleInput(txn, suggestion.rule));
        } else if (suggestion?.plan) {
          await save.mutateAsync(acceptPlanInput(txn, suggestion.plan.id));
        } else if (suggestion?.carCharge) {
          await save.mutateAsync(acceptCarInput(txn, suggestion.carCharge.carFundId, suggestion.carCharge.kind));
        } else if (suggestion?.ledgerTxn) {
          await save.mutateAsync({
            synced_transaction_id: txn.id,
            status: 'linked_txn',
            transaction_id: suggestion.ledgerTxn.id,
            // KEPT, unlike the rule write: `linked_txn` is an EXCLUSIVE status, so it lands ON the
            // exclusive row — the row that owns the category. `save` writes every column including
            // the nulls, so omitting this would silently clear the user's label.
            category_override: findExclusiveReview(reviewsByTxn[txn.id] ?? [])?.category_override ?? null,
          });
        } else {
          continue;
        }
        done++;
      }
      if (done > 0) toast.success(`Linked ${done} ${done === 1 ? 'charge' : 'charges'}`);
    } catch {
      // `save`'s own `onError` has already said what went wrong in the user's language. All this
      // adds is how far the batch got, which that toast cannot know.
      if (done > 0) toast.message(`Stopped after ${done} of ${acceptable.length} — nothing else was changed`);
    } finally {
      setAccepting(false);
      setConfirmingAcceptAll(false);
    }
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
      {/* THE ENTRY POINT. "Needs a decision" is first and default; the archive is the other tab.
          Rendered as a two-button segment rather than a third dropdown because which population you
          are looking at is not the same kind of choice as which month — burying it in a select is
          how the month default hid a suggestion for three months in the first place. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex border border-border overflow-hidden" style={{ borderRadius: 'var(--radius)' }}>
          {([
            { id: 'needs' as const, label: 'Needs a decision' },
            { id: 'all' as const, label: 'All activity' },
          ]).map(v => (
            <button
              key={v.id}
              onClick={() => { setView(v.id); setVisibleCount(PAGE_SIZE); setConfirmingAcceptAll(false); }}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                view === v.id ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {v.label}
              {/* The count rides the tab it belongs to. No badge at zero — a "0" and a badge that
                  failed to compute look identical, and there is nothing to say either way. */}
              {v.id === 'needs' && queue.suggestedCount > 0 && (
                <span className="ml-1.5 text-[10px] font-semibold text-primary">{queue.suggestedCount}</span>
              )}
            </button>
          ))}
        </div>
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
          {view === 'needs'
            ? `${rows.length} awaiting a decision`
            : `${rows.length} settled ${rows.length === 1 ? 'transaction' : 'transactions'}`}
        </span>
      </div>

      {/* §1B TRANSFER PAIRS — the pre-checked batch.
          Rendered as a LIST rather than a bare count because the whole reason it is not silent is
          that a person has to be able to see what would be collapsed. Every line names both
          accounts and the amount, and unticking one leaves both its rows in the queue. */}
      {recordableTransfers.length > 0 && (
        <div className="card-forged p-3 space-y-2">
          <div className="flex items-start gap-2">
            <ArrowLeftRight size={13} className="text-primary mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium">
                {recordableTransfers.length} {recordableTransfers.length === 1 ? 'movement' : 'movements'} between your own accounts
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Each of these is one movement your bank reported twice, once from each side. Money
                that moves between accounts you own is neither income nor spending, so recording
                these clears both rows and adds nothing to your ledger. Untick anything that is
                really two separate payments.
              </p>
            </div>
          </div>
          <div className="space-y-1 pl-5">
            {recordableTransfers.map(pair => (
              <label key={pair.key} className="flex items-center gap-2 text-[11px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={!untickedTransfers[pair.key]}
                  onChange={() => setUntickedTransfers(u => {
                    const next = { ...u };
                    if (next[pair.key]) delete next[pair.key]; else next[pair.key] = true;
                    return next;
                  })}
                  className="accent-primary"
                />
                <span className="font-display font-semibold whitespace-nowrap">{formatCurrency(pair.amount, false)}</span>
                <span className="text-muted-foreground truncate">
                  {describeTransfer(pair)} · {pair.out.date}
                  {pair.paidCard ? ` · pays ${pair.paidCard.name}` : ''}
                </span>
              </label>
            ))}
          </div>
          <button
            onClick={recordAllTransfers}
            disabled={recordingTransfers}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <ArrowLeftRight size={12} />
            {recordingTransfers
              ? 'Recording…'
              : `Record ${recordableTransfers.length} ${recordableTransfers.length === 1 ? 'transfer' : 'transfers'}`}
          </button>
        </div>
      )}

      {/* Batch accept. Offered from two upward: with a single suggestion the row's own button is
          already right there, and a batch control for one row is a second way to do one thing. */}
      {view === 'needs' && acceptable.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {confirmingAcceptAll ? (
            <>
              <button
                onClick={acceptAllSuggested}
                disabled={accepting}
                className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <ListChecks size={12} />
                {accepting ? 'Linking…' : `Confirm — link ${acceptable.length}`}
              </button>
              <button
                onClick={() => setConfirmingAcceptAll(false)}
                disabled={accepting}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                Cancel
              </button>
              {/* Says what it will and will NOT do. "Accept all" on a financial app has to state
                  that nothing is being added to the ledger, because that is the one thing on this
                  page that would move every projected number. */}
              <span className="text-[11px] text-muted-foreground">
                Labels {acceptable.length} charges with what the app already matched them to. Adds
                nothing to your ledger and changes no projected number. Each one stays undoable.
              </span>
            </>
          ) : (
            <button
              onClick={() => setConfirmingAcceptAll(true)}
              className="flex items-center gap-1.5 bg-secondary border border-border px-3 py-1.5 text-xs font-medium hover:border-primary/40 hover:text-primary transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <ListChecks size={12} /> Accept all {acceptable.length} suggested
            </button>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground leading-relaxed">
        {view === 'needs'
          ? 'Charges your bank reported that you have not decided on yet, newest first, with the ones the app already recognised at the top. This is not a chore list — most bank rows never need a decision, and the count above is only the ones the app has an answer for.'
          : 'What your connected accounts actually reported, decided or not.'}
        {' '}
        Linking a charge to a bill, a payment plan or an entry you already made just labels it and
        changes no projected number. Only "Add to my ledger" creates a new entry, and it is offered
        only where nothing you already track covers the charge.
      </p>

      <div className="card-forged divide-y divide-border">
        {visible.length === 0 ? (
          // An empty queue is a GOOD state and says so; an empty archive slice is just an empty
          // filter. Rendering the same neutral sentence for both would make "you are done" look
          // like "nothing loaded".
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {view === 'needs'
                ? 'Nothing is waiting on you here.'
                : 'Nothing settled in this period.'}
            </p>
          </div>
        ) : visible.map(txn => {
          const chargeReviews = reviewsByTxn[txn.id] ?? [];
          // The at-most-one decision about the CHARGE ITSELF — ignored, imported, pointed at a
          // ledger entry, or merely relabelled. It is also the only row that may carry a category.
          const exclusive = findExclusiveReview(chargeReviews);
          const links = chargeReviews.filter(r => isLinkStatus(r.status));
          const hasLinks = links.length > 0;
          // A TERMINAL decision about the whole charge. `'categorized'` is deliberately not one:
          // correcting a label takes no position on whether the charge was dealt with.
          const exclusiveHandled = isHandledReview(exclusive);
          const handled = exclusiveHandled || hasLinks;
          // From the shared queue, NOT recomputed here. One matcher run feeds the row, the count on
          // the tab and the sidebar badge, so the three can never disagree about the same charge —
          // and the queue's cross-charge ambiguity guard (see `bank-activity-queue.ts`) applies to
          // what is rendered, which a per-row call could not see.
          // §1B TRANSFER PAIRS — is this row half of one movement? Derived once, above; a per-row
          // call would rebuild the whole cross-row ambiguity analysis for every row on screen and
          // could not see the other rows' claims anyway.
          const pair = pairByLeg.get(txn.id) ?? null;
          const suggestion = queue.suggestions[txn.id] ?? {};
          const hasSuggestion = !!(suggestion.rule || suggestion.plan || suggestion.carCharge || suggestion.ledgerTxn);
          const suggestionRejected = !!rejected[txn.id];
          const showSuggestion = hasSuggestion && !suggestionRejected;
          // The guard and the row it would write are ONE decision, made in one place. This file must
          // never decide importability from its own conditionals — the button appears iff the plan
          // says yes, and it inserts exactly the row the plan produced.
          const plan = handled ? null : planLedgerImport(txn, {
            accountName: txn.account_id ? accountName[txn.account_id] : null,
            categoryOverride: exclusive?.category_override ?? null,
            hasSuggestion,
            suggestionRejected,
            // THE TRAP THIS SLICE CLOSES. Pressing "Add to my ledger" on either leg books a movement
            // between the user's own accounts as spending or as income; there is no third answer
            // that would be right, so the button is withheld rather than argued with. The refusal
            // lives in `planLedgerImport` and not in this file's conditionals, like every other one.
            isTransferLeg: !!pair,
            // The whole set, not one row: a charge already linked to a rule must not also become a
            // ledger entry, and asking about a single review would read only part of the answer.
            reviews: chargeReviews,
          });
          const openPicker = picker?.id === txn.id ? picker.kind : null;
          const amount = Number(txn.amount);
          const isInflow = amount < 0;
          const mapped = suggestCategory(txn.category);
          // The category comes off the EXCLUSIVE row and nowhere else (Tre, 2026-08-09). A charge
          // split across Rent and Water has one merchant and one label, not two.
          const category = exclusive?.category_override && isValidCategory(exclusive.category_override)
            ? exclusive.category_override
            : mapped;
          const isGuess = !exclusive?.category_override && !hasCategorySuggestion(txn.category);

          return (
            <div key={txn.id} className="px-4 py-3 space-y-2">
              {/* ⚠️ A TRANSFER ROW SAYS WHERE THE MONEY WENT, and it is neither red nor green.
                  Both banks describe only their own half ("Payment to Chase card ending in 56" /
                  "Payment Thank You-Mobile"), and neither says where the money came from or landed —
                  which is the only fact a person actually wants back from a transfer. Colouring it
                  would be the same misattribution in another form: nothing was earned and nothing
                  was spent, so an outflow-red row would be a claim the app cannot stand behind. */}
              {pair ? (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="w-5 shrink-0 mt-0.5 flex justify-center text-primary"><ArrowLeftRight size={14} /></span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{describeTransfer(pair)}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {pair.out.date}
                        {pair.in.date !== pair.out.date ? ` → ${pair.in.date}` : ''}
                        {' · '}moved between your accounts
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold font-display whitespace-nowrap text-foreground">
                    {formatCurrency(pair.amount, false)}
                  </span>
                </div>
              ) : (
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
              )}

              <div className="flex flex-wrap items-center gap-2 pl-8">
                {/* ⚠️ NO CATEGORY PICKER ON A TRANSFER, and that is the attribution half of this
                    slice rather than tidiness. Every option in that list is a kind of spending or
                    earning, so any answer it could give about a movement between your own accounts
                    is wrong — and today the row is indistinguishable from a purchase precisely
                    because it is asked to pick one. Where the money landed on a card, what the row
                    offers instead is that card's payment obligation. */}
                {!pair && (
                  <>
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
                  </>
                )}

                {pair && (
                  <span className="text-[10px] text-muted-foreground">
                    {pair.paidCard
                      ? `pays ${pair.paidCard.name} — a card payment is not spending, so it takes no category`
                      : 'not income and not spending — no category applies'}
                  </span>
                )}

                {/* ONE BADGE PER DECISION. A charge that settles four obligations shows four, each
                    with its own undo — the point of split link is that the Water rider stops being
                    invisible inside the bundled rent charge, and a single merged badge would put it
                    straight back. */}
                {links.map(link => (
                  <span
                    key={link.id}
                    className="inline-flex items-center gap-1 text-[10px] text-success bg-success/10 pl-1.5 pr-1 py-0.5"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    {linkLabel(link)}
                    {/* Per-link undo — `removeLink` deletes THIS row by id. The whole-charge
                        `remove` is still available below, but using it here would undo every
                        decision on the charge to correct one of them. */}
                    <button
                      onClick={() => removeLink.mutate(link.id)}
                      className="text-success/70 hover:text-success"
                      title="Undo just this link"
                      aria-label={`Undo ${linkLabel(link)}`}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}

                {exclusiveHandled && exclusive ? (
                  <>
                    <span className="text-[10px] text-success bg-success/10 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>
                      {/* A recorded transfer leg carries `'ignored'` because that is the only
                          existing status meaning "nothing about this belongs in the ledger" (see
                          `recordTransfer`), but "ignored" is not what the user did — they told the
                          app these two rows are one movement. The pairing is re-derived on every
                          read, so the badge can say the true thing without storing a sixth status. */}
                      {exclusive.status === 'ignored' ? (pair ? 'recorded · transfer' : 'ignored')
                        : exclusive.status === 'imported' ? 'added to ledger'
                          : 'linked · your entry'}
                    </span>
                    {exclusive.status === 'imported' && exclusive.transaction_id ? (
                      // ⚠️ Undoing an import must delete the LEDGER ROW, not the review. Deleting the
                      // review alone would report the import undone while leaving the money in
                      // `public.transactions`, where twelve surfaces still count it. The FK cascades,
                      // so removing the entry also clears this decision and re-offers the charge.
                      <button
                        onClick={() => undoImport.mutate(exclusive.transaction_id!)}
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
                    {/* §1B TRANSFER PAIRS — a paired row gets its own two actions and none of the
                        single-charge ones below. "Which of your entries is this?" and "which bill
                        does this pay?" are questions about a payment to someone else; asked of a
                        movement between your own accounts they invite exactly the misattribution
                        this slice removes. The one bill-shaped destination that IS meaningful is
                        kept: Tre tracks three `transfer` rules (HYS, Emergency Fund, Owners
                        Contribution) that describe these movements, and where the money landed on a
                        card, that card's payment is what the row names. */}
                    {pair && (
                      <>
                        <button
                          onClick={() => { void recordTransfer(pair); }}
                          className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 font-medium"
                          title="Marks both rows dealt with. Adds nothing to your ledger."
                        >
                          <ArrowLeftRight size={11} /> Record — one movement
                        </button>
                        <button
                          onClick={() => setPicker(p => (p?.id === txn.id && p.kind === 'rule' ? null : { id: txn.id, kind: 'rule' }))}
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          <Link2 size={11} /> {pair.paidCard ? `Link to a ${pair.paidCard.name} payment` : 'Link to a transfer you track'}
                        </button>
                      </>
                    )}

                    {!pair && showSuggestion && suggestion.rule && (
                      <button
                        // Same write the batch accept performs — one definition, so the two can
                        // never drift into recording a link differently. See `acceptRuleInput`.
                        onClick={() => save.mutate(acceptRuleInput(txn, suggestion.rule!))}
                        className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 font-medium"
                      >
                        <Link2 size={11} /> Confirm: {suggestion.rule.name}
                      </button>
                    )}
                    {/* §1B Stage 6. Both destinations already had a picker and no suggestion, so on
                        2026-08-10 the app knew Discover's two `Paypal Pay in 4` charges were the
                        Cold Air Intake and Exhaust instalments sitting in `payment_plans` on that
                        same card, and still made the user find them in a dropdown. The write is the
                        picker's own — see `acceptPlanInput` / `acceptCarInput`. */}
                    {!pair && showSuggestion && suggestion.plan && (
                      <button
                        onClick={() => save.mutate(acceptPlanInput(txn, suggestion.plan!.id))}
                        className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 font-medium"
                      >
                        <Link2 size={11} /> Confirm: {suggestion.plan.name}
                      </button>
                    )}
                    {!pair && showSuggestion && suggestion.carCharge && (
                      <button
                        onClick={() => save.mutate(acceptCarInput(txn, suggestion.carCharge!.carFundId, suggestion.carCharge!.kind))}
                        className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 font-medium"
                      >
                        {/* Names the OBLIGATION, not just the car. A vehicle bills a payment and an
                            insurance premium every month and "Confirm: Civic" would not say which
                            one the user just accounted for. */}
                        <Link2 size={11} /> Confirm: {suggestion.carCharge.vehicleName}{' '}
                        {suggestion.carCharge.kind === 'insurance' ? 'car insurance' : 'car payment'}
                      </button>
                    )}
                    {!pair && showSuggestion && !suggestion.rule && !suggestion.plan && !suggestion.carCharge && suggestion.ledgerTxn && (
                      <button
                        onClick={() => save.mutate({
                          synced_transaction_id: txn.id,
                          status: 'linked_txn',
                          transaction_id: suggestion.ledgerTxn!.id,
                          // KEPT, unlike the link writes above, and the difference is the point:
                          // `linked_txn` is an EXCLUSIVE status, so it lands ON the exclusive row —
                          // the row that owns the category. `save` writes every column including
                          // the nulls, so omitting this would silently clear the user's label.
                          category_override: exclusive?.category_override ?? null,
                        })}
                        className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 font-medium"
                      >
                        <Link2 size={11} /> Matches your entry on {suggestion.ledgerTxn.date}
                      </button>
                    )}

                    {/* "Not this" is a RE-TARGET, not a dismissal (Tre, 2026-08-09). Rejecting the
                        guess opens the same three destinations a row with no suggestion gets, so the
                        rejection lands somewhere instead of just hiding a wrong answer. */}
                    {!pair && showSuggestion && (
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
                    {!pair && !showSuggestion && (
                      <>
                        <button
                          onClick={() => setPicker(p => (p?.id === txn.id && p.kind === 'rule' ? null : { id: txn.id, kind: 'rule' }))}
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          <Link2 size={11} /> {hasLinks ? 'Link another bill' : 'Link to a bill'}
                        </button>
                        {/* EXCLUSIVE destinations, offered only while the charge has no links.
                            "This whole charge is that entry I already made" contradicts "this charge
                            paid these three bills", and the app should not let a user assert both
                            and then have to work out which one the forecast believed. Removing a
                            link with its ✕ brings these back. */}
                        {!hasLinks && (
                          <button
                            onClick={() => setPicker(p => (p?.id === txn.id && p.kind === 'txn' ? null : { id: txn.id, kind: 'txn' }))}
                            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            <Link2 size={11} /> Link to an entry
                          </button>
                        )}
                        {/* Offered only when a plan exists to link to — an empty picker asserts a
                            destination the user does not have. */}
                        {pickablePlans.length > 0 && (
                          <button
                            onClick={() => setPicker(p => (p?.id === txn.id && p.kind === 'plan' ? null : { id: txn.id, kind: 'plan' }))}
                            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            <Link2 size={11} /> {hasLinks ? 'Link another payment plan' : 'Link to a payment plan'}
                          </button>
                        )}
                        {/* Same rule as the plan picker: offered only when a vehicle charge exists
                            to link to. A user with no active car loan has no such obligation. */}
                        {pickableCarCharges.length > 0 && (
                          <button
                            onClick={() => setPicker(p => (p?.id === txn.id && p.kind === 'car' ? null : { id: txn.id, kind: 'car' }))}
                            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            <Link2 size={11} /> {hasLinks ? 'Link another vehicle charge' : 'Link to a vehicle charge'}
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

                    {/* Also exclusive, and also contradictory once links exist — a charge cannot
                        both settle three bills and be nothing worth recording. */}
                    {/* Not offered on a transfer leg: "nothing worth recording" and "this is one
                        movement between my accounts" are different statements, and the second one
                        has its own button above that also clears the other leg. */}
                    {!pair && !hasLinks && (
                      <button
                        onClick={() => save.mutate({ synced_transaction_id: txn.id, status: 'ignored' })}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <EyeOff size={11} /> Ignore
                      </button>
                    )}
                    {/* Undo-everything, offered only where the per-link ✕ would be tedious. With a
                        single link the ✕ already IS the undo, and two controls doing the same thing
                        differently is how a user ends up unsure which one keeps their category. */}
                    {links.length > 1 && (
                      <button
                        onClick={() => remove.mutate(txn.id)}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        title="Removes every decision on this charge, including its category"
                      >
                        <RotateCcw size={11} /> Undo all
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* The three LINK pickers stay open to a charge that already holds links — that is
                  "link another". They close only on a terminal exclusive decision. */}
              {openPicker === 'rule' && !exclusiveHandled && (
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
                        // No `category_override` — the label lives on the exclusive row. See the
                        // suggestion button above.
                      });
                      // §1B TRANSFER PAIRS — naming what a movement was settles BOTH of its rows.
                      // Linking only the leg on screen would leave the other one in the queue as an
                      // orphan the user has already answered for, which is the noise this removes,
                      // only halved. The partner gets the same `'ignored'` the batch writes.
                      if (pair) {
                        const partner = pair.out.id === txn.id ? pair.in : pair.out;
                        save.mutate({
                          synced_transaction_id: partner.id,
                          status: 'ignored',
                          category_override: findExclusiveReview(reviewsByTxn[partner.id] ?? [])?.category_override ?? null,
                        });
                      }
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

              {openPicker === 'plan' && !exclusiveHandled && (
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
                        // same reason a rule link does. No `category_override` — see above.
                        occurrence_month: monthOf(txn.date),
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

              {openPicker === 'car' && !exclusiveHandled && (
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
                        // the month it settles for the same reason a rule or plan link does. No
                        // `category_override` — see above.
                        occurrence_month: monthOf(txn.date),
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
                        // Kept: `linked_txn` is exclusive and lands on the row owning the category.
                        category_override: exclusive?.category_override ?? null,
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
