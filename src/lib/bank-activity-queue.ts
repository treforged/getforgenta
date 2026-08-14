// §1B Stage 5 — WHICH bank charges are waiting on the user, and what the app already thinks they are.
//
// WHY THIS FILE EXISTS. Every suggestion this computes already worked; nobody could see it. Bank
// Activity opened on the CURRENT calendar month, so a correct answer about a May charge sat behind a
// dropdown. Proven on Tre's real data on 2026-08-13: three correct suggestions (two Zelle-from-ARIANA
// charges in May and June, and an 1,100 Zelle on 06-29) had been sitting unseen for up to three
// months and were accepted by hand. Nothing was double-counted — the cost was purely that the app
// computed an answer and then hid it.
//
// ⚠️ THIS IS NOT AN "UNREVIEWED" COUNT, AND THE DIFFERENCE IS THE WHOLE DESIGN.
// `BankActivity.tsx`'s standing rule (Tre, 2026-08-08) is that UNREVIEWED MEANS NOTHING AT ALL: all
// history is in scope because history is the input to rule discovery at onboarding (§1C), so the vast
// majority of rows are permanently unreviewed BY DESIGN — 517 of 586 settled rows across 8 months at
// the time of writing. Counting those would badge the app with a number the user can never drive to
// zero, which is the nagging that rule forbids, and it is still forbidden.
//
// What this file counts instead is strictly smaller and categorically different: charges where THE
// APP HAS ALREADY COMPUTED AN ANSWER and is waiting for a yes/no. That is not a backlog the user
// created by not reading their bank feed; it is work the app did and then buried. A count of those
// is not nagging, it is the app admitting it has something to show. So:
//
//   - the count is SUGGESTIONS AWAITING A DECISION, never "unreviewed rows";
//   - zero suggestions renders NO badge, never a "0" (a badge reading 0 and a badge that failed to
//     compute look identical).
//
// ⚠️ NOTHING HERE LOOSENS THE MATCHER. `matchCharge`'s one-candidate-only rule is correct and stays:
// the three identical $10.00 CFX tolls on 2026-08-03 are exactly why two equally good candidates
// must yield silence rather than a coin flip. This file raises the number of suggestions a user SEES,
// not the number the matcher makes.

import { matchRuleOnDates, matchCharge, normalizePaymentSource, type MatchableTransaction } from './transaction-matching';
import { findExclusiveReview, isHandledReview, isLinkStatus, type CarChargeKind } from './synced-transaction-review';
import { getRuleOccurrenceDatesInMonth } from './pay-schedule';
import {
  paymentPlanObligations, carChargeObligations, matchObligations,
  type ChargeObligation, type ObligationPlan,
} from './charge-obligations';
import type { CarFund } from './types';

/** `YYYY-MM` for a `YYYY-MM-DD`. */
export const monthOf = (date: string) => date.slice(0, 7);

/**
 * The fields of a settled `synced_transactions` row the queue reads. Structurally satisfied by
 * `BankActivityRow`; kept minimal so the rules can be tested without a Supabase row shape.
 */
export interface QueueCharge {
  id: string;
  account_id: string | null;
  /** `numeric` — arrives as a string. OUTFLOW POSITIVE, inflow negative (Stage A's convention). */
  amount: number | string;
  /** `YYYY-MM-DD`. */
  date: string;
}

/** The fields of a `recurring_rules` row the queue reads. Structurally satisfied by `RuleRow`. */
export interface QueueRule {
  id: string;
  name: string;
  amount: number | string;
  /** Optional on `RuleRow` and REQUIRED by the matcher — a rule without one has no locatable occurrence. */
  due_day?: number | null;
  due_month?: number | null;
  frequency: string;
  rule_type: string;
  payment_source?: string | null;
  /** Where an INCOME rule's money lands. See `MatchableRule.deposit_account` — without it no income
   *  rule can match at all, because the rule editor leaves `payment_source` null on income. */
  deposit_account?: string | null;
  /** The three columns `getRuleOccurrenceDatesInMonth` needs to place a weekly/biweekly occurrence:
   *  `created_at` supplies the biweekly phase anchor, the other two bound the schedule. */
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
  active?: boolean;
}

/** The fields of a `transactions` (ledger) row the queue reads. Structurally satisfied by `TransactionRow`. */
export interface QueueLedgerTxn {
  id: string;
  date: string;
  type: string;
  amount: number | string;
  payment_source?: string | null;
}

