import type { CarFund } from './types';
import { PROJECTION_MONTHS } from './credit-card-engine';
import type { EnrichedTransaction } from './pay-schedule';

export type CarLoanTransaction = EnrichedTransaction & { carFundId: string };

export interface LumpSumPayment {
  id: string;
  date: string; // YYYY-MM-DD (matched to schedule by year+month)
  amount: number;
  label?: string;
}

export interface LoanInput {
  loanAmount: number;
  apr: number;
  termMonths: number;
  loanStartDate: string;
  paymentStartDate: string;
  interestStartDate: string;
  actualMonthlyPayment: number;
  lumpSumPayments?: LumpSumPayment[];
  /** Today's real outstanding principal, when a connected `accounts` row supplies one (see
   * `vehicle-loan-link.ts`). The schedule then SPLICES rather than rebuilds: rows already paid
   * stay exactly as they were computed from `loanAmount` — they are the only record of what was
   * actually paid, so `interestPaidToDate` and `monthsElapsed` stay truthful — and the balance is
   * reset to this figure at the first not-yet-paid row, so everything forward projects off the
   * bank's number. Rebuilding the whole schedule from the live balance would zero the history
   * instead, which is taking information away. Undefined/null means "no reading": amortize from
   * `loanAmount` exactly as before. */
  currentBalance?: number | null;
}

export interface LoanMonthRow {
  month: number;
  date: string;
  startBalance: number;
  interest: number;
  payment: number;
  principal: number;
  endBalance: number;
  deferred: boolean;
  lumpSum: number;
}

export interface LoanProjection {
  scheduledPayment: number;
  effectivePayment: number;
  schedule: LoanMonthRow[];
  payoffMonth: number;
  payoffDate: string;
  totalInterest: number;
  totalPaid: number;
  remainingBalance: number;
  interestPaidToDate: number;
  monthsElapsed: number;
  monthsRemaining: number;
  isDeferredInterest: boolean;
  isNegativeAmortization: boolean;
}

function addMonths(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return d.toISOString().split('T')[0];
}

