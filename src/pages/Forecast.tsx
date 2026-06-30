import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { PageSkeleton } from '@/components/shared/PageSkeleton';
import { useDemo } from '@/contexts/DemoContext';
import { useSubscription } from '@/hooks/useSubscription';
import { formatCurrency, formatYAxisTick } from '@/lib/calculations';
import { usePersistedState } from '@/hooks/usePersistedState';
import InstructionsModal from '@/components/shared/InstructionsModal';
import { useDebts, useSavingsGoals, useCarFunds, useAccounts, useSubscriptions, useBudgetItems, useProfile, useRecurringRules, useTransactions, usePaymentPlans } from '@/hooks/useSupabaseData';
import { aggregateByMonth, countWeekdayInMonth, countRuleOccurrencesInMonth, getCalendarYearMonthRange, getCalendarYearLabel } from '@/lib/scheduling';
import { buildCardData, getMonthlyDebtBreakdown, CC_DEFAULT_CATEGORIES, PROJECTION_MONTHS } from '@/lib/credit-card-engine';
import { getMonthlyPlanCashExpenses } from '@/lib/payment-plan-generator';
import { useCardProjectionContext } from '@/contexts/CardProjectionContext';
import { getDebtPaymentsByMonth, getDebtBalancesByMonth } from '@/lib/debt-transaction-generator';
import { getMonthNetIncome, getNormalizedMonthNetIncome, getPaychecksInMonth, getRemainingPaychecksThisMonth, getMinSafeCash, getAugmentedMinSafeCash, getPrePaycheckNextMonthBills, mergeWithGeneratedTransactions, getRemainingTransactionIncomeByDay, getRemainingTransactionExpensesByDay, getPaycheckGross, type EnrichedTransaction } from '@/lib/pay-schedule';
import { projectMilestones, monthlyContribForAccount } from '@/lib/retirement-projection';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  Bar, ComposedChart, ReferenceLine,
} from 'recharts';
import { Settings2, List, BarChart3, TrendingUp, CreditCard, Info, X, FileDown, Crown, ChevronRight, Plus } from 'lucide-react';
import { exportForecastPdf, type ForecastRow } from '@/lib/exportPdf';
import { exportForecastCsv } from '@/lib/exportCsv';
import { buildForecastMonthDetail, getAbsoluteMonthIndex } from '@/lib/forecast-export';
import { estimateTaxReturn, estimateFederalWithheld, STATE_TAX_RATES, type FilingStatus } from '@/lib/tax-estimator';
import { getTotalCarLoanMonthly, calculateScheduledPayment, buildAmortizationSchedule, getLoanPrincipal, monthsBetween, getCarFundEarmark } from '@/lib/vehicle-loan-engine';
import { computeFloorProtection } from '@/lib/floor-protection';

const toMonthly = (amount: number, freq: string) =>
  freq === 'weekly' ? amount * 52 / 12
  : freq === 'biweekly' ? amount * 26 / 12
  : freq === 'yearly' ? amount / 12
  : amount;

const RETIRE_TYPES_FORECAST = ['401k', 'roth_ira', 'ira', 'brokerage', 'hsa'];
const DEFAULT_APY_FORECAST = 7;

function CalcDrawer({ open, onClose, title, lines, zIndex = 60 }: { open: boolean; onClose: () => void; title: string; lines: { label: string; value: string; op?: string; onClick?: () => void }[]; zIndex?: number }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)', paddingTop: 'max(1rem, env(safe-area-inset-top))', zIndex }} onClick={onClose}>
      <div
        className="card-forged w-full max-w-sm sm:max-w-md flex flex-col"
        style={{ maxHeight: 'min(85vh, calc(100dvh - 2rem))' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-4 border-b border-border shrink-0">
          <h2 className="font-display font-semibold text-sm flex items-center gap-2 min-w-0">
            <Info size={14} className="text-primary shrink-0" />
            <span className="truncate">{title}</span>
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-4 sm:px-6 py-4 space-y-2">
          {lines.map((l, i) => (
            <div
              key={i}
              className={`flex items-start justify-between py-1.5 border-b border-border/30 last:border-0 gap-2 ${l.onClick ? 'cursor-pointer hover:bg-secondary/40 rounded px-1 -mx-1' : ''}`}
              onClick={l.onClick ? (e) => { e.stopPropagation(); l.onClick!(); } : undefined}
            >
              <span className="text-xs flex items-start gap-1.5 min-w-0 flex-1" style={{ color: l.onClick ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}>
                {l.op && <span className="text-primary font-bold shrink-0 mt-px">{l.op}</span>}
                <span className={`break-words ${l.onClick ? 'underline decoration-dotted underline-offset-2' : ''}`}>{l.label}</span>
                {l.onClick && <ChevronRight size={11} className="shrink-0 mt-px text-muted-foreground" />}
              </span>
              <span className="text-xs font-display font-bold text-foreground whitespace-nowrap shrink-0">{l.value}</span>
            </div>
          ))}
          <p className="text-xs text-muted-foreground pt-2 border-t border-border/30">
            A negative monthly cash flow can be acceptable if prior saved cash covers the difference and ending cash stays above the required floor. One-time purchases (e.g. car down payment) reduce available cash and may auto-adjust debt recommendations.
          </p>
        </div>
      </div>
    </div>
  );
}

interface ForecastTooltipProps {
  active?: boolean;
  payload?: { dataKey: string; color: string; name: string; value: number }[];
  label?: string;
}

function ForecastTooltip({ active, payload, label }: ForecastTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border p-2 sm:p-3 text-xs space-y-1 max-w-[140px] sm:max-w-xs" style={{ borderRadius: 'var(--radius)' }}>
      <p className="font-display font-bold text-foreground mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-2 sm:gap-3">
          <span className="flex items-center gap-1 truncate"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />{p.name}</span>
          <span className="font-display font-bold shrink-0">{formatCurrency(p.value, false)}</span>
        </div>
      ))}
    </div>
  );
}

// One row of PASS 3's final per-month projection (Forecast's main chart/table/popup data
// source) — every field is a real value pushed at the data.push() call below, kept as a
// single flat interface (rather than reusing PASS 1's baseData type) since several fields
// here are PASS-3-only derivations (endingCash, ccDisplayBalance, the breakdown arrays) with
// no equivalent on baseData.
interface ForecastMonthRow {
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
}

