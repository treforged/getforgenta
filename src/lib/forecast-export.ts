// Builds the detailed month-by-month money-flow + account-balance breakdown used by the
// Forecast PDF/CSV exports. Mirrors Forecast.tsx's own "Month Breakdown" drawer (openDrawer)
// field-for-field and formula-for-formula — including the per-card debt-payment scaling and the
// revolving/cycling balance selection — so the export can never show different numbers than the
// in-app popup for the same month. If that drawer's logic changes, this needs the same change.

export interface ForecastFlowItem {
  label: string;
  amount: number;
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
function getPerCardDebtBreakdown(row: any, absoluteI: number, cardProjectionData: any): { name: string; amount: number }[] {
  const fallbackAmt = row.displayDebtPayment ?? row.debtPayment ?? 0;
  const fallback = fallbackAmt > 0 ? [{ name: 'Debt Payments', amount: fallbackAmt }] : [];

  if (absoluteI === 0 && cardProjectionData?.month0?.perCardAdjusted) {
    const engineRecs = cardProjectionData.month0.perCardAdjusted.filter((r: any) => r.payment > 0);
    return engineRecs.length > 0
      ? engineRecs.map((r: any) => ({ name: r.name, amount: r.payment }))
      : fallback;
  }

  const perCard = cardProjectionData?.perCardPaymentsScaled ?? cardProjectionData?.perCardPayments;
  if (!perCard) return fallback;
  const rawAmounts = perCard
    .map((c: any) => ({ name: c.name, amt: c.payments[absoluteI] ?? 0 }))
    .filter((c: any) => c.amt > 0);
  if (rawAmounts.length === 0) return fallback;
  const rawSum = rawAmounts.reduce((s: number, c: any) => s + c.amt, 0);
  const scale = rawSum > 0 ? (row.debtPayment ?? rawSum) / rawSum : 1;
  const lines = rawAmounts
    .map((c: any) => ({ name: c.name, amount: c.amt * scale }))
    .filter((c: any) => c.amount > 0.005);
  return lines.length > 0 ? lines : fallback;
}

/** Mirrors Forecast.tsx openDrawer's per-card balance formula exactly: revolving cards read
 * monthlyBalances (full end balance including this month's purchases); cycling cards fall back to
 * the cycling statement balance stored on cardProjectionData.data[i][card.name]. */
function getCreditCardBalances(absoluteI: number, cardProjectionData: any): ForecastAccountLine[] {
  const cards = cardProjectionData?.simCards ?? [];
  return cards.map((card: any) => {
    const revBal = cardProjectionData?.monthlyRevolvingBalances?.get(card.id)?.[absoluteI] ?? 0;
    const simBal = cardProjectionData?.monthlyBalances?.get(card.id)?.[absoluteI] ?? 0;
    const cyclingBal = cardProjectionData?.data?.[absoluteI]?.[card.name] ?? 0;
    const balance = revBal > 0 ? simBal : cyclingBal;
    return { label: card.name, amount: Math.round(balance) };
  });
}

export function buildForecastMonthDetail(row: any, absoluteI: number, cardProjectionData: any): ForecastMonthDetail {
  const income: ForecastFlowItem[] = [];
  const expenses: ForecastFlowItem[] = [];

  const paycheck = row.paycheckIncome ?? row.takeHome ?? 0;
  if (paycheck > 0) income.push({ label: 'Paycheck', amount: paycheck });
  if ((row.otherIncome ?? 0) > 0) income.push({ label: 'Other Income', amount: row.otherIncome });
  if ((row.bonusIncome ?? 0) > 0) income.push({ label: 'Bonus', amount: row.bonusIncome });
  if ((row.taxReturnIncome ?? 0) > 0) income.push({ label: 'Tax Return', amount: row.taxReturnIncome });
  else if ((row.taxReturnIncome ?? 0) < 0) expenses.push({ label: 'Tax Owed', amount: Math.abs(row.taxReturnIncome) });

  if ((row.baseExpenses ?? 0) > 0) expenses.push({ label: 'Bills & Expenses', amount: row.baseExpenses });

  for (const c of getPerCardDebtBreakdown(row, absoluteI, cardProjectionData)) {
    expenses.push({ label: `Debt: ${c.name}`, amount: c.amount });
  }

  if ((row.savingsGoalItems?.length ?? 0) > 0) {
    for (const g of row.savingsGoalItems) if (g.amount > 0) expenses.push({ label: `Goal: ${g.name}`, amount: g.amount });
  } else if ((row.savingsContrib ?? 0) > 0) {
    expenses.push({ label: 'Savings Goals', amount: row.savingsContrib });
  }

  if ((row.carContribItems?.length ?? 0) > 0) {
    for (const v of row.carContribItems) {
      if (v.amount > 0) expenses.push({ label: v.isPurchaseMonth ? `${v.name} (Down Payment)` : `Reserving for ${v.name}`, amount: v.amount });
    }
  } else if ((row.carContrib ?? 0) > 0) {
    expenses.push({ label: 'Car Fund Reserve', amount: row.carContrib });
  }

  if ((row.mortgagePayment ?? 0) > 0) expenses.push({ label: 'Mortgage Payment', amount: row.mortgagePayment });
  if ((row.carLoanPayment ?? 0) > 0) expenses.push({ label: 'Car Loan Payment', amount: row.carLoanPayment });
  if ((row.vehicleDownPayment ?? 0) > 0) expenses.push({ label: 'Vehicle Down Payment', amount: row.vehicleDownPayment });
  if ((row.vehicleInsurance ?? 0) > 0) expenses.push({ label: 'Vehicle Insurance', amount: row.vehicleInsurance });
  if ((row.projectedCarLoan ?? 0) > 0) expenses.push({ label: 'Est. Car Loan (Projected)', amount: row.projectedCarLoan });

  if ((row.carLumpItems?.length ?? 0) > 0) {
    for (const v of row.carLumpItems) if (v.amount > 0) expenses.push({ label: `${v.name} — Extra Payment`, amount: v.amount });
  } else if ((row.carLoanExtraPayment ?? 0) > 0) {
    expenses.push({ label: 'Car Loan Extra Payment', amount: row.carLoanExtraPayment });
  }

  if ((row.lumpSumSavings ?? 0) > 0) expenses.push({ label: 'Lump Sum → Savings', amount: row.lumpSumSavings });
  if ((row.lumpSumBrokerage ?? 0) > 0) expenses.push({ label: 'Lump Sum → Brokerage', amount: row.lumpSumBrokerage });
  if ((row.lumpSumRothIra ?? 0) > 0) expenses.push({ label: 'Lump Sum → Roth IRA', amount: row.lumpSumRothIra });

  for (const t of row.transferBreakdown ?? []) if (t.amount > 0) expenses.push({ label: t.name, amount: t.amount });
  if ((row.businessContrib ?? 0) > 0) expenses.push({ label: 'Business Contributions', amount: row.businessContrib });

  if ((row.oneTimeNet ?? 0) > 0) income.push({ label: 'One-Time Income', amount: row.oneTimeNet });
  else if ((row.oneTimeNet ?? 0) < 0) expenses.push({ label: 'One-Time Expense', amount: Math.abs(row.oneTimeNet) });

  const internalTransfers: ForecastFlowItem[] = [
    ...(row.nonCashTransferItems ?? []).map((item: any) => ({
      label: item.fromAcctName ? `${item.name} (from ${item.fromAcctName})` : item.name,
      amount: item.amount,
    })),
    ...(row.otherAccountExpenseItems ?? []).map((item: any) => ({
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
    month: row.month,
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
