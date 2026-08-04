import { useState, useMemo, useCallback, useEffect } from 'react';
import { Link } from 'react-router';
import { PageSkeleton } from '@/components/shared/PageSkeleton';
import { useDemo } from '@/contexts/DemoContext';
import { useSubscription } from '@/hooks/useSubscription';
import { formatCurrency, formatYAxisTick } from '@/lib/calculations';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useIsViewportBelow } from '@/hooks/use-mobile';
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
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import { cumulativeSurplusesByCard, adjustedDisplayBalance } from '@/lib/step3-display';
import { useForecastProjections } from '@/hooks/useForecastProjections';

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
                <span className={`wrap-break-word ${l.onClick ? 'underline decoration-dotted underline-offset-2' : ''}`}>{l.label}</span>
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


  const {
    projections,
    monthlyAggregates,
    debtPaymentsByMonth,
    debtBalancesByMonth,
    oneTimeByMonth,
    ccOneTimeByMonth,
    ccScheduledByMonth,
    currentMonthRecommendedDebt,
    forecastMonthEvents,
    planExpensesByMonth,
    annualFederalWithheldFromBudget,
    prePaycheckBillsInfo,
  } = useForecastProjections();

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
  // Cumulative PASS-3 surplus redirected to each card — shared display adjustment (step3-display)
  // used by the month popup so per-card balances match Debt Payoff's accordion and the export.
  const step3CumSurplus = useMemo(
    () => cumulativeSurplusesByCard(cardProjectionData?.perCardPaymentsScaled),
    [cardProjectionData],
  );

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
  const isMobile = useIsViewportBelow(640);
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
          className="fixed inset-0 z-60 flex items-center justify-center"
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
            <ResponsiveContainer width="100%" height={isMobile ? 220 : 260}>
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
                    ...((cardProjectionData?.simCards ?? []) as { id: string; name: string }[]).map(card => ({
                      label: `  ${card.name}`,
                      value: (() => {
                        // Detect revolving vs cycling via monthlyRevolvingBalances (> 0 = revolving).
                        // Revolving cards show the shared step3-display adjusted balance (sim balance
                        // minus cumulative PASS-3 surplus routed to this card) so this popup matches
                        // the Debt Payoff accordion/chart and the CSV export. Cycling cards fall back
                        // to data[i][name], the cycling statement balance — matches accordion display.
                        const revBal = cardProjectionData?.monthlyRevolvingBalances?.get(card.id)?.[absoluteI] ?? 0;
                        const simBal = cardProjectionData?.monthlyBalances?.get(card.id)?.[absoluteI] ?? 0;
                        const cyclingBal = Number(cardProjectionData?.data[absoluteI]?.[card.name] ?? 0);
                        const cum = step3CumSurplus.get(card.id)?.[absoluteI] ?? 0;
                        const bal = revBal > 0 ? adjustedDisplayBalance(simBal, cum) : cyclingBal;
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
              // Current-month +Income is the paychecks REMAINING after the last sync — paychecks
              // already received this month are folded into Current Cash, not shown here. Without a
              // hint the reduced income reads like a missing paycheck (Tre, 2026-07-21). Count the
              // received ones (date on/before syncCutoffDate — the same cutoff the income filter uses)
              // and label the row so the split is self-explanatory.
              const absoluteRowI = filterYear === 'all' ? i : getCalendarYearMonthRange(parseInt(filterYear, 10))[0] + i;
              const isCurrentMonthRow = absoluteRowI === 0;
              const receivedThisMonth = isCurrentMonthRow && syncCutoffDate
                ? getPaychecksInMonth(payConfig, new Date().getFullYear(), new Date().getMonth()).filter(p => {
                    const ps = `${p.date.getFullYear()}-${String(p.date.getMonth() + 1).padStart(2, '0')}-${String(p.date.getDate()).padStart(2, '0')}`;
                    return ps <= syncCutoffDate;
                  }).length
                : 0;
              const showRemainingHint = isCurrentMonthRow && receivedThisMonth > 0;
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
                  {(hasCC || hasOneTime || hasCarLump || showRemainingHint) && (
                    <div className="px-1 pb-1.5 flex flex-wrap gap-1">
                      {showRemainingHint && (
                        <span className="text-[10px] sm:text-xs px-1.5 py-0.5 bg-secondary text-muted-foreground border border-border whitespace-nowrap" style={{ borderRadius: 'var(--radius)' }} title="Paychecks already received this month are included in Current Cash, not in +Income. Tap the row for the full breakdown.">
                          ⏱ rest of month · {receivedThisMonth} paycheck{receivedThisMonth > 1 ? 's' : ''} received
                        </span>
                      )}
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