export function monthsBetween(fromStr: string, toStr: string): number {
  const from = new Date(fromStr + 'T00:00:00');
  const to = new Date(toStr + 'T00:00:00');
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

export function calculateScheduledPayment(loanAmount: number, apr: number, termMonths: number): number {
  if (termMonths <= 0 || loanAmount <= 0) return 0;
  if (apr === 0) return loanAmount / termMonths;
  const r = apr / 100 / 12;
  return (loanAmount * r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
}

export function buildAmortizationSchedule(input: LoanInput, asOf?: Date): LoanProjection {
  const { loanAmount, apr, termMonths, loanStartDate, paymentStartDate, interestStartDate, actualMonthlyPayment, lumpSumPayments, currentBalance } = input;
  const r = apr / 100 / 12;
  const scheduled = calculateScheduledPayment(loanAmount, apr, termMonths);
  const effectivePmt = actualMonthlyPayment > 0 ? actualMonthlyPayment : scheduled;
  const today = asOf ?? new Date();
  const todayStr = today.toISOString().split('T')[0];

  const isDeferredInterest = interestStartDate > paymentStartDate;
  let isNegativeAmortization = false;

  const schedule: LoanMonthRow[] = [];
  let balance = loanAmount;

  // Hoisted above the loop because the splice below needs to know which row is the first
  // not-yet-paid one; it is clamped to the schedule's length afterwards, as it always was.
  const monthsElapsedRaw = Math.max(0, monthsBetween(paymentStartDate, todayStr));
  const hasLiveBalance = currentBalance != null && Number.isFinite(currentBalance);
  /** The first row whose payment has not happened yet. Re-anchoring here (rather than at row 1)
   * is what keeps the paid history truthful — see `LoanInput.currentBalance`. */
  const spliceAtMonth = hasLiveBalance ? monthsElapsedRaw + 1 : null;

  for (let month = 1; month <= termMonths + 24 && balance > 0.005; month++) {
    if (spliceAtMonth !== null && month === spliceAtMonth) {
      balance = Number(currentBalance);
      // A settled loan must end the schedule, not push a zero-balance row. The loop's own
      // condition cannot catch this because the reset happens after it was evaluated.
      if (balance <= 0.005) break;
    }
    const rowDate = addMonths(paymentStartDate, month - 1);
    const deferred = rowDate < interestStartDate;
    const interest = deferred ? 0 : Math.round(balance * r * 100) / 100;

    // Extra principal from any lump sum scheduled this month
    const rowMonth = rowDate.substring(0, 7);
    const lumpSumThisMonth = (lumpSumPayments ?? [])
      .filter(ls => ls.date.substring(0, 7) === rowMonth)
      .reduce((s, ls) => s + ls.amount, 0);

    let payment = effectivePmt;
    const maxPmt = balance + interest;
    if (payment > maxPmt) payment = Math.round(maxPmt * 100) / 100;

    // Lump sum is additional principal; cap so balance never goes below 0
    const lumpSum = Math.round(Math.min(lumpSumThisMonth, Math.max(0, maxPmt - payment)) * 100) / 100;
    const totalPayment = Math.round((payment + lumpSum) * 100) / 100;

    const principal = Math.round((totalPayment - interest) * 100) / 100;
    if (principal < 0) {
      isNegativeAmortization = true;
      // balance grows — cap schedule to avoid infinite loop
      if (month > termMonths + 12) break;
    }

    const endBalance = Math.max(0, Math.round((balance - principal) * 100) / 100);

    schedule.push({ month, date: rowDate, startBalance: balance, interest, payment: totalPayment, principal, endBalance, deferred, lumpSum });
    balance = endBalance;
  }

  const payoffMonth = schedule.length;
  const payoffDate = schedule.length > 0 ? schedule[schedule.length - 1].date : paymentStartDate;
  const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
  const totalPaid = schedule.reduce((s, r) => s + r.payment, 0);

  // months elapsed since payment_start_date as of today (raw value hoisted above the loop)
  const monthsElapsed = Math.min(monthsElapsedRaw, schedule.length);

  // What is owed right now is the opening balance of the first not-yet-paid row — which is
  // where the live-balance splice lands, so a linked loan reports the bank's figure exactly.
  // For an unlinked loan this is identical to the previous expression by construction: a row's
  // startBalance IS the previous row's endBalance.
  const remainingBalance =
    schedule[monthsElapsed]?.startBalance
    ?? (hasLiveBalance ? Number(currentBalance) : undefined)
    ?? (monthsElapsed > 0 ? (schedule[monthsElapsed - 1]?.endBalance ?? loanAmount) : loanAmount);
  const interestPaidToDate = schedule.slice(0, monthsElapsed).reduce((s, r) => s + r.interest, 0);
  const monthsRemaining = Math.max(0, schedule.length - monthsElapsed);

  return {
    scheduledPayment: Math.round(scheduled * 100) / 100,
    effectivePayment: Math.round(effectivePmt * 100) / 100,
    schedule,
    payoffMonth,
    payoffDate,
    totalInterest: Math.round(totalInterest * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    remainingBalance: Math.round(remainingBalance * 100) / 100,
    interestPaidToDate: Math.round(interestPaidToDate * 100) / 100,
    monthsElapsed,
    monthsRemaining,
    isDeferredInterest,
    isNegativeAmortization,
  };
}

export interface CarLoanPaymentInfo {
  carFundId: string;
  vehicleName: string;
  payment: number;
  payoffDate: string;
  remainingBalance: number;
  isDeferredInterest: boolean;
  /** The `accounts` row this loan is also tracked as, if the user linked one — passed straight
   * through so net worth can dedupe by identity instead of matching names. */
  linkedLoanAccountId: string | null;
  /** Interest portion of THIS month's regular payment. Read straight off the amortization row
   * rather than re-derived, so the expense model and the loan schedule cannot disagree.
   * `interest + principal === payment`; on a deferred-interest month `interest` is 0. */
  interest: number;
  /** Principal portion of this month's regular payment (lump sums excluded, as with `payment`). */
  principal: number;
}

/**
 * The single source of truth for "how much is this loan for" — used by both the saving-phase
 * projection (where it's an estimate computed live from target_price/tax_fees/down_payment_goal)
 * and the loan-phase actual (where it's the stored loan_amount, frozen at activation). Before
 * this helper existed, the two phases each had their own copy of the saving-phase formula, with
 * nothing keeping them in sync — any drift between them changed the displayed payment the instant
 * phase flipped, even with "no other changes."
 */
export function getLoanPrincipal(cf: CarFund): number {
  return cf.phase === 'loan'
    ? Number(cf.loan_amount)
    : Math.max(0, Number(cf.target_price) + Number(cf.tax_fees) - Number(cf.down_payment_goal));
}

/**
 * Money already saved/gifted toward a saving-phase car's down payment, when that money sits in
 * (or defaults to) the same account being offered up as "available cash" elsewhere — so it must
 * be excluded from that cash pool, not just from the "how much more do I need to save" math.
 * Capped at down_payment_goal - gift_contribution: never earmark more than the buyer actually
 * still needs to bring from their own cash, even if current_saved happens to be larger.
 * When linked_account is a genuinely separate account, its balance already lives outside the
 * funding account's balance — earmarking it again here would double-subtract, so those car funds
 * contribute 0. Phase-gated to 'saving' only: the instant a car fund activates into a loan, it
 * stops matching this filter and the earmark disappears on its own — no separate release step,
 * which is what keeps loan activation from creating a second, unrelated cash discontinuity.
 */
export function getCarFundEarmark(
  carFunds: CarFund[], fundingAccountId: string | null, fundingAccountBalance: number | null = null,
): number {
  return carFunds.reduce((s, cf) => {
    if (cf.phase !== 'saving') return s;
    if (cf.linked_account && cf.linked_account !== fundingAccountId) return s;
    const ownCashNeeded = Math.max(0, Number(cf.down_payment_goal || 0) - Number(cf.gift_contribution || 0));
    // Only same-account / unlinked funds reach here, so the linked balance IS the funding balance.
    // The separate-account branch of getCarFundSaved is unreachable from this filter by construction.
    return s + Math.min(getCarFundSaved(cf, fundingAccountId, fundingAccountBalance), ownCashNeeded);
  }, 0);
}

/**
 * THE single source for "how much has this car fund already saved" — finding §2.10.
 *
 * Two independent rules used to live inline at ten call sites, and one of them (the earmark) was
 * missing the other, which is how §2.9's shortfall got in. Both now live here:
 *
 *  1. `saved_source === 'account_percent'` — the user declared that N% of the linked account is car
 *     money. Self-limiting: a percentage of a balance can never exceed that balance, so this mode
 *     cannot produce a §2.9 shortfall at all. Takes priority because it is an explicit user choice.
 *  2. Otherwise, a link to a *separate* account means the money demonstrably sits there, so the live
 *     balance is the honest figure — the pre-existing behavior at nine call sites. The
 *     `!== fundingAccountId` guard is load-bearing: when the linked account IS the funding account,
 *     its balance is already offered as available cash, and calling it "saved" too would count the
 *     same dollars twice. That case falls through to the typed figure and is earmarked instead.
 *  3. Otherwise, the typed `current_saved` — today's behavior and every pre-§2.10 row.
 *
 * `linkedAccountBalance` is the balance of `cf.linked_account`, or null when the caller has not
 * resolved it; a null balance always falls through to `current_saved` rather than inventing a zero.
 * Under `'fixed'` (every existing row) this returns exactly what each call site computed inline
 * before, pinned by `vehicle-loan-engine.savedSource.test.ts`, so §2.10 moves no existing figure.
 */
export function getCarFundSaved(
  cf: CarFund, fundingAccountId: string | null, linkedAccountBalance: number | null,
): number {
  if (cf.saved_source === 'account_percent' && cf.linked_account && linkedAccountBalance != null) {
    const pct = Math.min(100, Math.max(0, Number(cf.saved_percent || 0)));
    return Math.max(0, Number(linkedAccountBalance)) * (pct / 100);
  }
  if (cf.linked_account && cf.linked_account !== fundingAccountId && linkedAccountBalance != null) {
    return Number(linkedAccountBalance);
  }
  return Number(cf.current_saved || 0);
}

export interface CarFundEarmarkResolution {
  /** What the car funds claim — the raw `getCarFundEarmark` figure. */
  requested: number;
  /** What the account can actually cover. Subtract THIS from the balance. */
  applied: number;
  /** `requested − applied`: saved cash the linked account demonstrably does not hold. */
  shortfall: number;
}

/**
 * Reconcile the earmark against the balance it is earmarked FROM — finding §2.9.
 *
 * `current_saved` is a number the user types; the account balance is a number the bank reports.
 * Nothing keeps the two consistent, so a user whose down-payment savings actually sit somewhere
 * other than `linked_account` claims more than the account holds. Every caller used to absorb that
 * with its own `Math.max(0, balance - earmark)`, which is arithmetically right (cash cannot go
 * negative) but destroyed the interesting part: the user saw "Balance on hand $0" and had no way
 * to learn that $400 of their "saved" money was never in that account.
 *
 * This keeps the clamp in ONE place and returns the discarded remainder, so a UI can name it.
 * Tre's decision (2026-08-08): surface the shortfall, never silently absorb it. The resulting
 * spendable balance is `Math.max(0, balance) - applied`, which equals the old inline expression for
 * every balance — pinned by `vehicle-loan-engine.carFundEarmarkResolution.test.ts` so this refactor
 * cannot move a cash figure the whole debt engine is built on.
 */
export function resolveCarFundEarmark(
  carFunds: CarFund[], fundingAccountId: string | null, accountBalance: number,
): CarFundEarmarkResolution {
  const requested = getCarFundEarmark(carFunds, fundingAccountId, accountBalance);
  const applied = Math.min(requested, Math.max(0, accountBalance));
  return { requested, applied, shortfall: requested - applied };
}

/**
 * The car fund a "Car Goal" surface should render, or null if there is none.
 *
 * A down-payment goal only exists while the buyer is still saving. Once the fund activates into a
 * loan the car has been bought, so a saving progress bar is describing something that already
 * happened — the vehicle is represented by its payment rows and the Vehicles page instead. Callers
 * previously took `carFunds[0]`, which kept the goal on screen after activation and picked an
 * arbitrary fund when a user had several. Same phase gate as getCarFundEarmark, for the same
 * reason: activation releases the saving construct on its own, with no separate teardown step.
 */
export function getSavingPhaseCarFund(carFunds: CarFund[] | null | undefined): CarFund | null {
  return carFunds?.find(cf => cf.phase === 'saving') ?? null;
}

export function getActiveCarLoanPayments(carFunds: CarFund[], asOf?: Date): CarLoanPaymentInfo[] {
  const today = asOf ?? new Date();
  const results: CarLoanPaymentInfo[] = [];

  for (const cf of carFunds) {
    if (cf.phase !== 'loan') continue;
    if (!cf.loan_start_date || !cf.payment_start_date) continue;

    // Calendar-month comparison, not exact-date — the forecast model this feeds operates at
    // monthly granularity everywhere else (buildAmortizationSchedule's own monthsElapsed below
    // already uses monthsBetween for this same reason). An exact-date check against an arbitrary
    // representative day for "this month" (callers have used both the 1st and the 15th) made the
    // loan's effective start month depend on which day happened to be picked, not on
    // payment_start_date's actual month — causing Forecast and Debt Payoff to disagree with each
    // other, and either to disagree with the saving-phase projection's month-only anchor.
    const todayStr = today.toISOString().split('T')[0];
    if (monthsBetween(cf.payment_start_date, todayStr) < 0) continue;

    const proj = buildAmortizationSchedule({
      loanAmount: cf.loan_amount,
      apr: cf.expected_apr,
      termMonths: cf.loan_term_months,
      loanStartDate: cf.loan_start_date,
      paymentStartDate: cf.payment_start_date,
      interestStartDate: cf.interest_start_date ?? cf.payment_start_date,
      actualMonthlyPayment: cf.actual_monthly_payment,
      lumpSumPayments: cf.lump_sum_payments ?? [],
      // Resolved onto the CarFund at the data layer (`applyLinkedLoanBalances`), deliberately
      // NOT by giving this function an `accounts` parameter: it has ~12 call sites including
      // pure libs (monthly-expense-model, charge-obligations, pay-schedule) that have no
      // accounts to hand it. One seam, at the boundary.
      currentBalance: cf.current_balance_override ?? null,
    }, today);

    if (proj.remainingBalance <= 0) continue;

    // The row for the month in progress — its payment is already capped to (balance + interest)
    // by buildAmortizationSchedule, so the final payoff month correctly shows a smaller true-up
    // amount instead of the flat scheduled/actual payment. Subtract lumpSum: callers add lump sums
    // separately (e.g. carLoanLumpByMonth in Forecast.tsx), so this must stay regular-payment-only.
    const currentRow = proj.schedule[proj.monthsElapsed];
    const currentPayment = currentRow
      ? Math.round((currentRow.payment - currentRow.lumpSum) * 100) / 100
      : proj.effectivePayment;

    // Split the same row `currentPayment` came from, so the two always reconcile. Principal is
    // derived by subtraction (not read from currentRow.principal, which includes the lump sum
    // that currentPayment deliberately excludes) and floored at 0 for negative-amortization
    // months, where the payment does not even cover interest.
    const currentInterest = currentRow ? Math.min(currentRow.interest, currentPayment) : 0;
    const currentPrincipal = Math.round((currentPayment - currentInterest) * 100) / 100;

    results.push({
      carFundId: cf.id,
      vehicleName: cf.vehicle_name,
      payment: currentPayment,
      payoffDate: proj.payoffDate,
      remainingBalance: proj.remainingBalance,
      isDeferredInterest: proj.isDeferredInterest,
      interest: currentInterest,
      principal: currentPrincipal,
      linkedLoanAccountId: cf.linked_loan_account_id ?? null,
    });
  }

  return results;
}

export function getTotalCarLoanMonthly(carFunds: CarFund[], asOf?: Date): number {
  return getActiveCarLoanPayments(carFunds, asOf).reduce((s, c) => s + c.payment, 0);
}

/**
 * Transaction-row-shaped entries for every car fund's regular payments, lump sums, and insurance
 * — modeled directly on generatePaymentPlanTransactions (payment-plan-generator.ts), the
 * equivalent for debt payment plans. Covers BOTH phases: an active loan's real payments, and a
 * saving-phase car's projected future payments (using getLoanPrincipal's estimate instead of a
 * stored loan_amount) — previously loan-phase only, so a saving-phase car's projected payment and
 * insurance never showed up here at all. Regular payments and lump sums are split out of
 * buildAmortizationSchedule's combined row.payment (= regular + lumpSum) so each shows as its own
 * line item, matching how the user entered them separately in the first place. Insurance is
 * capped at a PROJECTION_MONTHS display horizon (this is for the Transactions list, not a
 * cash-flow model — unlike the indefinite-insurance behavior in
 * useCardProjection.ts/Forecast.tsx, there's no reason to generate rows forever).
 */
export function generateCarLoanTransactions(carFunds: CarFund[]): CarLoanTransaction[] {
  const results: CarLoanTransaction[] = [];
  for (const cf of carFunds) {
    // loan_start_date and planned_purchase_date represent the same real-world date — saving-
    // phase car funds only ever populate the latter (no separate "loan start" concept until a
    // loan actually exists), so fall back to it here.
    const loanStartDate = cf.loan_start_date ?? cf.planned_purchase_date;
    if (!loanStartDate || !cf.payment_start_date) continue;
    const loanAmount = getLoanPrincipal(cf);
    if (loanAmount <= 0) continue;
    const paymentSource = cf.loan_payment_account ? `account:${cf.loan_payment_account}` : '';

    const proj = buildAmortizationSchedule({
      loanAmount,
      apr: cf.expected_apr,
      termMonths: cf.loan_term_months,
      loanStartDate,
      paymentStartDate: cf.payment_start_date,
      interestStartDate: cf.interest_start_date ?? cf.payment_start_date,
      actualMonthlyPayment: cf.phase === 'loan' ? cf.actual_monthly_payment : 0,
      lumpSumPayments: cf.lump_sum_payments ?? [],
      // Only an active loan can have a live balance to re-anchor to; a saving-phase fund is a
      // projection of a loan that does not exist yet.
      currentBalance: cf.phase === 'loan' ? (cf.current_balance_override ?? null) : null,
    });

    proj.schedule.forEach((row, i) => {
      const regular = Math.round((row.payment - row.lumpSum) * 100) / 100;
      if (regular > 0) {
        // `row.principal` is the whole month's principal INCLUDING the lump sum (it is derived as
        // payment − interest, and `payment` is regular + lumpSum), so the regular row's own share
        // is what is left after the lump-sum row takes its 100%. Clamped because a negative-
        // amortization month has a negative principal, and a display sub-line must not go below 0.
        const regularPrincipal = Math.max(0, Math.round((row.principal - row.lumpSum) * 100) / 100);
        results.push({
          id: `carloan:${cf.id}:${i}`,
          date: row.date,
          type: 'expense',
          amount: regular,
          category: 'Auto Loan',
          note: `${cf.vehicle_name} Payment (${i + 1}/${proj.schedule.length})`,
          payment_source: paymentSource,
          account: '',
          isGenerated: true,
          isCarLoanPayment: true,
          principalPortion: regularPrincipal,
          carFundId: cf.id,
        });
      }
      if (row.lumpSum > 0) {
        results.push({
          id: `carloanlump:${cf.id}:${i}`,
          date: row.date,
          type: 'expense',
          amount: row.lumpSum,
          category: 'Auto Loan',
          note: `${cf.vehicle_name} Extra Payment`,
          payment_source: paymentSource,
          account: '',
          isGenerated: true,
          isCarLoanPayment: true,
          // A lump sum is extra principal by definition — no interest attaches to it.
          principalPortion: row.lumpSum,
          carFundId: cf.id,
        });
      }
    });

    if (Number(cf.monthly_insurance) > 0) {
      const start = new Date(cf.payment_start_date + 'T00:00:00');
      for (let m = 0; m < PROJECTION_MONTHS; m++) {
        const d = new Date(start.getFullYear(), start.getMonth() + m, start.getDate());
        results.push({
          id: `carloanins:${cf.id}:${m}`,
          date: d.toISOString().split('T')[0],
          type: 'expense',
          amount: Number(cf.monthly_insurance),
          category: 'Insurance',
          note: `${cf.vehicle_name} Insurance`,
          payment_source: paymentSource,
          account: '',
          isGenerated: true,
          isCarLoanPayment: true,
          carFundId: cf.id,
        });
      }
    }
  }
  return results;
}
