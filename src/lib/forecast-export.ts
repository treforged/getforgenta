// Builds the detailed month-by-month money-flow + account-balance breakdown used by the
// Forecast PDF/CSV exports. Mirrors Forecast.tsx's own "Month Breakdown" drawer (openDrawer)
// field-for-field and formula-for-formula — including the per-card debt-payment scaling and the
// revolving/cycling balance selection — so the export can never show different numbers than the
// in-app popup for the same month. If that drawer's logic changes, this needs the same change.

import { cumulativeSurplusesByCard, adjustedDisplayBalance } from './step3-display';

export interface ForecastFlowItem {
  label: string;
  amount: number;
}

interface NamedAmountItem {
  name: string;
  amount: number;
  isPurchaseMonth?: boolean;
  fromAcctName?: string | null;
}

interface NamedBalanceItem {
  name: string;
  balance: number;
}

/** One target's ranked automatic extra payment for a month — `ForecastMonthRow.autoExtraItems`. */
export interface AutoExtraFlowItem {
  name: string;
  kind: 'goal' | 'car_fund' | 'loan' | 'liability';
  amount: number;
}

/**
 * What a ranked automatic extra payment is CALLED, on the drawer and in the export alike.
 *
 * Defined once and imported by `MonthlyBreakdownTable` because those two surfaces are required to
 * print the same line for the same month (see this file's header) — two copies of a label is how
 * that promise quietly stops being true. A debt target's extra is a PAYMENT (it retires principal);
 * a goal's or a saving car fund's is a CONTRIBUTION (it lands in an account the user still owns).
 * Both leave checking, so both are an outflow either way.
 */
export function autoExtraFlowLabel(item: AutoExtraFlowItem): string {
  return item.kind === 'loan' || item.kind === 'liability'
    ? `${item.name} — Extra Payment`
    : `${item.name} — Extra Contribution`;
}

/** Only the fields this module reads off a Forecast.tsx projection row — not the row's full
 * (much larger) shape, which lives in Forecast.tsx itself. Every field optional/loose on purpose:
 * this is a read-only structural subset, not the canonical row type. */
interface ForecastExportRow {
  month?: string;
  startingCash?: number;
  endingCash?: number;
  monthMinSafe?: number;
  netWorth?: number;
  totalAssets?: number;
  totalLiabilities?: number;
  paycheckIncome?: number;
  takeHome?: number;
  otherIncome?: number;
  bonusIncome?: number;
  taxReturnIncome?: number;
  baseExpenses?: number;
  debtPayment?: number;
  displayDebtPayment?: number;
  savingsGoalItems?: NamedAmountItem[];
  savingsContrib?: number;
  carContribItems?: NamedAmountItem[];
  carContrib?: number;
  otherDebtPayment?: number;
  carLoanPayment?: number;
  vehicleDownPayment?: number;
  vehicleInsurance?: number;
  projectedCarLoan?: number;
  carLumpItems?: NamedAmountItem[];
  carLoanExtraPayment?: number;
  autoExtraItems?: AutoExtraFlowItem[];
  lumpSumSavings?: number;
  lumpSumBrokerage?: number;
  lumpSumRothIra?: number;
  transferBreakdown?: NamedAmountItem[];
  businessContrib?: number;
  oneTimeNet?: number;
  nonCashTransferItems?: NamedAmountItem[];
  otherAccountExpenseItems?: NamedAmountItem[];
  assetBreakdown?: { bucket: string; name: string; balance: number }[];
  nonCCLiabBreakdown?: NamedBalanceItem[];
  carLoanBreakdown?: NamedBalanceItem[];
}

interface PerCardAdjustedRec {
  name: string;
  payment: number;
}

interface PerCardPaymentSeries {
  name: string;
  id: string;
  payments: number[];
  surpluses?: number[];
}

interface SimCardShape {
  id: string;
  name: string;
}

/** Only the fields this module reads off useCardProjection's CardProjectionResult — see the same
 * note as ForecastExportRow above. */
