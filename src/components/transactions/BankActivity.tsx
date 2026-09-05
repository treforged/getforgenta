// §1B Stages 1+2 — the Bank Activity tab.
//
// WHAT THIS IS: what the bank says happened. `/transactions`'s other tab is a PLANNING stream —
// hand-entered rows merged with generated debt, payment-plan and car-loan rows — and the two are
// deliberately never interleaved, so there is no ambiguity about which rows are projections.
//
// ⚠️ TWO CONTROLS HERE WRITE MONEY, AND THEY ARE THE SAME WRITE: "Add to my ledger" (Stage 3), and
// — since 2026-08-25 — the row's CATEGORY SELECT. Tre: *"when categories for transactions are
// selected, those should auto add to ledger."* Every other action — confirming a match, linking to a
// different rule, payment plan or entry, ignoring — is an ANNOTATION and creates no
// `public.transactions` row. That table is read by twelve surfaces including the forecast and card
// engines, so a row written there moves projected numbers app-wide while `recurring_rules` already
// projects the same bill.
//
// Import is therefore offered ONLY where nothing else in the app already describes the charge:
// either the matcher found nothing, or the user pressed "Not this" and overruled it. That rule is
// enforced in `planLedgerImport`, not in this file's conditionals — Tre's "otherwise it adds a
// transaction if the user says it doesn't match anything" is load-bearing, not UX. The category
// select is routed through the SAME plan for exactly that reason: labelling a charge the app already
// tracks still only labels it, so the second control cannot become a looser way to create money.
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
import { useCrowdCategories } from '@/hooks/useCrowdCategories';
import { resolveCategorySuggestion, describeSuggestionSource, CROWD_PRIVACY_NOTE } from '@/lib/crowd-category';
import { normalizeMerchant } from '@/lib/merchant-memory';
import {
  useAllSyncedTransactions, useSyncedTransactionReviews, useAccounts, useRecurringRules,
  useTransactions, usePaymentPlans, useCarFunds, isHandledReview, planLedgerImport,
  isLinkStatus, findExclusiveReview,
  type SyncedTransactionReviewRow, type BankActivityRow, type ImportPlan,
} from '@/hooks/useSupabaseData';
import { useBankReviewQueue } from '@/hooks/useBankReviewQueue';
import { monthOf, isChargeHandled } from '@/lib/bank-activity-queue';
import { detectTransferPairs, indexPairsByLeg, collapseTransferLegs, describeTransfer, type TransferPair } from '@/lib/transfer-pair-detection';
import MerchantMemoryPanel from './MerchantMemoryPanel';
import DecisionDeck from './DecisionDeck';
import LinkPicker from './LinkPicker';
import { useAllCarBuildItems } from '@/hooks/useSupabaseData';
import {
  pickableRules as buildPickableRules, pickablePlans as buildPickablePlans,
  pickableCarCharges as buildPickableCarCharges, nearestLedgerOptions, amountLabel,
} from '@/lib/review-link-options';
import type { CarChargeKind } from '@/lib/synced-transaction-review';
import { getActiveCarLoanPayments } from '@/lib/vehicle-loan-engine';
import { buildDeck } from '@/lib/decision-deck';
// The rows every decision writes. LIFTED OUT of this file (2026-08-14) so the Decision Deck writes
// the SAME ones rather than a second copy that drifts — see `review-write-inputs.ts`. Behaviour is
// unchanged on this path: they are the identical builders, at the identical call sites.
import {
  ruleOccurrence, acceptRuleInput, acceptPlanInput, acceptCarInput, acceptLedgerTxnInput,
} from '@/lib/review-write-inputs';
import { Link2, EyeOff, RotateCcw, Landmark, Plus, X, ListChecks, ArrowLeftRight, Layers } from 'lucide-react';