/** The one field of a review row the queue reads. */
export interface QueueReview {
  status: string;
}

/** A vehicle obligation a charge appears to settle — which car, and which of its two monthly bills. */
export interface CarChargeSuggestion {
  carFundId: string;
  kind: CarChargeKind;
  /** For the button's label. Read off the fund so a deleted vehicle cannot leave a blank badge. */
  vehicleName: string;
  /** The obligation's own amount, which for a loan payment is that month's real figure. */
  amount: number;
}

/**
 * What the app thinks one charge is, if it thinks anything. AT MOST ONE FIELD IS EVER SET.
 *
 * ⚠️ PRECEDENCE IS RULE → PLAN → VEHICLE → YOUR OWN ENTRY, and it is a real decision, not an
 * accident of iteration order. The first three are OBLIGATIONS the app already projects, so
 * confirming one retires a specific future outflow; the last only says the user typed the same
 * charge in by hand. Where two would both fit, naming the obligation is the more useful answer and
 * the one whose acceptance changes a projected number. Ties are vanishingly rare — they need two
 * things of the same amount on the same account within days — and the fixed order at least makes
 * them deterministic instead of dependent on which map was built first.
 */
export interface ChargeSuggestion<R = QueueRule, T = QueueLedgerTxn, P = ObligationPlan> {
  /** The rule this charge appears to settle, per the app's single definition of "matched". */
  rule?: R;
  /** The payment plan whose instalment this charge appears to be. */
  plan?: P;
  /** The vehicle obligation this charge appears to settle. */
  carCharge?: CarChargeSuggestion;
  /** A ledger row the user already entered by hand for this charge. */
  ledgerTxn?: T;
}

/**
 * Ledger rows in the shape the §1A matcher consumes.
 *
 * `payment_source` needs `normalizePaymentSource` because the two tables disagree on a convention —
 * `transactions.payment_source` is `account:`-prefixed on every live row while
 * `recurring_rules.payment_source` is a bare uuid. That helper already accepts both; do not write a
 * second parser.
 */
export function asMatchableLedger(txns: readonly QueueLedgerTxn[]): MatchableTransaction[] {
  return txns.map(t => ({
    id: t.id,
    account_id: normalizePaymentSource(t.payment_source ?? null),
    // Stage A's convention: OUTFLOW POSITIVE, inflow negative. The ledger stores a positive amount
    // and puts direction in `type`, so it is re-signed here to match.
    amount: t.type === 'income' ? -Math.abs(Number(t.amount)) : Math.abs(Number(t.amount)),
    date: t.date,
    pending: false,
  }));
}

/**
 * Has the user made a TERMINAL decision about this whole charge?
 *
 * `'categorized'` is deliberately not one: correcting a label takes no position on whether the
 * charge was dealt with. A charge holding any link is handled — it settles something.
 */
export function isChargeHandled(chargeReviews: readonly QueueReview[]): boolean {
  const exclusive = findExclusiveReview(chargeReviews);
  return isHandledReview(exclusive) || chargeReviews.some(r => isLinkStatus(r.status));
}

/**
 * Rule suggestions for a whole set of charges, computed the only correct way round.
 *
 * The matcher answers "which transaction settles THIS rule's occurrence", and its one-candidate-only
 * rule is what keeps it honest. So the index is built by asking every rule that question and
 * inverting the answer — never by scoring rules against a transaction, which would be a second
 * matcher with different ambiguity behavior.
 *
 * ⚠️ EVERY FREQUENCY IS ASKED ABOUT, and that is the §1B Stage 6 change. This used to call
 * `matchOccurrence`, which locates an occurrence from `due_day` alone and therefore SKIPS weekly and
 * biweekly rules outright — `due_day` is a day of the WEEK there. The guard was right and the
 * outcome was wrong: it is why Tre's weekly paycheck and his biweekly `Fuel` rule could never be
 * suggested. `getRuleOccurrenceDatesInMonth` is the app's one definition of where a rule's
 * occurrences land (phase-anchored for biweekly, bounded by `start_date`/`end_date`), so the real
 * dates are generated and each is matched. No tolerance moved; the calendar did.
 *
 * ⚠️ `months` and `charges` are separate arguments ON PURPOSE. The months are the ones being shown;
 * the charges are the FULL synced history, because a bill due on the 1st can settle in the prior
 * month and matching within the visible slice would drop those.
 */