interface ForecastExportCardProjectionData {
  month0?: { perCardAdjusted?: PerCardAdjustedRec[] };
  perCardPaymentsScaled?: PerCardPaymentSeries[];
  perCardPayments?: PerCardPaymentSeries[];
  simCards?: SimCardShape[];
  monthlyRevolvingBalances?: Map<string, number[]>;
  monthlyBalances?: Map<string, number[]>;
  data?: Record<string, number>[];
}

export interface ForecastAccountLine {
  label: string;
  amount: number;
}

export interface ForecastMonthDetail {
  month: string;
  startingCash: number;
  endingCash: number;
  cashFloor: number;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  income: ForecastFlowItem[];
  expenses: ForecastFlowItem[];
  /** Money that moved between the user's own accounts with no net cash impact (e.g. linked
   * savings transfers, other-account expenses) — shown separately so it's visible without being
   * double-counted against income/expenses. */
  internalTransfers: ForecastFlowItem[];
  retirementAccounts: ForecastAccountLine[];
  investmentAccounts: ForecastAccountLine[];
  savingsAccounts: ForecastAccountLine[];
  creditCards: ForecastAccountLine[];
  otherLiabilities: ForecastAccountLine[];
  carLoans: ForecastAccountLine[];
}

/** Mirrors Forecast.tsx openDrawer's per-card debt-payment breakdown (month 0 uses engine
 * recommendations; later months scale the simulation's per-card amounts to the actual capped
 * total) exactly, just returning raw numbers instead of formatted JSX lines. */
function getPerCardDebtBreakdown(row: ForecastExportRow, absoluteI: number, cardProjectionData: ForecastExportCardProjectionData | null): { name: string; amount: number }[] {
  const fallbackAmt = row.displayDebtPayment ?? row.debtPayment ?? 0;
  const fallback = fallbackAmt > 0 ? [{ name: 'Debt Payments', amount: fallbackAmt }] : [];

  if (absoluteI === 0 && cardProjectionData?.month0?.perCardAdjusted) {
    const engineRecs = cardProjectionData.month0.perCardAdjusted.filter(r => r.payment > 0);
    return engineRecs.length > 0
      ? engineRecs.map(r => ({ name: r.name, amount: r.payment }))
      : fallback;
  }

  const perCard = cardProjectionData?.perCardPaymentsScaled ?? cardProjectionData?.perCardPayments;
  if (!perCard) return fallback;
  const rawAmounts = perCard
    .map(c => ({ name: c.name, amt: c.payments[absoluteI] ?? 0 }))
    .filter(c => c.amt > 0);
  if (rawAmounts.length === 0) return fallback;
  const rawSum = rawAmounts.reduce((s, c) => s + c.amt, 0);
  const scale = rawSum > 0 ? (row.debtPayment ?? rawSum) / rawSum : 1;
  const lines = rawAmounts
    .map(c => ({ name: c.name, amount: c.amt * scale }))
    .filter(c => c.amount > 0.005);
  return lines.length > 0 ? lines : fallback;
}

/** Mirrors Forecast.tsx openDrawer's per-card balance formula exactly: revolving cards read
 * monthlyBalances minus the cumulative PASS-3 surplus already routed to the card (shared
 * step3-display adjustment — same numbers as the popup and Debt Payoff accordion); cycling cards
 * fall back to the cycling statement balance stored on cardProjectionData.data[i][card.name]. */
function getCreditCardBalances(absoluteI: number, cardProjectionData: ForecastExportCardProjectionData | null): ForecastAccountLine[] {
  const cards = cardProjectionData?.simCards ?? [];
  const cumSurplus = cumulativeSurplusesByCard(
    (cardProjectionData?.perCardPaymentsScaled ?? []).map(c => ({ id: c.id, surpluses: c.surpluses ?? [] })),
  );
  return cards.map(card => {
    const revBal = cardProjectionData?.monthlyRevolvingBalances?.get(card.id)?.[absoluteI] ?? 0;
    const simBal = cardProjectionData?.monthlyBalances?.get(card.id)?.[absoluteI] ?? 0;
    const cyclingBal = cardProjectionData?.data?.[absoluteI]?.[card.name] ?? 0;
    const cum = cumSurplus.get(card.id)?.[absoluteI] ?? 0;
    const balance = revBal > 0 ? adjustedDisplayBalance(simBal, cum) : cyclingBal;
    return { label: card.name, amount: Math.round(balance) };
  });
}

