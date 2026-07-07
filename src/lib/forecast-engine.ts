// src/lib/forecast-engine.ts
//
// Unified Forecast projection engine — Stage 2 extraction (see docs/forecast-engine-plan.md).
//
// This is a PURE MOVE of Forecast.tsx's `projections` useMemo (the PASS 1/2/3 cash walk plus
// all of its helper closures), lifted verbatim so Forecast — and later Debt Payoff, Savings
// Goals, and the AI Advisor — can share ONE deterministic projection instead of each running
// their own divergent simulation. No behavior change: the body below is byte-identical to the
// original useMemo body; only its previously-closed-over variables are now passed in via
// `inputs`. Do not "fix" anything here in Stage 2 — bug fixes are Stage 5.

import { formatCurrency } from '@/lib/calculations';
import { aggregateByMonth, countWeekdayInMonth, countRuleOccurrencesInMonth, getCalendarYearMonthRange, getCalendarYearLabel } from '@/lib/scheduling';
import { buildCardData, getMonthlyDebtBreakdown, CC_DEFAULT_CATEGORIES, PROJECTION_MONTHS } from '@/lib/credit-card-engine';
import { getMonthlyPlanCashExpenses } from '@/lib/payment-plan-generator';
import { getDebtPaymentsByMonth, getDebtBalancesByMonth } from '@/lib/debt-transaction-generator';
import { getMonthNetIncome, getNormalizedMonthNetIncome, getPaychecksInMonth, getRemainingPaychecksThisMonth, getMinSafeCash, getAugmentedMinSafeCash, getPrePaycheckNextMonthBills, mergeWithGeneratedTransactions, getRemainingTransactionIncomeByDay, getRemainingTransactionExpensesByDay, getPaycheckGross, type EnrichedTransaction, type PayScheduleConfig } from '@/lib/pay-schedule';
import { projectMilestones, monthlyContribForAccount } from '@/lib/retirement-projection';
import { estimateTaxReturn, estimateFederalWithheld, STATE_TAX_RATES, type FilingStatus } from '@/lib/tax-estimator';
import { getTotalCarLoanMonthly, calculateScheduledPayment, buildAmortizationSchedule, getLoanPrincipal, monthsBetween, getCarFundEarmark } from '@/lib/vehicle-loan-engine';
import { computeFloorProtection } from '@/lib/floor-protection';
import { cumulativeSurplusesByCard, adjustedDisplayBalance } from '@/lib/step3-display';
import type { CarFund } from '@/lib/types';
import type { AccountRow, RuleRow, DebtRow, TransactionRow } from '@/hooks/useSupabaseData';
import type { CardProjectionResult } from '@/hooks/useCardProjection';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';
import type { Tables } from '@/integrations/supabase/types';

const toMonthly = (amount: number, freq: string) =>
  freq === 'weekly' ? amount * 52 / 12
  : freq === 'biweekly' ? amount * 26 / 12
  : freq === 'yearly' ? amount / 12
  : amount;

// One row of PASS 3's final per-month projection (Forecast's main chart/table/popup data
// source) — every field is a real value pushed at the data.push() call below, kept as a
// single flat interface (rather than reusing PASS 1's baseData type) since several fields
// here are PASS-3-only derivations (endingCash, ccDisplayBalance, the breakdown arrays) with
// no equivalent on baseData.
export interface ForecastMonthRow {
  month: string;
  netWorth: number; totalAssets: number; totalLiabilities: number; debtBalance: number;
  savingsBalance: number; investmentBalance: number; retirementBalance: number; liquidCash: number;
  endingCash: number; startingCash: number;
  takeHome: number; totalExpenses: number;
  debtPayment: number; displayDebtPayment: number | undefined; plannedDebtPayment: number;
  brokerageContrib: number; retireContrib: number; paycheckRetireContrib: number; fullMonth401kContrib: number;
  investGrowth: number; retireGrowth: number; oneTimeNet: number; ccOneTime: number;
  monthMinSafe: number; floorBreachedByOneTime: boolean; debtWasReduced: boolean;
  baseExpenses: number; savingsContrib: number;
  savingsGoalItems: { name: string; amount: number; goalId: string; linkedAccount?: string }[];
  carContrib: number;
  carContribItems: { name: string; amount: number; isPurchaseMonth: boolean }[];
  carReserveHeld: number; carLoanPayment: number; vehicleDownPayment: number; vehicleSavedPortion: number;
  vehicleInsurance: number; projectedCarLoan: number; carLoanExtraPayment: number;
  carLumpItems: { name: string; amount: number }[];
  mortgagePayment: number; transfersTotal: number;
  transferBreakdown: { name: string; amount: number }[];
  nonCashTransferItems: { name: string; fromAcctId: string; fromAcctName: string; amount: number }[];
  otherAccountExpenseItems: { name: string; fromAcctName: string; amount: number }[];
  lumpSumSavings: number; lumpSumBrokerage: number; lumpSumRothIra: number;
  businessContrib: number; totalCCPurchases: number; ccDebtBalance: number; ccDisplayBalance: number;
  paycheckIncome: number; otherIncome: number; bonusIncome: number; taxReturnIncome: number;
  isRaiseMonth: boolean; promotionNewSalary: number; recommendedDebtPayment: number;
  floorItems: { name: string; amount: number; dueDay: number }[];
  prePaycheckBillsTotal: number; settingsCashFloor: number;
  assetBreakdown: { bucket: 'retirement' | 'investment' | 'savings'; id: string; name: string; balance: number }[];
  nonCCLiabBreakdown: { id: string; name: string; account_type: string; balance: number }[];
  carLoanBreakdown: { name: string; balance: number }[];
  revolving3Extra: number;
}

// Inputs to the projection engine. At the Stage-2 extraction boundary these are exactly the
// values the Forecast `projections` useMemo closed over (its dependency array): a mix of raw
// data (debts/goals/accounts/…) and pre-computed intermediates (monthlyAggregates, the
// per-month one-time maps, the CC simulation `cardProjectionData`, …) that upstream useMemos
// build. Later stages can push more of that pre-computation into the engine; Stage 2 keeps the
// boundary identical to preserve byte-for-byte output.
export interface ForecastInputs {
  debts: DebtRow[];
  goals: Partial<Tables<'savings_goals'>>[];
  carFunds: CarFund[];
  accounts: AccountRow[];
  budgetItems: Tables<'budget_items'>[];
  profile: Partial<Tables<'profiles'>> | undefined;
  assumptions: AssumptionsType;
  rules: RuleRow[];
  monthlyAggregates: ReturnType<typeof aggregateByMonth>;
  debtPaymentsByMonth: ReturnType<typeof getDebtPaymentsByMonth>;
  debtBalancesByMonth: ReturnType<typeof getDebtBalancesByMonth>;
  cardProjectionData: CardProjectionResult | null;
  payConfig: PayScheduleConfig;
  oneTimeByMonth: Record<string, { income: number; expense: number }>;
  ccOneTimeByMonth: Record<string, number>;
  ccScheduledByMonth: number[];
  transactions: TransactionRow[];
  currentMonthRecommendedDebt: {
    safeToPayTotal: number;
    autopayTotal: number;
    recommendations: ReturnType<typeof getMonthlyDebtBreakdown>['recommendations'];
  } | null;
  forecastMonthEvents: { income: number; nonPaycheckIncome: number; expenses: number }[];
  forecastFundingAccountId: string | null;
  cashFloor: number;
  pauseSavings: boolean;
  syncCutoffDate: string;
  planExpensesByMonth: ReturnType<typeof getMonthlyPlanCashExpenses>[];
  annualFederalWithheldFromBudget: number;
}

export interface ForecastResult {
  data: ForecastMonthRow[];
  milestones: { month: string; event: string }[];
}