export function buildRuleSuggestionIndex<R extends QueueRule>(
  rules: readonly R[],
  months: readonly string[],
  charges: readonly MatchableTransaction[],
): Record<string, R> {
  const index: Record<string, R> = {};
  for (const month of months) {
    const [year, monthNumber] = month.split('-').map(Number);
    if (!year || !monthNumber) continue;
    for (const rule of rules) {
      // Same guard and same adapter as `BudgetControl.tsx:549`.
      if (typeof rule.due_day !== 'number') continue;
      const dates = getRuleOccurrenceDatesInMonth(
        {
          frequency: rule.frequency,
          due_day: rule.due_day,
          due_month: rule.due_month ?? null,
          start_date: rule.start_date ?? null,
          end_date: rule.end_date ?? null,
          created_at: rule.created_at ?? undefined,
        },
        year,
        monthNumber - 1,
      );
      // First rule to claim a charge keeps it. A charge settling two rules is a data problem, and
      // silently showing the second rule would misattribute it.
      for (const match of matchRuleOnDates({ ...rule, due_day: rule.due_day, payment_source: rule.payment_source ?? null }, dates, charges)) {
        if (!index[match.txn.id]) index[match.txn.id] = rule;
      }
    }
  }
  return index;
}

export interface QueueInput<C extends QueueCharge, R extends QueueRule, T extends QueueLedgerTxn, P extends ObligationPlan> {
  /** Every settled synced row, all months. */
  charges: readonly C[];
  /** Every review row already recorded, keyed by `synced_transaction_id`. */
  reviewsByCharge: Readonly<Record<string, readonly QueueReview[]>>;
  rules: readonly R[];
  ledger: readonly T[];
  /** Payment plans, for the instalment suggestions. Absent means none are offered. */
  plans?: readonly P[];
  /** Car funds, for the loan-payment and insurance suggestions. */
  carFunds?: readonly CarFund[];
  /**
   * The account a car charge falls back to when the fund names none — `loan_payment_account`'s
   * documented null means "the generic liquid-cash pool". Same fallback as `capture-evidence.ts`.
   */
  fundingAccountId?: string | null;
  /**
   * Charges whose suggestion the user pressed "Not this" on THIS SESSION. Deliberately not
   * persisted (Tre, 2026-08-09) — a rejection has to land somewhere, and each destination writes its
   * own review row. A rejected charge still needs a decision; it just no longer carries a suggestion.
   */
  rejected?: Readonly<Record<string, true>>;
}

export interface ReviewQueue<C extends QueueCharge, R extends QueueRule, T extends QueueLedgerTxn, P extends ObligationPlan = ObligationPlan> {
  /** Every charge with no terminal decision yet, suggestion-carrying first, then newest first. */
  needsDecision: C[];
  /** What the app thinks each charge is. Only ever populated for unhandled, unrejected charges. */
  suggestions: Record<string, ChargeSuggestion<R, T, P>>;
  /**
   * THE NUMBER THAT GETS BADGED: charges where the app has an answer and is waiting for a yes/no.
   * Never the count of unreviewed rows — see this file's header.
   */
  suggestedCount: number;
}

/**
 * The review queue: what still needs a decision, across ALL months, best answers first.
 *
 * ⚠️ SORT ORDER IS LOAD-BEARING, NOT COSMETIC. A suggestion-carrying row is a one-click decision and
 * an unsuggested row is an open-ended chore; interleaving them by date buries the former in the
 * latter, which is the failure this whole slice exists to fix — just at a different scale.
 */