export function buildForecastMonthDetail(row: ForecastExportRow, absoluteI: number, cardProjectionData: ForecastExportCardProjectionData | null): ForecastMonthDetail {
  const income: ForecastFlowItem[] = [];
  const expenses: ForecastFlowItem[] = [];

  const paycheck = row.paycheckIncome ?? row.takeHome ?? 0;
  if (paycheck > 0) income.push({ label: 'Paycheck', amount: paycheck });
  if ((row.otherIncome ?? 0) > 0) income.push({ label: 'Other Income', amount: row.otherIncome ?? 0 });
  if ((row.bonusIncome ?? 0) > 0) income.push({ label: 'Bonus', amount: row.bonusIncome ?? 0 });
  if ((row.taxReturnIncome ?? 0) > 0) income.push({ label: 'Tax Return', amount: row.taxReturnIncome ?? 0 });
  else if ((row.taxReturnIncome ?? 0) < 0) expenses.push({ label: 'Tax Owed', amount: Math.abs(row.taxReturnIncome ?? 0) });

  if ((row.baseExpenses ?? 0) > 0) expenses.push({ label: 'Bills & Expenses', amount: row.baseExpenses ?? 0 });

  for (const c of getPerCardDebtBreakdown(row, absoluteI, cardProjectionData)) {
    expenses.push({ label: `Debt: ${c.name}`, amount: c.amount });
  }

  if ((row.savingsGoalItems?.length ?? 0) > 0) {
    for (const g of row.savingsGoalItems ?? []) if (g.amount > 0) expenses.push({ label: `Goal: ${g.name}`, amount: g.amount });
  } else if ((row.savingsContrib ?? 0) > 0) {
    expenses.push({ label: 'Savings Goals', amount: row.savingsContrib ?? 0 });
  }

  if ((row.carContribItems?.length ?? 0) > 0) {
    for (const v of row.carContribItems ?? []) {
      if (v.amount > 0) expenses.push({ label: v.isPurchaseMonth ? `${v.name} (Down Payment)` : `Reserving for ${v.name}`, amount: v.amount });
    }
  } else if ((row.carContrib ?? 0) > 0) {
    expenses.push({ label: 'Car Fund Reserve', amount: row.carContrib ?? 0 });
  }

  if ((row.otherDebtPayment ?? 0) > 0) expenses.push({ label: 'Other Loan Payments', amount: row.otherDebtPayment ?? 0 });
  if ((row.carLoanPayment ?? 0) > 0) expenses.push({ label: 'Car Loan Payment', amount: row.carLoanPayment ?? 0 });
  if ((row.vehicleDownPayment ?? 0) > 0) expenses.push({ label: 'Vehicle Down Payment', amount: row.vehicleDownPayment ?? 0 });
  if ((row.vehicleInsurance ?? 0) > 0) expenses.push({ label: 'Vehicle Insurance', amount: row.vehicleInsurance ?? 0 });
  if ((row.projectedCarLoan ?? 0) > 0) expenses.push({ label: 'Est. Car Loan (Projected)', amount: row.projectedCarLoan ?? 0 });

  if ((row.carLumpItems?.length ?? 0) > 0) {
    for (const v of row.carLumpItems ?? []) if (v.amount > 0) expenses.push({ label: `${v.name} — Extra Payment`, amount: v.amount });
  } else if ((row.carLoanExtraPayment ?? 0) > 0) {
    expenses.push({ label: 'Car Loan Extra Payment', amount: row.carLoanExtraPayment ?? 0 });
  }

  // The ranked automatic extras, beside the hand-entered lump sums directly above because they are
  // the same event to the reader: money that left checking this month on top of the schedule. The
  // engine already subtracted them from the month's cash — itemising them here is what makes this
  // list of terms reach the Ending Cash printed under it.
  for (const x of row.autoExtraItems ?? []) {
    if (x.amount > 0) expenses.push({ label: autoExtraFlowLabel(x), amount: x.amount });
  }

  if ((row.lumpSumSavings ?? 0) > 0) expenses.push({ label: 'Lump Sum → Savings', amount: row.lumpSumSavings ?? 0 });
  if ((row.lumpSumBrokerage ?? 0) > 0) expenses.push({ label: 'Lump Sum → Brokerage', amount: row.lumpSumBrokerage ?? 0 });
  if ((row.lumpSumRothIra ?? 0) > 0) expenses.push({ label: 'Lump Sum → Roth IRA', amount: row.lumpSumRothIra ?? 0 });

  for (const t of row.transferBreakdown ?? []) if (t.amount > 0) expenses.push({ label: t.name, amount: t.amount });
  if ((row.businessContrib ?? 0) > 0) expenses.push({ label: 'Business Contributions', amount: row.businessContrib ?? 0 });

  if ((row.oneTimeNet ?? 0) > 0) income.push({ label: 'One-Time Income', amount: row.oneTimeNet ?? 0 });
  else if ((row.oneTimeNet ?? 0) < 0) expenses.push({ label: 'One-Time Expense', amount: Math.abs(row.oneTimeNet ?? 0) });

  const internalTransfers: ForecastFlowItem[] = [
    ...(row.nonCashTransferItems ?? []).map(item => ({
      label: item.fromAcctName ? `${item.name} (from ${item.fromAcctName})` : item.name,
      amount: item.amount,
    })),
    ...(row.otherAccountExpenseItems ?? []).map(item => ({
      label: item.fromAcctName ? `${item.name} (from ${item.fromAcctName})` : item.name,
      amount: item.amount,
    })),
  ];

  const assetBreakdown = (row.assetBreakdown ?? []) as { bucket: string; name: string; balance: number }[];
  const retirementAccounts = assetBreakdown.filter(a => a.bucket === 'retirement').map(a => ({ label: a.name, amount: a.balance }));
  const investmentAccounts = assetBreakdown.filter(a => a.bucket === 'investment').map(a => ({ label: a.name, amount: a.balance }));
  const savingsAccounts = assetBreakdown.filter(a => a.bucket === 'savings').map(a => ({ label: a.name, amount: a.balance }));

  const creditCards = getCreditCardBalances(absoluteI, cardProjectionData);
  const otherLiabilities = ((row.nonCCLiabBreakdown ?? []) as { name: string; balance: number }[]).map(l => ({ label: l.name, amount: l.balance }));
  const carLoans = ((row.carLoanBreakdown ?? []) as { name: string; balance: number }[]).map(c => ({ label: c.name, amount: c.balance }));

  return {
    month: row.month ?? '',
    startingCash: row.startingCash ?? 0,
    endingCash: row.endingCash ?? 0,
    cashFloor: row.monthMinSafe ?? 0,
    netWorth: row.netWorth ?? 0,
    totalAssets: row.totalAssets ?? 0,
    totalLiabilities: row.totalLiabilities ?? 0,
    income,
    expenses,
    internalTransfers,
    retirementAccounts,
    investmentAccounts,
    savingsAccounts,
    creditCards,
    otherLiabilities,
    carLoans,
  };
}

/** Computes the absolute (true, unsliced) PROJECTION_MONTHS index for a row at local position
 * `i` within a year-filtered export — needed because filteredData.slice() resets indices to 0,
 * but cardProjectionData's per-card maps are still indexed by the true month offset from today. */
export function getAbsoluteMonthIndex(localIndex: number, filterYear: string, calendarYearStart: number): number {
  return filterYear === 'all' ? localIndex : calendarYearStart + localIndex;
}

/** Pivots a list of per-month detail objects into a flat column-label -> ordered union, so a
 * wide CSV/table can have one column per distinct label seen across ANY month (goals, cards, and
 * accounts vary per user and can appear/disappear mid-projection as they're paid off or completed). */
export function collectLabelUnion(details: ForecastMonthDetail[], pick: (d: ForecastMonthDetail) => { label: string }[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const d of details) {
    for (const item of pick(d)) {
      if (!seen.has(item.label)) { seen.add(item.label); order.push(item.label); }
    }
  }
  return order;
}

export function amountForLabel(items: { label: string; amount: number }[], label: string): number {
  return items.find(i => i.label === label)?.amount ?? 0;
}
