import type { CarFund } from './types';

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

function monthsBetween(fromStr: string, toStr: string): number {
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
  const { loanAmount, apr, termMonths, loanStartDate, paymentStartDate, interestStartDate, actualMonthlyPayment, lumpSumPayments } = input;
  const r = apr / 100 / 12;
  const scheduled = calculateScheduledPayment(loanAmount, apr, termMonths);
  const effectivePmt = actualMonthlyPayment > 0 ? actualMonthlyPayment : scheduled;
  const today = asOf ?? new Date();
  const todayStr = today.toISOString().split('T')[0];

  const isDeferredInterest = interestStartDate > paymentStartDate;
  let isNegativeAmortization = false;

  const schedule: LoanMonthRow[] = [];
  let balance = loanAmount;

  for (let month = 1; month <= termMonths + 24 && balance > 0.005; month++) {
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

  // months elapsed since payment_start_date as of today
  let monthsElapsed = Math.max(0, monthsBetween(paymentStartDate, todayStr));
  monthsElapsed = Math.min(monthsElapsed, schedule.length);

  const remainingBalance = monthsElapsed > 0 ? (schedule[monthsElapsed - 1]?.endBalance ?? loanAmount) : loanAmount;
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

export function getActiveCarLoanPayments(carFunds: CarFund[], asOf?: Date): CarLoanPaymentInfo[] {
  const today = asOf ?? new Date();
  const results: CarLoanPaymentInfo[] = [];

  for (const cf of carFunds) {
    if (cf.phase !== 'loan') continue;
    if (!cf.loan_start_date || !cf.payment_start_date) continue;

    const paymentStart = new Date(cf.payment_start_date + 'T00:00:00');
    if (today < paymentStart) continue;

    const proj = buildAmortizationSchedule({
      loanAmount: cf.loan_amount,
      apr: cf.expected_apr,
      termMonths: cf.loan_term_months,
      loanStartDate: cf.loan_start_date,
      paymentStartDate: cf.payment_start_date,
      interestStartDate: cf.interest_start_date ?? cf.payment_start_date,
      actualMonthlyPayment: cf.actual_monthly_payment,
      lumpSumPayments: cf.lump_sum_payments ?? [],
    }, today);

    if (proj.remainingBalance <= 0) continue;

    results.push({
      carFundId: cf.id,
      vehicleName: cf.vehicle_name,
      payment: proj.effectivePayment,
      payoffDate: proj.payoffDate,
      remainingBalance: proj.remainingBalance,
      isDeferredInterest: proj.isDeferredInterest,
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
 * capped at a 36-month display horizon (this is for the Transactions list, not a cash-flow
 * model — unlike the indefinite-insurance behavior in useCardProjection.ts/Forecast.tsx, there's
 * no reason to generate rows forever).
 */
export function generateCarLoanTransactions(carFunds: CarFund[]): any[] {
  const results: any[] = [];
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
    });

    proj.schedule.forEach((row, i) => {
      const regular = Math.round((row.payment - row.lumpSum) * 100) / 100;
      if (regular > 0) {
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
          carFundId: cf.id,
        });
      }
    });

    if (Number(cf.monthly_insurance) > 0) {
      const start = new Date(cf.payment_start_date + 'T00:00:00');
      for (let m = 0; m < 36; m++) {
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