export function calculateForecast(inputs: ForecastInputs): ForecastResult {
  const {
    debts, goals, carFunds, accounts, budgetItems, profile, assumptions, rules,
    monthlyAggregates, debtPaymentsByMonth, debtBalancesByMonth, cardProjectionData,
    payConfig, oneTimeByMonth, ccOneTimeByMonth, ccScheduledByMonth, transactions,
    currentMonthRecommendedDebt, forecastMonthEvents, forecastFundingAccountId, cashFloor,
    pauseSavings, syncCutoffDate, planExpensesByMonth, annualFederalWithheldFromBudget,
  } = inputs;

    const _profTr = profile?.tax_rate;
    const taxRate = _profTr != null ? Number(_profTr) : 22;

    const active = accounts.filter((a) => a.active);
    // FIX: Aligned with debt engine — only checking/business_checking/cash are "liquid"
    // for cash floor and debt payment purposes. Savings/HYS are tracked in savingsBal
    // separately and appear in net worth but NOT in ending cash calculations.
    const liquidTypes = ['checking', 'business_checking', 'cash'];
    const investTypes = ['brokerage'];
    const retireTypes = ['roth_ira', '401k', 'ira', 'hsa'];
    const liabilityTypes = ['credit_card', 'student_loan', 'auto_loan', 'other_liability'];

    // Starting liquid cash = funding account only (the account that pays debt/expenses).
    // Using all liquid accounts inflates starting cash and masks real floor breaches.
    const fundingAcct = forecastFundingAccountId
      ? active.find((a) => a.id === forecastFundingAccountId)
      : active.find((a) => a.account_type === 'checking' || a.account_type === 'business_checking');
    let liquidBal = fundingAcct
      ? Number(fundingAcct.balance)
      : active.filter((a) => liquidTypes.includes(a.account_type)).reduce((s, a) => s + Number(a.balance), 0);
    // Already-saved/gifted down-payment money sitting in this same account is still "available
    // cash" by default — earmark it out so it isn't offered up for CC paydown while it's spoken
    // for. Disappears on its own once a car fund's phase flips to 'loan' (see getCarFundEarmark).
    liquidBal = Math.max(0, liquidBal - getCarFundEarmark(carFunds, forecastFundingAccountId));
    let totalLiabilityBal = active.filter((a) => liabilityTypes.includes(a.account_type)).reduce((s, a) => s + Number(a.balance), 0);

    const accountMap = new Map(accounts.map((a) => [a.id, a]));
    const goalLinkedAccountIds = new Set(goals.filter((g) => g.linked_account).map((g) => g.linked_account as string));

    // Per-account balance trackers — precise projected values for popup display
    const investAcctsForTrack = active.filter((a) => investTypes.includes(a.account_type));
    const savingsAcctsForTrack = active.filter((a) => ['savings', 'high_yield_savings'].includes(a.account_type));
    const investAcctIdSet = new Set<string>(investAcctsForTrack.map((a) => a.id as string));
    const savingsAcctIdSet = new Set<string>(savingsAcctsForTrack.map((a) => a.id as string));
    const perAcctInvest = new Map<string, { name: string; balance: number }>(
      investAcctsForTrack.map((a) => [a.id as string, { name: a.name as string, balance: Number(a.balance) }])
    );
    const perAcctSavings = new Map<string, { name: string; balance: number }>(
      savingsAcctsForTrack.map((a) => [a.id as string, { name: a.name as string, balance: Number(a.balance) }])
    );

    const monthlyInvestGrowth = Math.pow(1 + assumptions.investmentGrowth / 100, 1 / 12) - 1;
    const monthlySavingsInterest = Math.pow(1 + assumptions.savingsInterest / 100, 1 / 12) - 1;

    // Per-account weighted APY for retirement growth — falls back to global investmentGrowth
    const retireAccounts = active.filter((a) => retireTypes.includes(a.account_type));
    const totalRetireBal = retireAccounts.reduce((s, a) => s + Number(a.balance), 0);
    const weightedRetireApy = totalRetireBal > 0
      ? retireAccounts.reduce((s, a) => {
          const apy = a.apy_rate != null ? Number(a.apy_rate) : assumptions.investmentGrowth;
          return s + apy * (Number(a.balance) / totalRetireBal);
        }, 0)
      : assumptions.investmentGrowth;
    const monthlyRetireGrowth = Math.pow(1 + weightedRetireApy / 100, 1 / 12) - 1;

    // Monthly retirement paycheck contributions — reads paycheck_deductions JSONB first,
    // falls back to legacy deduction_401k_value if no linked deductions exist
    const prof = profile;
    const paycheckGrossForForecast = payConfig
      ? (payConfig.frequency === 'biweekly' ? payConfig.weeklyGross * 2 : payConfig.frequency === 'monthly' ? payConfig.weeklyGross * 52 / 12 : payConfig.weeklyGross)
      : 0;
    const paychecksPerYear = payConfig?.frequency === 'biweekly' ? 26 : payConfig?.frequency === 'monthly' ? 12 : 52;
    const retireAccountIds = new Set(retireAccounts.map((a) => a.id as string));
    const retireAcctIdSet = retireAccountIds; // alias for per-account tracking
    const payDeds: { value: number; mode: 'flat' | 'pct'; accountId?: string }[] =
      Array.isArray(prof?.paycheck_deductions) ? (prof.paycheck_deductions as typeof payDeds) : [];
    // Per-paycheck contribution amount — multiplied by actual paycheck count per month inside the loop
    const perCheck401k = (() => {
      const linked = payDeds
        .filter(d => d.accountId && retireAccountIds.has(d.accountId) && d.value > 0)
        .reduce((s, d) => s + (d.mode === 'pct' ? paycheckGrossForForecast * (d.value / 100) : d.value), 0);
      if (linked > 0) return linked;
      const d401kVal = Number(prof?.deduction_401k_value) || 0;
      const d401kMode = prof?.deduction_401k_mode || 'pct';
      return d401kMode === 'pct' ? paycheckGrossForForecast * (d401kVal / 100) : d401kVal;
    })();

    // Per-paycheck retirement attribution per account
    const perCheckRetireByAcct = (() => {
      const m = new Map<string, number>();
      const linked = payDeds.filter(d => d.accountId && retireAcctIdSet.has(d.accountId!) && d.value > 0);
      if (linked.length > 0) {
        for (const d of linked) {
          m.set(d.accountId!, (m.get(d.accountId!) ?? 0) + (d.mode === 'pct' ? paycheckGrossForForecast * (d.value / 100) : d.value));
        }
      } else {
        const fallback = retireAccounts.find((a) => a.account_type === '401k') ?? retireAccounts[0];
        if (fallback) m.set(fallback.id as string, perCheck401k);
      }
      return m;
    })();

    // Per-account retire tracker and goal pools (savings accounts already in perAcctSavings above)
    const perAcctRetire = new Map<string, { name: string; balance: number }>(
      retireAccounts.map((a) => [a.id as string, { name: a.name as string, balance: Number(a.balance) }])
    );
    // Goal pools: goals not linked to a savings/retire/invest account
    const goalPools = new Map<string, { name: string; balance: number }>(
      goals
        .filter((g) => {
          if (!g.linked_account) return true;
          if (savingsAcctIdSet.has(g.linked_account) || retireAcctIdSet.has(g.linked_account) || investAcctIdSet.has(g.linked_account)) return false;
          return true;
        })
        .map((g) => [g.id as string, { name: g.name as string, balance: Number(g.current_amount) }])
    );
    // Aggregate scalars derived from per-account Maps (fixes retire-linked goal double-counting)
    let retireBal = Array.from(perAcctRetire.values()).reduce((s, a) => s + a.balance, 0);
    let investBal = Array.from(perAcctInvest.values()).reduce((s, a) => s + a.balance, 0);
    let savingsBal = Array.from(perAcctSavings.values()).reduce((s, a) => s + a.balance, 0)
      + Array.from(goalPools.values()).reduce((s, p) => s + p.balance, 0);

    const nowDate = new Date();

    const monthlyCarContrib = pauseSavings ? 0 : carFunds.reduce((s, c) => {
      if (c.phase === 'loan') return s;
      const rem = Number(c.down_payment_goal) - Number(c.current_saved);
      return s + (rem > 0 ? Math.min(rem / 12, 500) : 0);
    }, 0);
    // Active loan payments per month — stops when each loan pays off within the projection window
    const activeCarLoanByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
      const md = new Date(nowDate.getFullYear(), nowDate.getMonth() + i, 15);
      const mk = `${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, '0')}`;
      const regular = getTotalCarLoanMonthly(carFunds, md);
      const lumpTotal = (carFunds)
        .filter((cf) => cf.phase === 'loan')
        .flatMap((cf) => (cf.lump_sum_payments ?? []).filter((ls) => ls.date.substring(0, 7) === mk))
        .reduce((s, ls) => s + ls.amount, 0);
      return regular + lumpTotal;
    });
    const activeCarLoanLumpSumByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
      const md = new Date(nowDate.getFullYear(), nowDate.getMonth() + i, 1);
      const mk = `${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, '0')}`;
      return (carFunds)
        .filter((cf) => cf.phase === 'loan')
        .flatMap((cf) => (cf.lump_sum_payments ?? []).filter((ls) => ls.date.substring(0, 7) === mk))
        .reduce((s, ls) => s + ls.amount, 0);
    });
    // Insurance on phase='loan' car funds per month — activeCarLoanByMonth above covers the
    // regular payment and lump sums for an active loan, but nothing here ever added the car's
    // monthly_insurance once phase flips to 'loan'. getMonthVehicleInsurance only ever looked at
    // vehicleProjections (phase==='saving' cars), so insurance silently vanished from every total
    // that includes it the instant a loan activated. Anchored to loan_start_date (not
    // payment_start_date) — insurance is needed the day you own the car, not when the first bill
    // posts, and matches vehicleProjections' saving-phase insurance below (purchaseMonthIdx).
    // Calendar-month comparison via monthsBetween, not exact-date, for the same reason
    // getActiveCarLoanPayments' gate was fixed earlier — different representative days within the
    // same month must agree. Runs indefinitely rather than capping at loan_term_months (insurance
    // is an ownership cost, not a financing one).
    const activeCarLoanInsuranceByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() + i, 1);
      const dStr = d.toISOString().split('T')[0];
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return (carFunds)
        .filter((cf): cf is typeof cf & { loan_start_date: string } => cf.phase === 'loan' && !!cf.loan_start_date)
        .filter((cf) => {
          const insuranceAnchor = cf.insurance_start_date ?? cf.loan_start_date;
          if (monthsBetween(insuranceAnchor, dStr) < 0) return false;
          // Month 0: skip if the insurance due date already cleared through Plaid.
          if (i === 0 && syncCutoffDate) {
            const insuranceDueDay = new Date(insuranceAnchor + 'T00:00:00').getDate();
            if (`${mk}-${String(insuranceDueDay).padStart(2, '0')}` <= syncCutoffDate) return false;
          }
          return true;
        })
        .reduce((s, cf) => s + Number(cf.monthly_insurance || 0), 0);
    });

    // Lump sum contributions from savings goals — one-time future transfers
    // Destination type inferred from the goal's linked account type
    const retireAccountTypes = new Set(['401k', 'roth_ira', 'ira', 'hsa']);
    const brokerageAccountTypes = new Set(['brokerage', 'investment']);
    const activeAccountMap = Object.fromEntries(accounts.filter((a) => a.active !== false).map((a) => [a.id, a]));
    const lumpTransferByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
      const md = new Date(nowDate.getFullYear(), nowDate.getMonth() + i, 1);
      const mk = `${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, '0')}`;
      let savings = 0, brokerage = 0, roth_ira = 0;
      const perAccount = new Map<string, number>();
      for (const g of goals) {
        const lumps = (Array.isArray(g.lump_sum_payments) ? g.lump_sum_payments : []) as unknown as { date: string; amount: number }[];
        const monthTotal = lumps.filter((ls) => ls.date.substring(0, 7) === mk).reduce((s, ls) => s + Number(ls.amount), 0);
        if (monthTotal === 0) continue;
        const acctType = g.linked_account ? (activeAccountMap[g.linked_account]?.account_type ?? '') : '';
        if (retireAccountTypes.has(acctType) || (g.goal_type ?? '').toLowerCase() === 'retirement') roth_ira += monthTotal;
        else if (brokerageAccountTypes.has(acctType)) brokerage += monthTotal;
        else savings += monthTotal;
        // Per-account attribution: keyed by linked account id, or by goal id for unlinked goals
        const key = g.linked_account ?? (g.id as string);
        perAccount.set(key, (perAccount.get(key) ?? 0) + monthTotal);
      }
      return { savings, brokerage, roth_ira, total: savings + brokerage + roth_ira, perAccount };
    });

    // Mortgage — hard floor deduction before CC payoff (same priority as car loans)
    const mortgageAccountNames = new Set(
      accounts.filter((a) => a.account_type === 'mortgage' && a.active !== false)
        .map((a) => (a.name as string).toLowerCase())
    );
    const mortgageMonthlyPayment = debts
      .filter((d) => mortgageAccountNames.has((d.name as string).toLowerCase()))
      .reduce((s, d) => s + Number(d.target_payment || d.min_payment || 0), 0);

    // Month-aware projections for saving-phase vehicles: contrib stops at purchase month,
    // projected loan payment starts at purchase month
    const vehicleProjections = pauseSavings ? [] : (carFunds)
      .filter((c) => c.phase === 'saving')
      .map((c) => {
        // Use live account balance when the vehicle is linked to a separate savings account.
        // Ignore linked_account when it's the funding account itself — that balance is already
        // counted as available cash elsewhere, so treating it as "already saved" would double-
        // count the same dollars instead of protecting them for the upcoming purchase.
        const linkedAcct = c.linked_account && c.linked_account !== forecastFundingAccountId
          ? accountMap.get(c.linked_account) : null;
        const effectiveSaved = linkedAcct ? Number(linkedAcct.balance) : Number(c.current_saved);
        const rem = Math.max(0, Number(c.down_payment_goal) - effectiveSaved - Number(c.gift_contribution || 0));
        // Determine purchase month first — needed for timeline-aware contribution calculation.
        let purchaseMonthIdx: number;
        if (c.planned_purchase_date) {
          const parts = (c.planned_purchase_date as string).split('-').map(Number);
          const pd = new Date(parts[0], parts[1] - 1, parts[2]); // local time — avoid UTC off-by-one
          purchaseMonthIdx = Math.max(0, (pd.getFullYear() - nowDate.getFullYear()) * 12 + (pd.getMonth() - nowDate.getMonth()));
        } else if (rem > 0) {
          const bootstrapContrib = Math.min(rem / 12, 500);
          purchaseMonthIdx = bootstrapContrib > 0 ? Math.ceil(rem / bootstrapContrib) : Infinity;
        } else {
          purchaseMonthIdx = 0;
        }
        // Timeline-aware: spread rem over purchaseMonthIdx+1 months (include the purchase month itself —
        // user can deposit before the purchase date that month).
        // If linked account with a transfer rule → rule's monthly transfer is already in cash flow, skip contrib.
        // If linked account without a transfer rule → compute needed monthly contrib (user must fund it manually).
        const contrib = (c.linked_account && c.linked_rule_id) ? 0
          : (rem > 0 && isFinite(purchaseMonthIdx)
            ? Math.min(rem / (purchaseMonthIdx + 1), rem)
            : 0);
        // getLoanPrincipal — same formula loan-phase uses once cf.loan_amount is the stored
        // source instead; keeping this in one place is what guarantees the payment amount
        // doesn't change at activation if nothing else changed.
        const loanPrincipal = getLoanPrincipal(c);
        const projPayment = Number(c.expected_apr) > 0 && Number(c.loan_term_months) > 0 && loanPrincipal > 0
          ? calculateScheduledPayment(loanPrincipal, Number(c.expected_apr), Number(c.loan_term_months))
          : 0;
        // Payment/insurance anchor — derived from payment_start_date the same way purchaseMonthIdx
        // is derived from planned_purchase_date, falling back to purchaseMonthIdx + 1 (the old
        // implicit assumption) when payment_start_date isn't set on a pre-existing record. Using
        // the real stored date instead of purchaseMonthIdx + 1's integer-month approximation is
        // what keeps this in sync with the loan-phase schedule (built from the exact same date)
        // once activated.
        let paymentStartMonthIdx: number;
        if (c.payment_start_date) {
          const parts = (c.payment_start_date as string).split('-').map(Number);
          const psd = new Date(parts[0], parts[1] - 1, parts[2]);
          paymentStartMonthIdx = Math.max(0, (psd.getFullYear() - nowDate.getFullYear()) * 12 + (psd.getMonth() - nowDate.getMonth()));
        } else {
          paymentStartMonthIdx = isFinite(purchaseMonthIdx) ? purchaseMonthIdx + 1 : Infinity;
        }
        // Gift arrives at purchase — user only brings down_payment_goal minus the gift from their own cash.
        // effectiveDP = what still needs to come from checking in the purchase month after monthly
        // savings have accumulated. When monthly savings fully cover `rem`, effectiveDP = 0 so the
        // cash sim sees no lump-sum shock in the purchase month (the savings handled it month-by-month).
        const effectiveDP = Math.max(0, rem - contrib * (purchaseMonthIdx + 1));
        // Effective term — accounts for lump sums accelerating payoff, matching what the actual
        // loan-phase schedule (buildAmortizationSchedule) would show once activated. Without this,
        // the projected window always ran the full loan_term_months even when lump sums pay the
        // loan off earlier, disagreeing with the real schedule at activation.
        const effectiveTermMonths = (loanPrincipal > 0 && Number(c.expected_apr) >= 0 && Number(c.loan_term_months) > 0 && c.payment_start_date)
          ? buildAmortizationSchedule({
              loanAmount: loanPrincipal, apr: Number(c.expected_apr), termMonths: Number(c.loan_term_months),
              loanStartDate: c.planned_purchase_date ?? c.payment_start_date, paymentStartDate: c.payment_start_date,
              interestStartDate: c.payment_start_date, actualMonthlyPayment: 0,
              lumpSumPayments: c.lump_sum_payments ?? [],
            }).schedule.length
          : Number(c.loan_term_months);
        let insuranceStartMonthIdx = purchaseMonthIdx;
        if (c.insurance_start_date) {
          const parts = (c.insurance_start_date as string).split('-').map(Number);
          const isd = new Date(parts[0], parts[1] - 1, parts[2]);
          insuranceStartMonthIdx = Math.max(0, (isd.getFullYear() - nowDate.getFullYear()) * 12 + (isd.getMonth() - nowDate.getMonth()));
        }
        return { contrib, purchaseMonthIdx, paymentStartMonthIdx, insuranceStartMonthIdx, projPayment, downPayment: Math.max(0, Number(c.down_payment_goal) - Number(c.gift_contribution || 0)), effectiveDP, insurance: Number(c.monthly_insurance), termMonths: effectiveTermMonths, lumpSumPayments: (c.lump_sum_payments ?? []) as { id: string; date: string; amount: number }[], vehicleName: c.vehicle_name as string, linkedAccountId: (c.linked_account as string | null) ?? null };
      });
    // Per-vehicle lump sum breakdown for forecast popup (every car fund, any phase). Previously
    // filtered to phase === 'loan' only, plus a second pass over vehicleProjections (saving-phase
    // only) gated to a purchase-month-estimate window — so a car fund undone back to 'saving'
    // (lump_sum_payments untouched by the undo, still real data) could fall through the cracks
    // whenever its actual lump-sum dates didn't happen to land inside that re-estimated window.
    // lump_sum_payments already carries its own exact date, so there's no need to infer a window
    // at all — match by date directly for every car fund, regardless of phase.
    const carLumpItemsByMonth: { name: string; amount: number }[][] = Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() + i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const items: { name: string; amount: number }[] = [];
      for (const cf of carFunds) {
        const amt = (cf.lump_sum_payments ?? [])
          .filter((ls) => ls.date.substring(0, 7) === mk)
          .reduce((s, ls) => s + Number(ls.amount), 0);
        if (amt > 0) items.push({ name: cf.vehicle_name as string, amount: Math.round(amt) });
      }
      return items;
    });
    // Non-CC liability accounts with matched debt payments for per-account popup display
    const nonCCLiabAccts = active
      .filter((a) => liabilityTypes.includes(a.account_type) && a.account_type !== 'credit_card')
      .map((a) => {
        const matched = debts.find((d) => (d.name as string).toLowerCase() === (a.name as string).toLowerCase());
        return {
          id: a.id as string,
          name: a.name as string,
          account_type: a.account_type as string,
          startBalance: Number(a.balance),
          monthlyPayment: Number(matched?.target_payment ?? 0),
        };
      });

    // Per-month remaining car loan balance for liabilities (active loans + projected future loans)
    const carLoanBalanceByMonth = new Array(PROJECTION_MONTHS).fill(0);
    const carLoanPerFund: { name: string; balances: number[] }[] = [];
    for (const cf of carFunds) {
      const fundName = cf.vehicle_name ?? 'Vehicle';
      if (cf.phase === 'loan' && cf.loan_start_date && cf.payment_start_date) {
        const fundBalances = new Array(PROJECTION_MONTHS).fill(0);
        try {
          const proj = buildAmortizationSchedule({
            loanAmount: Number(cf.loan_amount),
            apr: Number(cf.expected_apr),
            termMonths: Number(cf.loan_term_months),
            loanStartDate: cf.loan_start_date,
            paymentStartDate: cf.payment_start_date,
            interestStartDate: cf.interest_start_date ?? cf.payment_start_date,
            actualMonthlyPayment: Number(cf.actual_monthly_payment),
            lumpSumPayments: cf.lump_sum_payments ?? [],
          }, nowDate);
          for (let i = 0; i < PROJECTION_MONTHS; i++) {
            const schedIdx = proj.monthsElapsed - 1 + i;
            const bal = schedIdx < 0 ? Number(cf.loan_amount)
              : (proj.schedule[schedIdx]?.endBalance ?? 0);
            fundBalances[i] = Math.max(0, bal);
            carLoanBalanceByMonth[i] += fundBalances[i];
          }
        } catch {}
        if (fundBalances.some(b => b > 0)) carLoanPerFund.push({ name: fundName, balances: fundBalances });
      } else if (cf.phase === 'saving') {
        const loanPrincipal = Math.max(0, Number(cf.target_price) + Number(cf.tax_fees) - Number(cf.down_payment_goal));
        if (loanPrincipal <= 0) continue;
        const apr = Number(cf.expected_apr);
        const termMonths = Number(cf.loan_term_months);
        if (termMonths <= 0) continue;
        let purchaseMonthIdx: number;
        if (cf.planned_purchase_date) {
          const parts = (cf.planned_purchase_date as string).split('-').map(Number);
          const pd = new Date(parts[0], parts[1] - 1, parts[2]);
          purchaseMonthIdx = Math.max(0, (pd.getFullYear() - nowDate.getFullYear()) * 12 + (pd.getMonth() - nowDate.getMonth()));
        } else {
          const linkedAcctLoan = cf.linked_account ? accountMap.get(cf.linked_account) : null;
          const effectiveSavedLoan = linkedAcctLoan ? Number(linkedAcctLoan.balance) : Number(cf.current_saved);
          const rem = Math.max(0, Number(cf.down_payment_goal) - effectiveSavedLoan - Number(cf.gift_contribution || 0));
          const mc = rem > 0 ? Math.min(rem / 12, 500) : 0;
          purchaseMonthIdx = mc > 0 ? Math.ceil(rem / mc) : 999;
        }
        if (!isFinite(purchaseMonthIdx) || purchaseMonthIdx >= PROJECTION_MONTHS) continue;
        const r = apr > 0 ? apr / 100 / 12 : 0;
        const scheduled = r > 0
          ? (loanPrincipal * r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1)
          : loanPrincipal / termMonths;
        let bal = loanPrincipal;
        const projFundBalances = new Array(PROJECTION_MONTHS).fill(0);
        for (let i = purchaseMonthIdx; i < PROJECTION_MONTHS && bal > 0; i++) {
          projFundBalances[i] = Math.round(bal);
          carLoanBalanceByMonth[i] += Math.round(bal);
          const interest = r > 0 ? bal * r : 0;
          const calD = new Date(nowDate.getFullYear(), nowDate.getMonth() + i, 1);
          const calMk = `${calD.getFullYear()}-${String(calD.getMonth() + 1).padStart(2, '0')}`;
          const lumpAmt = i > purchaseMonthIdx
            ? (cf.lump_sum_payments ?? []).filter((ls) => ls.date.substring(0, 7) === calMk).reduce((s, ls) => s + ls.amount, 0)
            : 0;
          bal = Math.max(0, bal + interest - Math.min(scheduled + lumpAmt, bal + interest));
        }
        if (projFundBalances.some(b => b > 0)) carLoanPerFund.push({ name: fundName, balances: projFundBalances });
      }
    }

    const getMonthCarContrib = (i: number) => vehicleProjections.reduce(
      (s, v) => s + (i <= v.purchaseMonthIdx ? v.contrib : 0), 0);
    const getMonthProjLoanRegular = (i: number) => vehicleProjections.reduce(
      (s, v) => s + (isFinite(v.paymentStartMonthIdx) && i >= v.paymentStartMonthIdx && i < v.paymentStartMonthIdx + v.termMonths ? v.projPayment : 0), 0);
    const getMonthProjLumpSum = (i: number) => {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() + i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return vehicleProjections.reduce((s, v) => {
        if (!isFinite(v.paymentStartMonthIdx) || i < v.paymentStartMonthIdx || i >= v.paymentStartMonthIdx + v.termMonths) return s;
        return s + v.lumpSumPayments.filter((ls) => ls.date.substring(0, 7) === mk).reduce((ls_s, ls) => ls_s + ls.amount, 0);
      }, 0);
    };
    const getMonthProjLoan = (i: number) => getMonthProjLoanRegular(i) + getMonthProjLumpSum(i);
    const getMonthDownPayment = (i: number) => vehicleProjections.reduce(
      (s, v) => s + (isFinite(v.purchaseMonthIdx) && i === v.purchaseMonthIdx ? v.downPayment : 0), 0);
    // For cash-flow math only: uses effectiveDP (0 when monthly savings already cover the remaining).
    const getMonthEffectiveDP = (i: number) => vehicleProjections.reduce(
      (s, v) => s + (isFinite(v.purchaseMonthIdx) && i === v.purchaseMonthIdx ? v.effectiveDP : 0), 0);
    // Insurance follows the purchase date (purchaseMonthIdx), not the payment-start date — you
    // need insurance the day you own the car, not when the first loan bill posts. The loan
    // payment itself stays anchored to paymentStartMonthIdx elsewhere; only insurance differs.
    const getMonthVehicleInsurance = (i: number) => vehicleProjections.reduce(
      (s, v) => s + (isFinite(v.insuranceStartMonthIdx) && i >= v.insuranceStartMonthIdx ? v.insurance : 0), 0)
      + activeCarLoanInsuranceByMonth[i];

    const transferRulesAll = rules.filter((r) => r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment'));

    // ═══ PASS 1: Compute base values without debt payment adjustments ═══
    const baseData: {
      monthLabel: string; monthKey: string; netIncome: number; baseExpenses: number;
      rawDebtPayment: number; monthTransfers: number; monthBrokerageContrib: number; monthRetireContrib: number; monthBusinessContrib: number; monthSavingsTransferContrib: number; oneTimeNet: number;
      ccDebtBalance: number; otherDebtBalance: number; monthMinSafe: number; monthlySavingsContrib: number;
      paycheckIncome: number; otherIncome: number; bonusIncome: number; taxReturnIncome: number; isRaiseMonth: boolean;
      promotionNewSalary: number;
      paycheckRetireContrib: number; fullMonth401kContrib: number;
      transferBreakdown: { name: string; amount: number }[];
      nonCashTransferItems: { name: string; fromAcctId: string; fromAcctName: string; amount: number }[];
      floorItems: { name: string; amount: number; dueDay: number }[];
      prePaycheckBillsTotal: number;
      savingsGoalItems: { name: string; amount: number; goalId: string; linkedAccount?: string }[];
      carContribItems: { name: string; amount: number; isPurchaseMonth: boolean }[];
      perAccountTransferContribs: Map<string, number>;
      otherAccountExpenseItems: { name: string; fromAcctName: string; amount: number }[];
    }[] = [];
    let incomeMultiplier = 1;
    const sortedPromotions = [...(assumptions.promotions ?? [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    let nextPromotionIdx = 0;

    // Expense rules paid from a non-CC, non-funding-account source — tracked for the popup's
    // "Other Account Expenses (no cash impact)" section. Hoisted out of the per-month loop below
    // since it only depends on accounts, not the month being computed.
    const ccPaymentSourcesForOtherAcct = new Set<string>(
      accounts.filter((a) => a.active && a.account_type === 'credit_card')
        .flatMap((a) => [a.id, `account:${a.id}`]),
    );

    // Index of the first (or only) bonus month in the projection window — used for non-recurring bonus
    const nextBonusMonthIndex = !assumptions.bonusRecurring && assumptions.bonusEnabled && assumptions.bonusAmount > 0
      ? (() => {
          for (let k = 0; k < PROJECTION_MONTHS; k++) {
            const dd = new Date(nowDate.getFullYear(), nowDate.getMonth() + k, 1);
            if (dd.getMonth() + 1 === assumptions.bonusMonth) return k;
          }
          return -1;
        })()
      : -1;

    // Non-CC debt amortization — compute the projected balance for each non-CC debt record
    // using proper interest accrual (balance × monthly_rate - payment) rather than the
    // previous flat linear decay (staticBalance - payment × i) that ignored APR entirely
    // and underestimated later-month balances for any loan with a non-zero APR.
    const nonCCDebtItems = debts.filter(
      dd => !accounts.some(a => a.account_type === 'credit_card' && a.name.toLowerCase() === (dd.name ?? '').toLowerCase())
    );
    const nonCCDebtBalanceByMonth = (() => {
      const arr = new Array<number>(PROJECTION_MONTHS).fill(0);
      for (const dd of nonCCDebtItems) {
        let bal = Number(dd.balance);
        const monthlyRate = (Number(dd.apr) || 0) / 1200;
        const payment = Number(dd.target_payment) || 0;
        for (let m = 0; m < PROJECTION_MONTHS; m++) {
          arr[m] += Math.max(0, bal);
          bal = monthlyRate > 0
            ? Math.max(0, bal * (1 + monthlyRate) - payment)
            : Math.max(0, bal - payment);
        }
      }
      return arr;
    })();

    for (let i = 0; i < PROJECTION_MONTHS; i++) {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() + i, 1);
      const monthLabel = d.toLocaleString('en', { month: 'short', year: 'numeric' });
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      // Scheduled promotions snap the multiplier directly to the new salary (rather than
      // multiplying it) so the raise/bonus math below — which both just read whatever the
      // current multiplier is — automatically compounds/scales off the new value afterward.
      // A promotion dated on/before this month applies the first time the loop reaches it,
      // including immediately at month 0 if the date has already passed.
      let promotionNewSalary = 0;
      while (nextPromotionIdx < sortedPromotions.length && sortedPromotions[nextPromotionIdx].effectiveDate.slice(0, 7) <= monthKey) {
        const annualBase = payConfig.weeklyGross * 52;
        if (annualBase > 0) incomeMultiplier = sortedPromotions[nextPromotionIdx].newAnnualSalary / annualBase;
        promotionNewSalary = sortedPromotions[nextPromotionIdx].newAnnualSalary;
        nextPromotionIdx++;
      }

      // Apply annual raise as a step in the specified month (not continuous compounding)
      if (assumptions.incomeGrowthEnabled && assumptions.incomeGrowth > 0 && i > 0 && d.getMonth() + 1 === assumptions.raiseMonth) {
        if (assumptions.raiseMode === 'flat') {
          const currentAnnual = payConfig.weeklyGross * 52 * incomeMultiplier;
          if (currentAnnual > 0) incomeMultiplier *= (1 + assumptions.incomeGrowth / currentAnnual);
        } else {
          incomeMultiplier *= (1 + assumptions.incomeGrowth / 100);
        }
      }

      const adjustedConfig = { ...payConfig, weeklyGross: payConfig.weeklyGross * incomeMultiplier };
      const scheduled = monthlyAggregates[monthKey];
      // Use CC-filtered income from forecastMonthEvents; fall back to monthlyAggregates
      const scheduledIncome = forecastMonthEvents[i]?.income || scheduled?.income || 0;
      const fallbackTakeHome = getMonthNetIncome(adjustedConfig, d.getFullYear(), d.getMonth());

      // Bonus calculation — flat dollar amount or % of projected annual gross
      const annualGrossHere = payConfig.weeklyGross * 52 * incomeMultiplier;
      const grossBonusAmt = assumptions.bonusMode === 'pct'
        ? annualGrossHere * (assumptions.bonusAmount / 100)
        : assumptions.bonusAmount;
      const isBonusMonth =
        assumptions.bonusEnabled &&
        assumptions.bonusAmount > 0 &&
        d.getMonth() + 1 === assumptions.bonusMonth &&
        (assumptions.bonusRecurring ? true : i === nextBonusMonthIndex);

      const isRaiseMonth = assumptions.incomeGrowthEnabled && assumptions.incomeGrowth > 0 && i > 0 && d.getMonth() + 1 === assumptions.raiseMonth;
      const bonusIncome = isBonusMonth ? grossBonusAmt : 0;
      let paycheckIncome: number;
      let otherIncome: number;
      let netIncome: number;
      if (i === 0) {
        // Month 0: scheduledIncome only includes events strictly after syncCutoffDate.
        // Paychecks/income already deposited are in liquidBal — don't add them again.
        const nonPayRemaining = forecastMonthEvents[0]?.nonPaycheckIncome ?? 0;
        paycheckIncome = Math.max(0, scheduledIncome - nonPayRemaining);
        otherIncome = nonPayRemaining;
        netIncome = scheduledIncome + bonusIncome;
      } else {
        paycheckIncome = fallbackTakeHome;
        otherIncome = forecastMonthEvents[i]?.nonPaycheckIncome ?? 0;
        netIncome = fallbackTakeHome + otherIncome + bonusIncome;
      }

      // Tax return injection — estimate or override, applied annually in the configured month
      let taxReturnIncome = 0;
      if (assumptions.taxReturnEnabled && d.getMonth() + 1 === assumptions.taxReturnMonth) {
        try {
          const refundAmt = assumptions.taxReturnAmountOverride > 0
            ? assumptions.taxReturnAmountOverride
            : (() => {
                if (!annualGrossHere || annualGrossHere <= 0) return 0;
                const federalWithheld = assumptions.taxReturnFederalWithheld
                  || annualFederalWithheldFromBudget
                  || estimateFederalWithheld(annualGrossHere, assumptions.taxReturnFilingStatus, assumptions.taxReturnDependents);
                const stateRate = STATE_TAX_RATES[assumptions.taxReturnState] ?? 0;
                const stateWithheld = Math.round(annualGrossHere * stateRate);
                return estimateTaxReturn({
                  annualGrossIncome: annualGrossHere,
                  federalWithheld,
                  filingStatus: assumptions.taxReturnFilingStatus,
                  dependentsUnder17: assumptions.taxReturnDependents,
                  stateCode: assumptions.taxReturnState,
                  stateWithheld,
                }).totalRefund;
              })();
          netIncome += refundAmt; // positive = refund income; negative = amount owed outflow
          taxReturnIncome = refundAmt;
        } catch { /* skip refund if estimator throws */ }
      }

      // Expenses — use CC-filtered forecastMonthEvents (scheduled events from today onward).
      // Month 0: starting cash already reflects all paid expenses; never fall back to the
      // full-month budget amount or past bills that have already cleared would be re-charged.
      const filteredExpenses = forecastMonthEvents[i]?.expenses ?? 0;
      const budgetFallback = budgetItems.reduce((s, b) => s + Number(b.amount), 0);
      let baseExpenses: number;
      if (i === 0) {
        baseExpenses = filteredExpenses;
      } else if (filteredExpenses > 0) {
        baseExpenses = filteredExpenses;
      } else {
        baseExpenses = budgetFallback;
      }
      // Plan payments are fixed amounts — add after base expenses
      baseExpenses += planExpensesByMonth[i] ?? 0;

      // rawDebtPayment = all CC outflows: debt payoff while balances remain + post-payoff
      // purchase pass-through. Uses allPaymentTotals (from sim.monthlyPayments) so
      // post-payoff CC purchases appear as cash outflows — forecastMonthEvents.expenses
      // already excludes CC purchases, so without this they vanish from the model.
      let rawDebtPayment = cardProjectionData?.allPaymentTotals?.[i]
        ?? debtPaymentsByMonth[monthKey]
        ?? 0;

      // FIX #5: Only fall back to minimum payments if debt engine returned 0 but balance > 0
      if (rawDebtPayment <= 0) {
        const debtRow = debtBalancesByMonth[i];
        if (debtRow && debtRow.totalBalance > 0) {
          const fcCards = buildCardData(accounts, transactions, rules, debts);
          const totalMinPayments = fcCards.filter(c => !c.autopayFullBalance && c.balance > 0)
            .reduce((s, c) => s + Math.max(c.minPayment, c.monthlyNewPurchases), 0);
          if (totalMinPayments > 0) rawDebtPayment = totalMinPayments;
        }
      }

      // Month 0: pin to total recommended CC outflow (revolving + autopay pass-throughs).
      // displayDebtPayment in data.push shows only safeToPayTotal so the popup matches
      // Debt Payoff / Dashboard — the cash model still uses the full amount.
      if (i === 0 && currentMonthRecommendedDebt !== null &&
          (currentMonthRecommendedDebt.safeToPayTotal + currentMonthRecommendedDebt.autopayTotal) > 0) {
        rawDebtPayment = currentMonthRecommendedDebt.safeToPayTotal + currentMonthRecommendedDebt.autopayTotal;
      }

      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      let monthTransfers = 0;
      let monthBrokerageContrib = 0;
      let monthRetireContrib = 0;
      let monthBusinessContrib = 0;
      let monthSavingsTransferContrib = 0;
      const activeTransferDestIds = new Set<string>();
      const transferBreakdown: { name: string; amount: number }[] = [];
      const nonCashTransferItems: { name: string; fromAcctId: string; fromAcctName: string; amount: number }[] = [];
      const perAccountTransferContribs = new Map<string, number>();
      for (const tr of transferRulesAll) {
        if (tr.start_date && new Date(tr.start_date + 'T00:00:00') > monthEnd) continue;
        if (tr.end_date && new Date(tr.end_date + 'T00:00:00') < d) continue;
        if (tr.deposit_account) activeTransferDestIds.add(tr.deposit_account);
        const amt = Number(tr.amount);
        let monthAmt = amt;
        if (i === 0) {
          // Month 0: only count transfer occurrences that haven't cleared yet.
          // The balance already reflects transfers on or before syncCutoffDate.
          const syncDay = parseInt(syncCutoffDate.split('-')[2]);
          if (tr.frequency === 'weekly') {
            let weekCount = 0;
            const firstD = new Date(d.getFullYear(), d.getMonth(), 1);
            const dow = tr.due_day ?? 5;
            while (firstD.getDay() !== dow) firstD.setDate(firstD.getDate() + 1);
            while (firstD <= monthEnd) {
              if (firstD.getDate() > syncDay) weekCount++;
              firstD.setDate(firstD.getDate() + 7);
            }
            monthAmt = amt * weekCount;
          } else if (tr.frequency === 'monthly') {
            const dueDay = Math.min(tr.due_day || 1, monthEnd.getDate());
            monthAmt = dueDay > syncDay ? amt : 0;
          } else if (tr.frequency === 'yearly') {
            monthAmt = amt / 12;
          }
          // biweekly: leave monthAmt = amt (conservative; at most once per month)
        } else {
          if (tr.frequency === 'weekly') monthAmt = amt * countWeekdayInMonth(d.getFullYear(), d.getMonth(), tr.due_day ?? 5);
          else if (tr.frequency === 'yearly') monthAmt = amt / 12;
        }

        // If payment_source is a non-cash account, this transfer moves money between
        // non-cash accounts and should NOT reduce checking cash.
        const srcAcct = tr.payment_source ? accountMap.get(tr.payment_source) : null;
        const srcIsNonCash = srcAcct
          ? (['savings', 'high_yield_savings', 'brokerage', 'roth_ira', '401k', 'ira', 'hsa'] as string[]).includes(srcAcct.account_type as string)
          : false;
        if (srcIsNonCash) {
          if (monthAmt > 0) {
            nonCashTransferItems.push({ name: tr.name, fromAcctId: srcAcct!.id as string, fromAcctName: srcAcct!.name as string, amount: monthAmt });
            if (tr.deposit_account) {
              perAccountTransferContribs.set(tr.deposit_account, (perAccountTransferContribs.get(tr.deposit_account) ?? 0) + monthAmt);
            }
          }
          continue;
        }

        monthTransfers += monthAmt;
        if (monthAmt === 0) continue; // cleared — skip categorization

        // Per-account attribution for precise per-account balance tracking
        if (tr.deposit_account) {
          perAccountTransferContribs.set(tr.deposit_account, (perAccountTransferContribs.get(tr.deposit_account) ?? 0) + monthAmt);
        }

        // Categorize by destination account type
        const destAcct = tr.deposit_account ? accountMap.get(tr.deposit_account) : null;
        const destType = destAcct?.account_type || '';
        if (['roth_ira', '401k', 'ira', 'hsa'].includes(destType)) {
          monthRetireContrib += monthAmt;
          transferBreakdown.push({ name: tr.name, amount: monthAmt });
        } else if (destType === 'brokerage') {
          monthBrokerageContrib += monthAmt;
          transferBreakdown.push({ name: tr.name, amount: monthAmt });
        } else if (['savings', 'high_yield_savings'].includes(destType)) {
          monthSavingsTransferContrib += monthAmt;
          transferBreakdown.push({ name: tr.name, amount: monthAmt });
        } else if (
          destType === 'business_checking' ||
          (destType === 'checking' && forecastFundingAccountId != null && destAcct?.id !== forecastFundingAccountId)
        ) {
          monthBusinessContrib += monthAmt;
          // business transfers have their own popup line — excluded from transferBreakdown
        } else {
          // generic investment/transfer — include
          transferBreakdown.push({ name: tr.name, amount: monthAmt });
        }
      }

      // Expense rules paid from a different bank account than the funding account — that money
      // never touches the funding account, so (mirroring nonCashTransferItems above) it must not
      // reduce baseExpenses. Tracked here for the popup's own "no cash impact" section instead.
      const otherAccountExpenseItems: { name: string; fromAcctName: string; amount: number }[] = [];
      for (const r of rules) {
        if (!r.active || r.rule_type !== 'expense' || !r.payment_source) continue;
        if (ccPaymentSourcesForOtherAcct.has(r.payment_source)) continue;
        const srcId = (r.payment_source as string).replace(/^account:/, '');
        if (!forecastFundingAccountId || srcId === forecastFundingAccountId) continue;
        const srcAcct = accountMap.get(srcId);
        const monthAmt = Number(r.amount) * countRuleOccurrencesInMonth(r, d.getFullYear(), d.getMonth());
        if (monthAmt > 0) {
          otherAccountExpenseItems.push({ name: r.name as string, fromAcctName: (srcAcct?.name as string) ?? '', amount: monthAmt });
        }
      }

      // Add paycheck 401k deduction — month 0 uses only paychecks strictly after syncCutoffDate.
      // Paychecks on or before the sync date are already reflected in liquidBal.
      const paychecksThisMonth = i === 0
        ? getPaychecksInMonth(adjustedConfig, d.getFullYear(), d.getMonth())
            .filter(p => {
              const pStr = `${p.date.getFullYear()}-${String(p.date.getMonth() + 1).padStart(2, '0')}-${String(p.date.getDate()).padStart(2, '0')}`;
              return pStr > syncCutoffDate;
            }).length
        : getPaychecksInMonth(adjustedConfig, d.getFullYear(), d.getMonth()).length;
      const month401kContrib = payConfig ? perCheck401k * paychecksThisMonth : 0;
      // Full month paychecks — used for display only (popup shows full month total, not remaining)
      const allPaychecksThisMonth = getPaychecksInMonth(adjustedConfig, d.getFullYear(), d.getMonth()).length;
      const fullMonth401kContrib = payConfig ? perCheck401k * allPaychecksThisMonth : 0;
      monthRetireContrib += month401kContrib;

      const oneTime = oneTimeByMonth[monthKey] || { income: 0, expense: 0 };
      const oneTimeNet = oneTime.income - oneTime.expense;

      // Use cardProjectionData (event-based, includes all outflows) as the source of truth
      // for CC balance — this ensures the chart and monthly table show identical trajectories.
      // Fallback to debtBalancesByMonth if cardProjectionData isn't available (no CC cards).
      const ccDebtBalance = cardProjectionData?.data[i]?.totalCCBalance
        ?? (debtBalancesByMonth[i]?.totalBalance ?? 0);

      const otherDebtBalance = nonCCDebtBalanceByMonth[i];

      // Shared with Dashboard.tsx and useCardProjection.ts via getAugmentedMinSafeCash so the
      // floor displayed here always matches the floor actually used to cap available cash.
      const { monthMinSafe, floorItems, prePaycheckBillsTotal } = getAugmentedMinSafeCash(
        rules, payConfig, cashFloor, forecastFundingAccountId, d,
        carFunds ?? [],
        cardProjectionData ? {
          simCards: cardProjectionData.simCards,
          monthlyRevolvingBalances: cardProjectionData.monthlyRevolvingBalances,
          perCardMinPayments: cardProjectionData.perCardMinPayments,
          monthlyCyclingBacklog: cardProjectionData.monthlyCyclingBacklog,
        } : null,
        i, syncCutoffDate,
      );

      // Respect contribution_start_date; exclude goals linked to retirement accounts (paycheck deduction)
      // and goals whose linked account is funded by an active transfer rule this month (avoid double count)
      const savingsGoalItems: { name: string; amount: number; goalId: string; linkedAccount?: string }[] = [];
      const monthlySavingsContrib = goals.reduce((s, g) => {
        if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > d) return s;
        if (g.linked_account && retireAccountIds.has(g.linked_account)) return s;
        if (g.linked_account && activeTransferDestIds.has(g.linked_account)) return s;
        const contrib = Number(g.monthly_contribution);
        if (contrib > 0) savingsGoalItems.push({ name: g.name ?? 'Goal', amount: contrib, goalId: g.id as string, linkedAccount: g.linked_account as string | undefined });
        return s + contrib;
      }, 0);

      const carContribItems: { name: string; amount: number; isPurchaseMonth: boolean }[] = vehicleProjections
        .filter(v => i <= v.purchaseMonthIdx && v.contrib > 0)
        .map(v => ({ name: v.vehicleName, amount: Math.round(v.contrib), isPurchaseMonth: i === v.purchaseMonthIdx }));

      baseData.push({
        monthLabel, monthKey, netIncome, baseExpenses, rawDebtPayment,
        monthTransfers, monthBrokerageContrib, monthRetireContrib, monthBusinessContrib, monthSavingsTransferContrib, oneTimeNet, ccDebtBalance, otherDebtBalance, monthMinSafe, monthlySavingsContrib,
        paycheckIncome, otherIncome, bonusIncome, taxReturnIncome, isRaiseMonth, promotionNewSalary,
        paycheckRetireContrib: month401kContrib, fullMonth401kContrib, transferBreakdown, nonCashTransferItems,
        floorItems, prePaycheckBillsTotal, savingsGoalItems, carContribItems, perAccountTransferContribs,
        otherAccountExpenseItems,
      });

    }

    // ═══ PASS 2: Look-ahead — save up for one-time CASH expenses, redirect surplus otherwise ═══
    //
    // Design goals:
    //  • When CC debt exists and no upcoming cash expense needs saving, PASS 3 pins end cash
    //    to cashFloor (all surplus → debt). PASS 2 must simulate this so it sees the correct
    //    starting balance for future months.
    //  • When a future one-time CASH expense would breach the floor, PASS 2 reduces debt
    //    payments in the months immediately before the expense (latest-first = "1 month before
    //    if possible, more if needed"), down to CC minimums. Those months become "save-up months"
    //    where PASS 3 skips its redirect so cash accumulates.
    //  • CC one-time purchases are excluded from oneTimeByMonth and never trigger save-up.
    //  • CC minimums are always met — payments never drop below ccMinTotal.

    // Total CC minimum payment across all cards (floor for save-up reduction).
    // Sourced from cardProjectionData.simCards (CardData.minPayment, the same value the
    // simulation and useCardProjection's month-0 calc use) rather than the debts table's
    // min_payment directly — those can disagree (accounts.min_payment takes precedence in
    // buildCardData when present), which previously made Forecast think less was due than the
    // engine actually required, letting month-0 debt payments diverge from cardProjectionData.
    const ccCards = active.filter((a) => a.account_type === 'credit_card');
    const ccMinTotal = (cardProjectionData?.simCards ?? []).length > 0
      ? cardProjectionData!.simCards.reduce((s, c) => s + Number(c.minPayment || 0), 0)
      : debts
        .filter((d) => ccCards.some((a) => a.name.toLowerCase() === d.name.toLowerCase()))
        .reduce((s, d) => s + Number(d.min_payment), 0);

    // ═══ PASS 2: Look-ahead — save up for upcoming cash shortfalls ═══
    // Runs its own independent floor-protection pass, sharing the reserve-based algorithm in
    // src/lib/floor-protection.ts with useCardProjection.ts but built entirely from Forecast's
    // own per-month numbers — not borrowed from the hook. This is deliberate: the hook and
    // Forecast compute income/expenses/floor independently (separate code paths over the same
    // underlying data), and a previous attempt at trusting the hook's save-up determination here
    // blindly let a real discrepancy between the two models (a saving-phase car's projected-loan
    // lump-sum payments, which the hook didn't know about) show up as unprotected floor breaches
    // on this page while the hook itself reported everything was fine. Each page now catches its
    // own breaches in its own model; sharing only the algorithm (not the data) means a fix to the
    // math — like the cascade-protection rewrite that replaced an all-or-nothing "fully protect
    // this month or not" flag — fixes both pages at once instead of drifting apart again.
    const cyclingByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, i) =>
      Math.max(0, (cardProjectionData?.allPaymentTotals?.[i] ?? 0) - (cardProjectionData?.debtPaymentTotals?.[i] ?? 0)),
    );
    const ccSourceIds = new Set<string>(ccCards.flatMap((a) => [a.id as string, `account:${a.id}`]));
    const { maxDebtPaymentByMonth, saveUpMonths, strictSaveUpMonths } = computeFloorProtection({
      incomeByMonth: baseData.map(b => b.netIncome),
      expenseByMonth: baseData.map((b, i) =>
        b.baseExpenses + b.monthlySavingsContrib + getMonthCarContrib(i) + activeCarLoanByMonth[i]
          + getMonthVehicleInsurance(i) + getMonthProjLoan(i) + mortgageMonthlyPayment
          + b.monthTransfers + lumpTransferByMonth[i].total + cyclingByMonth[i]),
      oneTimeNetByMonth: baseData.map(b => b.oneTimeNet),
      carDownPaymentByMonth: Array.from({ length: PROJECTION_MONTHS }, (_, i) => getMonthEffectiveDP(i)),
      floorByMonth: baseData.map(b => b.monthMinSafe),
      startingBalance: liquidBal,
      ccMinTotal,
      cyclingExcessByMonth: cyclingByMonth,
      carFunds, transactions, ccSourceIds, now: nowDate, formatCurrency,
    });

    // debtPayments[i]: Forecast's own raw recommended payment (rawDebtPayment, already sourced
    // from cardProjectionData.allPaymentTotals where available), capped by this page's own
    // look-ahead above.
    const debtPayments = baseData.map((b, i) => Math.min(b.rawDebtPayment, maxDebtPaymentByMonth[i]));

    // Resolve each goal's live current_amount/monthly_contribution/contribution-start delay the
    // same way SavingsGoals.tsx's allGoals does (linked_account balance, linked_rule amount) so
    // this milestone timing matches what the Goals tab actually shows. Reading the raw DB fields
    // directly (as this used to) goes stale the moment a goal is linked to an account or rule,
    // and ignored contribution_start_date entirely, firing the milestone as if contributions had
    // already started.
    const goalAccountMap = new Map(accounts.map((a) => [a.id, a]));
    const resolvedGoals = goals.map((g) => {
      const ruleIds: string[] = (g.linked_rule_ids ?? []).length > 0
        ? (g.linked_rule_ids ?? [])
        : g.linked_rule_id ? [g.linked_rule_id] : [];
      const linkedRules = ruleIds.map(id => rules.find(r => r.id === id)).filter((r): r is NonNullable<typeof r> => r != null);
      const linkedAcct = g.linked_account ? goalAccountMap.get(g.linked_account) : null;
      const earliestStart = linkedRules.map(r => r.start_date).filter((d): d is string => d != null).sort()[0] ?? null;
      const contributionStartDate = earliestStart ?? g.contribution_start_date ?? null;
      let delayMonths = 0;
      if (contributionStartDate) {
        const start = new Date(contributionStartDate + 'T00:00:00');
        const j = (start.getFullYear() - nowDate.getFullYear()) * 12 + (start.getMonth() - nowDate.getMonth());
        delayMonths = Math.max(0, j - 1);
      }
      const linkedMonthly = linkedRules.reduce((s, r) => s + toMonthly(Number(r.amount), r.frequency), 0);
      return {
        ...g,
        current_amount: linkedAcct ? Number(linkedAcct.balance) : Number(g.current_amount),
        monthly_contribution: linkedRules.length > 0 ? linkedMonthly : Number(g.monthly_contribution),
        delayMonths,
      };
    });

    // ═══ PASS 3: Build final projection data ═══
    let finalLiquid = liquidBal;
    const data: ForecastMonthRow[] = [];
    const milestones: { month: string; event: string }[] = [];

    // p3RevBal tracks the actual revolving CC balance forward through PASS 3.
    // The CC sim's b.ccDebtBalance projects balances using only target/min payments,
    // running far too long (e.g. Discover at $97/mo takes 45 months). PASS 3 sends
    // large surpluses to CC debt each month, zeroing it in ~2-4 months. Using the CC
    // sim's projection as the gate would pin ending cash to the floor long after all
    // debt is actually paid. p3RevBal uses live account balances as the starting point
    // and deducts the actual revolving payments + surplus each month.
    const liveRevolvingBal = (cardProjectionData?.simCards ?? []).reduce((s, c) => {
      const revBal0 = cardProjectionData?.monthlyRevolvingBalances?.get(c.id)?.[0] ?? 1;
      if (revBal0 === 0) return s; // cycling card — paid in full each month, not revolving
      const acct = active.find((a) => a.id === c.id);
      return s + (acct ? Number(acct.balance || 0) : 0);
    }, 0);
    let p3RevBal = liveRevolvingBal;
    // virtualRevBal tracks what Discover's balance would be if step-3 payments were real:
    // starts at the live balance, decreases each month by the simulation's net change
    // (which already includes interest) and by any step-3 surplus routed that month.
    // This replaces the old cumulativeSurplus cap, which hit 0 prematurely whenever
    // the simulation's own large avalanche payments dropped ccEngRevBalEnd faster than
    // cumulativeSurplus accumulated — causing surplus cash to pile up instead of routing
    // to Discover.
    let virtualRevBal = liveRevolvingBal;
    let prevCcEngRevBalEnd = liveRevolvingBal;
    // Tracks cumulative extra step-3 surplus payments sent to revolving debt beyond the SIM's plan.
    // Used to compute "adjusted remaining balance" = ccEngRevBalEnd - cumulativeStep3Extra,
    // which is the forecast's authoritative view of what's still owed after all extra routing.
    let cumulativeStep3Extra = 0;
    let prevAdjustedRevBal = liveRevolvingBal;
    // ccDebtFreeFired gates the step-3 surplus routing + display adjustment below: it flips the
    // month the forecast's combined payments COVER the revolving balance (~1 mo before the real
    // balance reaches $0). Keep it there — it controls money movement, not the milestone.
    let ccDebtFreeFired = false;
    // ccMilestoneFired is separate: the user-facing "CC Debt Free" milestone must land on the month
    // the real revolving balance actually reaches $0 (Discover, the last interest-bearing card),
    // NOT the earlier surplus-covers month — otherwise a Discover payment shows AFTER the milestone
    // with no matching $0. Prefer the SIM's true all-revolving-clear month (simRevolvingPayoffMonth);
    // fall back to the surplus-covers signal, then to ccDebtFreeFired when no signal is available.
    let ccMilestoneFired = false;
    const rawPayoffMonth = cardProjectionData?.simRevolvingPayoffMonth
      ?? cardProjectionData?.forecastRevolvingPayoffMonth ?? null;
    const ccDebtFreePayoffIdx = rawPayoffMonth != null && rawPayoffMonth > 0 ? rawPayoffMonth - 1 : null;
    // Cash being set aside toward a saving-phase vehicle's down payment hasn't left any account
    // yet — it's still the user's cash. Track it separately and add it back to displayed Ending
    // Cash each month, removing it once the purchase month arrives (the money's been spent by
    // month-end, same point effectiveDP/the lump-sum purchase deduction already fires).
    let cumulativeCarReserveHeld = 0;

    // Per-card cumulative PASS-3 surpluses from the card-projection hook — the SAME derivation the
    // Forecast popup's per-card lines, the Debt Payoff accordion/chart, and the CSV export subtract
    // (see step3-display.ts). The Total CC display line below must use it too, so the popup's
    // per-card lines always sum to the total shown next to them. Display-only: the engine's own
    // cumulativeStep3Extra still drives the step-3 cash routing above.
    const hookCumSurplusByCard = cumulativeSurplusesByCard(cardProjectionData?.perCardPaymentsScaled);

    for (let i = 0; i < PROJECTION_MONTHS; i++) {
      const b = baseData[i];
      let monthDebtPayment = debtPayments[i];
      const startingCash = Math.round(finalLiquid);
      const carContribThisMonth = getMonthCarContrib(i);
      cumulativeCarReserveHeld += carContribThisMonth;
      for (const v of vehicleProjections) {
        if (i === v.purchaseMonthIdx) {
          cumulativeCarReserveHeld = Math.max(0, cumulativeCarReserveHeld - v.contrib * (v.purchaseMonthIdx + 1));
        }
      }
      const carLoanThisMonth = activeCarLoanByMonth[i];
      const projLumpThisMonth = getMonthProjLumpSum(i);
      const projLoanThisMonth = getMonthProjLoan(i);
      const carLoanLumpThisMonth = activeCarLoanLumpSumByMonth[i] + projLumpThisMonth;
      const downPaymentThisMonth = getMonthDownPayment(i); // display only (full goal - gift)
      const effectiveDPThisMonth = getMonthEffectiveDP(i); // cash math (0 when monthly savings cover it)
      const vehicleInsuranceThisMonth = getMonthVehicleInsurance(i);

      // displayCCBalance (not the raw revolving-only ccDebtBalance) keeps a statement-preference
      // card's routine monthly purchases counted as a real liability even after its revolving
      // balance clears and it settles into cycling mode — ccDebtBalance is a deliberate one-way
      // 0-once-cycling signal (see credit-card-engine.ts), so liabilities/net worth would otherwise
      // understate debt for any card that pays its statement in full every month but still spends.
      const ccLiabilityBalThisMonth = cardProjectionData?.data[i]?.displayCCBalance ?? b.ccDebtBalance;
      totalLiabilityBal = ccLiabilityBalThisMonth + b.otherDebtBalance + carLoanBalanceByMonth[i];

      const investGrowthAmt = Math.round(investBal * monthlyInvestGrowth * 100) / 100;
      const retireGrowthAmt = Math.round(retireBal * monthlyRetireGrowth * 100) / 100;

      // Step 1: savings + transfers + fixed car loan payments apply first as regular outflows
      const savingsOut = b.monthlySavingsContrib + carContribThisMonth;
      const transfersOut = b.monthTransfers;
      const lumpTransferThisMonth = lumpTransferByMonth[i].total;
      const cashPreDebt = finalLiquid + b.netIncome - b.baseExpenses - savingsOut - carLoanThisMonth - effectiveDPThisMonth - vehicleInsuranceThisMonth - projLoanThisMonth - mortgageMonthlyPayment - transfersOut - lumpTransferThisMonth + b.oneTimeNet;

      // Step 2: cycling payments are non-negotiable (like rent).
      // Exception: in save-up months where revolving debt is already cleared, cap total CC
      // payments to PASS 2's reduced amount (monthDebtPayment = debtPayments[i]) so that
      // statement/full-balance card payments (e.g. Amex Gold) are reduced and cash accumulates
      // for the upcoming large expense (car down payment, one-time item). Without this cap,
      // cycling payments bypass PASS 2's look-ahead reductions and the floor is never met.
      // Revolving payments and minimums only apply while p3RevBal shows remaining debt.
      const simAllPayments = cardProjectionData?.allPaymentTotals?.[i] ?? monthDebtPayment;
      const simRevolvingPayment = cardProjectionData?.debtPaymentTotals?.[i] ?? monthDebtPayment;
      const effectiveTotalPayments = (saveUpMonths.has(i) && p3RevBal <= 0 && cardProjectionData)
        ? Math.min(simAllPayments, Math.max(0, monthDebtPayment))
        : simAllPayments;
      const cyclingPayment = Math.max(0, effectiveTotalPayments - simRevolvingPayment);
      // Gate minimum and revolving payment on p3RevBal — once debt is zeroed, skip both.
      const ccMinForMonth = p3RevBal > 0 ? Math.min(ccMinTotal, simRevolvingPayment) : 0;
      const availableForRevolving = p3RevBal > 0
        ? Math.max(ccMinForMonth, Math.max(0, cashPreDebt - cyclingPayment - b.monthMinSafe))
        : 0;
      // Save-up months: cap revolving at minimum-ish so cash accumulates for the upcoming large
      // expense instead of being drained to the floor. saveUpMonths is sourced directly from
      // useCardProjection above, so this is already the engine's own determination.
      const revolvingCap = saveUpMonths.has(i)
        ? Math.max(ccMinForMonth, debtPayments[i] - cyclingPayment)
        : availableForRevolving;
      const revolvingPayment = p3RevBal > 0 ? Math.min(simRevolvingPayment, Math.min(revolvingCap, availableForRevolving)) : 0;
      // Prefer the Debt Payoff tab's own displayed total (perCardPaymentsScaled, which already
      // reflects its per-card avalanche/snowball priority, minimum-payment protection, and
      // surplus redirect) over Forecast's independently re-derived revolvingPayment above,
      // whenever it's within Forecast's own safety ceiling (cyclingPayment + revolvingPayment) —
      // this is what actually keeps the two pages' displayed numbers in sync in the common case,
      // since otherwise each page computes its own revolving split from a slightly different
      // running-cash model and the two only roughly agree. Still clamped to Forecast's own
      // ceiling so a rare disagreement between the two models can never let this page pay out
      // more than its own independent floor check considers safe.
      // When all month-0 CC payments have already settled before syncCutoffDate (safeToPayTotal === 0),
      // perCardPaymentsScaled still carries the engine's pass-3 revolving amounts — routing those via
      // hookScaledTotal would double-count payments already captured in the live Plaid balance. Use 0
      // so the math matches what the engine actually recommends for this settled month.
      const m0AllSettled = i === 0 && (cardProjectionData?.month0?.safeToPayTotal ?? 1) === 0;
      const hookScaledTotal = m0AllSettled
        ? 0
        : (cardProjectionData?.perCardPaymentsScaled?.reduce((s, p) => s + (p.payments[i] ?? 0), 0) ?? null);
      const safetyCeiling = cyclingPayment + revolvingPayment;
      // Prefer the hook's total when it's within Forecast's own floor-safety ceiling — that
      // keeps per-card popup amounts in sync with the Debt Payoff tab. Clamp to safetyCeiling
      // when the hook's total exceeds it (rare disagreement between the two cash models) so
      // this page never pays out more than its own independent floor check considers safe.
      // Exception: when activeSim (sim2) diverges from the original sim on a catch-up payment
      // (e.g., a cycling card that temporarily built revolving balance), hookScaledTotal can
      // legitimately exceed the original-sim-derived ceiling. Allow it when paying the full
      // hookScaledTotal still leaves cash safely above floor — the floor check is the real gate.
      const effectiveCeiling = (
        hookScaledTotal !== null &&
        hookScaledTotal > safetyCeiling &&
        cashPreDebt - hookScaledTotal >= b.monthMinSafe
      ) ? hookScaledTotal : safetyCeiling;
      monthDebtPayment = hookScaledTotal !== null ? Math.min(hookScaledTotal, effectiveCeiling) : effectiveCeiling;
      finalLiquid = cashPreDebt - monthDebtPayment;

      // Step 3: redirect surplus above floor to debt. Cap uses CC engine's post-payment revolving
      // balance (interest-inclusive) minus cumulative surpluses already sent — fixes prior drift
      // where p3RevBal fell below the true balance because monthly interest wasn't added back.
      // The engine's monthlyRevolvingBalances[i] already has the planned revolving payment deducted,
      // so revolvingPayment is not subtracted again here.
      // Skip surplus routing in month 0 when all payments are settled — future-dated income should
      // remain visible as projected ending cash, not be silently pre-routed to CC debt.
      const ccEngRevBalEnd = (cardProjectionData?.simCards ?? []).reduce((s, c) => {
        const revBal0 = cardProjectionData?.monthlyRevolvingBalances?.get(c.id)?.[0] ?? 1;
        if (revBal0 === 0) return s;
        return s + Math.max(0, cardProjectionData?.monthlyRevolvingBalances?.get(c.id)?.[i] ?? 0);
      }, 0);
      // virtualRevBal tracks the SIM's revolving payment plan (revolvingPayment + interest/new-purchases).
      // cumulativeStep3Extra tracks additional forecast surplus sent to revolving debt beyond the SIM's plan.
      // "adjusted remaining" = ccEngRevBalEnd - cumulativeStep3Extra is the authoritative remaining balance
      // that accounts for both the SIM's planned payments AND forecast step-3 pre-payments.
      if (!ccDebtFreeFired) {
        const interestAndNewPurchases = Math.max(0, ccEngRevBalEnd - prevCcEngRevBalEnd + simRevolvingPayment);
        virtualRevBal = Math.max(0, virtualRevBal - revolvingPayment + interestAndNewPurchases);
        prevCcEngRevBalEnd = ccEngRevBalEnd;
        // adjustedRevBal = what's still truly owed after all forecast payments (SIM plan + step-3 extras).
        // When virtualRevBal = 0 but the SIM still has remaining balance, adjustedRevBal continues routing
        // surplus until the combined payments cover the full balance.
        const adjustedRevBal = Math.max(0, ccEngRevBalEnd - cumulativeStep3Extra);
        if (!m0AllSettled && !strictSaveUpMonths.has(i) && adjustedRevBal > 0 && finalLiquid > b.monthMinSafe) {
          const surplus = Math.min(finalLiquid - b.monthMinSafe, adjustedRevBal);
          if (surplus > 0) {
            monthDebtPayment += surplus;
            finalLiquid -= surplus;
            cumulativeStep3Extra += surplus;
            virtualRevBal = Math.max(0, virtualRevBal - surplus);
          }
        }
      }
      // p3RevBal = virtualRevBal: CC Debt Free fires when the virtual balance (step-2 + step-3
      // payments tracked against real interest and new purchases) reaches zero.
      p3RevBal = ccDebtFreeFired ? 0 : Math.max(0, virtualRevBal);

      // Adjust the displayed CC liability to reflect PASS-3 extras already routed to revolving
      // debt. The SIM's displayCCBalance treats the revolving balance as if no extra payments
      // occurred. Uses the hook's per-card cumulative surpluses (hookCumSurplusByCard) — the same
      // adjustment the popup applies per card — gated to cards still carrying revolving debt and
      // capped at each card's own balance, so the Total CC line always equals the sum of the
      // per-card lines and we never over-subtract into the cycling cards' share. Once a card's
      // revolving balance clears, its surplus history stops being subtracted (the card's line
      // shows its cycling statement untouched), so post-payoff months show cycling balances only.
      const revolvingAdj = (cardProjectionData?.simCards ?? []).reduce((s, c) => {
        const revBal = cardProjectionData?.monthlyRevolvingBalances?.get(c.id)?.[i] ?? 0;
        if (revBal <= 0) return s;
        const trueBal = cardProjectionData?.monthlyBalances?.get(c.id)?.[i] ?? 0;
        return s + (trueBal - adjustedDisplayBalance(trueBal, hookCumSurplusByCard.get(c.id)?.[i] ?? 0));
      }, 0);
      const adjCCLiab = Math.max(0, ccLiabilityBalThisMonth - revolvingAdj);
      totalLiabilityBal = adjCCLiab + b.otherDebtBalance + carLoanBalanceByMonth[i];

      // Step 4: per-account balance tracking
      const actualGoalsSavings = b.monthlySavingsContrib;
      const actualCarSavings = carContribThisMonth;
      const actualTransfers = transfersOut;
      // Kept for existing popup display fields (brokerageContrib / retireContrib)
      const xferRetireAmt = b.monthTransfers > 0 ? (b.monthRetireContrib - b.paycheckRetireContrib) / b.monthTransfers * actualTransfers : 0;
      const xferBrokerageAmt = b.monthTransfers > 0 ? b.monthBrokerageContrib / b.monthTransfers * actualTransfers : 0;

      // 4a. Paycheck retire deductions → per-account attribution
      if (b.paycheckRetireContrib > 0) {
        const totalPerCheckBasis = Array.from(perCheckRetireByAcct.values()).reduce((s, v) => s + v, 0);
        for (const [id, baseAmt] of perCheckRetireByAcct) {
          const a = perAcctRetire.get(id);
          if (a) a.balance += totalPerCheckBasis > 0 ? b.paycheckRetireContrib * (baseAmt / totalPerCheckBasis) : b.paycheckRetireContrib;
        }
      }

      // 4b. Transfer rule contributions → exact account via perAccountTransferContribs
      for (const [acctId, amt] of b.perAccountTransferContribs) {
        const retA = perAcctRetire.get(acctId);
        const invA = perAcctInvest.get(acctId);
        const savA = perAcctSavings.get(acctId);
        if (retA) retA.balance += amt;
        else if (invA) invA.balance += amt;
        else if (savA) savA.balance += amt;
      }

      // 4b-ii. Non-cash transfers — debit the source account
      for (const item of b.nonCashTransferItems) {
        const srcSav = perAcctSavings.get(item.fromAcctId);
        const srcInv = perAcctInvest.get(item.fromAcctId);
        const srcRet = perAcctRetire.get(item.fromAcctId);
        if (srcSav) srcSav.balance = Math.max(0, srcSav.balance - item.amount);
        else if (srcInv) srcInv.balance = Math.max(0, srcInv.balance - item.amount);
        else if (srcRet) srcRet.balance = Math.max(0, srcRet.balance - item.amount);
      }

      // 4c. Goal monthly contributions → linked savings account or goal pool
      for (const item of b.savingsGoalItems) {
        if (item.linkedAccount && perAcctSavings.has(item.linkedAccount)) {
          perAcctSavings.get(item.linkedAccount)!.balance += item.amount;
        } else {
          const pool = goalPools.get(item.goalId);
          if (pool) pool.balance += item.amount;
        }
      }

      // 4d. Lump sums → per-account or goal pool
      for (const [key, amt] of lumpTransferByMonth[i].perAccount) {
        const retA = perAcctRetire.get(key);
        const invA = perAcctInvest.get(key);
        const savA = perAcctSavings.get(key);
        const pool = goalPools.get(key);
        if (retA) retA.balance += amt;
        else if (invA) invA.balance += amt;
        else if (savA) savA.balance += amt;
        else if (pool) pool.balance += amt;
      }

      // 4d-ii. Vehicle down payment — debit the linked savings account on purchase month
      const vehicleDPFromSavingsThisMonth: { vehicleName: string; fromAcctName: string; amount: number }[] = [];
      for (const v of vehicleProjections) {
        if (isFinite(v.purchaseMonthIdx) && i === v.purchaseMonthIdx && v.linkedAccountId) {
          const savingsPortionFromLinked = Math.round(v.downPayment - v.effectiveDP);
          if (savingsPortionFromLinked > 0) {
            const savA = perAcctSavings.get(v.linkedAccountId);
            if (savA) {
              savA.balance = Math.max(0, savA.balance - savingsPortionFromLinked);
              vehicleDPFromSavingsThisMonth.push({ vehicleName: v.vehicleName, fromAcctName: savA.name, amount: savingsPortionFromLinked });
            }
          }
        }
      }

      // 4e. Apply growth to each account
      for (const [, a] of perAcctRetire) a.balance = Math.round(a.balance * (1 + monthlyRetireGrowth) * 100) / 100;
      for (const [, a] of perAcctInvest) a.balance = Math.round(a.balance * (1 + monthlyInvestGrowth) * 100) / 100;
      for (const [, a] of perAcctSavings) a.balance = Math.round(a.balance * (1 + monthlySavingsInterest) * 100) / 100;
      for (const [, p] of goalPools) p.balance = Math.round(p.balance * (1 + monthlySavingsInterest) * 100) / 100;

      // 4f. Re-derive aggregate scalars from per-account Maps
      retireBal = Array.from(perAcctRetire.values()).reduce((s, a) => s + a.balance, 0);
      investBal = Array.from(perAcctInvest.values()).reduce((s, a) => s + a.balance, 0);
      savingsBal = Array.from(perAcctSavings.values()).reduce((s, a) => s + a.balance, 0)
        + Array.from(goalPools.values()).reduce((s, p) => s + p.balance, 0);

      const totalMonthlyOut = b.baseExpenses + monthDebtPayment + savingsOut + carLoanThisMonth + effectiveDPThisMonth + vehicleInsuranceThisMonth + projLoanThisMonth + mortgageMonthlyPayment + actualTransfers + lumpTransferThisMonth;

      // FIX #9: Don't floor at 0 — allow display of negative to alert user
      // Reserved-but-not-yet-spent vehicle savings are added back — see cumulativeCarReserveHeld.
      const endingCash = Math.round(finalLiquid + cumulativeCarReserveHeld);

      // Flag: floor breached AND the one-time expense alone caused it
      const floorBreachedByOneTime =
        endingCash < cashFloor &&
        b.oneTimeNet < 0 &&
        (endingCash - b.oneTimeNet) >= cashFloor;
      const debtWasReduced = debtPayments[i] < b.rawDebtPayment;

      const totalAssets = finalLiquid + investBal + retireBal + savingsBal;
      const netWorth = totalAssets - totalLiabilityBal;

      // ccDebtFreeFired flips the month the forecast's combined payments (SIM plan + step-3 extras)
      // COVER the full revolving balance: adjustedRevBal = ccEngRevBalEnd - cumulativeStep3Extra <= 0.
      // This gates the surplus routing + display adjustment above (do NOT emit the milestone here —
      // that fires ~1 month before the real balance reaches $0).
      const adjustedRevBalFinal = Math.max(0, ccEngRevBalEnd - cumulativeStep3Extra);
      if (!ccDebtFreeFired && adjustedRevBalFinal <= 0 && prevAdjustedRevBal > 0) {
        ccDebtFreeFired = true;
      }
      prevAdjustedRevBal = adjustedRevBalFinal;

      // CC Debt Free milestone: fire on the real revolving-$0 month (ccDebtFreePayoffIdx, from the
      // SIM's true payoff signal). When no signal is available, fall back to the surplus-covers flag
      // so the milestone still fires within the horizon.
      if (!ccMilestoneFired) {
        const fireBySignal = ccDebtFreePayoffIdx !== null && i === ccDebtFreePayoffIdx;
        const fireByFallback = ccDebtFreePayoffIdx === null && ccDebtFreeFired;
        if (fireBySignal || fireByFallback) {
          milestones.push({ month: b.monthLabel, event: 'CC Debt Free! 🎉' });
          ccMilestoneFired = true;
        }
      }
      resolvedGoals.forEach((g) => {
        const elapsed = Math.max(0, i - g.delayMonths);
        const prevElapsed = Math.max(0, (i - 1) - g.delayMonths);
        const projected = Number(g.current_amount) + Number(g.monthly_contribution) * elapsed;
        const prevProjected = Number(g.current_amount) + Number(g.monthly_contribution) * prevElapsed;
        if (projected >= Number(g.target_amount) && (i === 0 || prevProjected < Number(g.target_amount))) {
          milestones.push({ month: b.monthLabel, event: `${g.name} Complete! 🎯` });
        }
      });
      if (floorBreachedByOneTime) {
        milestones.push({ month: b.monthLabel, event: '💸 One-time expense caused floor breach' });
      } else if (endingCash < 0 && (i === 0 || data[data.length - 1]?.endingCash >= 0)) {
        milestones.push({ month: b.monthLabel, event: '⚠️ Cash goes negative!' });
      } else if (endingCash >= 0 && endingCash < cashFloor && (data.length === 0 || data[data.length - 1]?.endingCash >= cashFloor)) {
        milestones.push({ month: b.monthLabel, event: '⚠️ Cash below safe minimum' });
      }

      data.push({
        month: b.monthLabel, netWorth: Math.round(netWorth), totalAssets: Math.round(totalAssets),
        totalLiabilities: Math.round(totalLiabilityBal), debtBalance: Math.round(adjCCLiab + b.otherDebtBalance),
        savingsBalance: Math.round(savingsBal), investmentBalance: Math.round(investBal),
        retirementBalance: Math.round(retireBal), liquidCash: Math.round(finalLiquid),
        endingCash,
        startingCash,
        takeHome: Math.round(b.netIncome), totalExpenses: Math.round(totalMonthlyOut),
        debtPayment: Math.round(monthDebtPayment),
        displayDebtPayment: i === 0
          ? (cardProjectionData?.month0?.safeToPayTotal ?? (currentMonthRecommendedDebt?.safeToPayTotal ?? undefined))
          : undefined,
        plannedDebtPayment: Math.round(monthDebtPayment),

        brokerageContrib: Math.round(xferBrokerageAmt),
        retireContrib: Math.round(b.paycheckRetireContrib + xferRetireAmt),
        paycheckRetireContrib: Math.round(b.paycheckRetireContrib),
        fullMonth401kContrib: Math.round(b.fullMonth401kContrib),
        investGrowth: Math.round(investGrowthAmt),
        retireGrowth: Math.round(retireGrowthAmt),
        oneTimeNet: Math.round(b.oneTimeNet),
        ccOneTime: Math.round(ccOneTimeByMonth[b.monthKey] || 0),
        monthMinSafe: Math.round(b.monthMinSafe),
        floorBreachedByOneTime,
        debtWasReduced,
        // Popup breakdown fields
        baseExpenses: Math.round(b.baseExpenses),
        savingsContrib: Math.round(actualGoalsSavings),
        savingsGoalItems: b.savingsGoalItems,
        carContrib: Math.round(actualCarSavings),
        carContribItems: b.carContribItems,
        carReserveHeld: Math.round(cumulativeCarReserveHeld),
        carLoanPayment: Math.round(carLoanThisMonth - activeCarLoanLumpSumByMonth[i]),
        vehicleDownPayment: Math.round(effectiveDPThisMonth), // cash portion only — savings portion in nonCashTransferItems
        vehicleSavedPortion: Math.round(Math.max(0, downPaymentThisMonth - effectiveDPThisMonth)), // from linked savings account
        vehicleInsurance: Math.round(vehicleInsuranceThisMonth),
        projectedCarLoan: Math.round(projLoanThisMonth - projLumpThisMonth),
        carLoanExtraPayment: Math.round(carLoanLumpThisMonth),
        carLumpItems: carLumpItemsByMonth[i],
        mortgagePayment: Math.round(mortgageMonthlyPayment),
        transfersTotal: Math.round(actualTransfers),
        transferBreakdown: b.transferBreakdown,
        nonCashTransferItems: [
          ...b.nonCashTransferItems,
          ...vehicleDPFromSavingsThisMonth.map(v => ({ name: `${v.vehicleName} Down Payment`, fromAcctName: v.fromAcctName, fromAcctId: '', amount: v.amount })),
        ],
        otherAccountExpenseItems: b.otherAccountExpenseItems,
        lumpSumSavings: Math.round(lumpTransferByMonth[i].savings),
        lumpSumBrokerage: Math.round(lumpTransferByMonth[i].brokerage),
        lumpSumRothIra: Math.round(lumpTransferByMonth[i].roth_ira),
        businessContrib: Math.round(b.monthBusinessContrib),
        totalCCPurchases: Math.round((ccScheduledByMonth[i] ?? 0) + (ccOneTimeByMonth[b.monthKey] || 0)),
        ccDebtBalance: Math.round(b.ccDebtBalance),
        ccDisplayBalance: Math.round(adjCCLiab),
        paycheckIncome: Math.round(b.paycheckIncome),
        otherIncome: Math.round(b.otherIncome),
        bonusIncome: Math.round(b.bonusIncome),
        taxReturnIncome: Math.round(b.taxReturnIncome),
        isRaiseMonth: b.isRaiseMonth,
        promotionNewSalary: Math.round(b.promotionNewSalary),
        recommendedDebtPayment: Math.round(debtPayments[i]),
        floorItems: b.floorItems ?? [],
        prePaycheckBillsTotal: Math.round(b.prePaycheckBillsTotal ?? 0),
        settingsCashFloor: cashFloor,
        // Per-account breakdown snapshots for popup display
        assetBreakdown: [
          ...Array.from(perAcctRetire.entries()).map(([id, a]) => ({ bucket: 'retirement' as const, id, name: a.name, balance: Math.round(a.balance) })),
          ...Array.from(perAcctInvest.entries()).map(([id, a]) => ({ bucket: 'investment' as const, id, name: a.name, balance: Math.round(a.balance) })),
          ...Array.from(perAcctSavings.entries()).map(([id, a]) => ({ bucket: 'savings' as const, id, name: a.name, balance: Math.round(a.balance) })),
          ...Array.from(goalPools.entries()).map(([id, p]) => ({ bucket: 'savings' as const, id, name: p.name, balance: Math.round(p.balance) })),
        ],
        nonCCLiabBreakdown: nonCCLiabAccts.map(la => ({
          id: la.id,
          name: la.name,
          account_type: la.account_type,
          balance: Math.max(0, Math.round(la.startBalance - la.monthlyPayment * i)),
        })),
        carLoanBreakdown: carLoanPerFund
          .map(cf => ({ name: cf.name, balance: cf.balances[i] ?? 0 }))
          .filter(cf => cf.balance > 0),
        revolving3Extra: cumulativeStep3Extra,
      });
    }

    return { data, milestones };
}