export function buildReviewQueue<C extends QueueCharge, R extends QueueRule, T extends QueueLedgerTxn, P extends ObligationPlan = ObligationPlan>(
  input: QueueInput<C, R, T, P>,
): ReviewQueue<C, R, T, P> {
  const {
    charges, reviewsByCharge, rules, ledger, rejected = {},
    plans = [], carFunds = [], fundingAccountId = null,
  } = input;

  const unhandled = charges.filter(c => !isChargeHandled(reviewsByCharge[c.id] ?? []));

  // The matcher runs against the FULL history in both directions: every month that holds an
  // unhandled charge, matched over every charge. Restricting either side would drop cross-month
  // settlements — the exact rows that were invisible before this existed.
  const matchableCharges: MatchableTransaction[] = charges.map(c => ({
    id: c.id,
    account_id: c.account_id,
    amount: c.amount,
    date: c.date,
    pending: false,
  }));
  const months = [...new Set(unhandled.map(c => monthOf(c.date)))];
  const ruleByChargeId = buildRuleSuggestionIndex(rules, months, matchableCharges);
  const matchableLedger = asMatchableLedger(ledger);
  const ledgerById = new Map(ledger.map(l => [l.id, l]));

  // §1B Stage 6 — the two destinations that had a picker and no suggestion. Both are matched from
  // the OBLIGATION side, same as the rules above, so `matchCharge` is reused unchanged; see
  // `charge-obligations.ts`. The month list is the same one the rules use, so a charge and the
  // instalment it settles are always asked about together.
  const obligationByChargeId = matchObligations(
    [...paymentPlanObligations(plans), ...carChargeObligations(carFunds, months, fundingAccountId)],
    matchableCharges,
  );
  const planById = new Map(plans.map(p => [p.id, p]));
  const carFundById = new Map(carFunds.map(cf => [cf.id, cf]));

  /** One obligation as the suggestion it renders, or null when the thing it names is gone. */
  const asSuggestion = (obligation: ChargeObligation): ChargeSuggestion<R, T, P> | null => {
    if (obligation.planId) {
      const plan = planById.get(obligation.planId);
      return plan ? { plan } : null;
    }
    const cf = obligation.carFundId ? carFundById.get(obligation.carFundId) : undefined;
    if (!cf || !obligation.carChargeKind) return null;
    return {
      carCharge: {
        carFundId: cf.id,
        kind: obligation.carChargeKind,
        vehicleName: cf.vehicle_name,
        amount: Math.abs(Number(obligation.charge.amount)),
      },
    };
  };

  const suggestions: Record<string, ChargeSuggestion<R, T, P>> = {};
  /** Which unhandled charges claim each ledger row — the other half of the ambiguity guard, below. */
  const claimsByLedgerId = new Map<string, string[]>();

  for (const charge of unhandled) {
    if (rejected[charge.id]) continue;
    const rule = ruleByChargeId[charge.id];
    if (rule) { suggestions[charge.id] = { rule }; continue; }
    // Precedence, deliberate — see `ChargeSuggestion`. An obligation the app projects outranks a
    // row the user typed in by hand.
    const obligation = obligationByChargeId.get(charge.id);
    if (obligation) {
      const suggestion = asSuggestion(obligation);
      if (suggestion) { suggestions[charge.id] = suggestion; continue; }
    }
    const amount = Number(charge.amount);
    const hit = matchCharge(
      { accountId: charge.account_id, amount: Math.abs(amount), dueDate: charge.date, isInflow: amount < 0 },
      matchableLedger,
    );
    const ledgerTxn = hit ? ledgerById.get(hit.txn.id) : undefined;
    if (!ledgerTxn) continue;
    suggestions[charge.id] = { ledgerTxn };
    claimsByLedgerId.set(ledgerTxn.id, [...(claimsByLedgerId.get(ledgerTxn.id) ?? []), charge.id]);
  }

  // ⚠️ A TIGHTENING, NOT A LOOSENING, AND IT IS THE HALF `matchCharge` STRUCTURALLY CANNOT DO.
  // `matchCharge` asks "which ledger row settles THIS charge" and refuses to answer when two rows
  // are equally good — the CANDIDATE side. It is called once per charge and so cannot see the mirror
  // ambiguity: three identical $10.00 CFX tolls on 2026-08-03 each see the single $10 entry Tre made
  // and each get told, confidently, that it is theirs. One of those three is right and the app has no
  // idea which, so it must say nothing about all three rather than invite two wrong links — and this
  // matters far more now that "Accept all suggested" exists, which would otherwise point every toll
  // at one entry in a single click. Same principle as the matcher's own rule, applied on the axis a
  // per-charge call cannot reach.
  for (const [ledgerId, claimants] of claimsByLedgerId) {
    if (claimants.length < 2) continue;
    for (const chargeId of claimants) {
      if (suggestions[chargeId]?.ledgerTxn?.id === ledgerId) delete suggestions[chargeId];
    }
  }

  const needsDecision = unhandled.slice().sort((a, b) => {
    const sa = suggestions[a.id] ? 0 : 1;
    const sb = suggestions[b.id] ? 0 : 1;
    if (sa !== sb) return sa - sb;
    // Newest first within each group, matching the tab's existing order. `id` breaks ties so the
    // list cannot reshuffle itself between renders.
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });

  return { needsDecision, suggestions, suggestedCount: Object.keys(suggestions).length };
}
