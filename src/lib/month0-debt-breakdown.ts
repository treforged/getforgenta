/**
 * Canonical current-month debt breakdown.
 *
 * There used to be two debt engines. `getMonthlyDebtBreakdown` /
 * `getCurrentMonthDebtRecommendations` in credit-card-engine.ts run their own
 * one-shot recommendation pass, while Debt Payoff, Forecast and the Dashboard
 * debt widget read `useCardProjection`'s converged pass-3 month 0. The two
 * disagreed — different cash floor, save-up reserves, income timing and goal
 * handling — which is what made Budget Control's "matches Debt tab Safe to Pay"
 * claim false and put a different Chase Sapphire payment on /transactions than
 * on /debt.
 *
 * This module derives the same `MonthlyDebtBreakdown` shape the legacy engine
 * returned, but entirely from `cardProjection.month0`, so every surface reads
 * one number. Extracted verbatim from Dashboard's `dashboardDebtRecs`.
 *
 * `buildCardRecRows` below is the ONE construction of a recommendation row —
 * /debt's "Recommended This Month" panel and the Dashboard widget both call it,
 * so the two surfaces cannot drift apart again (the widget spent a day showing
 * the old due-chip layout after the panel had moved to leading with the next
 * payment — one derivation, or that happens again).
 */
import { m0MinDueSettled } from '@/lib/credit-card-engine';
import { isSimCardOpenAsOf } from '@/lib/card-start-date';
import { hasPinnedStatement } from '@/lib/statement-pin';
import { nextPaymentDueDate } from '@/lib/next-card-payment';
import { getActiveCarLoanPayments } from '@/lib/vehicle-loan-engine';
import {
  listDebtServiceLiabilities,
  type DebtServiceAccountInput, type DebtServiceRuleInput, type LiabilityDebtInput,
} from '@/lib/non-cc-liabilities';
import type { CardData, MonthlyDebtBreakdown } from '@/lib/credit-card-engine';
import type { Month0Result } from '@/lib/debt-model-types';
import type { CarFund } from '@/lib/types';

