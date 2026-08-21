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
import { getMonthlyPlanCashExpenses, type PaymentPlan } from '@/lib/payment-plan-generator';
import { getDebtPaymentsByMonth, getDebtBalancesByMonth } from '@/lib/debt-transaction-generator';
import { getMonthNetIncome, getNormalizedMonthNetIncome, getPaychecksInMonth, getRemainingPaychecksThisMonth, getMinSafeCash, getAugmentedMinSafeCash, getPrePaycheckNextMonthBills, mergeWithGeneratedTransactions, getRemainingTransactionIncomeByDay, getRemainingTransactionExpensesByDay, getPaycheckGross, type EnrichedTransaction, type PayScheduleConfig } from '@/lib/pay-schedule';
import { projectMilestones, monthlyContribForAccount } from '@/lib/retirement-projection';
import { computeBonusAndTax } from '@/lib/income-model';
import { getTotalCarLoanMonthly, calculateScheduledPayment, buildAmortizationSchedule, getLoanPrincipal, monthsBetween, resolveCarFundEarmark, getCarFundSaved } from '@/lib/vehicle-loan-engine';
import { linkedLoanAccountIds } from '@/lib/vehicle-loan-link';
import { buildNonCCLiabilities, type LiabilityDebtInput } from '@/lib/non-cc-liabilities';
import { isCapturedInBalance, dueDateInMonth } from '@/lib/sync-cutoff';
import { carChargeEvidence } from '@/lib/capture-evidence';
import type { MatchableTransaction } from '@/lib/transaction-matching';
import { estimateGoalCompletionMonths, getGoalEffectiveApyPercent } from '@/lib/savings-growth';
import { buildGoalTransferCutoffs, buildGoalOwnCompletionCutoffs } from '@/lib/goal-linkage';
import { computeFloorProtection, FLOOR_CUSHION_DOLLARS } from '@/lib/floor-protection';
import { computeAutoExtraReserve, type AutoExtraReserve, type RankedTarget } from '@/lib/ranked-surplus-allocation';
import { goalRemainingNeed, carFundRemainingNeed } from '@/lib/ranked-extra-payment-targets';
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
  /** This month's RANKED AUTOMATIC EXTRA payment per target, keyed by goal id / car fund id and
   * carrying only the targets that actually took money this month. Emitted so a surface that
   * projects one target on its own (the Goals page's Savings Growth chart) can add the same
   * dollars the engine already diverted, instead of modelling a second, disagreeing version of
   * the allocation. Purely an OUTPUT of the allocation in step 4c-ii — nothing reads it back. */
  autoExtraByTarget: Record<string, number>;
  nonCCLiabBreakdown: { id: string; name: string; account_type: string; balance: number }[];
  carLoanBreakdown: { name: string; balance: number }[];
  /** This month's revolving-debt-cash TARGET for the next convergence pass: the sim's own
   * revolving share of debtPayment (from the payment ledger, unify-cycling-model Stage 3) plus
   * any cash surplus above the floor not yet routed. Fed back by runDebtCashConvergence via
   * resimulateWithDebtCash → debtCashTargetByMonth; the sim absorbs it into its own state on the
   * next pass rather than the engine tracking a parallel cumulative register. */
  revolvingDebtCash: number;
  /** Unrounded end-of-month cash (finalLiquid + carReserveHeld) and floor. The display fields
   * (endingCash / monthMinSafe) are rounded to whole dollars, which hides sub-dollar floor
   * misses — diagnostics and floor-breach checks that care about cents must use these. */
  rawEndingCash: number;
  rawMonthMinSafe: number;
  /** Unrounded balance-style projections for the Month Breakdown popup (N8, Tre 2026-08-09:
   * "all numbers in the forecast pop ups should show decimal places"). The rounded fields
   * above stay whole-dollar for the chart/table; the popup and CSV export render these. */
  rawNetWorth: number;
  rawTotalAssets: number;
  rawTotalLiabilities: number;
  rawCcDisplayBalance: number;
  rawTotalCCPurchases: number;
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
  /** Raw payment-plan rows. The engine never reads these (it consumes planExpensesByMonth);
   * they ride along so fixture captures of these inputs carry the rows the SIM side
   * (useCardProjection) needs — without them a replayed sim walks $X/month richer than the
   * engine and ISB-pinned months can't correct the drift (the Q12 Aug-2026 phantom breach). */
  paymentPlans?: PaymentPlan[];
  /** §1A Stage C: settled synced transactions overlapping month 0, for the capture gates below.
   * Optional so the captured fixture (`forecast-inputs.real.json`) replays identically and so an
   * omitting caller gets exactly the pre-Stage-C date heuristic. */
  syncedTransactions?: readonly MatchableTransaction[];
}

export interface ForecastResult {
  data: ForecastMonthRow[];
  milestones: { month: string; event: string }[];
  /** PASS 2's per-month save-up cap (see computeFloorProtection call below) — the authoritative
   * source-of-truth cap. Threaded back into the sim's Step 2 cycling-pool cap via
   * runDebtCashConvergence → resimulateWithDebtCash so cycling-only save-up months agree with
   * Forecast instead of the sim recomputing its own, narrower version. */
  maxDebtPaymentByMonth: number[];
}