/** How many rows render before the "show more" cut. All history is browsable; not all at once. */
const PAGE_SIZE = 100;

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
  const { crowd } = useCrowdCategories();
  const {
    data: reviews, save, setCategory, remove, removeLink, importToLedger, undoImport,
  } = useSyncedTransactionReviews();
  const { data: accounts } = useAccounts();
  const { data: rules } = useRecurringRules();
  // `update` is here for ONE case: relabelling a charge that has already been imported has to
  // relabel the ledger row it created, or the two disagree silently. See `chooseCategory`.
  const { data: ledger, update: updateLedgerTxn } = useTransactions();
  const { data: buildItems } = useAllCarBuildItems();

  /**
   * Build parts a charge may be recorded AS — the ones with no ledger entry yet.
   *
   * ⚠️ AN ITEM THAT ALREADY HAS AN ENTRY IS NOT OFFERED. Stamping a second transaction on it
   * would leave the Garage choosing between two rows for one part with no rule for which wins, and
   * the item edit panel reads exactly one (`transactions.find(t => t.car_build_item_id === id)`).
   */
  const unpaidBuildItems = useMemo(() => {
    const paid = new Set(ledger.map(t => t.car_build_item_id).filter(Boolean));
    return buildItems
      .filter(b => !paid.has(b.id))
      .map(b => ({
        value: b.id,
        label: b.price != null ? amountLabel(b.name, b.price) : b.name,
      }));
  }, [buildItems, ledger]);
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
   * THE DECISION DECK — the queue's default DECIDING surface (`design/DIRECTION.md`, "one decision
   * per screen"). The list below is not replaced: it is the BROWSE fallback, one tap away from the
   * deck and still the whole archive.
   *
   * ⚠️ A PASSTHROUGH OVER THE SAME QUEUE. `buildDeck` attaches each charge's suggestion and changes
   * nothing about the order, so the deck asks in exactly the sequence the list shows.
   */
  const deckCards = useMemo(() => buildDeck(queue), [queue]);
  /**
   * `'unopened'` means the user has not touched the deck either way, and it is the only state in
   * which the deck opens ITSELF — that is what "default surface" means. Closing it records
   * `'closed'`, which sticks for the visit; the door below reopens it as `'open'`.
   *
   * ⚠️ DERIVED IN RENDER, NOT SET FROM AN EFFECT. An effect that opened the deck on arrival would
   * fire again on the render after the user closed it (the queue is still non-empty), leaving them
   * unable to reach the list at all — and `react-hooks/set-state-in-effect` rejects the shape
   * outright.
   */
  const [deckIntent, setDeckIntent] = useState<'unopened' | 'open' | 'closed'>('unopened');
  const deckOpen = deckIntent === 'open'
    || (deckIntent === 'unopened' && !isLoading && deckCards.length > 0);

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
  /** Just the ids, for the deck: `planLedgerImport` refuses a transfer leg, but only if told. */
  const transferLegIds = useMemo(() => new Set(pairByLeg.keys()), [pairByLeg]);

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

  /** Rules a charge may be linked to by hand — see `review-link-options.ts` for why active only. */
  const pickableRules = useMemo(() => buildPickableRules(rules), [rules]);

  /**
   * §1B Stage 4C — payment plans a charge may be linked to. Active only, same reasoning as the
   * rules: a finished or cancelled plan bills nothing that a bank charge could be settling.
   *
   * A plan is a THIRD kind of thing a charge can pay, not a variant of the other two: an instalment
   * is projected from `payment_plans` by `getMonthlyPlanCashExpenses`, never from `recurring_rules`
   * and never as a ledger row — so before this existed, the only honest thing a user could do with a
   * BNPL/Plan-It charge was ignore it.
   */
  const pickablePlans = useMemo(() => buildPickablePlans(paymentPlans), [paymentPlans]);

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
  const pickableCarCharges = useMemo(() => buildPickableCarCharges(carFunds), [carFunds]);

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
   * §1B — PICKING A CATEGORY IS ALSO "PUT THIS IN MY LEDGER". Tre, 2026-08-25: *"when categories for
   * transactions are selected, those should auto add to ledger."*
   *
   * Until now choosing a category wrote `category_override` and stopped. `'categorized'` is
   * deliberately NOT a handled status, so the charge stayed outside `public.transactions` and moved
   * no number anywhere — the user had labelled the charge and the app had recorded a label, not a
   * transaction. Pressing a second button afterwards was the missing step, and nothing on the row
   * said so.
   *
   * ⚠️ THE DOUBLE-COUNT GUARD IS UNCHANGED AND UNMOVED. This does not decide importability;
   * `planLedgerImport` already did, on the row, and the plan it produced is passed in. A charge that
   * matches a rule, a plan, a vehicle charge or an entry the user already made — or that is one leg
   * of a transfer — has no plan and is only LABELLED here, exactly as before. Routing the select
   * through the same plan the button uses is what stops this becoming a second, looser way to create
   * money.
   *
   * ⚠️ SEQUENTIAL, NOT PARALLEL, and the import only runs if the label landed. Both writes are
   * find-then-write against the same charge's review rows (see `fetchChargeReviews`), so firing them
   * together races the read half of one against the write half of the other and can leave a charge
   * holding two exclusive rows.
   */
  const chooseCategory = async (
    txn: BankActivityRow,
    category: string,
    merchantKey: string | null,
    plan: ImportPlan | null,
    importedTransactionId: string | null,
  ) => {
    try {
      await setCategory.mutateAsync({ syncedTransactionId: txn.id, category, merchantKey });
    } catch {
      // `setCategory`'s own `onError` has already said what went wrong in the user's language.
      // Nothing was labelled, so nothing may be imported on the strength of it.
      return;
    }
    if (importedTransactionId) {
      // ALREADY IN THE LEDGER, so the label has two homes and they must not disagree. Relabelling
      // only the review row would leave the entry this charge created filed under the old category,
      // still feeding that category's totals, with nothing on screen saying so.
      updateLedgerTxn.mutate({ id: importedTransactionId, category });
      return;
    }
    if (!plan?.ok) return;
    importToLedger.mutate({ syncedTransactionId: txn.id, draft: { ...plan.draft, category } });
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
          // KEPT, unlike the rule write: `linked_txn` is an EXCLUSIVE status, so it lands ON the
          // exclusive row — the row that owns the category. `save` writes every column including
          // the nulls, so omitting this would silently clear the user's label.
          await save.mutateAsync(acceptLedgerTxnInput(
            txn,
            suggestion.ledgerTxn.id,
            findExclusiveReview(reviewsByTxn[txn.id] ?? [])?.category_override ?? null,
          ));
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
                <span className="ml-1.5 text-xs font-semibold text-primary">{queue.suggestedCount}</span>
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

      {/* THE DECISION DECK's door. It opens itself on arrival when there is something to decide, so
          this is the way BACK IN after the user has browsed — and, when there is nothing waiting, a
          plain sentence saying so.

          ⚠️ NEVER A ZERO-COUNT DECK. "0 waiting" and a deck that failed to build look identical, and
          there is nothing to decide either way, so no deck is offered and no number is drawn. */}
      {deckCards.length > 0 ? (
        <button
          onClick={() => setDeckIntent('open')}
          className="w-full flex items-center justify-between gap-3 card-forged px-4 py-3 text-left hover:border-primary/40 transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Layers size={14} className="text-primary shrink-0" />
            <span className="min-w-0">
              <span className="block text-xs font-medium">Decide one at a time</span>
              <span className="block text-xs text-muted-foreground">
                {deckCards.length} {deckCards.length === 1 ? 'charge' : 'charges'}, one per card, in
                the order the app thinks is most useful.
              </span>
            </span>
          </span>
          <span className="text-xs font-semibold text-primary whitespace-nowrap">Start</span>
        </button>
      ) : (
        <p className="text-xs text-muted-foreground">Nothing needs a decision.</p>
      )}

      {deckOpen && (
        <DecisionDeck
          cards={deckCards}
          accountName={accountName}
          reviewsByCharge={reviewsByTxn}
          // The queue's own rules, so a remembered link can only ever name one the queue also saw.
          rules={rules}
          // The other three destinations, so the deck's pickers offer exactly what the list's do.
          paymentPlans={paymentPlans}
          carFunds={carFunds}
          ledger={ledger}
          // The build parts and the two money mutations — the deck's one exception to
          // "no control here creates money", authorised by Tre on 2026-08-18.
          buildItems={unpaidBuildItems}
          importToLedger={importToLedger}
          undoImport={undoImport}
          // Cross-row analysis, computed once here. `planLedgerImport` refuses a transfer leg, but
          // only if it is told which charges are legs.
          transferLegIds={transferLegIds}
          // The parent's own mutations, passed down rather than re-instantiated: one write path per
          // decision, however the user made it. See `DecisionDeck.tsx`'s header.
          save={save}
          setCategory={setCategory}
          remove={remove}
          onClose={() => setDeckIntent('closed')}
        />
      )}

      {/* §1B MERCHANT MEMORY — the categories the user already decided, applied to the backlog.
          Above the transfer batch because it is the cheaper decision of the two: it labels rows and
          nothing else, where recording a transfer takes a position on what a movement WAS.

          ⚠️ THE RAW MUTATION, NOT `chooseCategory`, AND THAT IS THE DECISION. A row's own select
          imports the one charge in front of the person who picked it; this panel labels a backlog in
          one press, and routing it through the same path would insert dozens of ledger rows from a
          button whose label promises a relabel. Those charges keep their "Add to my ledger" offer on
          their own rows, one visible decision each. */}
      <MerchantMemoryPanel setCategory={setCategory} />

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
              <p className="text-xs text-muted-foreground leading-relaxed">
                Each of these is one movement your bank reported twice, once from each side. Money
                that moves between accounts you own is neither income nor spending, so recording
                these clears both rows and adds nothing to your ledger. Untick anything that is
                really two separate payments.
              </p>
            </div>
          </div>
          <div className="space-y-1 pl-5">
            {recordableTransfers.map(pair => (
              <label key={pair.key} className="flex items-center gap-2 text-xs cursor-pointer">
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
            className="btn btn-md btn-primary font-semibold"
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
                className="btn btn-md btn-primary font-semibold"
              >
                <ListChecks size={12} />
                {accepting ? 'Linking…' : `Confirm — link ${acceptable.length}`}
              </button>
              <button
                onClick={() => setConfirmingAcceptAll(false)}
                disabled={accepting}
                className="btn btn-sm btn-ghost"
              >
                Cancel
              </button>
              {/* Says what it will and will NOT do. "Accept all" on a financial app has to state
                  that nothing is being added to the ledger, because that is the one thing on this
                  page that would move every projected number. */}
              <span className="text-xs text-muted-foreground">
                Labels {acceptable.length} charges with what the app already matched them to. Adds
                nothing to your ledger and changes no projected number. Each one stays undoable.
              </span>
            </>
          ) : (
            <button
              onClick={() => setConfirmingAcceptAll(true)}
              className="btn btn-md btn-secondary"
            >
              <ListChecks size={12} /> Accept all {acceptable.length} suggested
            </button>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground leading-relaxed">
        {view === 'needs'
          ? 'Charges your bank reported that you have not decided on yet, newest first, with the ones the app already recognized at the top. This is not a chore list — most bank rows never need a decision, and the count above is only the ones the app has an answer for.'
          : 'What your connected accounts actually reported, decided or not.'}
        {' '}
        Linking a charge to a bill, a payment plan or an entry you already made just labels it and
        changes no projected number. Choosing a category records the charge in your ledger, and so
        does "Add to my ledger". Both apply only where nothing you already track covers the charge,
        and both are undoable from the row.
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
          // ledger entry, or merely relabeled. It is also the only row that may carry a category.
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
          // Slice 6 — the three answers, in one order, in one place. The user's own always wins;
          // the crowd only speaks where at least three different people agreed; the bank's own
          // label is last because it is a bucketing, not a decision.
          const merchantKey = normalizeMerchant(txn.merchant_name ?? txn.name);
          const categorySuggestion = resolveCategorySuggestion({
            ownCategory: exclusive?.category_override,
            crowd: merchantKey ? crowd[merchantKey] : null,
            providerCategory: mapped,
            providerHasOpinion: hasCategorySuggestion(txn.category),
          });
          // The category comes off the EXCLUSIVE row and nowhere else (Tre, 2026-08-09). A charge
          // split across Rent and Water has one merchant and one label, not two.
          const category = exclusive?.category_override && isValidCategory(exclusive.category_override)
            ? exclusive.category_override
            : (categorySuggestion.category ?? mapped);
          // ⚠️ STILL A GUESS WHEN THE CROWD ANSWERED. A crowd suggestion is other people's first
          // draft about this merchant, not a fact about THIS charge — so it fills the dropdown and
          // says where it came from, and it does not stop the row reading as unconfirmed.
          const isGuess = !exclusive?.category_override && !hasCategorySuggestion(txn.category);
          const suggestionNote = exclusive?.category_override ? null : describeSuggestionSource(categorySuggestion);

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
                      onChange={e => { void chooseCategory(
                        txn,
                        e.target.value,
                        merchantKey,
                        plan,
                        exclusive?.status === 'imported' ? exclusive.transaction_id : null,
                      ); }}
                      className="bg-secondary border border-border px-2 py-1 text-xs text-foreground"
                      style={{ borderRadius: 'var(--radius)' }}
                      aria-label="Category"
                    >
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {/* ⚠️ THE SOURCE IS NAMED, ALWAYS. "You said this" and "other people say this"
                        are different promises, and a dropdown that renders them identically makes
                        the stronger one on the weaker one's evidence. */}
                    {suggestionNote && (
                      <span className="text-xs text-muted-foreground" title={categorySuggestion.source === 'crowd' ? CROWD_PRIVACY_NOTE : undefined}>
                        {suggestionNote}
                      </span>
                    )}

                    {/* An unmapped provider category is uncategorized, not "Other". Saying "Other"
                        asserts the charge is miscellaneous; the honest claim is that we do not know. */}
                    {isGuess && <span className="text-xs text-muted-foreground">uncategorized — pick one</span>}

                    {/* SAYS WHAT THE SELECT WILL DO BEFORE IT DOES IT. A dropdown that quietly
                        creates a transaction is the kind of surprise this app does not get to
                        spring on a person, so the one row where it will is the row that says so.
                        Shown iff `planLedgerImport` said yes, so the sentence and the behaviour are
                        the same answer rather than two that can drift. */}
                    {plan?.ok && (
                      <span className="text-xs text-muted-foreground">
                        picking a category also adds this to your ledger
                      </span>
                    )}
                  </>
                )}

                {pair && (
                  <span className="text-xs text-muted-foreground">
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
                    className="inline-flex items-center gap-1 text-xs text-success bg-success/10 pl-1.5 pr-1 py-0.5"
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
                    <span className="text-xs text-success bg-success/10 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>
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
                        className="btn btn-sm btn-ghost"
                        title="Removes the entry this created from your transactions"
                      >
                        <RotateCcw size={11} /> Undo — deletes the entry
                      </button>
                    ) : (
                      <button
                        onClick={() => remove.mutate(txn.id)}
                        className="btn btn-sm btn-ghost"
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
                          className="btn btn-sm btn-ghost text-primary hover:text-primary/80"
                          title="Marks both rows dealt with. Adds nothing to your ledger."
                        >
                          <ArrowLeftRight size={11} /> Record — one movement
                        </button>
                        <button
                          onClick={() => setPicker(p => (p?.id === txn.id && p.kind === 'rule' ? null : { id: txn.id, kind: 'rule' }))}
                          className="btn btn-sm btn-ghost"
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
                        className="btn btn-sm btn-ghost text-primary hover:text-primary/80"
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
                        className="btn btn-sm btn-ghost text-primary hover:text-primary/80"
                      >
                        <Link2 size={11} /> Confirm: {suggestion.plan.name}
                      </button>
                    )}
                    {!pair && showSuggestion && suggestion.carCharge && (
                      <button
                        onClick={() => save.mutate(acceptCarInput(txn, suggestion.carCharge!.carFundId, suggestion.carCharge!.kind))}
                        className="btn btn-sm btn-ghost text-primary hover:text-primary/80"
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
                        // KEPT, unlike the link writes above, and the difference is the point:
                        // `linked_txn` is an EXCLUSIVE status, so it lands ON the exclusive row —
                        // the row that owns the category. `save` writes every column including the
                        // nulls, so omitting this would silently clear the user's label.
                        onClick={() => save.mutate(
                          acceptLedgerTxnInput(txn, suggestion.ledgerTxn!.id, exclusive?.category_override ?? null),
                        )}
                        className="btn btn-sm btn-ghost text-primary hover:text-primary/80"
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
                        className="btn btn-sm btn-ghost"
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
                          className="btn btn-sm btn-ghost"
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
                            className="btn btn-sm btn-ghost"
                          >
                            <Link2 size={11} /> Link to an entry
                          </button>
                        )}
                        {/* Offered only when a plan exists to link to — an empty picker asserts a
                            destination the user does not have. */}
                        {pickablePlans.length > 0 && (
                          <button
                            onClick={() => setPicker(p => (p?.id === txn.id && p.kind === 'plan' ? null : { id: txn.id, kind: 'plan' }))}
                            className="btn btn-sm btn-ghost"
                          >
                            <Link2 size={11} /> {hasLinks ? 'Link another payment plan' : 'Link to a payment plan'}
                          </button>
                        )}
                        {/* Same rule as the plan picker: offered only when a vehicle charge exists
                            to link to. A user with no active car loan has no such obligation. */}
                        {pickableCarCharges.length > 0 && (
                          <button
                            onClick={() => setPicker(p => (p?.id === txn.id && p.kind === 'car' ? null : { id: txn.id, kind: 'car' }))}
                            className="btn btn-sm btn-ghost"
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
                            className="btn btn-sm btn-ghost text-primary hover:text-primary/80"
                          >
                            <Plus size={11} /> Add to my ledger
                          </button>
                        )}
                        {/* … AND SAY WHAT IT WAS FOR. Tre, 2026-08-18, on the Lowered Empire
                            steering wheel: *"why cant i choose to connect to an existing
                            transaction?"* — there was no entry to connect it to, because the
                            purchase had never been recorded.

                            ⚠️ A BUILD ITEM IS NOT ONE OF THE FOUR LINK DESTINATIONS, deliberately.
                            Those all point at something that BILLS; a build part is a purchase, so
                            the honest shape is the one the ledger already has — the charge becomes
                            a real entry and that entry carries `car_build_item_id`, the column the
                            Garage already reads. No new review status and no migration, and the
                            item shows as paid because both surfaces read the same row.

                            ⚠️ Only items that DO NOT already have a ledger entry are offered.
                            Stamping a second row on one would leave the Garage picking between two
                            entries for one part with no rule for which wins. */}
                        {plan?.ok && unpaidBuildItems.length > 0 && (
                          <LinkPicker
                            options={unpaidBuildItems}
                            placeholder="…or add it as a build part"
                            ariaLabel="Add this charge to your ledger as a car build part"
                            onPick={value => importToLedger.mutate({
                              syncedTransactionId: txn.id,
                              // ⚠️ CATEGORY FORCED TO 'Car', and that is not the importer guessing.
                              // Picking a build item IS the user asserting the charge is a car part;
                              // leaving it under whatever the provider category mapped to would file
                              // a wheel as Shopping in the very budget the Garage is meant to feed.
                              draft: { ...plan.draft, category: 'Car', car_build_item_id: value },
                            })}
                            className="bg-secondary border border-border px-1.5 py-0.5 text-xs text-foreground max-w-full"
                          />
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
                        className="btn btn-sm btn-ghost"
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
                        className="btn btn-sm btn-ghost"
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
                  <LinkPicker
                    options={pickableRules.map(r => ({ value: r.id, label: amountLabel(r.name, r.amount) }))}
                    placeholder="Which bill does this pay?"
                    ariaLabel="Link this charge to a bill"
                    onPick={value => {
                      const picked = pickableRules.find(r => r.id === value);
                      if (!picked) return;
                      save.mutate(acceptRuleInput(txn, picked));
                      // §1B TRANSFER PAIRS — naming what a movement was settles BOTH of its rows.
                      // Linking only the leg on screen would leave the other one in the queue as an
                      // orphan the user has already answered for, which is the noise this removes,
                      // only halved. The partner gets the same `'ignored'` the batch writes.
                      //
                      // ⚠️ THIS STAYS AT THE CALL SITE, not inside `LinkPicker`. It is a fact about
                      // this LIST's transfer-pair model, not about linking a charge to a bill, and
                      // burying it in the shared picker would perform it on every surface.
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
                  />
                </div>
              )}

              {openPicker === 'plan' && !exclusiveHandled && (
                <div className="pl-8">
                  <LinkPicker
                    options={pickablePlans.map(p => ({ value: p.id, label: amountLabel(p.name, p.payment_amount) }))}
                    placeholder="Which plan does this pay?"
                    ariaLabel="Link this charge to a payment plan"
                    onPick={value => { save.mutate(acceptPlanInput(txn, value)); setPicker(null); }}
                  />
                </div>
              )}

              {openPicker === 'car' && !exclusiveHandled && (
                <div className="pl-8">
                  <LinkPicker
                    options={pickableCarCharges}
                    placeholder="Which vehicle charge is this?"
                    ariaLabel="Link this charge to a vehicle charge"
                    onPick={value => {
                      // `<fundId>:<kind>` — see `pickableCarCharges` for why one value carries both.
                      const [carFundId, kind] = value.split(':');
                      save.mutate(acceptCarInput(txn, carFundId, kind as CarChargeKind));
                      setPicker(null);
                    }}
                  />
                </div>
              )}

              {openPicker === 'txn' && !handled && (
                <div className="pl-8">
                  <LinkPicker
                    options={nearestLedgerOptions(ledger, txn.date)}
                    placeholder="Which of your entries is this?"
                    ariaLabel="Link this charge to an entry you already made"
                    onPick={value => {
                      // The category is KEPT: `linked_txn` is exclusive and lands on the row that
                      // owns the label, so dropping it would wipe one the user set.
                      save.mutate(acceptLedgerTxnInput(txn, value, exclusive?.category_override ?? null));
                      setPicker(null);
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {rows.length > visible.length && (
        <button
          onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
          className="btn btn-md btn-secondary w-full"
        >
          Show {Math.min(PAGE_SIZE, rows.length - visible.length)} more
        </button>
      )}
    </div>
  );
}