export interface Month0DebtBreakdownInput {
  /** Converged pass-3 month 0 from useCardProjection; null before the projection resolves. */
  month0: Month0Result | null | undefined;
  /** Cards the sim actually ran on — same list month0.perCardAdjusted indexes. */
  simCards: CardData[];
  debtStrategy: 'avalanche' | 'snowball';
  /** Plaid last-synced date; payments already due before it are treated as settled. */
  syncCutoffDate: string;
  /** Month-1 per-card payment series for the next-payment headline: pass-3-scaled first (the
   * cash-floor-constrained figure — what the plan can actually send), raw sim otherwise.
   * Absent ⇒ month-1 figures are null and render as "Not modelled", never zero. */
  nextMonthSource?: { id: string; payments: number[] }[] | null;
  /** Car funds, for the loan rows. Absent ⇒ no loan rows, same as before loans joined. */
  carFunds?: CarFund[];
  /**
   * Raw `accounts` / `debts` / `recurring_rules`, for the non-CC liability rows (student loan,
   * mortgage, other liability). All three are needed or none is: the pairing rule that decides
   * which liability is real reads all three. Absent ⇒ no such rows, exactly as `carFunds` absent
   * means no loan rows.
   */
  accounts?: readonly DebtServiceAccountInput[];
  debts?: readonly LiabilityDebtInput[];
  rules?: readonly DebtServiceRuleInput[];
  /** Accounts a `car_funds` loan is linked to; the car fund carries those, and they already have
   *  a loan row. */
  excludedAccountIds?: ReadonlySet<string>;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

/** One card row, exactly as both recommendation surfaces render it. */
export interface CardRecRow {
  cardId: string;
  cardName: string;
  color: string;
  /** THIS month's engine-pinned payment (month0.perCardAdjusted) — feeds the injected
   * transactions and the demoted "due this month" sub-line, never the headline on its own. */
  payment: number;
  maxPayment: number;
  dueDay: number | null;
  pastDue: boolean;
  nextPayment: number | null;
  nextPayMonth: 0 | 1;
  nextDueDate: Date | null;
  reason: string;
  isMinimumOnly: boolean;
}

export interface CardRecRowsInput {
  /** month0.perCardAdjusted — the integers the engine itself was pinned to. */
  perCardAdjusted: Month0Result['perCardAdjusted'];
  cards: CardData[];
  strategy: 'avalanche' | 'snowball';
  /** See Month0DebtBreakdownInput.nextMonthSource. */
  nextMonthSource?: { id: string; payments: number[] }[] | null;
  now: Date;
}

/**
 * The shared card-row construction: next-payment headline, calendar-derived due date, and a
 * reason/badge computed against the SAME figure the row leads with. Extracted verbatim from
 * CreditCardEngine's `month0Recs` (the A.2 layout) so the Dashboard widget reads identical rows.
 */
export function buildCardRecRows({
  perCardAdjusted, cards, strategy, nextMonthSource, now,
}: CardRecRowsInput): CardRecRow[] {
  const todayDay = now.getDate();
  // A card whose card_start_date has not arrived cannot receive a payment this month.
  // Display layer only — the simulation still models it turning on (cardStartMonths).
  // ⚠️ Keyed on the cards KNOWN to be unopened, never on "not in the open set". A
  // perCardAdjusted entry with no matching card row is a payment the sim made on a card
  // this list cannot describe, and it is still shown (neutral colour, no due day) — hiding a
  // recommended payment because the row went missing is the opposite of the fix.
  const unopenedCardIds = new Set(cards.filter(c => !isSimCardOpenAsOf(c, now)).map(c => c.id));
  return perCardAdjusted.filter(item => !unopenedCardIds.has(item.id)).map(item => {
    const card = cards.find(c => c.id === item.id);
    const dueDay = card?.dueDay ?? null;
    // Due date already passed this month → payment is next month's, just save for it.
    const pastDue = !card?.autopayFullBalance && dueDay !== null && dueDay < todayDay;
    // The month the NEXT payment lands in. Derived from the CALENDAR, not from `pastDue`:
    // `pastDue` is forced false for every autopay/cycling card by its leading
    // `!card?.autopayFullBalance` guard, because it gates the "saving" badge rather than the
    // date. Reusing it would hand a cycling card whose due day has already gone by a date
    // EARLIER THIS MONTH and present it as upcoming, which is the bug this panel is being
    // fixed for, one card type over.
    const dueDayPassed = dueDay !== null && dueDay < todayDay;
    const nextPayMonth: 0 | 1 = dueDayPassed ? 1 : 0;
    // The month a pinned statement lands in, `deriveIsbPins`' own rule verbatim. It differs
    // from nextPayMonth for a card with NO recorded due day: the engine assumes month 1 there,
    // this display refuses to name a month it does not know, so such a row is never labelled
    // against a statement it cannot place.
    const pinMonth: 0 | 1 = dueDay != null && dueDay >= todayDay ? 0 : 1;
    const nextDueDate = nextPaymentDueDate(dueDay, nextPayMonth, now);
    // NO `?? 0` ANYWHERE ON THIS PATH. A missing array must reach the render as null so it can
    // say so; a zero here is the very bug this change exists to remove, moved one month over.
    let nextPayment: number | null;
    if (nextPayMonth === 0) {
      nextPayment = item.payment;
    } else {
      const series = nextMonthSource?.find(p => p.id === item.id)?.payments;
      const raw = series?.[1];
      nextPayment = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    }
    let reason: string;
    let isMinimumOnly = false;
    if (card?.autopayFullBalance || (card && card.balance <= 0)) {
      // Cycling / zero-balance card — show preference-aware label
      if (card?.paymentPreference === 'statement') reason = 'Statement balance';
      else if (card?.paymentPreference === 'full') reason = 'Full balance';
      else reason = 'Autopay Full Balance';
    } else if (nextPayment == null) {
      // The projection has not resolved a payment for that month, so nothing can be said about
      // what it covers. Classifying an amount that does not exist is how "Not modelled" would
      // otherwise end up sitting beside a confident "Avalanche priority" on the same line.
      reason = '';
    } else if (card && hasPinnedStatement(card, now) && pinMonth === nextPayMonth) {
      // The engine pays this card's statement in its due month (deriveIsbPins →
      // manualStatementByCard), but only as far as the cash above the floor reaches: the
      // uncovered remainder breaks grace and accrues at the standard rate (credit-card-engine's
      // partial-ISB model). So the label has to test COVERAGE, not just eligibility, or the row
      // promises interest avoidance the plan does not deliver — live today on Prime Visa, whose
      // row read "Statement balance" beside $2,217 of a $2,845 statement.
      // `card.balance` is the outer cap for the same reason the engine caps at the modelled
      // revolving balance: never claim a shortfall against more than is owed. It is the total
      // balance rather than the revolving one, so the test errs toward "Partial statement".
      const statementTarget = Math.min(card.statementBalance ?? 0, card.balance);
      reason = nextPayment >= statementTarget - 0.01 ? 'Statement balance' : 'Partial statement';
    } else {
      const min = Math.min(card?.minPayment ?? 0, card?.balance ?? 0);
      isMinimumOnly = nextPayment <= min + 0.01;
      reason = isMinimumOnly
        ? 'Minimum payment'
        : strategy === 'avalanche'
          ? 'Avalanche priority'
          : 'Snowball priority';
    }
    return {
      cardId: item.id,
      cardName: item.name,
      color: card?.color ?? '#888',
      payment: item.payment,
      maxPayment: item.maxPayment,
      dueDay,
      pastDue,
      nextPayment,
      nextPayMonth,
      nextDueDate,
      reason,
      isMinimumOnly,
    };
  });
}

/** One loan row — see MonthlyDebtBreakdown.loanRecommendations for why this is a separate list. */
export type LoanRecRow = NonNullable<MonthlyDebtBreakdown['loanRecommendations']>[number];

/**
 * Active loan-phase vehicle loans as recommendation rows, same calendar rule as the card rows.
 * Everything comes off the amortization schedule (`getActiveCarLoanPayments`): the payment is
 * true-up-capped on the final month and excludes lump sums.
 */
export function buildLoanRecommendations(carFunds: CarFund[], now: Date = new Date()): LoanRecRow[] {
  const todayDay = now.getDate();
  const rows: LoanRecRow[] = [];
  for (const info of getActiveCarLoanPayments(carFunds, now)) {
    // Same calendar rule as the card rows: a due day already gone by means the next payment
    // is next month's.
    const dueDayPassed = info.dueDay !== null && info.dueDay < todayDay;
    const nextPayMonth: 0 | 1 = dueDayPassed ? 1 : 0;
    const nextPayment = nextPayMonth === 0 ? info.payment : info.nextMonthPayment;
    // Due day passed AND no next-month row ⇒ this month's payment was the loan's last. There is
    // nothing upcoming to recommend, so the row is dropped rather than shown with an invented
    // figure — the loan itself still lives on the Vehicles page.
    if (nextPayment == null) continue;
    rows.push({
      carFundId: info.carFundId,
      name: info.vehicleName,
      payment: info.payment,
      dueDay: info.dueDay,
      nextPayment,
      nextPayMonth,
      nextDueDate: nextPaymentDueDate(info.dueDay, nextPayMonth, now),
      isFinalPayment: nextPayMonth === 0 ? info.isFinalPayment : info.nextIsFinalPayment,
    });
  }
  return rows;
}

/** One non-CC liability row — see MonthlyDebtBreakdown.otherDebtRecommendations. */
export type OtherDebtRecRow = NonNullable<MonthlyDebtBreakdown['otherDebtRecommendations']>[number];

/**
 * Non-credit-card, non-vehicle debts as recommendation rows: a student loan, a mortgage, an
 * `other_liability` account paired to a `debts` row. Same calendar rule as the card and loan rows.
 *
 * ⚠️ WHAT THIS WILL NOT DO. It will not invent a due date — `accounts.payment_due_day` is the only
 * source, it is null on most liability rows (the Accounts form offers that field for credit cards
 * only), and a null reaches the render as null so the row can say it does not know. It will not
 * print a $0 recommendation either: a `debts` row with neither a `target_payment` nor a
 * `min_payment` describes a debt nobody has said how to pay, and the row is dropped rather than
 * shown paying nothing.
 *
 * The payment is capped at the balance-with-interest, so a final payment shows the true-up rather
 * than the nominal figure — the same courtesy `getActiveCarLoanPayments` does for a vehicle loan,
 * and it is computed with the same one-month step `buildNonCCLiabilities.projectBalances` uses so
 * the row and the projected balance cannot disagree about when the debt ends.
 */
export function buildOtherDebtRecommendations(params: {
  accounts: readonly DebtServiceAccountInput[];
  debts: readonly LiabilityDebtInput[];
  rules: readonly DebtServiceRuleInput[];
  excludedAccountIds?: ReadonlySet<string>;
  now?: Date;
}): OtherDebtRecRow[] {
  const now = params.now ?? new Date();
  const todayDay = now.getDate();
  const rows: OtherDebtRecRow[] = [];
  for (const l of listDebtServiceLiabilities(params)) {
    if (!(l.payment > 0)) continue;
    const monthlyRate = l.apr / 1200;
    /** What one scheduled payment retires, given the interest that accrues first. */
    const owedAfter = (balance: number) =>
      Math.max(0, balance * (1 + monthlyRate) - l.payment);
    const dueThisMonth = Math.min(l.payment, l.balance * (1 + monthlyRate));
    if (dueThisMonth <= 0) continue;

    // Same calendar rule as the card and loan rows: a due day already gone by means the next
    // payment is next month's. A liability with NO recorded due day is not past due — nothing is
    // known about it — so it reads as this month, which is the conservative half of the guess.
    const dueDayPassed = l.dueDay !== null && l.dueDay < todayDay;
    const nextPayMonth: 0 | 1 = dueDayPassed ? 1 : 0;
    const balanceNextMonth = owedAfter(l.balance);
    // Due day passed AND nothing left after this month's payment ⇒ that payment was the last one.
    // Nothing upcoming to recommend, so the row is dropped rather than shown with an invented
    // figure — the same rule the loan rows follow.
    if (nextPayMonth === 1 && balanceNextMonth <= 0) continue;
    const nextPayment = nextPayMonth === 0
      ? dueThisMonth
      : Math.min(l.payment, balanceNextMonth * (1 + monthlyRate));

    rows.push({
      accountId: l.id,
      name: l.name,
      accountType: l.account_type,
      payment: dueThisMonth,
      dueDay: l.dueDay,
      nextPayment,
      nextPayMonth,
      nextDueDate: nextPaymentDueDate(l.dueDay, nextPayMonth, now),
      isFinalPayment: nextPayMonth === 0 ? balanceNextMonth <= 0 : owedAfter(balanceNextMonth) <= 0,
      paidByExpenseRule: l.paidByExpenseRule,
    });
  }
  return rows;
}

export function emptyMonth0DebtBreakdown(
  debtStrategy: 'avalanche' | 'snowball',
): MonthlyDebtBreakdown {
  return {
    recommendations: [],
    loanRecommendations: [],
    otherDebtRecommendations: [],
    totalMinimumsDue: 0,
    totalRecommended: 0,
    totalAvailableCash: 0,
    autopayTotal: 0,
    strategyLabel: debtStrategy === 'avalanche' ? 'Avalanche' : 'Snowball',
    cashWarning: false,
    interestAvoided: 0,
  };
}

export function buildMonth0DebtBreakdown({
  month0,
  simCards,
  debtStrategy,
  syncCutoffDate,
  nextMonthSource,
  carFunds,
  accounts,
  debts,
  rules,
  excludedAccountIds,
  now = new Date(),
}: Month0DebtBreakdownInput): MonthlyDebtBreakdown {
  const strategyLabel = debtStrategy === 'avalanche' ? 'Avalanche' : 'Snowball';
  // Loans read the amortization schedule, not the projection, so they survive an unresolved
  // month0 — a real payment does not stop being due because the card sim has not settled.
  const loanRecommendations = buildLoanRecommendations(carFunds ?? [], now);
  // Non-CC liabilities read the `accounts`/`debts` pairing, likewise not the projection, and
  // survive an unresolved month0 for exactly the same reason.
  const otherDebtRecommendations = buildOtherDebtRecommendations({
    accounts: accounts ?? [], debts: debts ?? [], rules: rules ?? [], excludedAccountIds, now,
  });
  if (!month0 || simCards.length === 0) {
    return { ...emptyMonth0DebtBreakdown(debtStrategy), loanRecommendations, otherDebtRecommendations };
  }

  const totalAvailableCash = month0.safeToPayTotal;

  // A card whose `card_start_date` has not arrived is one the user has PLANNED, not opened.
  // It cannot receive a payment this month and it owes nothing today, so it belongs in no
  // part of this breakdown. It stays in the simulation (`cardStartMonths`) — that is where
  // it is supposed to turn on — which is why the filter lives here, at the display layer.
  // (buildCardRecRows applies the same filter to the recommendation rows.)
  const openCards = simCards.filter(c => isSimCardOpenAsOf(c, now));

  // "Is this card's month-0 minimum already paid?" is exactly what `m0MinDueSettled` decides for
  // the engine. This used to open-code the inverse (`dueDateStr > syncCutoffDate`), so the number
  // shown here could disagree with the number the engine reserved — §1.1 cause C in miniature.
  const totalMinimumsDue = openCards
    .filter(c => !c.autopayFullBalance && c.balance > 0)
    .filter(c => !m0MinDueSettled(c.dueDay, syncCutoffDate, now))
    .reduce((s, c) => s + Math.min(c.minPayment, c.balance), 0);

  const autopayTotal = openCards
    .filter(c => c.autopayFullBalance)
    .reduce((s, c) => s + c.monthlyNewPurchases, 0);

  const recommendations = buildCardRecRows({
    perCardAdjusted: month0.perCardAdjusted,
    cards: simCards,
    strategy: debtStrategy,
    nextMonthSource,
    now,
  });

  // Card-only, deliberately: the loan payment is already held by the cash floor (carLoanTotal in
  // the floor formula), so Safe to Pay never contained that money — summing loans in here would
  // double-count it against the totals Dashboard reads. The non-CC liabilities stay out for the
  // same reason one level along: `buildOtherDebtPaymentSchedule` has already taken their cash out of
  // `cashPreDebt` before Safe to Pay is computed at all.
  const totalRecommended = recommendations.reduce((s, r) => s + r.payment, 0);
  const cashWarning = Math.ceil(totalAvailableCash - totalMinimumsDue) < 0;

  return {
    recommendations,
    loanRecommendations,
    otherDebtRecommendations,
    totalMinimumsDue,
    totalRecommended,
    totalAvailableCash,
    autopayTotal,
    strategyLabel,
    cashWarning,
    interestAvoided: 0,
  };
}