export function calculateForecast(inputs: ForecastInputs): ForecastResult {
  const {
    debts, goals, carFunds, accounts, budgetItems, profile, assumptions, rules,
    monthlyAggregates, debtPaymentsByMonth, debtBalancesByMonth, cardProjectionData,
    payConfig, oneTimeByMonth, ccOneTimeByMonth, ccScheduledByMonth, transactions,
    currentMonthRecommendedDebt, forecastMonthEvents, forecastFundingAccountId, cashFloor,
    pauseSavings, syncCutoffDate, planExpensesByMonth, annualFederalWithheldFromBudget,
    syncedTransactions,
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
    // Finding §2.9: same clamp as before, but expressed through the ONE helper that owns it, so the
    // forecast and the debt hook cannot drift on how an over-claimed earmark is absorbed.
    liquidBal = Math.max(0, liquidBal)
      - resolveCarFundEarmark(carFunds, forecastFundingAccountId, liquidBal).applied;
    // Re-derived from the card projection + loan schedules on every month of the loop below
    // (see step 3), so it needs no account-derived seed — nothing reads it before that.
    let totalLiabilityBal: number;

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
    // Per-paycheck contribution amount — multiplied by actual paycheck count per month inside the
    // loop. N10 fix: pct-mode deductions are a share of GROSS, and gross scales with raises and
    // promotions (incomeMultiplier), so these are functions of the month's multiplier rather than
    // values frozen at month-0 gross. Flat-mode deductions stay flat — that is what flat means.
    const perCheck401kAt = (mult: number): number => {
      const linked = payDeds
        .filter(d => d.accountId && retireAccountIds.has(d.accountId) && d.value > 0)
        .reduce((s, d) => s + (d.mode === 'pct' ? paycheckGrossForForecast * mult * (d.value / 100) : d.value), 0);
      if (linked > 0) return linked;
      const d401kVal = Number(prof?.deduction_401k_value) || 0;
      const d401kMode = prof?.deduction_401k_mode || 'pct';
      return d401kMode === 'pct' ? paycheckGrossForForecast * mult * (d401kVal / 100) : d401kVal;
    };

    // Per-paycheck retirement attribution per account — same multiplier rule; recomputed per month
    // in step 4a because a mixed flat+pct set changes its SPLIT (not just its total) after a raise.
    const perCheckRetireByAcctAt = (mult: number): Map<string, number> => {
      const m = new Map<string, number>();
      const linked = payDeds.filter(d => d.accountId && retireAcctIdSet.has(d.accountId!) && d.value > 0);
      if (linked.length > 0) {
        for (const d of linked) {
          m.set(d.accountId!, (m.get(d.accountId!) ?? 0) + (d.mode === 'pct' ? paycheckGrossForForecast * mult * (d.value / 100) : d.value));
        }
      } else {
        const fallback = retireAccounts.find((a) => a.account_type === '401k') ?? retireAccounts[0];
        if (fallback) m.set(fallback.id as string, perCheck401kAt(mult));
      }
      return m;
    };

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
    // RANKED AUTOMATIC EXTRA PAYMENTS — car-fund pools, the exact analogue of goalPools above, for
    // car funds whose down-payment savings are not already tracked as a real account. They seed at
    // ZERO on purpose: a car fund's own `current_saved` is modelled by vehicleProjections (down
    // payment, purchase month), so seeding the typed figure here would count the same dollars
    // twice. All these pools ever hold is the auto-extra INCREMENT — cash that left checking this
    // month and has to land somewhere, or the user's money would simply evaporate.
    const carFundPools = new Map<string, { name: string; balance: number }>(
      carFunds
        .filter((c) => {
          if (!c.linked_account) return true;
          if (savingsAcctIdSet.has(c.linked_account) || retireAcctIdSet.has(c.linked_account) || investAcctIdSet.has(c.linked_account)) return false;
          return true;
        })
        .map((c) => [c.id, { name: c.vehicle_name, balance: 0 }])
    );
    // Where an auto-extra target's money should land: its linked account when that account is one
    // the projection tracks, otherwise its own pool above. Built once, keyed by goal / car-fund id
    // exactly as `computeAutoExtraReserve`'s `perTarget` rows are.
    const autoExtraLinkedAcct = new Map<string, string | null>([
      ...goals.map((g) => [g.id as string, (g.linked_account as string | null) ?? null] as const),
      ...carFunds.map((c) => [c.id, c.linked_account ?? null] as const),
    ]);
    // RANKED AUTOMATIC EXTRA PAYMENTS — MULTI-MONTH. Month 0's reserve is decided by
    // `useCardProjection` (the converged chain every user-facing debt surface reads) and arrives
    // on `cardProjectionData.month0`. Every LATER month is decided here, in the loop below,
    // because only this pass knows that month's cash — and until it did, an opted-in user's
    // projected payoff date read OPTIMISTIC: the sim kept spending on cards the very dollars the
    // user had said go to a goal.
    //
    // `autoExtraCapacity` is the remaining need per target, carried across the whole horizon. It
    // is seeded from the same two helpers `buildRankedTargets` uses, then decremented each month
    // by BOTH (a) whatever the target reserved and (b) the target's own monthly contribution,
    // which fills the same need — so a goal that is projected full stops drawing extras instead
    // of reserving against a need that no longer exists. A target that never opted in is absent
    // from this map entirely and can therefore never appear in any month's reserve.
    //
    // ⚠️ Every entry here requires an explicit opt-in (`auto_extra`), which defaults FALSE, so for
    // every existing user this map is EMPTY and the loop below takes a fast path that leaves the
    // whole cascade byte-identical.
    const autoExtraCapacity = new Map<string, { kind: 'goal' | 'car_fund'; sortOrder: number; remaining: number; share?: number }>();
    /** A stored split weight, or undefined. Zero and negative are not weights. */
    const shareOf = (raw: unknown): number | undefined => {
      const n = Number(raw);
      return raw == null || !Number.isFinite(n) || n <= 0 ? undefined : n;
    };
    for (const g of goals) {
      if (g.auto_extra !== true || typeof g.id !== 'string') continue;
      const need = goalRemainingNeed(g);
      if (need > 0) autoExtraCapacity.set(g.id, { kind: 'goal', sortOrder: Number(g.sort_order) || 0, remaining: need, share: shareOf((g as { surplus_share?: number | null }).surplus_share) });
    }
    for (const c of carFunds) {
      // Mirrors `buildRankedTargets`: a car fund's `auto_extra` is a real column on a full row, so
      // only an explicit `false` opts it out. `carFundRemainingNeed` returns 0 for a loan-phase
      // fund, which drops it here.
      if (c.auto_extra === false) continue;
      const linkedAcct = c.linked_account ? accountMap.get(c.linked_account) : null;
      const need = carFundRemainingNeed(c, forecastFundingAccountId, linkedAcct ? Number(linkedAcct.balance) : null);
      if (need > 0) autoExtraCapacity.set(c.id, { kind: 'car_fund', sortOrder: c.sort_order, remaining: need, share: shareOf(c.surplus_share) });
    }
    /** Fill part of a target's remaining need. An exhausted target is deleted, which is also what
     *  lets the loop's fast path fire again once every target is full. */
    const decayAutoExtraCapacity = (id: string, amount: number) => {
      const cap = autoExtraCapacity.get(id);
      if (!cap || !(amount > 0)) return;
      cap.remaining = Math.max(0, cap.remaining - amount);
      if (cap.remaining <= 0) autoExtraCapacity.delete(id);
    };

    // Aggregate scalars derived from per-account Maps (fixes retire-linked goal double-counting)
    let retireBal = Array.from(perAcctRetire.values()).reduce((s, a) => s + a.balance, 0);
    let investBal = Array.from(perAcctInvest.values()).reduce((s, a) => s + a.balance, 0);
    // Unlike retireBal/investBal (read for growth before step 4f), savingsBal is only ever read
    // after 4f re-derives it from perAcctSavings + goalPools, so no seed value is needed.
    let savingsBal: number;

    const nowDate = new Date();

    // Handoff item 4b: a goal-linked transfer/investment rule (or an unlinked goal's own
    // monthly_contribution) stops being counted once its goal has already hit target_amount.
    // Built here, ahead of the PASS-1 loop below that consumes it, and kept separate from the
    // later `resolvedGoals`/`goalCompletionIdx` block (PASS 3) — that block computes a
    // different thing (display-resolution for the "goal complete" milestone), even though both
    // call estimateGoalCompletionMonths.
    const goalTransferCutoffs = buildGoalTransferCutoffs(goals, rules, accounts, nowDate);
    const goalOwnCutoffs = buildGoalOwnCompletionCutoffs(goals, rules, accounts, nowDate);

    const monthlyCarContrib = pauseSavings ? 0 : carFunds.reduce((s, c) => {
      if (c.phase === 'loan') return s;
      const rem = Number(c.down_payment_goal) - Number(c.current_saved);
      return s + (rem > 0 ? Math.min(rem / 12, 500) : 0);
    }, 0);
    // Active loan payments per month — stops when each loan pays off within the projection window
    const activeCarLoanByMonth = Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
      const md = new Date(nowDate.getFullYear(), nowDate.getMonth() + i, 15);
      const mk = `${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, '0')}`;
      // Finding §1.1 cause C — the $537. `useCardProjection.ts` has always dropped a month-0 car
      // loan the stored balance already reflects; this had no such gate, so Forecast charged the
      // RAV4's payment and the Dashboard did not, for the same loan in the same month. Month 0
      // only: later months are entirely in the future, nothing about them is in any balance.
      const eligible = i === 0 && syncCutoffDate
        ? carFunds.filter((cf) => {
            if (cf.phase !== 'loan' || !cf.payment_start_date) return true;
            const payDay = new Date(cf.payment_start_date + 'T00:00:00').getDate();
            const dueDate = dueDateInMonth(mk, payDay);
            // §1A Stage C part 2: a settled transaction, where one covers this due date, outranks
            // the settlement-lag guess. `getTotalCarLoanMonthly([cf], md)` is the very amount this
            // gate is deciding whether to charge, so the matcher looks for exactly what the engine
            // would otherwise add — including a final-month true-up, which is smaller than the
            // scheduled payment and would miss if the nominal amount were used instead.
            const evidence = carChargeEvidence(
              cf, getTotalCarLoanMonthly([cf], md), dueDate, forecastFundingAccountId, syncedTransactions,
            );
            return !isCapturedInBalance(dueDate, syncCutoffDate, evidence);
          })
        : carFunds;
      const regular = getTotalCarLoanMonthly(eligible, md);
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
          // Month 0: skip if the insurance due date is already reflected in the stored balance.
          // Was `<=` here while `useCardProjection.ts` used `<`, so a charge due exactly on the
          // cutoff day was dropped by Forecast and kept by the Dashboard. One shared predicate now.
          if (i === 0 && syncCutoffDate) {
            const insuranceDueDay = new Date(insuranceAnchor + 'T00:00:00').getDate();
            const dueDate = dueDateInMonth(mk, insuranceDueDay);
            // §1A Stage C part 2 — same evidence rule as the loan payment above, with the premium
            // as the amount. Insurance is usually debited from the same account as the payment.
            const evidence = carChargeEvidence(
              cf, Number(cf.monthly_insurance || 0), dueDate, forecastFundingAccountId, syncedTransactions,
            );
            if (isCapturedInBalance(dueDate, syncCutoffDate, evidence)) return false;
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
        // §2.10: the two rules (percent-of-account, and separate-account-derives-live) now live in
        // getCarFundSaved. A missing account stays null so it falls through to current_saved rather
        // than being read as a $0 balance.
        const linkedAcct = c.linked_account ? accountMap.get(c.linked_account) : null;
        const effectiveSaved = getCarFundSaved(
          c, forecastFundingAccountId, linkedAcct ? Number(linkedAcct.balance) : null,
        );
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
        return { contrib, purchaseMonthIdx, paymentStartMonthIdx, insuranceStartMonthIdx, projPayment, downPayment: Math.max(0, Number(c.down_payment_goal) - Number(c.gift_contribution || 0)), effectiveDP, insurance: Number(c.monthly_insurance), termMonths: effectiveTermMonths, lumpSumPayments: (c.lump_sum_payments ?? []) as { id: string; date: string; amount: number }[], vehicleName: c.vehicle_name as string, linkedAccountId: (c.linked_account as string | null) ?? null, fundId: c.id };
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
    // Non-CC liability accounts with matched debt payments for per-account popup display.
    //
    // ⚠️ Accounts a vehicle loan is explicitly linked to are DROPPED here: the car fund's own
    // amortizing row already carries that balance (and now carries the account's live figure —
    // see `vehicle-loan-link.ts`), so keeping both rendered the same debt twice in the month
    // drawer — once amortizing, once as a flat line for all 60 months, because a Plaid auto_loan
    // account has `min_payment` null and there is no `debts` row to match it to.
    //
    // This drops the OPPOSITE row from `net-worth.ts`, which drops the car fund and keeps the
    // account. That is deliberate, not an inconsistency to reconcile: the two agree on the
    // number, and they differ on which row carries it because only the car fund has a rate, a
    // term and a payment. Net worth reports one instant, so the row the user maintains wins;
    // forecast projects forward, so the row that can move has to survive.
    const linkedVehicleAccountIds = linkedLoanAccountIds(
      carFunds as unknown as { linked_loan_account_id: string | null }[],
      active as unknown as { id: string; balance: number | null; active?: boolean | null }[],
    );
    //
    // The exclusion is applied INSIDE buildNonCCLiabilities (below) rather than here, because a
    // linked account also has to silence any `debts` row wearing its name — dropping the account
    // early would leave that row behind to be itemised as a second copy of the same loan.
    const nonCCLiabAccts = active
      .filter((a) => liabilityTypes.includes(a.account_type) && a.account_type !== 'credit_card')
      .map((a) => ({
        id: a.id as string,
        name: a.name as string,
        account_type: a.account_type as string,
        balance: Number(a.balance),
      }));

    // Per-month remaining car loan balance for liabilities (active loans + projected future loans)
    const carLoanBalanceByMonth = new Array(PROJECTION_MONTHS).fill(0);
    const carLoanPerFund: { name: string; balances: number[] }[] = [];
    /**
     * The same arrays as `carLoanPerFund`, keyed by car-fund id — SHARED REFERENCES, not copies.
     *
     * Extra principal is decided inside the month loop, hundreds of lines below where these are
     * amortized, so the loop reduces them in place from the paying month forward. Sharing the
     * reference is what makes the popup breakdown, the liability total and the target's remaining
     * capacity all fall by the same dollars — three surfaces that would otherwise disagree, which
     * is the §2.5 class of bug this codebase has already paid to fix once.
     */
    const loanBalancesByFundId = new Map<string, number[]>();
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
            currentBalance: cf.current_balance_override ?? null,
          }, nowDate);
          for (let i = 0; i < PROJECTION_MONTHS; i++) {
            // Forecast month i owes the balance the month OPENS at, which is the start balance of
            // its own row — previously read as the end balance of the row before it. The two are
            // equal by construction for an unamortized-elsewhere loan, but not for a linked one:
            // the live-balance splice lands on the first not-yet-paid row's startBalance, and the
            // paid row before it deliberately keeps its historical end balance. Reading the row
            // before therefore showed the drifted estimate in month 0 and the bank's figure in
            // every month after. Indexing forward also folds in the old `schedIdx < 0` case
            // (`schedule[0].startBalance` IS the loan amount) and the past-the-end case (no row,
            // nothing owed).
            const bal = proj.schedule[proj.monthsElapsed + i]?.startBalance ?? 0;
            fundBalances[i] = Math.max(0, bal);
            carLoanBalanceByMonth[i] += fundBalances[i];
          }
        } catch {}
        if (fundBalances.some(b => b > 0)) carLoanPerFund.push({ name: fundName, balances: fundBalances });
        loanBalancesByFundId.set(cf.id, fundBalances);
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
          // Funding id passed as null deliberately: unlike the cash-pool math above, this fallback
          // purchase-date estimator has always derived from ANY linked account, funding one
          // included. Routing it through the helper adds percent mode without changing that.
          const effectiveSavedLoan = getCarFundSaved(
            cf, null, linkedAcctLoan ? Number(linkedAcctLoan.balance) : null,
          );
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

    /**
     * EXTRA PRINCIPAL ON A LIVE VEHICLE LOAN — the fourth target kind, and the only one whose
     * capacity is NOT carried in `autoExtraCapacity`.
     *
     * A goal's remaining need only falls when something pays it, so a running total is the right
     * model. A loan's falls every month whether or not anything extra is paid, because the
     * scheduled payment is amortizing it — so the honest capacity is simply "what the schedule says
     * is still owed in this month", read fresh from `loanBalancesByFundId` each time round the
     * loop. Since the loop also SUBTRACTS each extra from those same arrays, that one figure
     * already nets off both, and there is no second register to drift.
     */
    const autoExtraLoanFunds = carFunds
      .filter(c => c.phase === 'loan' && c.auto_extra === true && loanBalancesByFundId.has(c.id))
      .map(c => ({ id: c.id, sortOrder: Number(c.sort_order) || 0, share: shareOf(c.surplus_share) }));
    // ⚠️ DECLARED HERE, NOT BESIDE `autoExtraCapacity` WHERE IT BELONGS BY SUBJECT. It reads
    // `loanBalancesByFundId`, which the amortization loop directly above is what fills — putting it
    // with its siblings ~280 lines earlier is a temporal dead zone, and it threw
    // "Cannot access 'loanBalancesByFundId' before initialization" on the first live load. No test
    // caught it because none ran `calculateForecast` with a loan-phase fund opted in; one does now.

    // ⚠️ DECLARED HERE, NOT BESIDE `autoExtraCapacity` WHERE IT BELONGS BY SUBJECT. It reads
    // `loanBalancesByFundId`, which the amortization loop directly above is what fills — declaring
    // it with its siblings ~280 lines earlier is a temporal dead zone, and it threw
    // "Cannot access 'loanBalancesByFundId' before initialization" on the first live load. No test
    // caught it, because none ran `calculateForecast` with a loan-phase fund opted in. One does now.

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
      /** The month's compounded raise/promotion multiplier — step 4a re-derives the per-account
       * deduction split from it, since a mixed flat+pct set splits differently after a raise. */
      incomeMultiplier: number;
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

    // Non-CC liabilities: ONE projection feeding BOTH the total below and the month drawer's
    // itemised rows (`nonCCLiabBreakdown`). Before 2026-08-18 the total was summed from the
    // `debts` table while the rows were built from `accounts`, so the drawer could itemise a
    // liability its own total did not count, and vice versa — see `non-cc-liabilities.ts` for the
    // three divergence cases. Amortization (balance × monthly rate − payment) is unchanged; it
    // simply happens once now, where both readers can see it.
    const nonCCLiabilities = buildNonCCLiabilities({
      accounts: nonCCLiabAccts,
      debts: debts as unknown as LiabilityDebtInput[],
      creditCardAccountNames: accounts
        .filter(a => a.account_type === 'credit_card')
        .map(a => a.name as string),
      excludedAccountIds: linkedVehicleAccountIds,
      months: PROJECTION_MONTHS,
    });
    const nonCCDebtBalanceByMonth = nonCCLiabilities.totalByMonth;

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

      // Bonus (flat or % of annual GROSS) and tax-return injection — the shared income model
      // (computeBonusAndTax) is the single source of truth so the credit-card sim
      // (useCardProjection.ts) computes byte-identical values. `taxReturnIncome` is a signed
      // annual injection: positive = refund income, negative = amount owed.
      const annualGrossHere = payConfig.weeklyGross * 52 * incomeMultiplier;
      const { bonusIncome, taxReturnIncome } = computeBonusAndTax({
        annualGrossHere,
        monthDate: d,
        assumptions,
        isFirstBonusOccurrence: i === nextBonusMonthIndex,
        annualFederalWithheldFromBudget,
      });

      const isRaiseMonth = assumptions.incomeGrowthEnabled && assumptions.incomeGrowth > 0 && i > 0 && d.getMonth() + 1 === assumptions.raiseMonth;
      let paycheckIncome: number;
      let otherIncome: number;
      let netIncome: number;
      if (i === 0) {
        // Month 0: scheduledIncome only includes events strictly after syncCutoffDate.
        // Paychecks/income already deposited are in liquidBal — don't add them again.
        const nonPayRemaining = forecastMonthEvents[0]?.nonPaycheckIncome ?? 0;
        paycheckIncome = Math.max(0, scheduledIncome - nonPayRemaining);
        otherIncome = nonPayRemaining;
        netIncome = scheduledIncome + bonusIncome + taxReturnIncome;
      } else {
        paycheckIncome = fallbackTakeHome;
        otherIncome = forecastMonthEvents[i]?.nonPaycheckIncome ?? 0;
        netIncome = fallbackTakeHome + otherIncome + bonusIncome + taxReturnIncome;
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
        const goalCutoff = tr.id ? goalTransferCutoffs.get(tr.id) : undefined;
        if (goalCutoff != null && i >= goalCutoff) continue;
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
      const perCheck401kNow = perCheck401kAt(incomeMultiplier);
      const month401kContrib = payConfig ? perCheck401kNow * paychecksThisMonth : 0;
      // Full month paychecks — used for display only (popup shows full month total, not remaining)
      const allPaychecksThisMonth = getPaychecksInMonth(adjustedConfig, d.getFullYear(), d.getMonth()).length;
      const fullMonth401kContrib = payConfig ? perCheck401kNow * allPaychecksThisMonth : 0;
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
        const ownCutoff = g.id ? goalOwnCutoffs.get(g.id) : undefined;
        if (ownCutoff != null && i >= ownCutoff) return s;
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
        paycheckRetireContrib: month401kContrib, fullMonth401kContrib, incomeMultiplier, transferBreakdown, nonCashTransferItems,
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
    // A manual interest-saving-balance pin makes its month's CC outflow mandatory at the pinned
    // amount (the sim pays it unconditionally — credit-card-engine's manualStatementByCard),
    // superseding that card's contract minimum. Without this, the look-ahead's netAtMin models
    // only ccMinTotal leaving the pinned month, overstates preservable cash, and the resulting
    // caps disagree with the sim's actual spend — the convergence loop then chases that error
    // through later months (the m6–m9 target oscillation, Q4).
    // Q11: cards whose current-month due date already cleared through Plaid (m0MinSettled,
    // stamped by useCardProjection) owe no minimum in month 0 — the next one lands in month 1.
    // Without this the look-ahead models a month-0 outflow (e.g. Discover's $227) that already
    // left the live balance, double-counting the cash.
    const m0SettledCcMin = (cardProjectionData?.simCards ?? [])
      .reduce((s, c) => s + (c.m0MinSettled ? Number(c.minPayment || 0) : 0), 0);
    const ccMinByMonth = ((cardProjectionData?.manualIsbPins ?? []).length > 0 || m0SettledCcMin > 0)
      ? Array.from({ length: PROJECTION_MONTHS }, (_, m) =>
          ccMinTotal
          - (m === 0 ? m0SettledCcMin : 0)
          + ((cardProjectionData?.manualIsbPins ?? [])
            .filter(p => p.month === m)
            .reduce((s, p) => s + Math.max(0, p.amount - p.minPayment), 0)))
      : undefined;
    // Upper bound on the reducible (revolving + backlog) debt payment per month: the debt
    // outstanding entering month m, from the sim's own trajectory. Keeps the look-ahead's cash
    // walk from assuming surplus keeps flowing to debt after all revolving debt has cleared —
    // which pinned its modeled balance to the floor for the whole horizon and made a later
    // cycling statement (e.g. the Apr 2028 $2.7k) look like a breach the user's actual five-digit
    // cash pile would never feel, capping (and underpaying) the preceding months' statements.
    // Month 0 stays uncapped: it is live-anchored elsewhere and its payment is already bounded
    // by the live balances. Slight overestimate is safe (falls back toward legacy behavior);
    // the sim can never pay more than what's owed, so this bound is exact where it matters.
    const reducibleDebtCapByMonth = cardProjectionData
      ? Array.from({ length: PROJECTION_MONTHS }, (_, m) => {
          if (m === 0) return Infinity;
          let owed = 0;
          for (const arr of cardProjectionData.monthlyRevolvingBalances.values()) owed += Math.max(0, arr[m - 1] ?? 0);
          for (const arr of cardProjectionData.monthlyCyclingBacklog.values()) owed += Math.max(0, arr[m - 1] ?? 0);
          return owed;
        })
      : undefined;
    const { maxDebtPaymentByMonth, strictSaveUpMonths } = computeFloorProtection({
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
      ccMinByMonth,
      cyclingExcessByMonth: cyclingByMonth,
      reducibleDebtCapByMonth,
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
        // Carried out of this closure so the completion milestone below can price the goal the
        // same way the Goals page does — both need the START DATE as resolved from linked rules
        // (not the raw column) and the linked account's APY.
        resolvedContributionStartDate: contributionStartDate,
        effectiveApyPercent: getGoalEffectiveApyPercent(linkedAcct),
      };
    });

    // Month index at which each goal first reaches its target, via the SAME accrual the Goals
    // page's "Est. completion" uses (estimateGoalCompletionMonths: monthly compounding, planned
    // lump sums, contribution start date). This milestone used to re-derive the date as a straight
    // line — current_amount + monthly_contribution × elapsed — which ignored both interest and
    // lump sums, so Forecast said "Emergency Fund Complete!" in Mar 2029 while Goals said Dec 2028
    // for the same goal earning Marcus's 4.5% (site walk §2.5). Milestones are display-only; this
    // moves no cash.
    const goalCompletionIdx = new Map<string, number>();
    resolvedGoals.forEach((g, gi) => {
      const months = estimateGoalCompletionMonths(
        {
          id: (g.id as string) ?? String(gi),
          name: g.name ?? '',
          currentAmount: Number(g.current_amount),
          monthlyContribution: Number(g.monthly_contribution),
          annualApyPercent: g.effectiveApyPercent,
          contributionStartDate: g.resolvedContributionStartDate,
          lumpSums: Array.isArray(g.lump_sum_payments)
            ? (g.lump_sum_payments as unknown as { date: string; amount: number }[])
                .map((ls) => ({ date: ls.date, amount: Number(ls.amount) }))
            : [],
        },
        Number(g.target_amount),
        { today: nowDate },
      );
      if (months != null) goalCompletionIdx.set((g.id as string) ?? String(gi), months);
    });

    // ═══ PASS 3: Build final projection data ═══
    let finalLiquid = liquidBal;
    const data: ForecastMonthRow[] = [];
    const milestones: { month: string; event: string }[] = [];

    // liveRevolvingBal seeds prevRevBalEnd below so the CC-Debt-Free transition check doesn't
    // fire falsely at month 0 when debt is already at $0 before the projection starts.
    const liveRevolvingBal = (cardProjectionData?.simCards ?? []).reduce((s, c) => {
      const revBal0 = cardProjectionData?.monthlyRevolvingBalances?.get(c.id)?.[0] ?? 1;
      if (revBal0 === 0) return s; // cycling card — paid in full each month, not revolving
      const acct = active.find((a) => a.id === c.id);
      return s + (acct ? Number(acct.balance || 0) : 0);
    }, 0);
    // ccEngRevBalEnd (computed per month below) is now the SIM's own authoritative post-payment
    // revolving balance — the sim already absorbs any step-3 surplus via the debtCashTargetByMonth
    // feedback loop (runDebtCashConvergence), so PASS 3 no longer tracks a parallel
    // virtualRevBal/cumulativeStep3Extra register that could drift from the sim's own state.
    let prevRevBalEnd = liveRevolvingBal;
    // ccDebtFreeFired: true from the month ccEngRevBalEnd (the SIM's own post-payment revolving
    // balance, already inclusive of any converged step-3 surplus) first reaches $0. Used only as
    // the CC-Debt-Free milestone's fallback trigger below when simRevolvingPayoffMonth is unavailable.
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
    // per-card lines always sum to the total shown next to them. Display-only: independent of the
    // sim's own payment ledger that drives the step-3 cash routing above.
    const hookCumSurplusByCard = cumulativeSurplusesByCard(cardProjectionData?.perCardPaymentsScaled);

    for (let i = 0; i < PROJECTION_MONTHS; i++) {
      const b = baseData[i];
      let monthDebtPayment = debtPayments[i];
      // Exact cents — it is the drawer's opening term and must reconcile against the prior
      // month's Ending Cash to the cent. See the "EXACT CENTS" note on the popup fields below.
      const startingCash = finalLiquid;
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
      // totalLiabilityBal is not set from this raw value — step 4 below recomputes it from
      // adjCCLiab (the revolving-surplus-adjusted figure) before anything reads it.
      const ccLiabilityBalThisMonth = cardProjectionData?.data[i]?.displayCCBalance ?? b.ccDebtBalance;

      const investGrowthAmt = Math.round(investBal * monthlyInvestGrowth * 100) / 100;
      const retireGrowthAmt = Math.round(retireBal * monthlyRetireGrowth * 100) / 100;

      // Step 1: savings + transfers + fixed car loan payments apply first as regular outflows
      const savingsOut = b.monthlySavingsContrib + carContribThisMonth;
      const transfersOut = b.monthTransfers;
      const lumpTransferThisMonth = lumpTransferByMonth[i].total;
      // Hoisted above the cash line below: the auto-extra reserve needs this month's cycling
      // spend and next-month-aware floor before `cashPreDebt` exists. Both are read again,
      // unchanged, by steps 2 and 3 further down — one definition each.
      const m0AllSettled = i === 0 && (cardProjectionData?.month0?.safeToPayTotal ?? 1) === 0;
      const ledgerEntry = cardProjectionData?.paymentLedger?.[i];
      // End-of-month cash IS next month's pre-paycheck cash, so neither the step-3 surplus branch
      // nor a reserve may spend below NEXT month's monthMinSafe either (Q9).
      const step3SpendFloor = Math.max(b.monthMinSafe, baseData[i + 1]?.monthMinSafe ?? b.monthMinSafe);
      // RANKED AUTOMATIC EXTRA PAYMENTS — surplus opted-in goals and car funds took ahead of the
      // credit cards this month. `useCardProjection`'s month 0 is the ONE place the reserve is
      // decided (every user-facing debt surface reads it), and its own `chain.cashPreDebt` already
      // subtracts it — so this mirrors that subtraction to the cent and step 4c-ii below credits
      // the same dollars to the matching balances. Month 0 only: the multi-month sim does not model
      // the diversion yet, so an opted-in user's payoff date still reads optimistic.
      //
      // ⚠️ The forecast's OTHER reserve — `generateRecommendations`' (fed by useForecastEngineInputs
      // for the month-0 recommendation pin) — deliberately credits nothing. Two reserves crediting
      // savings would double-count the same dollars; this one wins because it is the one the cash
      // chain and every debt surface already use.
      //
      // MULTI-MONTH: month 0 replays the hook's converged reserve to the cent; months 1+ decide
      // their own from THIS month's cash, against the running `autoExtraCapacity` above. The
      // subtraction is what makes the projection honest — `finalLiquid` falls by the reserve, so
      // step 3's surplus branch feeds a correspondingly smaller revolving target back through
      // convergence and the sim stops paying down cards with money the user diverted.
      const cashPreDebtBeforeAutoExtra = finalLiquid + b.netIncome - b.baseExpenses - savingsOut - carLoanThisMonth - effectiveDPThisMonth - vehicleInsuranceThisMonth - projLoanThisMonth - mortgageMonthlyPayment - transfersOut - lumpTransferThisMonth + b.oneTimeNet;
      // A target's own monthly contribution fills the same need the reserve would, and it is
      // subtracted BEFORE this month's reserve is decided: decide the reserve against a need the
      // contribution has already met and the target ends the month over-funded by exactly one
      // contribution. Step 4c below is where these same dollars are actually credited.
      for (const item of b.savingsGoalItems) decayAutoExtraCapacity(item.goalId, item.amount);
      for (const v of vehicleProjections) {
        if (i <= v.purchaseMonthIdx) decayAutoExtraCapacity(v.fundId, v.contrib);
      }
      let autoExtraThisMonth: AutoExtraReserve['perTarget'] = [];
      let autoExtraOutThisMonth = 0;
      if (i === 0) {
        autoExtraThisMonth = cardProjectionData?.month0?.autoExtraPerTarget ?? [];
        autoExtraOutThisMonth = cardProjectionData?.month0?.chain?.autoExtraReserve ?? 0;
      } else if (autoExtraCapacity.size > 0 || autoExtraLoanFunds.length > 0) {
        // The same three arguments month 0 builds, one month later: the card block's combined
        // minimum and balance, and a pool that is already net of the floor and the cycling spend.
        // `computeAutoExtraReserve` settles that combined minimum BEFORE it consults any rank, so
        // no reserve here can push a month below its cards' minimums.
        const simCards = cardProjectionData?.simCards ?? [];
        const revBalAt = (id: string) => Math.max(0, cardProjectionData?.monthlyRevolvingBalances?.get(id)?.[i] ?? 0);
        const revBalTotal = simCards.reduce((sum, c) => sum + revBalAt(c.id), 0);
        const ccMinForMonth = revBalTotal > 0
          ? simCards.reduce((sum, c) => revBalAt(c.id) <= 0 ? sum
              : sum + (cardProjectionData?.perCardMinPayments?.get(c.id)?.[i] ?? c.minPayment), 0)
          : 0;
        // Floor: the same next-month-aware floor step 3 drains to (Q9), so a reserve can never
        // leave the FOLLOWING month starting below its own pre-paycheck floor.
        const autoExtraPool = Math.max(0, cashPreDebtBeforeAutoExtra - step3SpendFloor - (ledgerEntry?.cycling ?? 0));
        const targets: RankedTarget[] = Array.from(autoExtraCapacity, ([id, t]) => ({
          id, kind: t.kind, sortOrder: t.sortOrder, minimum: 0, capacity: t.remaining, autoExtra: true,
          ...(t.share === undefined ? {} : { share: t.share }),
        }));
        // Extra principal, capacity read fresh from the (already-reduced) amortized balance.
        for (const f of autoExtraLoanFunds) {
          const owed = Math.max(0, loanBalancesByFundId.get(f.id)?.[i] ?? 0);
          if (owed <= 0) continue;
          targets.push({
            id: f.id, kind: 'loan', sortOrder: f.sortOrder, minimum: 0, capacity: owed, autoExtra: true,
            ...(f.share === undefined ? {} : { share: f.share }),
          });
        }
        // ⚠️ CARDS THE USER PULLED OUT OF THE BLOCK MUST BE PULLED OUT HERE TOO. Month 0 builds
        // them (useCardProjection → buildRankedTargets); if this month did not, every future month
        // would seat the whole card set at `cards_sort_order` — which, once a user has moved the
        // block to the bottom of their list, is the exact opposite of what month 0 decided. The
        // forecast would then reserve for goals that month 0 says the cards outrank, and the two
        // surfaces would print different payoff dates for the same plan.
        for (const c of simCards) {
          const acct = accountMap.get(c.id);
          const own = acct?.surplus_sort_order;
          if (own == null || !Number.isFinite(Number(own))) continue;
          const owed = revBalAt(c.id);
          if (owed <= 0) continue;
          targets.push({
            id: c.id, kind: 'card', sortOrder: Number(own), rankedIndividually: true,
            minimum: cardProjectionData?.perCardMinPayments?.get(c.id)?.[i] ?? c.minPayment,
            capacity: owed,
            ...(shareOf(acct?.surplus_share) === undefined ? {} : { share: shareOf(acct?.surplus_share)! }),
          });
        }
        // ⚠️ The card block's rank comes from `profiles.cards_sort_order`, exactly as month 0
        // reads it. The column defaults to 0 — cards first, the pre-feature behaviour.
        const reserve = computeAutoExtraReserve(
          autoExtraPool, ccMinForMonth, revBalTotal, targets, profile?.cards_sort_order ?? 0,
        );
        autoExtraThisMonth = reserve.perTarget;
        autoExtraOutThisMonth = reserve.reserved;
      }
      const cashPreDebt = cashPreDebtBeforeAutoExtra - autoExtraOutThisMonth;

      // Step 2: the sim is the single writer of debt-payment truth (unify-cycling-model Stage 3).
      // Its payment ledger already reflects a floor-aware, save-up-aware plan for whatever cash
      // target was fed in via debtCashTargetByMonth (see resimulateWithDebtCash /
      // runDebtCashConvergence, and credit-card-engine's maxDebtPaymentByMonth save-up cap, which
      // now also caps the cycling pool once revolving debt is clear). PASS 3 trusts it directly
      // instead of re-deriving its own cycling/revolving split.
      // Single-clamp rule: the sim clamps, the engine trusts — no second clamp here.
      // Month-0 exception: when all month-0 CC payments already settled before syncCutoffDate
      // (safeToPayTotal === 0), the sim's own month-0 plan would double-count payments already
      // reflected in the live Plaid balance — the sim has no syncCutoffDate concept, so PASS 3
      // must still zero this month out itself.
      monthDebtPayment = m0AllSettled ? 0 : (ledgerEntry ? ledgerEntry.total : monthDebtPayment);
      finalLiquid = cashPreDebt - monthDebtPayment;

      // Step 3: this month's revolving-debt-cash TARGET for the next convergence pass (fed back
      // via runDebtCashConvergence → resimulateWithDebtCash → debtCashTargetByMonth). Cash above
      // the floor that isn't already spoken for gets added on top of the sim's own revolving share
      // (ledgerEntry.revolving) so the next pass's resim routes it — the sim absorbs it into its
      // own state (interest, backlog, per-card cascade) instead of PASS 3 tracking a parallel
      // register. This pass's actual monthDebtPayment/finalLiquid above are NOT touched here; they
      // already equal what the sim decided given the CURRENT target (single-clamp rule).
      const ccEngRevBalEnd = (cardProjectionData?.simCards ?? []).reduce((s, c) => {
        const revBal0 = cardProjectionData?.monthlyRevolvingBalances?.get(c.id)?.[0] ?? 1;
        if (revBal0 === 0) return s;
        return s + Math.max(0, cardProjectionData?.monthlyRevolvingBalances?.get(c.id)?.[i] ?? 0);
      }, 0);
      let revolvingDebtCashTarget = m0AllSettled ? 0 : (ledgerEntry?.revolving ?? 0);
      // Asymmetric cushion (FLOOR_CUSHION_DOLLARS): both branches push toward
      // floor + cushion, but the surplus branch only fires ABOVE floor + cushion and the
      // deficit branch only BELOW the floor itself. The dead zone [floor, floor + cushion]
      // where neither fires is the stable landing strip — the convergence loop's $1 tolerance
      // lets fixed points settle within tolerance of the branch target, and a target pinned
      // EXACTLY at the floor let that residue land cents below it (penny-level red months in
      // the Forecast table, 2026-07-16 live report). With the target a cushion above the
      // floor, sub-tolerance residue can never cross below the floor.
      const step3DrainTo = step3SpendFloor + FLOOR_CUSHION_DOLLARS;
      if (!m0AllSettled && !strictSaveUpMonths.has(i) && ccEngRevBalEnd > 0 && finalLiquid > step3DrainTo) {
        const surplus = Math.min(finalLiquid - step3DrainTo, ccEngRevBalEnd);
        if (surplus > 0) revolvingDebtCashTarget += surplus;
      } else if (!m0AllSettled && !strictSaveUpMonths.has(i) && finalLiquid < step3SpendFloor) {
        // Symmetric deficit-reduction: this month's sim payment (monthDebtPayment) drove cash
        // below the same next-month-aware spend floor the surplus branch drains down to, so feed
        // back a LOWER revolving target for the next pass. Keyed to step3SpendFloor (Q9) so both
        // branches push toward the SAME threshold — an overpaying month that landed in the old
        // buffer zone (cashFloor..monthMinSafe) used to be a fixed point (target echoed the
        // sim's own revolving spend with nothing pulling it back), leaving residual months that
        // start below their pre-paycheck floor. A shared threshold can't make the branches
        // fight: surplus fires strictly above it, deficit strictly below, and the damped
        // re-target (runDebtCashConvergence) collapses any payment↔clip two-cycle this creates.
        // The sim clamps the target up to each card's contract minimum (resimulateWithDebtCash →
        // simulateVariablePayoff Step 5: min(max(target, minimums), owed)), so this can never
        // force a min-payment violation; when even paying only minimums breaches the floor the
        // deficit is structural and the milestone stands.
        const deficit = step3DrainTo - finalLiquid;
        revolvingDebtCashTarget = Math.max(0, revolvingDebtCashTarget - deficit);
      }

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
        const perCheckRetireByAcct = perCheckRetireByAcctAt(b.incomeMultiplier);
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

      // 4c-ii. RANKED AUTOMATIC EXTRA PAYMENTS → the same balance the cash left checking for.
      // The cash side is subtracted from `cashPreDebt` above; without this credit the dollars would
      // leave the funding account and land nowhere, which is strictly worse than not shipping the
      // feature at all. Linked account first (so the account's own popup line moves), else the
      // goal's / car fund's pool — between goalPools, carFundPools and the three per-account Maps
      // every target has a home, so nothing is silently dropped.
      for (const t of autoExtraThisMonth) {
        if (!(t.amount > 0)) continue;
        const linked = autoExtraLinkedAcct.get(t.id) ?? null;
        const savA = linked ? perAcctSavings.get(linked) : undefined;
        const invA = linked ? perAcctInvest.get(linked) : undefined;
        const retA = linked ? perAcctRetire.get(linked) : undefined;
        if (savA) savA.balance += t.amount;
        else if (invA) invA.balance += t.amount;
        else if (retA) retA.balance += t.amount;
        else if (t.kind !== 'loan') {
          const pool = t.kind === 'goal' ? goalPools.get(t.id) : carFundPools.get(t.id);
          if (pool) pool.balance += t.amount;
        }
      }

      // 4c-ii-b. EXTRA PRINCIPAL → the vehicle loan balance, from THIS month forward.
      //
      // A loan is the one target whose credit is a liability going DOWN rather than an asset going
      // up, and it is why loan targets were withheld from the allocator until this existed: cash
      // leaves checking via `autoExtraOutThisMonth`, and without this the money would simply
      // vanish from the projection — the same failure 4c-ii above was written to prevent.
      //
      // From `i`, not `i + 1`: a lump sum paid this month is already deducted from this month's own
      // `projectedCarLoan` (`- projLumpThisMonth`), and extra principal is the same kind of event,
      // so the two must land in the same month or the drawer contradicts itself.
      //
      // ⚠️ THE SCHEDULE IS NOT REBUILT, only reduced. Reducing the balance without shortening the
      // term or re-pricing the interest UNDERSTATES what the extra payment buys — the loan retires
      // early in reality and merely reaches zero sooner here. That is the conservative direction
      // and it is deliberate: re-amortizing inside the loop would need the schedule rebuilt every
      // month for every fund, and a projection that overstates the benefit of paying debt is the
      // one that gets a user into trouble. The capacity the next month ranks against is read from
      // these same arrays, so an over-payment can never reserve against principal already gone.
      for (const t of autoExtraThisMonth) {
        if (t.kind !== 'loan' || !(t.amount > 0)) continue;
        const balances = loanBalancesByFundId.get(t.id);
        if (!balances) continue;
        for (let j = i; j < balances.length; j += 1) {
          const before = balances[j];
          const after = Math.max(0, before - t.amount);
          balances[j] = after;
          carLoanBalanceByMonth[j] -= before - after;
        }
      }

      // 4c-iii. The reserve just taken fills part of the target's need, so it comes off the
      // remaining capacity the LATER months rank against. (The target's own monthly contribution
      // was already taken off above, before this month's reserve was decided — that ordering is
      // what stops a goal being over-funded by one month's contribution on the month it fills.)
      // Loans are excluded: their capacity is not carried here at all, it is read fresh from the
      // amortized balance each month (which the block above has just reduced). Decaying a running
      // total as well would take the same dollars off twice.
      for (const t of autoExtraThisMonth) {
        if (t.kind !== 'loan') decayAutoExtraCapacity(t.id, t.amount);
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
      for (const [, p] of carFundPools) p.balance = Math.round(p.balance * (1 + monthlySavingsInterest) * 100) / 100;

      // 4f. Re-derive aggregate scalars from per-account Maps
      retireBal = Array.from(perAcctRetire.values()).reduce((s, a) => s + a.balance, 0);
      investBal = Array.from(perAcctInvest.values()).reduce((s, a) => s + a.balance, 0);
      savingsBal = Array.from(perAcctSavings.values()).reduce((s, a) => s + a.balance, 0)
        + Array.from(goalPools.values()).reduce((s, p) => s + p.balance, 0)
        + Array.from(carFundPools.values()).reduce((s, p) => s + p.balance, 0);

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

      // ccDebtFreeFired flips the month the SIM's own revolving balance (already inclusive of any
      // converged step-3 surplus) reaches $0. Do NOT emit the milestone here — see ccMilestoneFired
      // below, which prefers the SIM's true payoff signal and only falls back to this flag.
      if (!ccDebtFreeFired && ccEngRevBalEnd <= 0 && prevRevBalEnd > 0) {
        ccDebtFreeFired = true;
      }
      prevRevBalEnd = ccEngRevBalEnd;

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
      resolvedGoals.forEach((g, gi) => {
        if (goalCompletionIdx.get((g.id as string) ?? String(gi)) === i) {
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
        takeHome: b.netIncome, totalExpenses: totalMonthlyOut,
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
        oneTimeNet: b.oneTimeNet,
        ccOneTime: Math.round(ccOneTimeByMonth[b.monthKey] || 0),
        monthMinSafe: Math.round(b.monthMinSafe),
        rawEndingCash: finalLiquid + cumulativeCarReserveHeld,
        rawMonthMinSafe: b.monthMinSafe,
        rawNetWorth: netWorth,
        rawTotalAssets: totalAssets,
        rawTotalLiabilities: totalLiabilityBal,
        rawCcDisplayBalance: adjCCLiab,
        rawTotalCCPurchases: (ccScheduledByMonth[i] ?? 0) + (ccOneTimeByMonth[b.monthKey] || 0),
        floorBreachedByOneTime,
        debtWasReduced,
        // Popup breakdown fields.
        //
        // EXACT CENTS (Tre, 2026-08-06). These are the terms the Month Breakdown drawer walks on
        // screen, and a walk that is supposed to add up must not be a sum of separately-rounded
        // parts — that is the same defect the month-0 cash chain had when Dashboard and Forecast
        // printed a dollar apart (`debt-model-types.ts` Month0CashChain carries the same warning).
        // Rounding happens at RENDER only; the drawer prints two decimals so it visibly balances.
        // Balance-style fields above (netWorth/assets/liabilities/CC balances) stay rounded for
        // the chart/table, but the popup renders their raw* variants with cents — N8 (Tre,
        // 2026-08-09) asked for full decimals on every number in the forecast popups, superseding
        // the earlier keep-balances-rounded call for that surface only.
        baseExpenses: b.baseExpenses,
        savingsContrib: actualGoalsSavings,
        savingsGoalItems: b.savingsGoalItems,
        carContrib: actualCarSavings,
        carContribItems: b.carContribItems,
        carReserveHeld: cumulativeCarReserveHeld,
        carLoanPayment: carLoanThisMonth - activeCarLoanLumpSumByMonth[i],
        vehicleDownPayment: effectiveDPThisMonth, // cash portion only — savings portion in nonCashTransferItems
        vehicleSavedPortion: Math.max(0, downPaymentThisMonth - effectiveDPThisMonth), // from linked savings account
        vehicleInsurance: vehicleInsuranceThisMonth,
        projectedCarLoan: projLoanThisMonth - projLumpThisMonth,
        carLoanExtraPayment: carLoanLumpThisMonth,
        carLumpItems: carLumpItemsByMonth[i],
        mortgagePayment: mortgageMonthlyPayment,
        transfersTotal: actualTransfers,
        transferBreakdown: b.transferBreakdown,
        nonCashTransferItems: [
          ...b.nonCashTransferItems,
          ...vehicleDPFromSavingsThisMonth.map(v => ({ name: `${v.vehicleName} Down Payment`, fromAcctName: v.fromAcctName, fromAcctId: '', amount: v.amount })),
        ],
        otherAccountExpenseItems: b.otherAccountExpenseItems,
        lumpSumSavings: lumpTransferByMonth[i].savings,
        lumpSumBrokerage: lumpTransferByMonth[i].brokerage,
        lumpSumRothIra: lumpTransferByMonth[i].roth_ira,
        businessContrib: b.monthBusinessContrib,
        totalCCPurchases: Math.round((ccScheduledByMonth[i] ?? 0) + (ccOneTimeByMonth[b.monthKey] || 0)),
        ccDebtBalance: Math.round(b.ccDebtBalance),
        ccDisplayBalance: Math.round(adjCCLiab),
        paycheckIncome: b.paycheckIncome,
        otherIncome: b.otherIncome,
        bonusIncome: b.bonusIncome,
        taxReturnIncome: b.taxReturnIncome,
        isRaiseMonth: b.isRaiseMonth,
        promotionNewSalary: Math.round(b.promotionNewSalary),
        recommendedDebtPayment: Math.round(debtPayments[i]),
        floorItems: b.floorItems ?? [],
        prePaycheckBillsTotal: b.prePaycheckBillsTotal ?? 0,
        settingsCashFloor: cashFloor,
        autoExtraByTarget: autoExtraThisMonth.reduce<Record<string, number>>((acc, t) => {
          // Summed rather than assigned: `perTarget` is a list, and a target listed twice must
          // credit the chart with both dollars, never just the last one.
          if (t.amount > 0) acc[t.id] = (acc[t.id] ?? 0) + t.amount;
          return acc;
        }, {}),
        // Per-account breakdown snapshots for popup display
        // Per-account balances stay unrounded: the popup and CSV export are their only readers,
        // and both now print exact cents (N8).
        assetBreakdown: [
          ...Array.from(perAcctRetire.entries()).map(([id, a]) => ({ bucket: 'retirement' as const, id, name: a.name, balance: a.balance })),
          ...Array.from(perAcctInvest.entries()).map(([id, a]) => ({ bucket: 'investment' as const, id, name: a.name, balance: a.balance })),
          ...Array.from(perAcctSavings.entries()).map(([id, a]) => ({ bucket: 'savings' as const, id, name: a.name, balance: a.balance })),
          ...Array.from(goalPools.entries()).map(([id, p]) => ({ bucket: 'savings' as const, id, name: p.name, balance: p.balance })),
          // Only ever non-zero once an opted-in car fund has taken a ranked extra payment — an
          // empty pool is not a real asset row and would just add noise to every popup.
          ...Array.from(carFundPools.entries()).filter(([, p]) => p.balance > 0).map(([id, p]) => ({ bucket: 'savings' as const, id, name: p.name, balance: p.balance })),
        ],
        nonCCLiabBreakdown: nonCCLiabilities.rows.map(la => ({
          id: la.id,
          name: la.name,
          account_type: la.account_type,
          balance: la.balances[i],
        })),
        carLoanBreakdown: carLoanPerFund
          .map(cf => ({ name: cf.name, balance: cf.balances[i] ?? 0 }))
          .filter(cf => cf.balance > 0),
        // See Step 3 above: the sim's own revolving share (ledgerEntry.revolving) plus any
        // not-yet-routed surplus — the target fed to the next convergence pass.
        revolvingDebtCash: Math.max(0, Math.round(revolvingDebtCashTarget)),
      });
    }

    return { data, milestones, maxDebtPaymentByMonth };
}