export default function Forecast() {
  const { isDemo } = useDemo();
  const { isPremium } = useSubscription();
  const { data: debts } = useDebts();
  const { data: goals } = useSavingsGoals();
  const { data: carFunds } = useCarFunds();
  const { data: accounts, loading: accountsLoading } = useAccounts();
  const { data: subs } = useSubscriptions();
  const { data: budgetItems } = useBudgetItems();
  const { data: profile } = useProfile();
  const { data: rules } = useRecurringRules();
  const { data: transactions } = useTransactions();
  const { data: paymentPlans } = usePaymentPlans();

  const {
    cardProjection: cardProjectionData,
    assumptions,
    setAssumptions,
    pauseSavings,
    debtStrategy,
    payConfig,
    cashFloor,
    forecastFundingAccountId,
    syncCutoffDate,
    scheduledEvents,
    debtPayoffOptions,
  } = useCardProjectionContext();
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [assumptionsTutorialSeen, setAssumptionsTutorialSeen] = usePersistedState('tre:forecast:assumptionsTutorialSeen', false);
  const [filterYear, setFilterYear] = usePersistedState<'all' | '1' | '2' | '3' | '4' | '5'>('tre:forecast:filterYear', 'all');
  const [chartMode, setChartMode] = usePersistedState<'combo' | 'line'>('tre:forecast:chartMode', 'combo');
  const [viewMode, setViewMode] = usePersistedState<'monthly' | 'detailed'>('tre:forecast:viewMode', 'monthly');
  const [hiddenSeries, setHiddenSeries] = usePersistedState<string[]>('tre:forecast:hidden', []);
  const [calcDrawer, setCalcDrawer] = useState<{ title: string; lines: { label: string; value: string; op?: string; onClick?: () => void }[] } | null>(null);
  const [floorCalcDrawer, setFloorCalcDrawer] = useState<{ title: string; lines: { label: string; value: string; op?: string }[] } | null>(null);

  const toggleSeries = useCallback((key: string) => {
    setHiddenSeries((prev: string[]) => {
      const next = prev.includes(key) ? prev.filter((k: string) => k !== key) : [...prev, key];
      return next;
    });
  }, [setHiddenSeries]);


  // Annualize the "Federal Withholding" deduction from Budget Control, if the user has set one.
  // Takes priority over the state-rate default so the estimate reflects their actual W-4 setup.
  const annualFederalWithheldFromBudget = useMemo(() => {
    if (!payConfig || !profile) return 0;
    const jsonDeds = profile?.paycheck_deductions as { value: number; mode: string; label?: string }[] | null;
    if (!jsonDeds || jsonDeds.length === 0) return 0;
    const fedDed = jsonDeds.find(d => d.label != null && /federal.*withholding|^withholding$/i.test(d.label));
    if (!fedDed || !fedDed.value) return 0;
    const paycheckGross = payConfig.frequency === 'biweekly' ? payConfig.weeklyGross * 2
      : payConfig.frequency === 'monthly' ? payConfig.weeklyGross * 52 / 12
      : payConfig.weeklyGross;
    const perPaycheck = fedDed.mode === 'pct' ? paycheckGross * (fedDed.value / 100) : fedDed.value;
    const paychecksPerYear = payConfig.frequency === 'biweekly' ? 26 : payConfig.frequency === 'monthly' ? 12 : 52;
    return Math.round(perPaycheck * paychecksPerYear);
  }, [payConfig, profile]);


  const prePaycheckBillsInfo = useMemo(() => getPrePaycheckNextMonthBills(rules, payConfig, forecastFundingAccountId), [rules, payConfig, forecastFundingAccountId]);
  const monthlyAggregates = useMemo(() => aggregateByMonth(scheduledEvents), [scheduledEvents]);

  const planExpensesByMonth = useMemo(() => {
    const now = new Date();
    const ccIds = new Set<string>(
      accounts.filter(a => a.active && a.account_type === 'credit_card')
        .flatMap(a => [a.id, `account:${a.id}`]),
    );
    return Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return getMonthlyPlanCashExpenses(
        paymentPlans ?? [], d.getFullYear(), d.getMonth(), ccIds,
        i === 0 ? syncCutoffDate : undefined,
      );
    });
  }, [accounts, paymentPlans, syncCutoffDate]);

  const debtPaymentsByMonth = useMemo(() =>
    getDebtPaymentsByMonth(accounts, transactions, rules, debts, profile, debtPayoffOptions, PROJECTION_MONTHS, planExpensesByMonth),
    [accounts, transactions, rules, debts, profile, debtPayoffOptions, planExpensesByMonth],
  );

  const debtBalancesByMonth = useMemo(() =>
    getDebtBalancesByMonth(accounts, transactions, rules, debts, profile, debtPayoffOptions, PROJECTION_MONTHS, planExpensesByMonth),
    [accounts, transactions, rules, debts, profile, debtPayoffOptions, planExpensesByMonth],
  );

  // Current-month debt breakdown — pins forecast month 0 to the same calc as Debt Payoff + Dashboard.
  // safeToPayTotal = totalRecommended (sum of all card payments) = rawDebtPayment for month 0.
  // autopayTotal is kept at 0 here since it's already included in totalRecommended — the loop
  // previously added it separately causing double-counting after totalAvailableCash was changed
  // to represent the actual recommended payment rather than the pre-autopay pool.
  const currentMonthRecommendedDebt = useMemo(() => {
    try {
      const allTxns = mergeWithGeneratedTransactions(transactions, rules, accounts);
      const retireIds = new Set<string>(
        accounts.filter((a) => a.active && ['401k', 'roth_ira', 'ira', 'hsa'].includes(a.account_type)).map((a) => a.id),
      );
      const now0 = new Date();
      const monthEnd0 = new Date(now0.getFullYear(), now0.getMonth() + 1, 0);
      const activeTransferDests0 = new Set<string>(
        rules.filter((r) =>
          r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment') && r.deposit_account &&
          !(r.start_date && new Date(r.start_date + 'T00:00:00') > monthEnd0) &&
          !(r.end_date && new Date(r.end_date + 'T00:00:00') < now0),
        ).map((r) => r.deposit_account as string),
      );
      const savingsTotal = goals.reduce((s, g) => {
        if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > now0) return s;
        if (g.linked_account && retireIds.has(g.linked_account)) return s;
        if (g.linked_account && activeTransferDests0.has(g.linked_account)) return s;
        return s + Number(g.monthly_contribution);
      }, 0);
      const carTotal = carFunds.reduce((s, c) => {
        if (c.phase === 'loan') return s;
        const giftAdjDownPmt = Math.max(0, Number(c.down_payment_goal) - Number(c.gift_contribution || 0));
        const rem = Math.max(0, giftAdjDownPmt - Number(c.current_saved));
        if (rem <= 0) return s;
        let monthsToGoal = 12;
        if (c.planned_purchase_date) {
          const parts = (c.planned_purchase_date as string).split('-').map(Number);
          const pd = new Date(parts[0], parts[1] - 1, parts[2]);
          monthsToGoal = Math.max(1, (pd.getFullYear() - now0.getFullYear()) * 12 + (pd.getMonth() - now0.getMonth()));
        }
        return s + Math.min(rem / monthsToGoal, rem);
      }, 0);
      const carLoanTotal = getTotalCarLoanMonthly(carFunds);
      const ccIds = new Set<string>(
        accounts.filter(a => a.active && a.account_type === 'credit_card')
          .flatMap(a => [a.id, `account:${a.id}`]),
      );
      const planExpenses = getMonthlyPlanCashExpenses(paymentPlans ?? [], now0.getFullYear(), now0.getMonth(), ccIds);
      const breakdown = getMonthlyDebtBreakdown(accounts, allTxns, rules, debts, profile, pauseSavings ? 0 : savingsTotal + carTotal + carLoanTotal, undefined, syncCutoffDate, planExpenses);
      const safeToPayTotal = breakdown.totalRecommended;
      const autopayTotal = 0;
      return { safeToPayTotal, autopayTotal, recommendations: breakdown.recommendations };
    } catch { return null; }
  }, [accounts, transactions, rules, debts, profile, goals, carFunds, pauseSavings, syncCutoffDate, paymentPlans]);

  // ── Shared CC-filtered month events ─────────────────────────────────────────
  // Excludes CC-tagged expense rules from cash expenses so the main projections
  // engine doesn't double-count them with the debt engine's autopay pass-through
  // payments after cards are paid off.
  const forecastMonthEvents = useMemo((): { income: number; nonPaycheckIncome: number; expenses: number }[] => {
    const now = new Date();
    const todayStr = syncCutoffDate;

    const liquidAccountIds = new Set<string>(
      accounts
        .filter((a) => a.active && ['checking', 'business_checking', 'cash'].includes(a.account_type))
        .map((a) => a.id),
    );

    const incomeToLiquidRuleIds = new Set<string>(
      rules.filter((r) =>
        r.active && r.rule_type === 'income' &&
        (!r.deposit_account || liquidAccountIds.has(r.deposit_account)),
      ).map((r) => r.id),
    );

    // Identify the paycheck rule(s) so we can separate them from "other income".
    // paycheck income is already captured via fallbackTakeHome in PASS 1 — including it
    // again from forecastMonthEvents would double-count it for months > 0.
    const explicitPaycheckRuleId = profile?.paycheck_rule_id ?? undefined;
    const paycheckRuleIds = new Set<string>();
    if (explicitPaycheckRuleId) {
      paycheckRuleIds.add(explicitPaycheckRuleId);
    } else {
      // Fallback: treat periodic-pay-frequency income rules as the paycheck rule
      rules.filter((r) =>
        r.active && r.rule_type === 'income' &&
        ['weekly', 'biweekly', 'semi_monthly'].includes(r.frequency) &&
        (!r.deposit_account || liquidAccountIds.has(r.deposit_account)),
      ).forEach((r) => paycheckRuleIds.add(r.id));
    }

    const ccPaymentSources = new Set<string>(
      accounts
        .filter((a) => a.active && a.account_type === 'credit_card')
        .flatMap((a) => [a.id, `account:${a.id}`]),
    );

    const ccExplicitRuleIds = new Set<string>(
      rules.filter((r) =>
        r.active && r.rule_type === 'expense' &&
        r.payment_source && ccPaymentSources.has(r.payment_source),
      ).map((r) => r.id),
    );

    const ccDefaultRuleIds = new Set<string>(
      rules.filter((r) =>
        r.active && r.rule_type === 'expense' &&
        !r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category),
      ).map((r) => r.id),
    );

    const allCcRuleIds = new Set<string>([...ccExplicitRuleIds, ...ccDefaultRuleIds]);

    // Expense rules paid from a bank account other than the funding account (not a CC, already
    // excluded above) — that money never touches the funding account, so it must not reduce its
    // modeled cash flow. Mirrors useCardProjection.ts's identical Set exactly — keep in lockstep.
    const otherAccountRuleIds = new Set<string>(
      rules.filter((r) => {
        if (!r.active || r.rule_type !== 'expense' || !r.payment_source) return false;
        if (ccPaymentSources.has(r.payment_source)) return false;
        if (!forecastFundingAccountId) return false;
        const srcId = (r.payment_source as string).replace(/^account:/, '');
        return srcId !== forecastFundingAccountId;
      }).map((r) => r.id),
    );

    const savingsRuleIds = new Set<string>(
      rules.filter((r) =>
        r.active && r.rule_type === 'expense' &&
        (r.category === 'Savings' || r.category === 'Investing'),
      ).map((r) => r.id),
    );

    return Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const eventsInMonth = scheduledEvents.filter(e =>
        e.date.startsWith(monthKey) && (i > 0 || e.date > todayStr),
      );

      const income = eventsInMonth
        .filter(e => e.type === 'income' && e.ruleId && incomeToLiquidRuleIds.has(e.ruleId))
        .reduce((s, e) => s + e.amount, 0);

      // nonPaycheckIncome excludes the paycheck rule so PASS 1 / simulationMonthEvents can
      // add fallbackTakeHome (computed gross→net) without double-counting the paycheck.
      // Each non-paycheck income rule may have its own tax_rate; default is 0 (no tax).
      const ruleTaxRateMap = new Map<string, number>(
        rules.filter((r) => r.rule_type === 'income' && r.tax_rate != null)
          .map((r) => [r.id, Number(r.tax_rate)]),
      );
      const nonPaycheckIncome = eventsInMonth
        .filter(e => e.type === 'income' && e.ruleId && incomeToLiquidRuleIds.has(e.ruleId) && !paycheckRuleIds.has(e.ruleId))
        .reduce((s, e) => {
          const tr = e.ruleId ? (ruleTaxRateMap.get(e.ruleId) ?? 0) : 0;
          return s + e.amount * (1 - tr / 100);
        }, 0);

      const expenses = eventsInMonth
        .filter(e =>
          e.type === 'expense' &&
          !(e.ruleId && allCcRuleIds.has(e.ruleId)) &&
          !(e.ruleId && otherAccountRuleIds.has(e.ruleId)) &&
          !(pauseSavings && e.ruleId && savingsRuleIds.has(e.ruleId)),
        )
        .reduce((s, e) => s + e.amount, 0);

      return { income, nonPaycheckIncome, expenses };
    });
  }, [accounts, rules, scheduledEvents, pauseSavings, profile, syncCutoffDate, forecastFundingAccountId]);

  // One-time manual transactions for forecast.
  // CC-tagged expenses are excluded — they increase CC balance (tracked by the debt
  // engine via cardPurchasesPerMonth) and do NOT reduce checking account cash.
  // Past transactions in the current month are excluded — starting cash already reflects them.
  const oneTimeByMonth = useMemo(() => {
    const result: Record<string, { income: number; expense: number }> = {};
    const ccSources = new Set(
      accounts
        .filter((a) => a.account_type === 'credit_card' && a.active)
        .flatMap((a) => [a.id, `account:${a.id}`]),
    );
    const today = new Date();
    const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    for (const t of transactions) {
      if ((t as EnrichedTransaction).isGenerated) continue;
      const monthKey = t.date?.substring(0, 7);
      if (!monthKey) continue;
      // Exclude transactions on or before the last Plaid sync date — the account balance
      // already reflects them. Uses syncCutoffDate (sync-aligned) so the boundary matches
      // the actual balance snapshot, not the UTC clock.
      if (monthKey === currentMonthKey && t.date && t.date <= syncCutoffDate) continue;
      if (!result[monthKey]) result[monthKey] = { income: 0, expense: 0 };
      if (t.type === 'income') result[monthKey].income += Number(t.amount);
      else if (!t.payment_source || !ccSources.has(t.payment_source)) result[monthKey].expense += Number(t.amount);
    }
    return result;
  }, [transactions, accounts, syncCutoffDate]);

  // CC-only one-time purchases per month — display-only, does NOT affect cash floor math.
  // Past transactions in the current month are excluded — starting cash already reflects them.
  const ccOneTimeByMonth = useMemo(() => {
    const result: Record<string, number> = {};
    const ccSources = new Set(
      accounts
        .filter((a) => a.account_type === 'credit_card' && a.active)
        .flatMap((a) => [a.id, `account:${a.id}`]),
    );
    const today = new Date();
    const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    for (const t of transactions) {
      if ((t as EnrichedTransaction).isGenerated) continue;
      if (t.type !== 'expense') continue;
      if (!t.payment_source || !ccSources.has(t.payment_source)) continue;
      const monthKey = t.date?.substring(0, 7);
      if (!monthKey) continue;
      if (monthKey === currentMonthKey && t.date && t.date <= syncCutoffDate) continue;
      result[monthKey] = (result[monthKey] || 0) + Number(t.amount);
    }
    return result;
  }, [transactions, accounts, syncCutoffDate]);

  // Scheduled CC rule purchases per month — the recurring spend on credit cards.
  // Combined with ccOneTimeByMonth to show total CC purchases in the popup.
  const ccScheduledByMonth = useMemo(() => {
    const ccPaymentSources = new Set<string>(
      accounts
        .filter((a) => a.active && a.account_type === 'credit_card')
        .flatMap((a) => [a.id, `account:${a.id}`]),
    );
    const ccRuleIds = new Set<string>(
      rules.filter((r) =>
        r.active && r.rule_type === 'expense' &&
        (
          (r.payment_source && ccPaymentSources.has(r.payment_source)) ||
          (!r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category))
        )
      ).map((r) => r.id),
    );
    const now = new Date();
    const todayStr = syncCutoffDate;
    return Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return scheduledEvents
        .filter(e =>
          e.type === 'expense' &&
          e.date.startsWith(monthKey) &&
          (i > 0 || e.date > todayStr) &&
          e.ruleId && ccRuleIds.has(e.ruleId),
        )
        .reduce((s, e) => s + e.amount, 0);
    });
  }, [accounts, rules, scheduledEvents, syncCutoffDate]);

  const projections = useMemo(() => {
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
    let prevP3RevBal = p3RevBal;
    let cumulativeSurplus = 0;
    let ccDebtFreeFired = false;
    // Cash being set aside toward a saving-phase vehicle's down payment hasn't left any account
    // yet — it's still the user's cash. Track it separately and add it back to displayed Ending
    // Cash each month, removing it once the purchase month arrives (the money's been spent by
    // month-end, same point effectiveDP/the lump-sum purchase deduction already fires).
    let cumulativeCarReserveHeld = 0;

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
      if (!m0AllSettled && !strictSaveUpMonths.has(i) && p3RevBal > 0 && finalLiquid > b.monthMinSafe) {
        const surplus = Math.min(finalLiquid - b.monthMinSafe, Math.max(0, ccEngRevBalEnd - cumulativeSurplus));
        if (surplus > 0) {
          monthDebtPayment += surplus;
          finalLiquid -= surplus;
          cumulativeSurplus += surplus;
        }
      }
      // Sync p3RevBal to engine's interest-inclusive end-of-month balance minus all surplus sent.
      // Once CC Debt Free fires, lock at 0 — the engine's own trajectory (without PASS 3 surplus)
      // can lag several months behind actual payoff and would otherwise reopen surplus routing.
      p3RevBal = ccDebtFreeFired ? 0 : Math.max(0, ccEngRevBalEnd - cumulativeSurplus);

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

      if (p3RevBal <= 0 && prevP3RevBal > 0) {
        milestones.push({ month: b.monthLabel, event: 'CC Debt Free! 🎉' });
        ccDebtFreeFired = true;
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
        totalLiabilities: Math.round(totalLiabilityBal), debtBalance: Math.round(ccLiabilityBalThisMonth + b.otherDebtBalance),
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
        ccDisplayBalance: Math.round(cardProjectionData?.data[i]?.displayCCBalance ?? b.ccDebtBalance),
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
      });
      prevP3RevBal = p3RevBal;
    }

    return { data, milestones };
  }, [debts, goals, carFunds, accounts, budgetItems, profile, assumptions, rules, monthlyAggregates, debtPaymentsByMonth, debtBalancesByMonth, cardProjectionData, payConfig, oneTimeByMonth, ccOneTimeByMonth, ccScheduledByMonth, transactions, currentMonthRecommendedDebt, forecastMonthEvents, forecastFundingAccountId, cashFloor, pauseSavings, syncCutoffDate, planExpensesByMonth, annualFederalWithheldFromBudget]);

  // Live tax refund preview for the assumptions panel UI — always computed so it shows even when disabled
  const taxRefundPreview = useMemo(() => {
    try {
      if (assumptions.taxReturnAmountOverride > 0) {
        return { federalRefund: assumptions.taxReturnAmountOverride, stateRefund: 0, totalRefund: assumptions.taxReturnAmountOverride, federalTaxOwed: 0, stateTaxOwed: 0 };
      }
      const annualGross = payConfig.weeklyGross * 52;
      if (!annualGross || annualGross <= 0) return null;
      const federalWithheld = assumptions.taxReturnFederalWithheld || annualFederalWithheldFromBudget || estimateFederalWithheld(annualGross, assumptions.taxReturnFilingStatus, assumptions.taxReturnDependents);
      const stateRate = STATE_TAX_RATES[assumptions.taxReturnState] ?? 0;
      const stateWithheld = Math.round(annualGross * stateRate);
      return estimateTaxReturn({
        annualGrossIncome: annualGross,
        federalWithheld,
        filingStatus: assumptions.taxReturnFilingStatus,
        dependentsUnder17: assumptions.taxReturnDependents,
        stateCode: assumptions.taxReturnState,
        stateWithheld,
      });
    } catch { return null; }
  }, [assumptions, payConfig, annualFederalWithheldFromBudget]);

  const yearlyProjections = useMemo(() => {
    if (!payConfig) return [];
    const nowDate = new Date();
    let multiplier = 1;
    const sortedPromotions = [...(assumptions.promotions ?? [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    let nextPromotionIdx = 0;
    const results: { year: number; monthlyTakeHome: number; bonus: number; taxReturn: number; raiseApplied: boolean }[] = [];

    for (let i = 1; i <= PROJECTION_MONTHS; i++) {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() + i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      while (nextPromotionIdx < sortedPromotions.length && sortedPromotions[nextPromotionIdx].effectiveDate.slice(0, 7) <= monthKey) {
        const annualBase = payConfig.weeklyGross * 52;
        if (annualBase > 0) multiplier = sortedPromotions[nextPromotionIdx].newAnnualSalary / annualBase;
        nextPromotionIdx++;
      }
      let raiseApplied = false;
      if (assumptions.incomeGrowthEnabled && assumptions.incomeGrowth > 0 && d.getMonth() + 1 === assumptions.raiseMonth) {
        if (assumptions.raiseMode === 'flat') {
          const currentAnnual = payConfig.weeklyGross * 52 * multiplier;
          if (currentAnnual > 0) multiplier *= (1 + assumptions.incomeGrowth / currentAnnual);
        } else {
          multiplier *= (1 + assumptions.incomeGrowth / 100);
        }
        raiseApplied = true;
      }

      if (i % 12 === 0) {
        const adjustedConfig = { ...payConfig, weeklyGross: payConfig.weeklyGross * multiplier };
        const monthlyTakeHome = getMonthNetIncome(adjustedConfig, d.getFullYear(), d.getMonth());
        const annualGross = payConfig.weeklyGross * 52 * multiplier;

        const bonus = assumptions.bonusEnabled && assumptions.bonusAmount > 0
          ? (assumptions.bonusMode === 'pct' ? annualGross * (assumptions.bonusAmount / 100) : assumptions.bonusAmount)
          : 0;

        let taxReturn = 0;
        if (assumptions.taxReturnEnabled) {
          try {
            if (assumptions.taxReturnAmountOverride > 0) {
              taxReturn = assumptions.taxReturnAmountOverride;
            } else if (annualGross > 0) {
              const federalWithheld = assumptions.taxReturnFederalWithheld || annualFederalWithheldFromBudget || estimateFederalWithheld(annualGross, assumptions.taxReturnFilingStatus, assumptions.taxReturnDependents);
              const stateRate = STATE_TAX_RATES[assumptions.taxReturnState] ?? 0;
              taxReturn = estimateTaxReturn({
                annualGrossIncome: annualGross,
                federalWithheld,
                filingStatus: assumptions.taxReturnFilingStatus,
                dependentsUnder17: assumptions.taxReturnDependents,
                stateCode: assumptions.taxReturnState,
                stateWithheld: Math.round(annualGross * stateRate),
              }).totalRefund;
            }
          } catch {}
        }

        results.push({ year: i / 12, monthlyTakeHome, bonus, taxReturn, raiseApplied: i <= 12 ? raiseApplied : true });
      }
    }
    return results;
  }, [payConfig, assumptions, annualFederalWithheldFromBudget]);

  const filteredData = useMemo(() => {
    if (filterYear === 'all') return projections.data;
    const yr = parseInt(filterYear);
    const [start, end] = getCalendarYearMonthRange(yr);
    return projections.data.slice(start, end);
  }, [projections.data, filterYear]);

  // Detailed per-month money-flow + account-balance breakdown for the PDF/CSV exports, mirroring
  // the Month Breakdown drawer below exactly (same source fields/formulas — see forecast-export.ts).
  const exportDetails = useMemo(() => {
    const calendarYearStart = filterYear === 'all' ? 0 : getCalendarYearMonthRange(parseInt(filterYear, 10))[0];
    return filteredData.map((r, i) => {
      const absoluteI = getAbsoluteMonthIndex(i, filterYear, calendarYearStart);
      return buildForecastMonthDetail(r, absoluteI, cardProjectionData as unknown as Parameters<typeof buildForecastMonthDetail>[2]);
    });
  }, [filteredData, filterYear, cardProjectionData]);

  const detailedEvents = useMemo(() => {
    if (filterYear === 'all') return scheduledEvents.slice(0, 100);
    const yr = parseInt(filterYear);
    const now = new Date();
    const [startIdx, endIdx] = getCalendarYearMonthRange(yr, now);
    const start = new Date(now.getFullYear(), now.getMonth() + startIdx, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + endIdx, 0);
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    return scheduledEvents.filter(e => e.date >= startStr && e.date <= endStr).slice(0, 100);
  }, [scheduledEvents, filterYear]);

  const gridStroke = 'hsl(0, 0%, 18%)';
  const tickStyle = { fontSize: 10, fill: 'hsl(240, 4%, 50%)' };
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const xInterval = filterYear === 'all' ? (isMobile ? 5 : 4) : (isMobile ? 2 : 1);

  // Helper to check visibility — a series is visible if NOT in hiddenSeries
  const isVisible = (key: string) => !hiddenSeries.includes(key);

  const retirementProjections = useMemo(() => {
    const prof = profile;
    const retireAccounts = accounts.filter((a) => a.active && RETIRE_TYPES_FORECAST.includes(a.account_type));
    if (retireAccounts.length === 0) return [];

    const paycheckGross = getPaycheckGross(payConfig);
    const paychecksPerYear = payConfig?.frequency === 'biweekly' ? 26 : payConfig?.frequency === 'monthly' ? 12 : 52;

    const deductions: { value: number; mode: 'flat' | 'pct'; accountId?: string }[] =
      Array.isArray(prof?.paycheck_deductions) ? (prof.paycheck_deductions as typeof deductions) : [];

    const retireIds = new Set(retireAccounts.map((a) => a.id as string));
    const today = new Date(syncCutoffDate + 'T00:00:00');
    const transferContribByAccount: Record<string, number> = {};
    for (const r of (rules || [])) {
      if (!r.active) continue;
      if (r.rule_type !== 'transfer' && r.rule_type !== 'investment') continue;
      // Only count rules that are currently in effect — matches the main forecast loop's
      // start_date/end_date handling so this panel doesn't include not-yet-started or
      // already-ended transfers in its forward-looking milestones.
      if (r.start_date && new Date(r.start_date + 'T00:00:00') > today) continue;
      if (r.end_date && new Date(r.end_date + 'T00:00:00') < today) continue;
      const destId = r.deposit_account as string | undefined;
      if (!destId || !retireIds.has(destId)) continue;
      const amt = Number(r.amount);
      const annualCount = r.frequency === 'weekly' ? 52 : r.frequency === 'biweekly' ? 26 : r.frequency === 'yearly' ? 1 : 12;
      const monthly = amt * annualCount / 12;
      transferContribByAccount[destId] = (transferContribByAccount[destId] || 0) + monthly;
    }

    return retireAccounts.map((a) => {
      const apyRate = a.apy_rate != null ? Number(a.apy_rate) : DEFAULT_APY_FORECAST;
      const fromDeductions = monthlyContribForAccount(deductions, a.id, paycheckGross, paychecksPerYear);
      const fromTransfers = transferContribByAccount[a.id] || 0;
      const monthlyContrib = fromDeductions + fromTransfers;
      const milestones = projectMilestones(Number(a.balance), monthlyContrib, apyRate);
      return { account: a, apyRate, monthlyContrib, milestones };
    });
  }, [accounts, profile, rules, payConfig, syncCutoffDate]);

  const freePreview = !isPremium && !isDemo;
  const displayData = freePreview ? filteredData.slice(0, 12) : filteredData;

  if (accountsLoading) return <PageSkeleton />;

  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto space-y-4 sm:space-y-6 lg:space-y-8 overflow-x-hidden">
      {!isDemo && !assumptionsTutorialSeen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)', paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))', paddingLeft: '1rem', paddingRight: '1rem' }}
          onClick={() => setAssumptionsTutorialSeen(true)}
        >
          <div className="card-forged p-5 sm:p-6 w-full max-w-md space-y-4 overflow-y-auto popup-scroll" style={{ maxHeight: '100%' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display font-semibold text-sm flex items-center gap-2"><Settings2 size={14} className="text-primary shrink-0" /> Forecast Assumptions</h2>
              <button onClick={() => setAssumptionsTutorialSeen(true)} className="text-muted-foreground hover:text-foreground p-3 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center"><X size={16} /></button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              These inputs directly drive every number in the 60-month projection. Changing them instantly re-runs the full forecast.
            </p>
            <div className="space-y-2">
              {[
                { label: 'Promotions', desc: 'Schedule a one-time jump to a new annual salary on a specific date. Raises and % bonuses keep applying to the new amount afterward.' },
                { label: 'Income Growth %', desc: 'Annual raise applied to your take-home. 3% means your income increases 3% each year.' },
                { label: 'Investment Growth %', desc: 'Annual return applied to investment account balances in the projection.' },
                { label: 'Savings Interest %', desc: 'Annual APY applied to savings and HYSA account balances.' },
                { label: 'Bonus Income $', desc: 'A one-time annual bonus added to total income, spread evenly across all 12 months.' },
                { label: 'Tax Override %', desc: 'Overrides the default tax rate used to estimate your take-home. Leave at 0 to use your profile rate.' },
              ].map(a => (
                <div key={a.label} className="flex gap-2.5 py-1.5 border-b border-border/30 last:border-0">
                  <span className="text-primary font-bold text-xs shrink-0 mt-0.5">→</span>
                  <div><span className="text-xs font-medium text-foreground">{a.label}: </span><span className="text-xs text-muted-foreground">{a.desc}</span></div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Access assumptions anytime with the <span className="font-medium text-foreground">Assumptions</span> button in the toolbar.</p>
            <button
              onClick={() => setAssumptionsTutorialSeen(true)}
              className="w-full bg-primary text-primary-foreground py-2 text-sm font-semibold btn-press hover:bg-primary/90 transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 sm:gap-3 min-w-0">
          <div className="min-w-0">
            <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Forecast</h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1 truncate">60-month projections driven by live data</p>
          </div>
          <InstructionsModal pageTitle="Forecast Guide" sections={[
            { title: 'What is this page?', body: 'The Forecast projects your cash, debt, investments, and net worth across 60 months using your live accounts, recurring rules, debt payoff plan, savings goals, vehicle funds, and one-time transactions.' },
            { title: 'Three-stage engine', body: 'Each month runs in three stages. Stage 1 applies income and all baseline expenses. Stage 2 looks ahead to known large expenses — holding back extra debt payments early so a future month never falls below your safe floor. Stage 3 takes any cash still above the floor and automatically redirects it to your highest-priority credit card debt.' },
            { title: 'Automatic surplus routing', body: 'When your projected end cash exceeds the Safe Minimum, that surplus is automatically sent to credit card debt — on top of your regular planned payment. Months where surplus fully routed will show end cash pinned near the floor. The CC badge shows the full payment for the month, not just the planned amount.' },
            { title: 'CC payment badge', body: 'The CC badge (e.g. CC $1,318) shows the total cash that goes to credit cards that month — your regular revolving payment plus any surplus automatically added. It rises above the Debt Payoff plan amount in months where extra cash is available above the floor.' },
            { title: 'Look-ahead protection & save-up months', body: 'When a known large expense is coming (car purchase, one-time cost), the engine stops routing surplus to debt in earlier months and lets cash accumulate instead. Regular minimums are always paid — only the extra surplus is held back. You will see end cash stay above the floor in those months.' },
            { title: 'Payment plans on cards', body: 'Buy-now-pay-later or installment plans linked to a credit card (e.g. Amazon) are charged to that card each month — they do not reduce your cash balance directly. The CC payment covers them. Months with active plans show higher card charges and the engine factors them into the revolving balance projection.' },
            { title: 'Card balance popup', body: 'Tapping a month row shows each card\'s projected balance for that month. Revolving cards (Discover, Prime Visa) show the full balance including that month\'s purchases and payment plan charges. The popup tracks the actual balance — not just the carry-over — so it matches what you would see on your statement.' },
            { title: 'Savings & liquid cash', body: 'End Cash reflects only checking and cash accounts — savings, HYSA, and investments are excluded so the engine does not treat them as available for debt payments. Those balances still grow in the Net Worth projection.' },
            { title: 'Cash safety floor', body: 'End Cash enforces the Safe Minimum = max(your cash floor setting, estimated next-month bills due before your next paycheck). Debt payments automatically decrease to stay above this floor. Minimums are always paid first.' },
            { title: 'Charts & legends', body: 'Click any legend item to toggle that data series on or off. Preferences are saved — no refresh needed.' },
          ]} />
        </div>
        <div className="grid grid-cols-1 sm:flex gap-2 w-full sm:w-auto">
          <button onClick={() => setChartMode(chartMode === 'combo' ? 'line' : 'combo')}
            className="w-full sm:w-auto min-w-0 flex items-center justify-center gap-1.5 bg-secondary border border-border px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}>
            <TrendingUp size={12} /> {chartMode === 'combo' ? 'Line' : 'Bars'}
          </button>
          <button onClick={() => setViewMode(viewMode === 'monthly' ? 'detailed' : 'monthly')}
            className="w-full sm:w-auto min-w-0 flex items-center justify-center gap-1.5 bg-secondary border border-border px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}>
            {viewMode === 'monthly' ? <List size={12} /> : <BarChart3 size={12} />} {viewMode === 'monthly' ? 'Detail' : 'Summary'}
          </button>
          <button onClick={() => setShowAssumptions(!showAssumptions)} className="w-full sm:w-auto min-w-0 flex items-center justify-center gap-1.5 bg-secondary border border-border px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}>
            <Settings2 size={12} /> Assumptions
          </button>
          {(isPremium || isDemo) ? (
            <>
              <button
                onClick={async () => {
                  const label = filterYear === 'all' ? 'All 60 Months' : String(getCalendarYearLabel(parseInt(filterYear, 10)));
                  await exportForecastPdf(filteredData.map((r) => ({
                    month: r.month,
                    takeHome: r.takeHome ?? 0,
                    totalExpenses: r.totalExpenses ?? 0,
                    debtPayment: r.debtPayment ?? 0,
                    liquidCash: r.liquidCash ?? 0,
                    endingCash: r.endingCash ?? 0,
                    netWorth: r.netWorth ?? 0,
                    debtBalance: r.debtBalance ?? 0,
                    savingsBalance: r.savingsBalance ?? 0,
                  } as ForecastRow)), label, exportDetails);
                }}
                className="w-full sm:w-auto min-w-0 flex items-center justify-center gap-1.5 bg-secondary border border-border px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-medium btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <FileDown size={12} /> PDF
              </button>
              <button
                onClick={async () => {
                  await exportForecastCsv(filteredData.map((r): ForecastRow => ({
                    month: r.month,
                    takeHome: r.takeHome ?? 0,
                    totalExpenses: r.totalExpenses ?? 0,
                    debtPayment: r.debtPayment ?? 0,
                    liquidCash: r.liquidCash ?? 0,
                    endingCash: r.endingCash ?? 0,
                    netWorth: r.netWorth ?? 0,
                    debtBalance: r.debtBalance ?? 0,
                    savingsBalance: r.savingsBalance ?? 0,
                  })), exportDetails);
                }}
                className="w-full sm:w-auto min-w-0 flex items-center justify-center gap-1.5 bg-secondary border border-border px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-medium btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <FileDown size={12} /> CSV
              </button>
            </>
          ) : (
            <>
              <Link
                to="/premium"
                className="w-full sm:w-auto min-w-0 flex items-center justify-center gap-1.5 border border-primary/30 text-primary/70 px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-medium btn-press hover:bg-primary/5 transition-colors"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <FileDown size={12} /> PDF
              </Link>
              <Link
                to="/premium"
                className="w-full sm:w-auto min-w-0 flex items-center justify-center gap-1.5 border border-primary/30 text-primary/70 px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-medium btn-press hover:bg-primary/5 transition-colors"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <FileDown size={12} /> CSV
              </Link>
            </>
          )}
        </div>
      </div>

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-3">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-foreground">60-month simulation — every data source feeding one projection</p>
              <p className="text-xs text-muted-foreground mt-0.5">The Forecast is where everything converges: income rules, debt payments, savings transfers, and one-time transactions all play out month by month.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: '3-pass engine', desc: 'PASS 1 builds base values. PASS 2 looks ahead and pre-saves cash for future one-time expenses. PASS 3 pushes all surplus above the cash floor to debt.' },
              { label: 'End cash at floor', desc: 'While CC debt exists, end cash lands exactly at $1,000 each month — no idle cash. The June car purchase causes PASS 2 to pre-save in April and May.' },
              { label: 'Debt payoff trajectory', desc: 'The debt chart shows each card\'s balance declining month by month. Sapphire goes first (22.99% APR), then Discover gets the full surplus.' },
              { label: 'Assumptions panel', desc: 'Adjust income growth, investment return, and savings interest to model different scenarios over 5 years.' },
            ].map((f, i) => (
              <div key={i} className="flex flex-col gap-2 w-full sm:w-auto sm:flex-row p-2.5 bg-secondary/40 text-xs" style={{ borderRadius: 'var(--radius)' }}>
                <span className="text-primary font-bold shrink-0">→</span>
                <div className="min-w-0"><span className="font-medium text-foreground">{f.label}: </span><span className="text-muted-foreground">{f.desc}</span></div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">All data is fictional.</p>
            <Link to="/auth" className="text-xs font-semibold text-primary hover:underline">Use with your own data →</Link>
          </div>
        </div>
      )}

      {showAssumptions && (
        <div className="card-forged p-3 sm:p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Forecast Assumptions</h3>
            <button onClick={() => setShowAssumptions(false)} className="text-muted-foreground hover:text-foreground transition-colors p-3 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center"><X size={14} /></button>
          </div>

          {/* Growth & Returns */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Growth & Returns</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(
                [
                  { key: 'investmentGrowth', label: 'Investment %' },
                  { key: 'savingsInterest', label: 'Savings Interest %' },
                ] as { key: 'investmentGrowth' | 'savingsInterest'; label: string }[]
              ).map(({ key, label }) => (
                <div key={key}>
                  <label className="text-[9px] text-muted-foreground uppercase">{label}</label>
                  <input type="number" value={assumptions[key]}
                    onChange={e => setAssumptions(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                    className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step="0.1" />
                </div>
              ))}
            </div>
          </div>

          {/* Promotions */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Promotions</p>
            <div className="space-y-2">
              {assumptions.promotions.map(promo => (
                <div key={promo.id} className="border border-border/40 p-2" style={{ borderRadius: 'var(--radius)' }}>
                  <div className="flex items-start justify-between gap-1 mb-1.5">
                    <span className="text-xs font-semibold text-foreground">Promotion</span>
                    <button
                      onClick={() => setAssumptions(prev => ({ ...prev, promotions: prev.promotions.filter(p => p.id !== promo.id) }))}
                      className="text-muted-foreground hover:text-destructive shrink-0 p-1.5 -mr-1.5" title="Remove promotion">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] text-muted-foreground uppercase">Effective Date</label>
                      <input type="date" value={promo.effectiveDate}
                        onChange={e => setAssumptions(prev => ({ ...prev, promotions: prev.promotions.map(p => p.id === promo.id ? { ...p, effectiveDate: e.target.value } : p) }))}
                        className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} />
                    </div>
                    <div>
                      <label className="text-[9px] text-muted-foreground uppercase">New Annual Salary</label>
                      <input type="number" value={promo.newAnnualSalary || ''}
                        onChange={e => setAssumptions(prev => ({ ...prev, promotions: prev.promotions.map(p => p.id === promo.id ? { ...p, newAnnualSalary: parseFloat(e.target.value) || 0 } : p) }))}
                        className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step="1000" placeholder="$" />
                    </div>
                  </div>
                </div>
              ))}
              <button
                onClick={() => setAssumptions(prev => ({ ...prev, promotions: [...prev.promotions, { id: crypto.randomUUID(), effectiveDate: '', newAnnualSalary: 0 }] }))}
                className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors">
                <Plus size={13} /> Add Promotion
              </button>
              {assumptions.promotions.length > 0 && (
                <p className="text-[10px] text-muted-foreground">Snaps your projected salary to the new amount starting that month — raises and % bonuses continue applying to the new value afterward.</p>
              )}
            </div>
          </div>

          {/* Income Growth / Annual Raise */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setAssumptions(prev => ({ ...prev, incomeGrowthEnabled: !prev.incomeGrowthEnabled }))}
                className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${assumptions.incomeGrowthEnabled ? 'bg-primary' : 'bg-border'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full transition-transform ${assumptions.incomeGrowthEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Annual Raise</p>
            </div>
            <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 transition-opacity ${assumptions.incomeGrowthEnabled ? 'opacity-100' : 'opacity-50'}`}>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase">Mode</label>
                <div className="flex mt-1 border border-border overflow-hidden" style={{ borderRadius: 'var(--radius)' }}>
                  {(['pct', 'flat'] as const).map(m => (
                    <button key={m}
                      onClick={() => setAssumptions(prev => ({ ...prev, raiseMode: m }))}
                      className={`flex-1 py-1.5 text-xs font-medium transition-colors ${assumptions.raiseMode === m ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
                      {m === 'pct' ? '%' : '$'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase">{assumptions.raiseMode === 'flat' ? 'Raise $/yr' : 'Raise %'}</label>
                <input type="number" value={assumptions.incomeGrowth}
                  onChange={e => setAssumptions(prev => ({ ...prev, incomeGrowth: parseFloat(e.target.value) || 0 }))}
                  className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step={assumptions.raiseMode === 'flat' ? '500' : '0.1'} />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase">Effective Month</label>
                <select value={assumptions.raiseMonth}
                  onChange={e => setAssumptions(prev => ({ ...prev, raiseMonth: parseInt(e.target.value) }))}
                  className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }}>
                  {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, idx) => (
                    <option key={m} value={idx + 1}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end pb-1">
                <p className="text-[10px] text-muted-foreground">Applied once per year in the selected month.</p>
              </div>
            </div>
          </div>

          {/* Bonus */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setAssumptions(prev => ({ ...prev, bonusEnabled: !prev.bonusEnabled }))}
                className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${assumptions.bonusEnabled ? 'bg-primary' : 'bg-border'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full transition-transform ${assumptions.bonusEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Expected Bonus</p>
            </div>
            <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 transition-opacity ${assumptions.bonusEnabled ? 'opacity-100' : 'opacity-50'}`}>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase">Mode</label>
                <select value={assumptions.bonusMode}
                  onChange={e => setAssumptions(prev => ({ ...prev, bonusMode: e.target.value as 'flat' | 'pct' }))}
                  className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }}>
                  <option value="flat">Flat $</option>
                  <option value="pct">% of Income</option>
                </select>
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase">{assumptions.bonusMode === 'pct' ? 'Bonus %' : 'Bonus $'}</label>
                <input type="number" value={assumptions.bonusAmount}
                  onChange={e => setAssumptions(prev => ({ ...prev, bonusAmount: parseFloat(e.target.value) || 0 }))}
                  className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step={assumptions.bonusMode === 'pct' ? '0.1' : '100'} />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase">Paid In</label>
                <select value={assumptions.bonusMonth}
                  onChange={e => setAssumptions(prev => ({ ...prev, bonusMonth: parseInt(e.target.value) }))}
                  className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }}>
                  {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, idx) => (
                    <option key={m} value={idx + 1}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col justify-end gap-1">
                <label className="text-[9px] text-muted-foreground uppercase">Recurring</label>
                <button
                  onClick={() => setAssumptions(prev => ({ ...prev, bonusRecurring: !prev.bonusRecurring }))}
                  className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1.5 border transition-colors ${assumptions.bonusRecurring ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground'}`}
                  style={{ borderRadius: 'var(--radius)' }}>
                  {assumptions.bonusRecurring ? 'Every year' : 'One time'}
                </button>
              </div>
            </div>
          </div>

          {/* Tax Return Estimator */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAssumptions(prev => ({ ...prev, taxReturnEnabled: !prev.taxReturnEnabled }))}
                  className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${assumptions.taxReturnEnabled ? 'bg-primary' : 'bg-border'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full transition-transform ${assumptions.taxReturnEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tax Return Estimator</p>
              </div>
            </div>
            <div className={`space-y-3 transition-opacity ${assumptions.taxReturnEnabled ? 'opacity-100' : 'opacity-50'}`}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-[9px] text-muted-foreground uppercase">Filing Status</label>
                  <select value={assumptions.taxReturnFilingStatus}
                    onChange={e => setAssumptions(prev => ({ ...prev, taxReturnFilingStatus: e.target.value as FilingStatus }))}
                    className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }}>
                    <option value="single">Single</option>
                    <option value="mfj">Married Filing Jointly</option>
                    <option value="mfs">Married Filing Sep.</option>
                    <option value="hoh">Head of Household</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9px] text-muted-foreground uppercase">Dependents (&lt;17)</label>
                  <input type="number" min={0} max={10} value={assumptions.taxReturnDependents}
                    onChange={e => setAssumptions(prev => ({ ...prev, taxReturnDependents: parseInt(e.target.value) || 0 }))}
                    className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step="1" />
                </div>
                <div>
                  <label className="text-[9px] text-muted-foreground uppercase">State</label>
                  <select value={assumptions.taxReturnState}
                    onChange={e => setAssumptions(prev => ({ ...prev, taxReturnState: e.target.value }))}
                    className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }}>
                    {[['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],['DC','Washington DC']].map(([code, name]) => {
                      const rate = STATE_TAX_RATES[code] ?? 0;
                      const rateLabel = rate === 0 ? '0%' : `${(rate * 100).toFixed(1).replace(/\.0$/, '')}%`;
                      return <option key={code} value={code}>{name} ({rateLabel})</option>;
                    })}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] text-muted-foreground uppercase">Refund Month</label>
                  <select value={assumptions.taxReturnMonth}
                    onChange={e => setAssumptions(prev => ({ ...prev, taxReturnMonth: parseInt(e.target.value) }))}
                    className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }}>
                    {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, idx) => (
                      <option key={m} value={idx + 1}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[9px] text-muted-foreground uppercase">Fed. Withheld/yr (0 = auto-detect)</label>
                  <input type="number" value={assumptions.taxReturnFederalWithheld}
                    onChange={e => setAssumptions(prev => ({ ...prev, taxReturnFederalWithheld: parseFloat(e.target.value) || 0 }))}
                    className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step="100" />
                </div>
                <div>
                  <label className="text-[9px] text-muted-foreground uppercase">Override Refund $ (0 = estimate)</label>
                  <input type="number" value={assumptions.taxReturnAmountOverride}
                    onChange={e => setAssumptions(prev => ({ ...prev, taxReturnAmountOverride: parseFloat(e.target.value) || 0 }))}
                    className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step="100" />
                </div>
                {taxRefundPreview && (
                  <div className="flex flex-col justify-end">
                    <p className="text-[9px] text-muted-foreground uppercase mb-1">Tax Estimate</p>
                    <div className={`px-2 py-1.5 text-xs border ${taxRefundPreview.totalRefund >= 0 ? 'bg-primary/5 border-primary/20' : 'bg-destructive/5 border-destructive/20'}`} style={{ borderRadius: 'var(--radius)' }}>
                      <span className="text-muted-foreground">Fed </span>
                      <span className="font-display font-bold text-foreground">{formatCurrency(Math.abs(taxRefundPreview.federalRefund), false)}</span>
                      {taxRefundPreview.stateRefund !== 0 && (
                        <><span className="text-muted-foreground ml-2">State </span>
                        <span className="font-display font-bold text-foreground">{formatCurrency(Math.abs(taxRefundPreview.stateRefund), false)}</span></>
                      )}
                      <div className={`mt-0.5 font-display font-bold ${taxRefundPreview.totalRefund >= 0 ? 'text-primary' : 'text-destructive'}`}>
                        {taxRefundPreview.totalRefund >= 0 ? 'Est. Refund ' : 'Est. Owed '}
                        {formatCurrency(Math.abs(taxRefundPreview.totalRefund), false)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">Estimate uses 2025 federal brackets, standard deduction, and child tax credit. State uses a simplified flat rate. Injected as income in the selected month every year.</p>
            </div>
          </div>

          {/* Plan Impact Note */}
          <div className="border-t border-border/50 pt-3 space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Impact on Your Financial Plan</p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Income growth applies to both this Forecast and the Debt Payoff tab's future-month payment schedule. A higher raise accelerates your payoff timeline. Bonus and tax return amounts are injected as one-time income and also shift how quickly balances drop.
            </p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Investment return and savings interest rates only affect net worth and account growth projections here — they do not change what flows to debt payoff.
            </p>
          </div>

          {/* 5-Year Projection Summary */}
          {yearlyProjections.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Projected Estimates</p>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {yearlyProjections.map(yr => (
                  <div key={yr.year} className="bg-secondary/50 border border-border/50 px-2.5 py-2 space-y-1" style={{ borderRadius: 'var(--radius)' }}>
                    <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Year {yr.year}</p>
                    <div>
                      <p className="text-[9px] text-muted-foreground">Monthly Take-Home</p>
                      <p className="text-xs font-display font-bold text-foreground">{formatCurrency(yr.monthlyTakeHome, false)}</p>
                    </div>
                    {yr.bonus > 0 && (
                      <div>
                        <p className="text-[9px] text-muted-foreground">Bonus</p>
                        <p className="text-xs font-display font-bold text-success">{formatCurrency(yr.bonus, false)}</p>
                      </div>
                    )}
                    {yr.taxReturn !== 0 && (
                      <div>
                        <p className="text-[9px] text-muted-foreground">{yr.taxReturn > 0 ? 'Tax Return' : 'Tax Owed'}</p>
                        <p className={`text-xs font-display font-bold ${yr.taxReturn > 0 ? 'text-primary' : 'text-destructive'}`}>{formatCurrency(Math.abs(yr.taxReturn), false)}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Year Filter — premium only */}
      {!freePreview && (
        <div className="flex gap-1.5 sm:gap-2 overflow-x-auto w-full pb-1">
          {(['all', '1', '2', '3', '4', '5'] as const).map(yr => (
            <button key={yr} onClick={() => setFilterYear(yr)} className={`px-3 sm:px-4 py-1 sm:py-1.5 text-xs font-medium border btn-press whitespace-nowrap ${filterYear === yr ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`} style={{ borderRadius: 'var(--radius)' }}>
              {yr === 'all' ? 'All 60 Months' : getCalendarYearLabel(parseInt(yr, 10))}
            </button>
          ))}
        </div>
      )}

      {/* Milestones */}
      {projections.milestones.length > 0 && (
        <div className="card-forged p-3 sm:p-4 space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Milestones</h3>
          <div className="flex flex-wrap gap-2">
            {projections.milestones.map((m, i) => (
              <span key={i} className="bg-primary/10 text-primary px-2 sm:px-3 py-1 text-xs font-medium" style={{ borderRadius: 'var(--radius)' }}>
                {m.month}: {m.event}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Safe minimum override notice — shown when fixed monthly obligations exceed user cash floor */}
      {prePaycheckBillsInfo.total > debtPayoffOptions.cashFloor && (
        <div className="flex items-start gap-2.5 bg-primary/5 border border-primary/20 px-3 py-2.5 text-xs" style={{ borderRadius: 'var(--radius)' }}>
          <Info size={13} className="text-primary shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              Cash floor raised to {formatCurrency(Math.max(debtPayoffOptions.cashFloor, prePaycheckBillsInfo.total), false)} — monthly obligations exceed your {formatCurrency(debtPayoffOptions.cashFloor, false)} floor setting.
            </p>
            {prePaycheckBillsInfo.items.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                {prePaycheckBillsInfo.items.map((item, idx) => (
                  <span key={idx}>{item.name} — {formatCurrency(item.amount, false)} (due {item.dueDay}th)</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {viewMode === 'monthly' ? (
        <>
          {/* Net Worth Chart */}
          <div className="card-forged p-3 sm:p-5 min-w-0 overflow-x-hidden">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-3 sm:mb-4">
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Net Worth & Assets Projection</h3>
                <p className="text-[9px] text-muted-foreground mt-0.5">Click legend items to show or hide series</p>
              </div>
              {freePreview && <span className="text-[9px] text-muted-foreground">Showing 12 of 60 months</span>}
            </div>
            <ResponsiveContainer width="100%" height={window.innerWidth < 640 ? 220 : 260}>
              {chartMode === 'combo' ? (
                <ComposedChart data={displayData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ ...tickStyle, textAnchor: 'end' }} angle={-45} height={50} interval={xInterval} />
                  <YAxis tick={tickStyle} tickFormatter={formatYAxisTick} />
                  <Tooltip content={<ForecastTooltip />} />
                  <Legend onClick={e => toggleSeries(e.dataKey as string)} formatter={(value, entry) => (
                    <span style={{ color: hiddenSeries.includes(entry.dataKey as string) ? '#555' : entry.color, cursor: 'pointer', fontSize: 10 }}>{value}</span>
                  )} wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="netWorth" name="Net Worth" stroke="hsl(47, 100%, 50%)" strokeWidth={2.5} dot={false} strokeOpacity={isVisible('netWorth') ? 1 : 0} />
                  <Bar dataKey="totalAssets" name="Assets" fill="hsl(142, 71%, 45%)" opacity={isVisible('totalAssets') ? 0.3 : 0} />
                  <Bar dataKey="totalLiabilities" name="Liabilities" fill="hsl(0, 84%, 60%)" opacity={isVisible('totalLiabilities') ? 0.3 : 0} />
                  <Line type="monotone" dataKey="retirementBalance" name="Retirement" stroke="hsl(262, 83%, 58%)" strokeWidth={1.5} dot={false} strokeOpacity={isVisible('retirementBalance') ? 1 : 0} />
                  <Line type="monotone" dataKey="endingCash" name="Ending Cash" stroke="hsl(199, 89%, 48%)" strokeWidth={1.5} dot={false} strokeDasharray="5 5" strokeOpacity={isVisible('endingCash') ? 1 : 0} />
                </ComposedChart>
              ) : (
                <LineChart data={displayData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ ...tickStyle, textAnchor: 'end' }} angle={-45} height={50} interval={xInterval} />
                  <YAxis tick={tickStyle} tickFormatter={formatYAxisTick} />
                  <Tooltip content={<ForecastTooltip />} />
                  <Legend onClick={e => toggleSeries(e.dataKey as string)} formatter={(value, entry) => (
                    <span style={{ color: hiddenSeries.includes(entry.dataKey as string) ? '#555' : entry.color, cursor: 'pointer', fontSize: 10 }}>{value}</span>
                  )} wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="netWorth" name="Net Worth" stroke="hsl(47, 100%, 50%)" strokeWidth={2.5} dot={false} strokeOpacity={isVisible('netWorth') ? 1 : 0} />
                  <Line type="monotone" dataKey="investmentBalance" name="Investments" stroke="hsl(142, 71%, 45%)" strokeWidth={1.5} dot={false} strokeOpacity={isVisible('investmentBalance') ? 1 : 0} />
                  <Line type="monotone" dataKey="retirementBalance" name="Retirement" stroke="hsl(262, 83%, 58%)" strokeWidth={1.5} dot={false} strokeOpacity={isVisible('retirementBalance') ? 1 : 0} />
                  <Line type="monotone" dataKey="savingsBalance" name="Savings" stroke="hsl(199, 89%, 48%)" strokeWidth={1.5} dot={false} strokeOpacity={isVisible('savingsBalance') ? 1 : 0} />
                  <Line type="monotone" dataKey="endingCash" name="Ending Cash" stroke="hsl(30, 100%, 50%)" strokeWidth={1.5} dot={false} strokeDasharray="5 5" strokeOpacity={isVisible('endingCash') ? 1 : 0} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>

          {/* Premium upgrade CTA — free users only */}
          {freePreview && (
            <div className="card-forged p-4 sm:p-5 overflow-hidden sm:p-6 flex flex-col items-center text-center gap-3 border border-primary/20">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Crown size={18} className="text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">Unlock years 2-5</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">You have year 1 free. Upgrade to Premium to unlock all 60 months, the CC debt payoff trajectory chart, and PDF export.</p>
              </div>
              <Link
                to="/premium"
                className="bg-primary text-primary-foreground px-5 py-2 text-xs font-semibold btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                Unlock Full Forecast
              </Link>
            </div>
          )}


          {/* Monthly Cash Flow Table */}
          {<div className="card-forged p-3 sm:p-5">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Monthly Breakdown</h3>
              <div className="text-right">
                <span className="text-[9px] text-muted-foreground block">Tap any row for full breakdown</span>
                <span className="text-[9px] text-muted-foreground/60 block">1× = one-time purchase or income</span>
              </div>
            </div>
            {/* Column headers */}
            <div className="grid grid-cols-[5rem_1fr_1fr_1fr] border-b border-border pb-1.5 mb-0.5 text-[9px] text-muted-foreground uppercase tracking-wider font-medium">
              <div className="px-1">Month</div>
              <div className="px-1 text-right">+Income</div>
              <div className="px-1 text-right">−Out</div>
              <div className="px-1 text-right">End Cash</div>
            </div>
            {/* Rows */}
            {displayData.map((row, i) => {
              const openDrawer = () => {
                const isCurrentMonth = i === 0 && (filterYear === 'all' || filterYear === '1');
                const paychecksPerYear = payConfig?.frequency === 'biweekly' ? 26 : payConfig?.frequency === 'monthly' ? 12 : 52;
                // Use actual paycheck count for this month — dividing by normalized 52/12 gives wrong
                // per-check (e.g. 4-Friday month ÷ 4.33 shows raise as lower than pre-raise amount).
                const absoluteI = filterYear === 'all' ? i : getCalendarYearMonthRange(parseInt(filterYear, 10))[0] + i;
                const _rowDate = new Date(new Date().getFullYear(), new Date().getMonth() + absoluteI, 1);
                const paycheckCount = getPaychecksInMonth(payConfig, _rowDate.getFullYear(), _rowDate.getMonth()).length;
                const perPaycheck = paycheckCount > 0
                  ? Math.round((row.paycheckIncome ?? row.takeHome) / paycheckCount)
                  : Math.round((row.paycheckIncome ?? row.takeHome) / (paychecksPerYear / 12));
                const freqLabel = payConfig?.frequency === 'biweekly' ? 'biweekly' : payConfig?.frequency === 'monthly' ? 'monthly' : 'weekly';
                setCalcDrawer({
                  title: `${row.month} Breakdown`,
                  lines: [
                    ...(isCurrentMonth ? [{ label: '⏱ Reflects remaining of month — settled transactions excluded', value: '' }] : []),
                    ...(row.isRaiseMonth ? [{ label: `⬆ Raise applied — new ${freqLabel} paycheck: ${formatCurrency(perPaycheck, false)}`, value: '' }] : []),
                    ...((row.promotionNewSalary ?? 0) > 0 ? [{ label: `💼 Promotion applied — new annual salary: ${formatCurrency(row.promotionNewSalary, false)}`, value: '' }] : []),
                    { label: isCurrentMonth ? 'Current Cash' : 'Starting Cash', value: formatCurrency(row.startingCash, false) },
                    { label: 'Paycheck', value: formatCurrency(row.paycheckIncome ?? row.takeHome, false), op: '+' },
                    ...((row.otherIncome ?? 0) > 0 ? [{ label: 'Other Income', value: formatCurrency(row.otherIncome, false), op: '+' }] : []),
                    ...((row.bonusIncome ?? 0) > 0 ? [{ label: 'Bonus', value: formatCurrency(row.bonusIncome, false), op: '+' }] : []),
                    ...((row.taxReturnIncome ?? 0) !== 0 ? [(row.taxReturnIncome ?? 0) > 0
                      ? { label: 'Tax Return', value: formatCurrency(row.taxReturnIncome, false), op: '+' }
                      : { label: 'Tax Owed', value: formatCurrency(Math.abs(row.taxReturnIncome), false), op: '−' }] : []),
                    { label: '  Bills & Expenses', value: formatCurrency(row.baseExpenses ?? 0, false), op: '−' },
                    // Per-card breakdown: month 0 uses engine recommendations (same source as
                    // Dashboard widget and Debt Payoff summary list). Months 1+ use simulation.
                    ...((() => {
                      const fallback = [{ label: '  Debt Payments', value: formatCurrency(row.displayDebtPayment ?? row.debtPayment, false), op: '−' as const }];
                      // Month 0: use pass-3 per-card amounts (same source as Debt Payoff tab)
                      if (absoluteI === 0 && cardProjectionData?.month0?.perCardAdjusted) {
                        const engineRecs = cardProjectionData.month0.perCardAdjusted.filter(r => r.payment > 0);
                        if (engineRecs.length > 0) {
                          return engineRecs.map(r => ({ label: `  ${r.name}`, value: formatCurrency(r.payment, false), op: '−' as const }));
                        }
                        return fallback;
                      }
                      // Months 1+: use simulation amounts
                      const perCard = cardProjectionData?.perCardPaymentsScaled ?? cardProjectionData?.perCardPayments;
                      if (!perCard) return fallback;
                      const rawAmounts = perCard
                        .map(c => ({ name: c.name, amt: c.payments[absoluteI] ?? 0 }))
                        .filter(c => c.amt > 0);
                      if (rawAmounts.length === 0) return fallback;
                      // perCardPaymentsScaled never reflects this page's own save-up cap (a future
                      // month's larger obligation can shrink row.debtPayment well below the engine's
                      // natural per-card recommendation) — scale each line proportionally so the
                      // breakdown always sums to what was actually paid that month, not a bigger
                      // number than the cash math (row.endingCash etc.) ever used.
                      const rawSum = rawAmounts.reduce((s, c) => s + c.amt, 0);
                      const scale = rawSum > 0 ? (row.debtPayment ?? rawSum) / rawSum : 1;
                      const lines = rawAmounts
                        .map(c => ({ label: `  ${c.name}`, value: formatCurrency(c.amt * scale, false), op: '−' as const, scaledAmt: c.amt * scale }))
                        .filter(c => c.scaledAmt > 0.005)
                        .map(({ scaledAmt, ...c }) => c);
                      return lines.length > 0 ? lines : fallback;
                    })()),
                    { label: '  Adjusted to keep cash safely above your floor through upcoming bills. May be lower than the Debt Payoff tab\'s recommendation for the same month.', value: '' },
                    ...((row.savingsGoalItems?.length > 0)
                      ? (row.savingsGoalItems as { name: string; amount: number }[]).map(g => ({ label: `  ${g.name}`, value: formatCurrency(g.amount, false), op: '−' as const }))
                      : (row.savingsContrib ?? 0) > 0 ? [{ label: '  Savings Goals', value: formatCurrency(row.savingsContrib, false), op: '−' as const }] : []
                    ),
                    // Still-saving months: informational only — this cash hasn't left any account
                    // yet (see cumulativeCarReserveHeld adding it back into Ending Cash). The
                    // purchase month itself is a real outflow — show it as a normal subtracted
                    // line since the cumulative add-back nets to zero that month.
                    ...((row.carContribItems as { name: string; amount: number; isPurchaseMonth: boolean }[] | undefined)?.length
                      ? (row.carContribItems as { name: string; amount: number; isPurchaseMonth: boolean }[]).map(v => v.isPurchaseMonth
                          ? { label: `  ${v.name} (down payment)`, value: formatCurrency(v.amount, false), op: '−' as const }
                          : { label: `  Reserving for ${v.name} (still your cash)`, value: formatCurrency(v.amount, false) })
                      : (row.carContrib ?? 0) > 0 ? [{ label: '  Reserving for car fund (still your cash)', value: formatCurrency(row.carContrib, false) }] : []
                    ),
                    ...((row.mortgagePayment ?? 0) > 0 ? [{ label: '  Mortgage Payment', value: formatCurrency(row.mortgagePayment, false), op: '−' }] : []),
                    ...((row.carLoanPayment ?? 0) > 0 ? [{ label: '  Car Loan Payments', value: formatCurrency(row.carLoanPayment, false), op: '−' }] : []),
                    ...((row.vehicleDownPayment ?? 0) > 0 ? [{ label: '  Vehicle Down Payment (cash)', value: formatCurrency(row.vehicleDownPayment, false), op: '−' }] : []),
                    ...((row.vehicleInsurance ?? 0) > 0 ? [{ label: '  Vehicle Insurance (est.)', value: formatCurrency(row.vehicleInsurance, false), op: '−' }] : []),
                    ...((row.projectedCarLoan ?? 0) > 0 ? [{ label: '  Est. Car Loan (projected)', value: formatCurrency(row.projectedCarLoan, false), op: '−' }] : []),
                    ...((row.carLumpItems as { name: string; amount: number }[] | undefined)?.length
                      ? (row.carLumpItems as { name: string; amount: number }[]).map(v => ({ label: `  ${v.name} — Extra Payment`, value: formatCurrency(v.amount, false), op: '−' as const }))
                      : (row.carLoanExtraPayment ?? 0) > 0 ? [{ label: '  Car Loan Extra Payment', value: formatCurrency(row.carLoanExtraPayment, false), op: '−' as const }] : []
                    ),
                    ...((row.lumpSumSavings ?? 0) > 0 ? [{ label: '  Lump Sum → Savings', value: formatCurrency(row.lumpSumSavings, false), op: '−' }] : []),
                    ...((row.lumpSumBrokerage ?? 0) > 0 ? [{ label: '  Lump Sum → Brokerage', value: formatCurrency(row.lumpSumBrokerage, false), op: '−' }] : []),
                    ...((row.lumpSumRothIra ?? 0) > 0 ? [{ label: '  Lump Sum → Roth IRA', value: formatCurrency(row.lumpSumRothIra, false), op: '−' }] : []),
                    ...((row.transferBreakdown ?? [])
                      .filter((t: { name: string; amount: number }) => t.amount > 0)
                      .map((t: { name: string; amount: number }) => ({ label: `  ${t.name}`, value: formatCurrency(t.amount, false), op: '−' as const }))),
                    ...((row.businessContrib ?? 0) > 0
                      ? [{ label: '  Business Contributions', value: formatCurrency(row.businessContrib, false), op: '−' }]
                      : []),
                    { label: 'One-Time Net (Cash)', value: formatCurrency(Math.abs(row.oneTimeNet || 0), false), op: (row.oneTimeNet || 0) >= 0 ? '+' : '−' },
                    { label: 'Ending Cash', value: formatCurrency(row.endingCash, false), op: '=' },
                    ...((row.carReserveHeld ?? 0) > 0
                      ? [{ label: `  includes ${formatCurrency(row.carReserveHeld, false)} reserved for an upcoming vehicle purchase`, value: '' }]
                      : []),
                    {
                      label: 'Cash Floor',
                      value: formatCurrency(row.monthMinSafe, false),
                      onClick: () => {
                        const items: { name: string; amount: number; dueDay?: number }[] = row.floorItems ?? [];
                        const preTotal = row.prePaycheckBillsTotal ?? 0;
                        const settingsFloor = row.settingsCashFloor ?? 0;
                        const savingCarFunds = (carFunds ?? []).filter((cf) => cf.phase === 'saving');
                        setFloorCalcDrawer({
                          title: `${row.month} — Cash Floor`,
                          lines: [
                            { label: 'Settings floor', value: formatCurrency(settingsFloor, false) },
                            { label: '', value: '' },
                            ...(items.length > 0
                              ? [
                                  { label: 'Fixed monthly obligations (next mo.):', value: '' },
                                  ...items.map((it) => ({
                                    label: `  ${it.name}${it.dueDay ? ` (day ${it.dueDay})` : ''}`,
                                    value: formatCurrency(it.amount, false),
                                    op: '+' as const,
                                  })),
                                  { label: 'Obligations total', value: formatCurrency(preTotal, false), op: '=' },
                                ]
                              : [{ label: 'No fixed obligations this month', value: '' }]),
                            { label: '', value: '' },
                            { label: 'Cash Floor (higher of above)', value: formatCurrency(row.monthMinSafe, false), op: '=' },
                            ...(savingCarFunds.length > 0
                              ? [
                                  { label: '', value: '' },
                                  { label: 'Saving toward vehicle purchase:', value: '' },
                                  ...savingCarFunds.map((cf) => ({
                                    label: `  ${cf.vehicle_name ?? 'Vehicle'}${cf.planned_purchase_date ? ` — target ${new Date(cf.planned_purchase_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : ''}`,
                                    value: '',
                                  })),
                                ]
                              : []),
                          ],
                        });
                      },
                    },
                    { label: '', value: '' },
                    ...((row.nonCashTransferItems as { name: string; fromAcctName: string; amount: number }[] | undefined)?.length
                      ? [
                          { label: 'Account Transfers (no cash impact)', value: '' },
                          ...(row.nonCashTransferItems as { name: string; fromAcctName: string; amount: number }[]).map(item => ({
                            label: `  ${item.name}${item.fromAcctName ? ` — from ${item.fromAcctName}` : ''}`,
                            value: formatCurrency(item.amount, false),
                          })),
                          { label: '', value: '' },
                        ]
                      : []),
                    ...((row.otherAccountExpenseItems as { name: string; fromAcctName: string; amount: number }[] | undefined)?.length
                      ? [
                          { label: 'Other Account Expenses (no cash impact)', value: '' },
                          ...(row.otherAccountExpenseItems as { name: string; fromAcctName: string; amount: number }[]).map(item => ({
                            label: `  ${item.name}${item.fromAcctName ? ` — from ${item.fromAcctName}` : ''}`,
                            value: formatCurrency(item.amount, false),
                          })),
                          { label: '', value: '' },
                        ]
                      : []),
                    ...((row.assetBreakdown ?? []) as { bucket: string; id: string; name: string; balance: number }[])
                      .filter(a => a.bucket === 'retirement')
                      .map(a => ({ label: `  ${a.name}`, value: formatCurrency(a.balance, false) })),
                    ...((row.assetBreakdown ?? []) as { bucket: string; id: string; name: string; balance: number }[])
                      .filter(a => a.bucket === 'investment')
                      .map(a => ({ label: `  ${a.name}`, value: formatCurrency(a.balance, false) })),
                    ...((row.assetBreakdown ?? []) as { bucket: string; id: string; name: string; balance: number }[])
                      .filter(a => a.bucket === 'savings')
                      .map(a => ({ label: `  ${a.name}`, value: formatCurrency(a.balance, false) })),
                    { label: 'Total Assets', value: formatCurrency(row.totalAssets, false) },
                    { label: '', value: '' },
                    { label: 'CC Purchases', value: (row.totalCCPurchases ?? 0) > 0 ? formatCurrency(row.totalCCPurchases, false) : '—' },
                    ...((cardProjectionData?.simCards ?? []) as { id: string; name: string }[])
                      .map(card => ({
                        label: `  ${card.name}`,
                        value: (() => {
                          // Detect revolving vs cycling via monthlyRevolvingBalances (> 0 = revolving).
                          // For revolving cards: use monthlyBalances (= full endBal including new purchases
                          // this month) so statement-preference cards like Prime Visa show the real balance,
                          // not just the carry-over after stripping current-month charges.
                          // For cycling cards: revBal is 0, fall back to data[i][name] which stores the
                          // cycling statement balance (newPurchases) — matches accordion display.
                          const revBal = cardProjectionData?.monthlyRevolvingBalances?.get(card.id)?.[absoluteI] ?? 0;
                          const simBal = cardProjectionData?.monthlyBalances?.get(card.id)?.[absoluteI] ?? 0;
                          const cyclingBal = Number(cardProjectionData?.data[absoluteI]?.[card.name] ?? 0);
                          const bal = revBal > 0 ? simBal : cyclingBal;
                          return bal > 0 ? formatCurrency(Math.round(bal), false) : '—';
                        })(),
                      })),
                    { label: 'Total CC Balance', value: (row.ccDisplayBalance ?? row.ccDebtBalance ?? 0) > 0 ? formatCurrency(row.ccDisplayBalance ?? row.ccDebtBalance, false) : '—' },
                    ...((row.nonCCLiabBreakdown ?? []) as { id: string; name: string; balance: number }[])
                      .map(la => ({ label: `  ${la.name}`, value: la.balance > 0 ? formatCurrency(la.balance, false) : '—' })),
                    ...((row.carLoanBreakdown ?? []) as { name: string; balance: number }[])
                      .map(cl => ({ label: `  ${cl.name}`, value: formatCurrency(cl.balance, false) })),
                    { label: 'Total Liabilities', value: formatCurrency(row.totalLiabilities, false) },
                    { label: '', value: '' },
                    { label: 'Net Worth', value: formatCurrency(row.netWorth, false) },
                  ],
                });
              };
              const hasCC = (row.totalCCPurchases ?? 0) > 0;
              const hasOneTime = (row.oneTimeNet ?? 0) !== 0;
              const hasCarLump = (row.carLoanExtraPayment ?? 0) > 0;
              return (
                <div key={i} className="border-b border-border/30 hover:bg-secondary/30 cursor-pointer" onClick={openDrawer}>
                  <div className="grid grid-cols-[5rem_1fr_1fr_1fr] py-2">
                    <div className="px-1 text-xs font-medium">{row.month}</div>
                    <div className="px-1 text-right text-success font-display font-bold text-xs">{formatCurrency(row.takeHome, false)}</div>
                    <div className="px-1 text-right text-destructive font-display font-bold text-xs">{formatCurrency(row.totalExpenses, false)}</div>
                    <div className={`px-1 text-right font-display font-bold text-xs ${row.endingCash < row.monthMinSafe ? 'text-destructive' : row.endingCash <= row.monthMinSafe + 50 ? 'text-amber-400' : 'text-success'}`}>
                      {formatCurrency(row.endingCash, false)}
                      {row.endingCash < 0 && <span className="ml-0.5 text-[8px]">⚠️</span>}
                      {row.floorBreachedByOneTime && <div className="text-[8px] text-amber-400 leading-tight font-normal">one-time</div>}
                    </div>
                  </div>
                  {(hasCC || hasOneTime || hasCarLump) && (
                    <div className="px-1 pb-1.5 flex flex-wrap gap-1">
                      {hasCC && (
                        <span className="text-[10px] sm:text-xs px-1.5 py-0.5 bg-destructive/10 text-destructive border border-destructive/20 whitespace-nowrap" style={{ borderRadius: 'var(--radius)' }}>
                          CC {formatCurrency(row.totalCCPurchases, false)}
                        </span>
                      )}
                      {hasOneTime && (
                        <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 border whitespace-nowrap ${(row.oneTimeNet || 0) >= 0 ? 'bg-success/10 text-success border-success/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`} style={{ borderRadius: 'var(--radius)' }}>
                          1× {(row.oneTimeNet || 0) >= 0 ? '+' : ''}{formatCurrency(row.oneTimeNet, false)}
                        </span>
                      )}
                      {hasCarLump && (
                        <span className="text-[10px] sm:text-xs px-1.5 py-0.5 bg-primary/10 text-primary border border-primary/20 whitespace-nowrap" style={{ borderRadius: 'var(--radius)' }}>
                          +pmt {formatCurrency(row.carLoanExtraPayment, false)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>}
        </>
      ) : (

        <div className="card-forged p-3 sm:p-5">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 sm:mb-4">Scheduled Events Timeline</h3>
          <div className="space-y-1">
            {detailedEvents.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">No recurring rules configured yet. Add rules in Budget Control to see scheduled events.</p>}
            {detailedEvents.map((e, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 sm:py-2 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <span className="text-xs text-muted-foreground w-20 sm:w-24 font-mono shrink-0">{e.date}</span>
                  <span className="text-xs font-medium truncate">{e.name}</span>
                  {e.source && <span className="text-[9px] sm:text-xs text-muted-foreground hidden sm:inline">· {e.source}</span>}
                </div>
                <span className={`text-xs font-display font-bold shrink-0 ${e.type === 'income' ? 'text-success' : 'text-destructive'}`}>
                  {e.type === 'income' ? '+' : '-'}{formatCurrency(e.amount, false)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Retirement & Investment Growth Projections ─────────────────── */}
      {retirementProjections.length > 0 && (
        <div className="card-forged p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-primary" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Retirement & Investment Growth Projections</h3>
          </div>
          <div className="space-y-4">
            {retirementProjections.map(({ account, apyRate, monthlyContrib, milestones }) => (
              <div key={account.id} className="border border-border/40 rounded-sm p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-xs font-semibold text-foreground">{account.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {account.account_type.toUpperCase().replace('_', ' ')} · {apyRate}% APY
                      {monthlyContrib > 0 && ` · +${formatCurrency(monthlyContrib, false)}/mo contributions`}
                    </p>
                  </div>
                  <span className="text-xs font-bold font-display text-foreground">{formatCurrency(Number(account.balance), false)}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {([['1yr', milestones.year1], ['5yr', milestones.year5], ['10yr', milestones.year10], ['20yr', milestones.year20]] as [string, number][]).map(([label, val]) => (
                    <div key={label} className="bg-muted/30 border border-border/30 px-2 py-1.5 text-center rounded-sm">
                      <p className="text-[9px] text-muted-foreground uppercase">{label}</p>
                      <p className="text-xs font-bold font-display text-success">{formatCurrency(val, false)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {retirementProjections.length > 1 && (
              <div className="flex items-center justify-between pt-2 border-t border-border/30">
                <p className="text-xs text-muted-foreground font-medium">Combined projected retirement (10yr)</p>
                <p className="text-sm font-bold font-display text-success">
                  {formatCurrency(retirementProjections.reduce((s, p) => s + p.milestones.year10, 0), false)}
                </p>
              </div>
            )}
            <p className="text-[9px] text-muted-foreground">Projections use your configured APY rates and paycheck deductions. Actual growth will vary with market conditions.</p>
          </div>
        </div>
      )}

      <CalcDrawer
        open={!!calcDrawer}
        onClose={() => setCalcDrawer(null)}
        title={calcDrawer?.title || ''}
        lines={calcDrawer?.lines || []}
      />
      <CalcDrawer
        open={!!floorCalcDrawer}
        onClose={() => setFloorCalcDrawer(null)}
        title={floorCalcDrawer?.title || ''}
        lines={floorCalcDrawer?.lines || []}
        zIndex={70}
      />
    </div>
  );
}
