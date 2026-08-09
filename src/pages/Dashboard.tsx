import { useMemo, useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useRetirementAutoUpdate } from '@/hooks/useRetirementAutoUpdate';
import InstructionsModal from '@/components/shared/InstructionsModal';
import MetricCard from '@/components/shared/MetricCard';
import AppTour from '@/components/shared/AppTour';
import ProgressBar from '@/components/shared/ProgressBar';
import CategoryIcon from '@/components/shared/CategoryIcon';
import PremiumGate from '@/components/shared/PremiumGate';
import AccountUpdateReminder from '@/components/shared/AccountUpdateReminder';
import FounderNoteModal from '@/components/shared/FounderNoteModal';
import OnboardingWizard from '@/components/onboarding/OnboardingWizard';
import OnboardingChecklist from '@/components/dashboard/OnboardingChecklist';
import SubscriptionExpiryBanner from '@/components/dashboard/SubscriptionExpiryBanner';
import DashboardCustomizer from '@/components/dashboard/DashboardCustomizer';
import { formatCurrency, formatYAxisTick } from '@/lib/calculations';
import { categorizeExpenses, getDebtPaymentsByCard } from '@/lib/expense-filtering';
import { MetricSkeleton, ChartSkeleton, ScheduleSkeleton } from '@/components/dashboard/DashboardSkeleton';
import { useTransactions, useDebts, useSavingsGoals, useCarFunds, useAccounts, useProfile, useRecurringRules, useAssets, useLiabilities, usePaymentPlans, useSyncedTransactionReviews, type AccountRow } from '@/hooks/useSupabaseData';
import { buildConfirmedOccurrences } from '@/lib/confirmed-capture';
import { usePlaidItems } from '@/hooks/usePlaidItems';
import { generateScheduledEvents, getUpcomingEvents, formatDateShort, type ScheduledEvent } from '@/lib/scheduling';
import { toScheduledObligations } from '@/lib/upcoming-obligations';
import { useSubscription } from '@/hooks/useSubscription';
import { useDashboardLayout } from '@/hooks/useDashboardLayout';
import {
  buildPayConfig,
  getRemainingIncomeThisMonth,
  getMonthlyNetIncome,
  getRemainingPaychecksThisMonth,
  getNextPaycheckDate,
  getPaycheckNet,
  getMinSafeCash,
  getAugmentedMinSafeCash,
  getPrePaycheckNextMonthBills,
  getRemainingTransactionIncomeThisMonth,
  getRemainingTransactionExpensesThisMonth,
  getRemainingTransactionDebtPaymentsThisMonth,
  mergeWithGeneratedTransactions,
  generateCurrentMonthTransactionsFromRules,
  createDebtPaymentTransactions,
  mergeDebtPaymentsIntoStream,
  getPaychecksInMonth,
} from '@/lib/pay-schedule';
import { CC_DEFAULT_CATEGORIES } from "@/lib/credit-card-engine";
import { getMonthlyPlanCashExpenses, generatePaymentPlanTransactions } from '@/lib/payment-plan-generator';
import { buildMonthlyExpenseModel } from '@/lib/monthly-expense-model';
import { useCardProjectionContext } from '@/contexts/CardProjectionContext';
import { useMonth0DebtBreakdown } from '@/hooks/useMonth0DebtBreakdown';
import { getTotalCarLoanMonthly, generateCarLoanTransactions, getActiveCarLoanPayments, getSavingPhaseCarFund, getCarFundSaved } from '@/lib/vehicle-loan-engine';
import { buildNetWorthBreakdown, totalsFromBreakdown } from '@/lib/net-worth';
import { isCardOpenAsOf } from '@/lib/card-start-date';
import { buildGoalOwnCompletionCutoffs } from '@/lib/goal-linkage';
import {
  Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
  Line, CartesianGrid, ComposedChart,
  PieChart, Pie, Cell,
} from 'recharts';
import MonthlyBudgetSnapshot from '@/components/dashboard/MonthlyBudgetSnapshot';
import { buildMonth0Snapshot } from '@/lib/month0-budget-snapshot';
import DebtRecommendationsWidget from '@/components/dashboard/DebtRecommendationsWidget';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import {
  Plus, ArrowUpRight, DollarSign, CreditCard,
  TrendingUp, PiggyBank, Landmark, Percent, Wallet, Repeat,
  CalendarDays, AlertTriangle, Info, X, Car, Shield, Check, FileDown, LayoutDashboard,
} from 'lucide-react';
import { exportDashboardPdf } from '@/lib/exportPdf';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { calculateMonthlyPayment } from '@/lib/calculations';
import { supabase } from '@/integrations/supabase/client';
import type { WidgetId } from '@/lib/dashboard-widgets';

interface ChartTooltipProps {
  active?: boolean;
  payload?: { dataKey: string | number; name: string; value: number; color: string }[];
  label?: string;
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border px-3 py-2 text-xs" style={{ borderRadius: 'var(--radius)' }}>
      <p className="font-medium text-foreground mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{p.name}</span>
          <span className="font-semibold" style={{ color: p.color }}>{formatCurrency(p.value, false)}</span>
        </div>
      ))}
    </div>
  );
}

const CATEGORY_COLORS = [
  'hsl(43, 70%, 55%)',
  'hsl(168, 55%, 42%)',
  'hsl(25, 80%, 55%)',
  'hsl(260, 55%, 62%)',
  'hsl(210, 65%, 55%)',
  'hsl(0, 65%, 52%)',
  'hsl(140, 55%, 42%)',
  'hsl(300, 45%, 55%)',
];

const BREAKDOWN_COLORS = [
  'hsl(43, 56%, 52%)', 'hsl(142, 50%, 42%)', 'hsl(200, 65%, 52%)',
  'hsl(280, 55%, 58%)', 'hsl(30, 80%, 52%)', 'hsl(170, 60%, 42%)',
  'hsl(320, 55%, 52%)', 'hsl(60, 65%, 44%)', 'hsl(240, 55%, 62%)',
  'hsl(15, 75%, 52%)', 'hsl(100, 45%, 44%)', 'hsl(0, 65%, 52%)',
];

interface BreakdownTooltipProps {
  active?: boolean;
  payload?: { payload: { name: string }; value: number }[];
}

function BreakdownTooltip({ active, payload }: BreakdownTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border px-3 py-2 text-xs" style={{ borderRadius: 'var(--radius)' }}>
      <p className="font-medium">{payload[0].payload.name}</p>
      <p className="text-primary font-semibold">{formatCurrency(payload[0].value, false)}</p>
    </div>
  );
}

interface DashboardGoalEntry {
  id: string;
  name: string;
  current_amount: number;
  target_amount: number;
}

function CalcDrawer({
  open,
  onClose,
  title,
  lines,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  lines: { label: string; value: string; op?: string }[];
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)', paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      onClick={onClose}
    >
      <div
        className="card-forged p-4 sm:p-6 w-full max-w-sm sm:max-w-md space-y-3 max-h-[75vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-sm flex items-center gap-2">
            <Info size={14} className="text-primary" /> {title}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-3 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-muted-foreground uppercase tracking-wider">
          Calculation Breakdown
        </p>

        <div className="space-y-2 pt-2">
          {lines.map((l, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0"
            >
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                {l.op && <span className="text-primary font-bold">{l.op}</span>}
                {l.label}
              </span>
              <span className="text-xs font-display font-bold text-foreground">
                {l.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClickableMetric({
  to,
  onClick,
  children,
  tooltip,
}: {
  to?: string;
  onClick?: () => void;
  children: React.ReactNode;
  tooltip: string;
}) {
  const navigate = useNavigate();
  return (
    <div
      className="relative group cursor-pointer transition-all duration-200 hover:ring-1 hover:ring-primary/40 active:scale-[0.99] h-full"
      style={{ borderRadius: 'var(--radius)' }}
      onClick={() => {
        if (onClick) onClick();
        else if (to) navigate(to);
      }}
      title={tooltip}
    >
      {children}
      <div className="absolute bottom-2 right-2 opacity-30 group-hover:opacity-100 transition-opacity">
        <Info size={12} className="text-primary" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const isReviewer = user?.email === 'reviewer@getforgenta.com';
  const { isPremium } = useSubscription();
  const navigate = useNavigate();

  const { data: transactions, loading: txnLoading } = useTransactions();
  const { data: accounts, loading: acctLoading } = useAccounts();
  const { data: profile, loading: profileLoading } = useProfile();

  useRetirementAutoUpdate(profile as Parameters<typeof useRetirementAutoUpdate>[0], accounts, isDemo, isPremium);
  const { data: debts, loading: debtsLoading } = useDebts();
  const { data: goals, loading: goalsLoading } = useSavingsGoals();
  const { data: carFunds } = useCarFunds();
  const { data: rules, loading: rulesLoading } = useRecurringRules();
  const { items: plaidItems } = usePlaidItems();
  const { data: manualAssets } = useAssets();
  const { data: manualLiabilities } = useLiabilities();
  const { data: paymentPlans } = usePaymentPlans();
  // §1B Stage 4A — rule occurrences the user confirmed a bank transaction already paid.
  const { data: syncedReviews } = useSyncedTransactionReviews();
  const confirmedOccurrences = useMemo(() => buildConfirmedOccurrences(syncedReviews), [syncedReviews]);

  const { layout, setLayout, visibleWidgets, isCustomizing, setCustomizing, resetLayout } = useDashboardLayout();

  // Signal Swift cover that the dashboard has mounted and is ready to paint.
  useEffect(() => {
    window.__forgenta_dashboard_ready = true;
    return () => { window.__forgenta_dashboard_ready = false; };
  }, []);

  const { cardProjection, pauseSavings, debtStrategy } = useCardProjectionContext();
  const [calcDrawer, setCalcDrawer] = useState<{ title: string; lines: { label: string; value: string; op?: string }[] } | null>(null);
  const [showSecurityBanner, setShowSecurityBanner] = useState(false);
  const [founderNoteVisible, setFounderNoteVisible] = useState(false);
  const [wizardVisible, setWizardVisible] = useState(false);
  const onboardingInitRef = useRef(false);

  useEffect(() => {
    if (isDemo) return;
    supabase.auth.mfa.listFactors().then(({ data }) => {
      if (!data) return;
      const raw = data as unknown as { email?: { status: string }[] };
      const all = [...(data.totp ?? []), ...(data.phone ?? []), ...(raw.email ?? [])];
      const hasVerified = all.some(f => f.status === 'verified');
      setShowSecurityBanner(!hasVerified);
    });
  }, [isDemo]);

  const FOUNDER_NOTE_KEY = 'forged:founder_note_seen';

  useEffect(() => {
    if (isDemo || profileLoading || debtsLoading || goalsLoading || acctLoading || onboardingInitRef.current) return;
    onboardingInitRef.current = true;
    const alreadySeenThisSession = sessionStorage.getItem(FOUNDER_NOTE_KEY) === '1';
    // One-shot onboarding decision, latched by onboardingInitRef so it runs once
    // per mount. It waits on four async queries (profile/debts/goals/accounts)
    // and reads sessionStorage, so it can be decided neither during render nor in
    // a lazy initializer — the inputs simply do not exist yet at mount.
    if (profile?.founder_note_seen === false && !alreadySeenThisSession) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFounderNoteVisible(true);
    } else if (
      profile?.onboarding_completed === false &&
      !sessionStorage.getItem('forged:onboarding_wizard_dismissed') &&
      (isReviewer || (accounts.length === 0 && debts.length === 0 && goals.length === 0))
    ) {
      setWizardVisible(true);
    }
  }, [isDemo, profileLoading, debtsLoading, goalsLoading, acctLoading, profile, accounts, debts, goals, isReviewer]);

  const handleFounderNoteDismiss = () => {
    sessionStorage.setItem(FOUNDER_NOTE_KEY, '1');
    setFounderNoteVisible(false);
    if (
      profile?.onboarding_completed === false &&
      !sessionStorage.getItem('forged:onboarding_wizard_dismissed') &&
      (isReviewer || (accounts.length === 0 && debts.length === 0 && goals.length === 0))
    ) {
      setWizardVisible(true);
    }
  };

  const essentialLoading = txnLoading || acctLoading || profileLoading;

  const payConfig = useMemo(() => buildPayConfig(profile), [profile]);
  const paycheckNet = useMemo(() => getPaycheckNet(payConfig), [payConfig]);
  const remainingIncome = useMemo(() => getRemainingIncomeThisMonth(payConfig), [payConfig]);
  const remainingPaychecks = useMemo(() => getRemainingPaychecksThisMonth(payConfig), [payConfig]);
  const nextPayday = useMemo(() => getNextPaycheckDate(payConfig), [payConfig]);
  const monthlyNetIncome = useMemo(() => getMonthlyNetIncome(payConfig), [payConfig]);

  const accountMap = useMemo(() => {
    const map: Record<string, AccountRow> = {};
    accounts.forEach(a => {
      map[a.id] = a;
      map[`account:${a.id}`] = a;
    });
    return map;
  }, [accounts]);

  const generatedTransactions = useMemo(
    () => generateCurrentMonthTransactionsFromRules(rules, accounts),
    [rules, accounts],
  );

  const baseTxns = useMemo(
    () => mergeWithGeneratedTransactions(transactions, rules, accounts),
    [transactions, rules, accounts],
  );

  const fundingAccountId = useMemo(() => {
    const defaultId = profile?.default_deposit_account;
    if (defaultId) return defaultId;
    const checking = accounts.find(a => a.account_type === 'checking' && a.active);
    return checking?.id || null;
  }, [accounts, profile]);

  const debtFundingSources = useMemo(() =>
    fundingAccountId
      ? new Set([fundingAccountId, `account:${fundingAccountId}`])
      : new Set<string>(),
    [fundingAccountId],
  );

  const monthlySavingsAndCar = useMemo(() => {
    if (pauseSavings) return 0;
    const retireIds = new Set<string>(
      accounts.filter(a => a.active && ['401k', 'roth_ira', 'ira', 'hsa'].includes(a.account_type)).map(a => a.id),
    );
    const now = new Date();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const activeTransferDests = new Set<string>(
      rules.filter(r =>
        r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment') && r.deposit_account &&
        !(r.start_date && new Date(r.start_date + 'T00:00:00') > monthEnd) &&
        !(r.end_date && new Date(r.end_date + 'T00:00:00') < now),
      ).map(r => r.deposit_account as string),
    );
    // Handoff item 4b — month-0 gate, structural twin of CreditCardEngine.tsx's
    // monthlySavingsAndCar. Only the goal-keyed cutoff belongs here: `activeTransferDests` above
    // is a double-count GUARD, not a dollar sum, so gating it would drop a completed linked goal
    // out of the guard and add its raw contribution back. Leave that set alone.
    const goalOwnCutoffs = buildGoalOwnCompletionCutoffs(goals, rules, accounts, now);
    const savingsTotal = goals.reduce((s, g) => {
      if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > now) return s;
      if (g.linked_account && retireIds.has(g.linked_account)) return s;
      if (g.linked_account && activeTransferDests.has(g.linked_account)) return s;
      const ownCutoff = g.id ? goalOwnCutoffs.get(g.id) : undefined;
      if (ownCutoff != null && ownCutoff <= 0) return s;
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
        monthsToGoal = Math.max(1, (pd.getFullYear() - now.getFullYear()) * 12 + (pd.getMonth() - now.getMonth()));
      }
      return s + Math.min(rem / monthsToGoal, rem);
    }, 0);
    const carLoanTotal = getTotalCarLoanMonthly(carFunds);
    return savingsTotal + carTotal + carLoanTotal;
  }, [pauseSavings, goals, carFunds, accounts, rules]);

  // NOTE (finding §2.6): a `month0SavingsBreakdown` memo used to live here, re-deriving goal and
  // car-fund reserves from raw rows so the snapshot could itemize them — and a prior session
  // hand-patched a "Vehicle Insurance (est.)" line into it when that item was noticed missing.
  // That whole approach is gone. The engine now publishes its month-0 cash chain term by term
  // (`month0.chain`), so the snapshot itemizes the values the engine actually used instead of a
  // parallel guess at them, and nothing has to be patched in by hand when a term is added.

  // Mirror Forecast's syncCutoffDate: use funding account's Plaid last_synced_at so remaining
  // transactions roll over at 9am ET when accounts update, not at midnight.
  const syncCutoffDate = useMemo((): string => {
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (!fundingAccountId) return localDate;
    const fundingAcct = accounts.find(a => a.id === fundingAccountId);
    if (!fundingAcct?.plaid_item_id) return localDate;
    const plaidItem = plaidItems.find(pi => pi.plaid_item_id === fundingAcct.plaid_item_id);
    if (!plaidItem?.last_synced_at) return localDate;
    return plaidItem.last_synced_at.split('T')[0];
  }, [fundingAccountId, accounts, plaidItems]);

  // Card payments due this month, from the converged month-0 projection that Debt Payoff and
  // Forecast read. Replaces the legacy getMonthlyDebtBreakdown pass, which ran its own floor,
  // save-up and income-timing logic and so put a different payment on this page than on /debt.
  const debtBreakdown = useMonth0DebtBreakdown();

  const debtPaymentTxns = useMemo(
    () => createDebtPaymentTransactions(debtBreakdown.recommendations, fundingAccountId),
    [debtBreakdown.recommendations, fundingAccountId],
  );

  const allMonthTransactions = useMemo(
    () => mergeDebtPaymentsIntoStream(baseTxns, debtPaymentTxns),
    [baseTxns, debtPaymentTxns],
  );

  // One rollup drives both the NET WORTH tile and the breakdown lists below it,
  // so the itemised rows always sum to the headline number. See lib/net-worth.ts.
  // Financed vehicles live in car_funds, not accounts, and carry no stored
  // balance — amortized here so they count as liabilities. Same call the
  // Vehicles page uses, so the two can't disagree.
  const vehicleLoans = useMemo(() => getActiveCarLoanPayments(carFunds ?? []), [carFunds]);

  const netWorthBreakdown = useMemo(
    () => buildNetWorthBreakdown(accounts, manualAssets, manualLiabilities, vehicleLoans),
    [accounts, manualAssets, manualLiabilities, vehicleLoans],
  );

  const accountSummary = useMemo(() => {
    const active = accounts.filter(a => a.active);
    const liquidTypes = ['checking', 'savings', 'high_yield_savings', 'business_checking', 'cash'];

    const liquidCash = active.filter(a => liquidTypes.includes(a.account_type)).reduce((s, a) => s + Number(a.balance || 0), 0);
    // A card with a future card_start_date has not been opened yet, so its limit is
    // not available credit and must not dilute utilization. Both sides of the ratio
    // use the same filter so the tile's "$debt / $limit" sub-line stays consistent.
    const openCards = active.filter(a => a.account_type === 'credit_card' && isCardOpenAsOf(a, new Date()));
    const ccDebt = openCards.reduce((s, a) => s + Number(a.balance || 0), 0);
    const ccLimit = openCards.filter(a => a.credit_limit).reduce((s, a) => s + Number(a.credit_limit || 0), 0);

    return { liquidCash, ...totalsFromBreakdown(netWorthBreakdown), ccDebt, ccLimit };
  }, [accounts, netWorthBreakdown]);

  const allAssetsForBreakdown = netWorthBreakdown.assets;
  const allLiabilitiesForBreakdown = netWorthBreakdown.liabilities;

  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const currentMonthTransactions = useMemo(
    () => allMonthTransactions.filter(t => t.date?.startsWith(currentMonthStr)),
    [allMonthTransactions, currentMonthStr],
  );

  // §2.4. The transaction stream expands recurring rules ONLY, so every aggregate built straight
  // off it silently omitted payment plans, the auto loan and vehicle insurance — $1,226/mo of real
  // obligations on real data, which is why this page read $3,196 of expenses while /transactions
  // read $6,243 for the same month. `buildMonthlyExpenseModel` re-derives the month from the
  // filtered sources (never the raw generators, which over-emit) and every consumer below now
  // reads it. Engine-derived numbers — MONTH-END CASH, Safe to Pay, the floor — were always
  // correct and are deliberately untouched.
  const creditCardSourceIds = useMemo(
    () => new Set<string>(
      accounts.filter(a => a.active && a.account_type === 'credit_card').flatMap(a => [a.id, `account:${a.id}`]),
    ),
    [accounts],
  );

  const expenseModel = useMemo(
    () => buildMonthlyExpenseModel({
      monthTxns: currentMonthTransactions,
      paymentPlans: paymentPlans ?? [],
      carFunds: carFunds ?? [],
      creditCardSourceIds,
      asOf: new Date(),
    }),
    [currentMonthTransactions, paymentPlans, carFunds, creditCardSourceIds],
  );

  const expenseBreakdown = expenseModel.byCategory;

  const debtPaymentBreakdown = useMemo(
    () => getDebtPaymentsByCard(currentMonthTransactions),
    [currentMonthTransactions],
  );

  const totalDebtPayments = useMemo(
    () => debtPaymentBreakdown.reduce((s, d) => s + d.amount, 0),
    [debtPaymentBreakdown],
  );

  const summary = useMemo(() => {
    const income = currentMonthTransactions
      .filter(t => t.type === 'income' && t.category !== 'Balance Adjustment')
      .reduce((s, t) => s + Number(t.amount || 0), 0);

    // §2.4 Phase 2 — Option B (Tre's decision, 2026-08-06): debt PRINCIPAL is not an expense,
    // interest is. Repaying principal moves money between two of your own columns; it is not
    // spending, and counting it as such made "Monthly Expenses" a number you could shrink by
    // paying off less debt. So the tile is now living + interest, and the principal is reported
    // beside it as DEBT SERVICE rather than hidden inside a total.
    //
    // CRITICAL: this is a RELABEL, not a revaluation. `expenses + debtService` is exactly the
    // old `expensesAllIn + totalDebtPayments`, so cashFlow, savingsRate and Annual Savings do not
    // move by a cent — the same dollars, split into two truthful buckets instead of one blurred
    // one. Any future edit that breaks that identity is changing what the user is owed, not how
    // it is labelled.
    const expenses = expenseModel.expenses;
    const debtService = expenseModel.principal + totalDebtPayments;
    const totalDebt = debts.reduce((s, d) => s + Number(d.balance || 0), 0);

    const totalSaved = goals.reduce((s: number, g) => {
      if (g.linked_account && accountMap[g.linked_account]) {
        return s + Number(accountMap[g.linked_account].balance);
      }
      return s + Number(g.current_amount || 0);
    }, 0);

    const cashFlow = income - expenses - debtService;
    const savingsRate = income > 0 ? (cashFlow / income) * 100 : 0;

    // carSaved/carGoal used to be derived here from carFunds[0]. Nothing ever read them — the car
    // tile renders from carGoalData — and they carried the same unfiltered-carFunds[0] defect it
    // did, so they were a live trap for whoever wired them up next. Removed rather than fixed.
    return { income, expenses, debtService, cashFlow, totalDebt, totalSaved, savingsRate };
  }, [currentMonthTransactions, expenseModel, totalDebtPayments, debts, goals, accountMap]);

  const creditCardIds = useMemo(
    () => new Set(accounts.filter(a => a.active && a.account_type === 'credit_card').map(a => a.id)),
    [accounts],
  );

  const carLoanTxns = useMemo(() => generateCarLoanTransactions(carFunds ?? []), [carFunds]);
  const planTxns = useMemo(() => generatePaymentPlanTransactions(paymentPlans ?? []), [paymentPlans]);

  // Recurring rules alone left the upcoming/bills widgets blind to card payments, the auto loan
  // and vehicle insurance — all three already visible on /transactions. See lib/upcoming-obligations.
  const scheduledEvents = useMemo(() => {
    let ruleEvents: ScheduledEvent[] = [];
    if (rules.length) {
      try { ruleEvents = generateScheduledEvents(rules, accounts, 1); } catch { ruleEvents = []; }
    }
    return [
      ...ruleEvents,
      ...toScheduledObligations(debtPaymentTxns, 'Card payment'),
      ...toScheduledObligations(carLoanTxns, 'Vehicle'),
      // Plan installments charged to a card are already covered by that card's payment above.
      ...toScheduledObligations(planTxns, 'Payment plan', creditCardIds),
    ].sort((a, b) => a.date.localeCompare(b.date));
  }, [rules, accounts, debtPaymentTxns, carLoanTxns, planTxns, creditCardIds]);

  const upcomingWeek = useMemo(() => getUpcomingEvents(scheduledEvents, 7), [scheduledEvents]);
  const upcomingMonth = useMemo(() => getUpcomingEvents(scheduledEvents, 30), [scheduledEvents]);
  const upcomingBillsWeek = upcomingWeek.filter(e => e.type === 'expense');
  const upcomingBillsMonth = upcomingMonth.filter(e => e.type === 'expense');

  const utilization = accountSummary.ccLimit > 0 ? (accountSummary.ccDebt / accountSummary.ccLimit) * 100 : 0;

  const remainingTxIncome = useMemo(() => getRemainingTransactionIncomeThisMonth(allMonthTransactions, syncCutoffDate), [allMonthTransactions, syncCutoffDate]);
  const remainingTxExpenses = useMemo(() => getRemainingTransactionExpensesThisMonth(allMonthTransactions, true, syncCutoffDate, debtFundingSources, CC_DEFAULT_CATEGORIES, confirmedOccurrences), [allMonthTransactions, syncCutoffDate, debtFundingSources, confirmedOccurrences]);
  const remainingTxDebt = useMemo(() => getRemainingTransactionDebtPaymentsThisMonth(allMonthTransactions, syncCutoffDate), [allMonthTransactions, syncCutoffDate]);

  // Remaining-this-month cash outflow from checking-sourced payment plans (CC-sourced plans hit
  // card balances, not cash, so getMonthlyPlanCashExpenses excludes them). These aren't in the
  // transaction stream, so fold them into `txMergeMonthEndCash` below.
  //
  // Scope note: this feeds ONLY the txMergeMonthEndCash fallback (`monthEndCash` prefers
  // `cardProjection.month0.endCash`, which never reads the stream), so on any account with at
  // least one credit card it is dead. The previous comment here claimed it also fed surplus and
  // available-to-deploy; those consumers no longer exist. Cutoff-aware: plan payments already made
  // this month are baked into the live balance. Whole-month expense totals deliberately do NOT
  // reuse this — see buildMonthlyExpenseModel, which asks a different question.
  const planCashThisMonth = useMemo(() => {
    const now = new Date();
    const ccIds = new Set<string>(
      accounts.filter(a => a.active && a.account_type === 'credit_card').flatMap(a => [a.id, `account:${a.id}`]),
    );
    return getMonthlyPlanCashExpenses(paymentPlans ?? [], now.getFullYear(), now.getMonth(), ccIds, syncCutoffDate);
  }, [accounts, paymentPlans, syncCutoffDate]);

  const cashFloor = profile?.cash_floor != null ? Number(profile.cash_floor) : 1000;


  const month0SaveUpNote = useMemo(() => {
    const event = cardProjection?.month0?.holdbackEvent;
    const amount = cardProjection?.month0?.holdback;
    if (!event || !amount) return null;
    return { ...event, amount };
  }, [cardProjection]);

  const minSafeCash = useMemo(
    () => getMinSafeCash(rules, payConfig, cashFloor, fundingAccountId),
    [rules, payConfig, cashFloor, fundingAccountId],
  );

  const prePaycheckBills = useMemo(
    () => getPrePaycheckNextMonthBills(rules, payConfig, fundingAccountId),
    [rules, payConfig, fundingAccountId],
  );

  // Forecast-equivalent cash floor for month 0: pre-paycheck bills + car loans + CC minimums.
  // Shared with Forecast.tsx and useCardProjection.ts via getAugmentedMinSafeCash so the floor
  // displayed here always matches the floor actually used to cap availableToDeploy below.
  //
  // Finding §2.3 (the floor had five different values): sharing the FUNCTION was never enough —
  // this call passed Dashboard's own `fundingAccountId`, which takes `profile.default_deposit_account`
  // with no account-type check and ignores the persisted debt-funding override. The engine resolves
  // `persistedDebtFundingId || forecastFundingAccountId` (checking/business_checking/cash only), so
  // the two calls saw different pre-paycheck bills and this one displayed a floor the engine never
  // applied ($2,402 vs $1,650). Use the id the engine actually resolved. It also feeds the floor
  // calculator popover below, so the itemization matches the number too.
  const floorFundingAccountId = cardProjection?.debtFundingAccountId ?? fundingAccountId;
  const forecastFloor0 = useMemo(
    () => getAugmentedMinSafeCash(
      rules, payConfig, cashFloor, floorFundingAccountId, new Date(),
      carFunds ?? [],
      cardProjection ? {
        simCards: cardProjection.simCards,
        monthlyRevolvingBalances: cardProjection.monthlyRevolvingBalances,
        perCardMinPayments: cardProjection.perCardMinPayments,
        monthlyCyclingBacklog: cardProjection.monthlyCyclingBacklog,
      } : null,
      0, syncCutoffDate,
    ),
    [rules, payConfig, cashFloor, floorFundingAccountId, carFunds, cardProjection, syncCutoffDate],
  );

  const fundingBalance = useMemo(() => {
    const fundAcct = accounts.find(a => a.id === fundingAccountId);
    if (fundAcct) return Number(fundAcct.balance);
    return accountSummary.liquidCash;
  }, [accounts, fundingAccountId, accountSummary]);

  // Finding §1.1: this tile used to be built ONLY from the transaction-merge helpers below — the
  // very source `useCardProjection.ts` deliberately abandoned — and it omitted savings goals, the
  // car down-payment reserve, car loans, insurance, mortgage and transfers entirely. It read
  // $3,487 above the Forecast page's END CASH for the same month. `month0.endCash` is the single
  // canonical definition (see `Month0Result.endCash`), identical to Forecast's i=0 END CASH.
  //
  // The transaction-merge expression survives ONLY as the fallback for when the engine returns no
  // projection at all — `useCardProjection.ts:86` returns null when the user has no credit cards.
  const txMergeMonthEndCash = useMemo(
    () => fundingBalance + remainingTxIncome - remainingTxExpenses - remainingTxDebt - planCashThisMonth,
    [fundingBalance, remainingTxIncome, remainingTxExpenses, remainingTxDebt, planCashThisMonth],
  );
  const monthEndCash = cardProjection?.month0?.endCash ?? txMergeMonthEndCash;

  // Finding §2.6: the Monthly Budget Snapshot equation. Every row comes from the engine's own
  // month-0 cash chain and the leftover is emitted as a computed row — see
  // `buildMonth0Snapshot`. `spentSoFar` is the only page-local input and feeds the donut only.
  // The previous shape (a page-local projected-surplus chain plus a `month0ImpliedSavings`
  // residual that an itemized `savingsBreakdown` then silently replaced) is gone: it was two
  // derivations printed as one equation, and it is what made the rows not sum to their own total.
  const month0Snapshot = useMemo(
    () => cardProjection?.month0
      // ALL-IN, deliberately: `spentSoFar` drives the donut, which asks "how much of this month's
      // money is gone", not "how much did I spend". Principal leaving the account is gone.
      ? buildMonth0Snapshot(cardProjection.month0, expenseModel.expensesAllIn + totalDebtPayments)
      : null,
    [cardProjection, expenseModel.expensesAllIn, totalDebtPayments],
  );


  useWidgetSync({ monthEndCash, netWorth: accountSummary.netWorth, enabled: !isDemo && !essentialLoading });

  const categoryData = useMemo(
    () => Object.entries(expenseBreakdown).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    [expenseBreakdown],
  );

  const cashFlowData = useMemo(() => {
    const months = [];
    const nowDate = new Date();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1);
      const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthName = d.toLocaleString('en', { month: 'short' });

      if (i === 0) {
        // ALL-IN: months 1-5 are recorded actuals from `categorizeExpenses`, which knows nothing
        // of Option B. Plotting an Option B month 0 against five all-in months would make the bar
        // drop for a reason that is purely a change of label.
        months.push({ month: monthName, income: summary.income, expenses: expenseModel.expensesAllIn, net: summary.cashFlow });
      } else {
        const monthTxns = baseTxns.filter(t => t.date?.startsWith(monthStr));
        const inc = monthTxns.filter(t => t.type === 'income' && t.category !== 'Balance Adjustment').reduce((s, t) => s + Number(t.amount), 0);
        const expBreakdown = categorizeExpenses(monthTxns, true);
        const exp = Object.values(expBreakdown).reduce((s: number, v: number) => s + v, 0);
        months.push({ month: monthName, income: Math.round(inc), expenses: Math.round(exp), net: Math.round(inc - exp) });
      }
    }

    return months;
  }, [summary, expenseModel.expensesAllIn, baseTxns]);

  const avgMonthlySpend = useMemo(() => {
    const past = cashFlowData.slice(0, 5);
    const total = past.reduce((s, m) => s + m.expenses, 0);
    return past.length > 0 ? total / past.length : 0;
  }, [cashFlowData]);

  const emergencyRunwayMonths = useMemo(() => {
    // ALL-IN: runway asks how long the cash lasts, and every dollar of principal still has to be
    // paid when the income stops. An Option B burn rate would flatter the runway by the principal.
    const burn = expenseModel.cashOut + totalDebtPayments;
    if (burn <= 0) return null;
    const available = Math.max(0, accountSummary.liquidCash - cashFloor);
    return available / burn;
  }, [accountSummary.liquidCash, cashFloor, expenseModel.cashOut, totalDebtPayments]);

  const dti = useMemo(() => {
    if (summary.income <= 0) return null;
    return (debtBreakdown.totalMinimumsDue / summary.income) * 100;
  }, [debtBreakdown.totalMinimumsDue, summary.income]);

  const recentTxns = useMemo(() => {
    const todayDate = new Date();
    const todayStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
    const cutoff = new Date(todayDate);
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
    return [...allMonthTransactions]
      .filter(t => t.date <= todayStr && t.date >= cutoffStr)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6);
  }, [allMonthTransactions]);

  // Only a car still being SAVED for has a down-payment goal to show. This used to read
  // carFunds[0] unconditionally, which meant the tile kept showing "Car Goal" — with a saving
  // progress bar — after the loan was active and the car already bought, and picked an arbitrary
  // fund when there was more than one. Phase-gating matches getCarFundEarmark
  // (vehicle-loan-engine.ts): activating a loan makes the saving construct disappear on its own,
  // with no separate release step. A loan-phase vehicle is represented by its payment rows and
  // the Vehicles page, not by a goal.
  const carGoalData = useMemo(() => {
    const savingFund = getSavingPhaseCarFund(carFunds);
    if (savingFund) {
      const c = savingFund;
      const linkedAcctBal = c.linked_account && accountMap[c.linked_account]
        ? Number(accountMap[c.linked_account].balance)
        : null;
      // §2.10: funding id null — this tile has always shown the linked balance whichever account it
      // is. The helper adds percent mode and leaves 'fixed' funds reading exactly as before.
      const saved = getCarFundSaved(c, null, linkedAcctBal);
      const gift = Number(c.gift_contribution) || 0;
      const personalTarget = Math.max(0, Number(c.down_payment_goal) - gift);
      const rem = Math.max(0, personalTarget - saved);
      const now = new Date();
      let savingMonths = 13; // this month + 12 future
      if (c.planned_purchase_date) {
        const parts = (c.planned_purchase_date as string).split('-').map(Number);
        const pd = new Date(parts[0], parts[1] - 1, parts[2]);
        const diff = (pd.getFullYear() - now.getFullYear()) * 12 + (pd.getMonth() - now.getMonth());
        savingMonths = Math.max(1, diff + 1); // include the purchase month
      }
      const monthlyNeeded = rem > 0 ? Math.min(rem / savingMonths, rem) : 0;
      return {
        name: c.vehicle_name, saved, target: personalTarget, fullDownPayment: Number(c.down_payment_goal),
        gift, monthlyNeeded, price: Number(c.target_price), apr: Number(c.expected_apr),
        term: Number(c.loan_term_months), isCarFund: true,
      };
    }
    const carGoal = goals?.find(g => g.goal_type === 'Car Fund');
    if (carGoal) {
      return { name: carGoal.name, saved: Number(carGoal.current_amount), target: Number(carGoal.target_amount), fullDownPayment: Number(carGoal.target_amount), gift: 0, monthlyNeeded: 0, price: 0, apr: 0, term: 0, isCarFund: false };
    }
    return null;
  }, [carFunds, goals, accountMap]);

  // ─── Calc drawer openers ──────────────────────────────────────────────────

  const openMonthEndCalc = () => {
    const engineMinimums = debtBreakdown.totalMinimumsDue;
    const engineTotal = debtBreakdown.totalRecommended;
    const engineExtra = Math.max(0, engineTotal - engineMinimums);
    // §2.6 applied to the tile: the drawer must print the SAME derivation the tile shows. When the
    // engine has a month-0 projection, every row below is a term the engine actually consumed
    // (`month0.chain`); the old transaction-merge chain is printed only in the null-projection
    // fallback, where the tile itself falls back to it too.
    const m0 = cardProjection?.month0 ?? null;
    // Two decimals throughout (Tre, 2026-08-06). `month0.chain` now carries exact cents, so the
    // chain below balances to the cent — printing it rounded would show a column that does not add
    // up to its own total, which is the defect this drawer exists to prevent.
    const money = (v: number) => formatCurrency(v, true);
    const t = (label: string, value: number, op: string) =>
      Math.abs(value) >= 0.005 ? [{ label, value: money(Math.abs(value)), op: value < 0 ? (op === '−' ? '+' : '−') : op }] : [];

    const chainLines = m0
      ? [
          { label: 'Balance on hand', value: money(m0.chain.fundingBalance) },
          ...t('Income still coming', m0.chain.income, '+'),
          ...t('Bills still coming', m0.chain.expenses, '−'),
          ...t('Payment Plans (from checking)', m0.chain.planExpenses, '−'),
          ...t('Savings goals', m0.chain.goalContributions, '−'),
          // §2.9: 'Balance on hand' is the GROSS balance now, so this row is what keeps the drawer's
          // column adding up to `cashPreDebt`. Omit it and the equation is short by the earmark.
          ...t('Already saved toward a car', m0.chain.carSavedEarmark, '−'),
          ...t('Car down payment reserve', m0.chain.carReserve, '−'),
          ...t('Auto loan payment', m0.chain.carLoanPayment, '−'),
          ...t('Vehicle insurance (est.)', m0.chain.vehicleInsurance, '−'),
          ...t('Mortgage payment', m0.chain.mortgagePayment, '−'),
          ...t('Transfers & lump sums', m0.chain.transfers, '−'),
          ...t('One-time transactions', m0.chain.oneTimeNet, '+'),
          { label: 'Cash before debt payments', value: money(m0.chain.cashPreDebt), op: '=' },
          ...t('Debt payments (available to deploy)', m0.safeToPayTotal, '−'),
          ...t('Car reserve still held at month end', m0.carReserveHeld, '+'),
          { label: 'Projected Month-End Cash', value: money(monthEndCash), op: '=' },
        ]
      : [
          { label: 'Funding Account Balance', value: money(fundingBalance) },
          { label: 'Remaining Income', value: money(remainingTxIncome), op: '+' },
          { label: 'Remaining Expenses', value: money(remainingTxExpenses), op: '−' },
          { label: 'Remaining Debt Payments', value: money(remainingTxDebt), op: '−' },
          ...(planCashThisMonth > 0 ? [{ label: 'Payment Plans (from checking)', value: money(planCashThisMonth), op: '−' }] : []),
          { label: 'Projected Month-End Cash', value: money(monthEndCash), op: '=' },
        ];

    const lines: { label: string; value: string; op?: string }[] = [
      ...chainLines,
      { label: '', value: '' },
      { label: 'Minimum Payments Due (this month)', value: formatCurrency(engineMinimums, true) },
      ...(engineExtra > 0 ? [{ label: 'Extra Debt Payoff (above minimums)', value: formatCurrency(engineExtra, true), op: '+' }] : []),
      { label: 'Total Recommended Debt Payment', value: formatCurrency(engineTotal, true), op: '=' },
      { label: '', value: '' },
      { label: 'Your Cash Floor Setting', value: formatCurrency(cashFloor, true) },
      { label: `Pre-paycheck bills (${prePaycheckBills.items.length} items)`, value: formatCurrency(prePaycheckBills.total, true) },
      { label: 'Effective Cash Floor (used in debt payoff)', value: formatCurrency(forecastFloor0.monthMinSafe, true), op: '≥' },
      { label: '', value: '' },
      {
        // Compared PRE-debt-payment when the engine is driving: the engine caps `safeToPayTotal`
        // at the floor, so comparing post-payment cash would report ✅ by construction and never
        // surface the case this line exists to warn about.
        label: (m0 ? m0.chain.cashPreDebt : monthEndCash) >= forecastFloor0.monthMinSafe
          ? '✅ Cash is above safety threshold'
          : '⚠️ Cash is below safety threshold — debt payments may need adjustment',
        value: '',
      },
    ];
    setCalcDrawer({ title: 'Projected Month-End Cash', lines });
  };

  const openIncomeCalc = () => {
    const incomeItems = currentMonthTransactions.filter(t => t.type === 'income');
    const paycheckCount = getPaychecksInMonth(payConfig, now.getFullYear(), now.getMonth());
    const lines: { label: string; value: string; op?: string }[] = [
      { label: `Pay Schedule: ${payConfig.frequency}`, value: `${payConfig.paycheckDay === 5 ? 'Fri' : `Day ${payConfig.paycheckDay}`}` },
      { label: 'Net per paycheck (post-tax)', value: formatCurrency(paycheckNet, false) },
      { label: 'Paychecks this month', value: String(paycheckCount.length) },
      { label: `${incomeItems.length} income transactions`, value: '' },
    ];
    incomeItems.slice(0, 8).forEach(t => {
      lines.push({ label: `  ${t.note || t.category}`, value: formatCurrency(Number(t.amount), false), op: '+' });
    });
    lines.push({ label: 'Total Monthly Income', value: formatCurrency(summary.income, false), op: '=' });
    setCalcDrawer({ title: 'Monthly Income', lines });
  };

  // Option B on screen: the categories sum to the tile, then the chain continues through debt
  // service to cash flow — so income − expenses − debt = what's left is followable end to end
  // and no figure appears that the drawer did not derive.
  const openExpenseCalc = () => {
    const lines: { label: string; value: string; op?: string }[] = [
      { label: 'What you spent this month (debt principal excluded):', value: '' },
    ];
    Object.entries(expenseBreakdown)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, val]) => lines.push({ label: `  ${cat}`, value: formatCurrency(val, false), op: '+' }));
    lines.push({ label: 'Monthly Expenses', value: formatCurrency(summary.expenses, false), op: '=' });
    lines.push({ label: 'Debt service (principal repaid, not spent):', value: '' });
    if (expenseModel.principal > 0) {
      lines.push({ label: '  Auto loan principal', value: formatCurrency(expenseModel.principal, false), op: '+' });
    }
    debtPaymentBreakdown.forEach(({ cardName, amount }) => {
      lines.push({ label: `  ${cardName}`, value: formatCurrency(amount, false), op: '+' });
    });
    lines.push({ label: 'Total Debt Service', value: formatCurrency(summary.debtService, false), op: '=' });
    lines.push({ label: 'Total cash out', value: formatCurrency(summary.expenses + summary.debtService, false), op: '=' });
    setCalcDrawer({ title: 'Monthly Expenses', lines });
  };

  const openDebtPaymentsCalc = () => {
    const lines: { label: string; value: string; op?: string }[] = [
      { label: 'All current-month debt payment transactions:', value: '' },
    ];
    debtPaymentBreakdown.forEach(({ cardName, amount }) => {
      lines.push({ label: `  ${cardName}`, value: formatCurrency(amount, false), op: '+' });
    });
    if (debtPaymentBreakdown.length === 0) {
      lines.push({ label: '  No debt payments this month', value: '$0' });
    }
    lines.push({ label: 'Total Debt Payments', value: formatCurrency(totalDebtPayments, false), op: '=' });
    setCalcDrawer({ title: 'Debt Payments', lines });
  };

  const openNetWorthCalc = () => {
    const active = accounts.filter(a => a.active);
    const lines: { label: string; value: string; op?: string }[] = [];
    const assetAccts = active.filter(a => !['credit_card', 'student_loan', 'auto_loan', 'other_liability'].includes(a.account_type));
    const liabAccts = active.filter(a => ['credit_card', 'student_loan', 'auto_loan', 'other_liability'].includes(a.account_type));
    lines.push({ label: `Assets (${assetAccts.length} accounts)`, value: '' });
    assetAccts.forEach(a => lines.push({ label: `  ${a.name}`, value: formatCurrency(Number(a.balance), false), op: '+' }));
    lines.push({ label: 'Total Assets', value: formatCurrency(accountSummary.totalAssets, false), op: '=' });
    lines.push({ label: `Liabilities (${liabAccts.length} accounts)`, value: '' });
    liabAccts.forEach(a => lines.push({ label: `  ${a.name}`, value: formatCurrency(Number(a.balance), false), op: '−' }));
    lines.push({ label: 'Total Liabilities', value: formatCurrency(accountSummary.totalLiabilities, false), op: '=' });
    lines.push({ label: 'Net Worth', value: formatCurrency(accountSummary.netWorth, false), op: '=' });
    setCalcDrawer({ title: 'Net Worth', lines });
  };

  const openLiquidCashCalc = () => {
    const active = accounts.filter(a => a.active && ['checking', 'savings', 'high_yield_savings', 'business_checking', 'cash'].includes(a.account_type));
    const lines: { label: string; value: string; op?: string }[] = [];
    active.forEach(a => lines.push({ label: a.name, value: formatCurrency(Number(a.balance), false), op: '+' }));
    lines.push({ label: 'Total Liquid Cash', value: formatCurrency(accountSummary.liquidCash, false), op: '=' });
    setCalcDrawer({ title: 'Liquid Cash', lines });
  };

  const openFloorCalc = () => {
    const { floorItems, prePaycheckBillsTotal, monthMinSafe } = forecastFloor0;
    const lines: { label: string; value: string; op?: string }[] = [
      { label: 'Settings floor', value: formatCurrency(cashFloor, false) },
      { label: '', value: '' },
      ...(floorItems.length > 0
        ? [
            { label: 'Fixed monthly obligations (next mo.):', value: '' },
            ...floorItems.map(it => ({
              label: `  ${it.name}${it.dueDay ? ` (day ${it.dueDay})` : ''}`,
              value: formatCurrency(it.amount, false),
              op: '+' as const,
            })),
            { label: 'Obligations total', value: formatCurrency(prePaycheckBillsTotal, false), op: '=' as const },
          ]
        : [{ label: 'No fixed obligations', value: '' }]),
      { label: '', value: '' },
      { label: 'Cash Floor (higher of above)', value: formatCurrency(monthMinSafe, false), op: '=' as const },
    ];
    setCalcDrawer({ title: 'Cash Floor', lines });
  };

  // ─── Widget renderer ──────────────────────────────────────────────────────

  const renderWidget = (id: WidgetId) => {
    switch (id) {
      case 'monthly_snapshot':
        // No engine month 0 (still loading, or no cards) ⇒ render nothing rather than fall back to
        // a page-local re-derivation. A second derivation is exactly what finding §2.6 was.
        if (!month0Snapshot) return null;
        return (
          <MonthlyBudgetSnapshot
            key="monthly_snapshot"
            snapshot={month0Snapshot}
            onFloorClick={openFloorCalc}
          />
        );

      case 'upcoming_week':
        if (rulesLoading || upcomingBillsWeek.length === 0) return null;
        return (
          <div key="upcoming_week" className="card-forged p-4 card-clickable" onClick={() => navigate('/transactions')}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Upcoming This Week</h3>
            <div className="space-y-1">
              {upcomingBillsWeek.slice(0, 5).map((e, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 text-xs">
                  <div>
                    <span className="font-medium">{e.name}</span>
                    <span className="text-muted-foreground ml-2">{formatDateShort(e.date)}</span>
                    {e.source && <span className="text-muted-foreground ml-2">· {e.source}</span>}
                  </div>
                  <span className="font-display font-bold text-destructive">{formatCurrency(e.amount, false)}</span>
                </div>
              ))}
            </div>
          </div>
        );

      case 'schedule_cards':
        return rulesLoading ? (
          <ScheduleSkeleton key="schedule_cards" />
        ) : (
          <div key="schedule_cards" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <ClickableMetric to="/budget" tooltip="Next scheduled paycheck from your pay setup">
              <MetricCard label="Next Paycheck" value={formatCurrency(paycheckNet, false)} sub={nextPayday.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} accent="success" icon={CalendarDays} />
            </ClickableMetric>
            <ClickableMetric to="/transactions" tooltip="Total bills due in the next 7 days">
              <MetricCard label="Bills This Week" value={formatCurrency(upcomingBillsWeek.reduce((s, e) => s + e.amount, 0), false)} sub={`${upcomingBillsWeek.length} upcoming`} accent={upcomingBillsWeek.length > 0 ? 'crimson' : 'silver'} icon={AlertTriangle} />
            </ClickableMetric>
            <ClickableMetric to="/transactions" tooltip="All bills scheduled this month">
              <MetricCard label="Bills This Month" value={formatCurrency(upcomingBillsMonth.reduce((s, e) => s + e.amount, 0), false)} sub={`${upcomingBillsMonth.length} scheduled`} accent="silver" icon={Repeat} />
            </ClickableMetric>
            <ClickableMetric onClick={openMonthEndCalc} tooltip="Click to see how this is calculated">
              <MetricCard label="Month-End Cash" value={formatCurrency(monthEndCash, false)} sub="After all scheduled items" accent={monthEndCash >= 0 ? 'success' : 'crimson'} icon={Wallet} />
            </ClickableMetric>
          </div>
        );

      case 'financial_health':
        return (
          <div key="financial_health" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <ClickableMetric onClick={openLiquidCashCalc} tooltip="View liquid cash breakdown">
              <MetricCard label="Liquid Cash" value={formatCurrency(accountSummary.liquidCash, false)} accent="success" icon={DollarSign} />
            </ClickableMetric>
            <ClickableMetric onClick={openIncomeCalc} tooltip="How income is calculated">
              <MetricCard label="Monthly Income" value={summary.income > 0 ? formatCurrency(summary.income, false) : '—'} accent="success" icon={TrendingUp} />
            </ClickableMetric>
            <ClickableMetric onClick={openExpenseCalc} tooltip="How expenses are calculated">
              <MetricCard label="Monthly Expenses" value={summary.expenses > 0 ? formatCurrency(summary.expenses, false) : '—'} sub="spending only" accent="crimson" icon={CreditCard} />
            </ClickableMetric>
            {/* Option B: principal repaid gets its own tile instead of inflating the expense one.
                Same drawer — the two figures are halves of one chain and are read together. */}
            <ClickableMetric onClick={openExpenseCalc} tooltip="Debt principal repaid this month — not spending">
              <MetricCard label="Debt Service" value={summary.debtService > 0 ? formatCurrency(summary.debtService, false) : '—'} sub="principal repaid" accent="gold" icon={Landmark} />
            </ClickableMetric>
          </div>
        );

      case 'wealth_overview':
        return (
          <div key="wealth_overview" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <ClickableMetric onClick={openNetWorthCalc} tooltip="How net worth is calculated">
              <MetricCard label="Net Worth" value={formatCurrency(accountSummary.netWorth, false)} accent={accountSummary.netWorth >= 0 ? 'gold' : 'crimson'} icon={Wallet} sub={`${formatCurrency(accountSummary.totalAssets, false)} assets`} />
            </ClickableMetric>
            <ClickableMetric to="/budget" tooltip="Savings rate = (income − expenses − debt service) / income">
              <MetricCard label="Savings Rate" value={summary.income > 0 ? `${summary.savingsRate.toFixed(1)}%` : '—'} accent={summary.savingsRate >= 0 ? 'gold' : 'crimson'} icon={Percent} sub={summary.income > 0 ? `${formatCurrency(summary.cashFlow, false)} net / mo` : '—'} />
            </ClickableMetric>
            <ClickableMetric to="/debt" tooltip="Credit card balances / total limits">
              <MetricCard label="Credit Utilization" value={`${utilization.toFixed(1)}%`} accent={utilization > 30 ? 'crimson' : 'success'} sub={`${formatCurrency(accountSummary.ccDebt, false)} / ${formatCurrency(accountSummary.ccLimit, false)}`} icon={CreditCard} />
            </ClickableMetric>
            {goalsLoading ? (
              <MetricSkeleton />
            ) : (
              <ClickableMetric to="/goals" tooltip="Total saved across all goals">
                <MetricCard label="Total Saved" value={formatCurrency(summary.totalSaved, false)} accent="success" sub={`${goals.length} goals`} icon={PiggyBank} />
              </ClickableMetric>
            )}
          </div>
        );

      case 'car_goal':
        if (!carGoalData) return null;
        return (
          <div key="car_goal" className="card-forged p-5 card-clickable" onClick={() => navigate(carGoalData.isCarFund ? '/vehicles' : '/goals')}>
            <div className="flex items-center gap-2 mb-4">
              <Car size={14} className="text-primary" />
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Car Goal: {carGoalData.name}</h3>
            </div>
            <div className={`grid gap-4 ${carGoalData.isCarFund ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-3'}`}>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Saved</p>
                <p className="text-lg font-display font-bold text-primary">{formatCurrency(carGoalData.saved, false)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">{carGoalData.isCarFund ? (carGoalData.gift > 0 ? 'Your Goal' : 'Down Payment Goal') : 'Target'}</p>
                <p className="text-lg font-display font-bold text-foreground">{formatCurrency(carGoalData.target, false)}{carGoalData.gift > 0 && <span className="text-xs text-muted-foreground font-normal ml-1">+{formatCurrency(carGoalData.gift, false)} gift</span>}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Progress</p>
                <p className="text-lg font-display font-bold text-success">{carGoalData.target > 0 ? `${((carGoalData.saved / carGoalData.target) * 100).toFixed(0)}%` : '0%'}</p>
              </div>
              {carGoalData.isCarFund && (
                <div>
                  {carGoalData.monthlyNeeded > 0 ? (
                    <>
                      <p className="text-xs text-muted-foreground uppercase">Save / mo</p>
                      <p className="text-lg font-display font-bold text-amber-400">{formatCurrency(carGoalData.monthlyNeeded, false)}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground uppercase">Est. Monthly Pmt</p>
                      <p className="text-lg font-display font-bold text-destructive">
                        {formatCurrency(calculateMonthlyPayment(carGoalData.price - carGoalData.fullDownPayment, carGoalData.apr, carGoalData.term), true)}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3">
              <ProgressBar value={carGoalData.saved} max={carGoalData.target} color="gold" />
            </div>
          </div>
        );

      case 'cash_flow_chart':
        return (
          <div key="cash_flow_chart" className="card-forged p-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-5">Cash Flow Overview</h3>
            {cashFlowData.some(d => d.income > 0 || d.expenses > 0) ? (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={cashFlowData} margin={{ left: 0, right: 0, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 15%)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(240, 4%, 46%)', textAnchor: 'end' }} angle={-45} height={50} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(240, 4%, 46%)' }} axisLine={false} tickLine={false} tickFormatter={formatYAxisTick} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="income" name="Income" fill="hsl(142, 50%, 40%)" radius={[2, 2, 0, 0]} barSize={20} />
                  <Bar dataKey="expenses" name="Expenses" fill="hsl(0, 73%, 35%)" radius={[2, 2, 0, 0]} barSize={20} />
                  <Line dataKey="net" name="Net Cash Flow" stroke="hsl(43, 56%, 52%)" strokeWidth={2} dot={{ r: 4, fill: 'hsl(43, 56%, 52%)' }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-8">No transaction data yet. Add transactions or set up recurring rules in Budget Control.</p>
            )}
          </div>
        );

      case 'transactions_spending':
        return (
          <div key="transactions_spending" className="grid lg:grid-cols-2 gap-5">
            <div className="card-forged p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Spending by Category</h3>
                {categoryData.length > 0 && (
                  <span className="text-xs font-bold font-display text-foreground">
                    {formatCurrency(categoryData.reduce((s, c) => s + c.value, 0), false)}
                  </span>
                )}
              </div>
              {categoryData.length > 0 ? (() => {
                const total = categoryData.reduce((s, c) => s + c.value, 0);
                const top = categoryData.slice(0, 8);
                const rest = categoryData.slice(8);
                return (
                  <div className="space-y-3">
                    {top.map(({ name, value }, i) => {
                      const pct = total > 0 ? Math.round((value / total) * 100) : 0;
                      const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
                      return (
                        <div key={name}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                              <CategoryIcon category={name} size={11} className="shrink-0" />
                              <span className="text-xs font-medium truncate">{name}</span>
                            </div>
                            <div className="flex items-center gap-2.5 shrink-0 ml-2">
                              <span className="text-[10px] text-muted-foreground w-7 text-right">{pct}%</span>
                              <span className="text-xs font-bold font-display w-16 text-right">{formatCurrency(value, false)}</span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                          </div>
                        </div>
                      );
                    })}
                    {rest.length > 0 && (
                      <div className="flex items-center justify-between pt-1.5 border-t border-border/40">
                        <span className="text-[10px] text-muted-foreground">+{rest.length} more</span>
                        <span className="text-[10px] font-display font-semibold text-muted-foreground">{formatCurrency(rest.reduce((s, c) => s + c.value, 0), false)}</span>
                      </div>
                    )}
                  </div>
                );
              })() : (
                <p className="text-xs text-muted-foreground text-center py-8">No expenses recorded yet.</p>
              )}
            </div>

            <div className="card-forged p-5">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent Transactions</h3>
                <Link to="/transactions" className="text-xs text-primary hover:underline font-medium">View All</Link>
              </div>
              <div className="space-y-1">
                {recentTxns.map(t => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between py-2.5 px-2 border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-md flex items-center justify-center ${t.type === 'income' ? 'bg-success/10' : 'bg-muted'}`}>
                        {t.type === 'income' ? <ArrowUpRight size={14} className="text-success" /> : <CategoryIcon category={t.category} size={14} />}
                      </div>
                      <div>
                        <div className="flex items-center gap-1">
                          <p className="text-xs font-medium">{t.note || '—'}</p>
                          {t.isGenerated && <Repeat size={9} className="text-primary" />}
                        </div>
                        <p className="text-xs text-muted-foreground">{t.category}</p>
                      </div>
                    </div>
                    <span className={`text-xs font-bold font-display ${t.type === 'income' ? 'text-success' : 'text-destructive'}`}>
                      {t.type === 'income' ? '+' : '-'}{formatCurrency(Number(t.amount), false)}
                    </span>
                  </div>
                ))}
                {recentTxns.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No transactions yet.</p>}
              </div>
            </div>
          </div>
        );

      case 'goal_progress':
        return goalsLoading ? (
          <ChartSkeleton key="goal_progress" height={120} />
        ) : (
          <div key="goal_progress" className="card-forged p-5 card-clickable" onClick={() => navigate('/goals')}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-5">Goal Progress</h3>
            <div className="grid md:grid-cols-3 gap-5">
              {(() => {
                // Savings goals ONLY. Vehicles are deliberately not savings goals any more — the
                // Goals page this card links to says "car funds have moved to Vehicles" and lists
                // none, so injecting one here put a tile on the Dashboard that the linked page
                // cannot show, and made this list longer than the "N goals" count beside it.
                // The dedicated `car_goal` widget below covers the vehicle in full detail.
                const retireGoal = goals.find(g => g.goal_type === 'Retirement');
                const otherGoals = [...goals.filter(g => g.goal_type !== 'Retirement')].sort((a, b) => {
                  if (a.goal_type === 'Emergency Fund') return -1;
                  if (b.goal_type === 'Emergency Fund') return 1;
                  return 0;
                });
                return [
                  ...(retireGoal ? [retireGoal] : []),
                  ...otherGoals.slice(0, retireGoal ? 2 : 3),
                ].slice(0, 3) as DashboardGoalEntry[];
              })().map(g => {
                const pct = Number(g.target_amount) > 0 ? Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100) : 0;
                return (
                  <div key={g.id} className="space-y-3 p-4 bg-muted/30 border border-border" style={{ borderRadius: 'var(--radius)' }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold flex items-center gap-1.5">{g.name}</span>
                      <span className="text-xs font-bold text-primary">{pct}%</span>
                    </div>
                    <ProgressBar value={Number(g.current_amount)} max={Number(g.target_amount)} thick showLabel />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{formatCurrency(Number(g.current_amount), false)}</span>
                      <span>{formatCurrency(Number(g.target_amount), false)}</span>
                    </div>
                  </div>
                );
              })}
              {goals.length === 0 && <p className="text-xs text-muted-foreground col-span-3 text-center py-4">No savings goals yet.</p>}
            </div>
          </div>
        );

      case 'advanced_analytics':
        return (
          <PremiumGate
            key="advanced_analytics"
            isPremium={isPremium || isDemo}
            title="Advanced Analytics"
            features={[
              'Emergency runway — months your liquid cash covers at current burn rate',
              'Projected annual savings based on your live cash flow',
              'Average monthly spend trend from the last 5 months',
            ]}
          >
            <div className="card-forged p-5 space-y-6">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Advanced Analytics</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Debt-to-Income" value={dti !== null ? `${dti.toFixed(1)}%` : '—'} sub={dti === null ? 'no debt data' : dti < 28 ? 'healthy' : dti < 43 ? 'caution' : 'high risk'} accent={dti === null ? 'silver' : dti < 28 ? 'success' : dti < 43 ? 'gold' : 'crimson'} icon={Percent} />
                <MetricCard label="Annual Savings" value={formatCurrency(summary.cashFlow * 12, false)} sub="projected" accent={summary.cashFlow >= 0 ? 'success' : 'crimson'} icon={TrendingUp} />
                <MetricCard label="Emergency Runway" value={emergencyRunwayMonths !== null ? `${emergencyRunwayMonths.toFixed(1)} mo` : '—'} sub="above floor / monthly burn" accent={emergencyRunwayMonths === null ? 'silver' : emergencyRunwayMonths >= 3 ? 'success' : emergencyRunwayMonths >= 1 ? 'gold' : 'crimson'} icon={Shield} />
                <MetricCard label="Avg Monthly Spend" value={avgMonthlySpend > 0 ? formatCurrency(avgMonthlySpend, false) : '—'} sub="5-month avg" accent="silver" icon={Wallet} />
              </div>
              <div className="grid lg:grid-cols-2 gap-5 pt-2 border-t border-border/40">
                {/* Assets Breakdown */}
                <div className="min-w-0 overflow-hidden">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Assets Breakdown</h4>
                  <div className="flex flex-col sm:flex-row gap-4">
                    {allAssetsForBreakdown.length > 0 && (
                      <div className="flex justify-center sm:block shrink-0">
                        <ResponsiveContainer width={140} height={140}>
                          <PieChart>
                            <Pie data={allAssetsForBreakdown.map(a => ({ name: a.name, value: Number(a.value) }))} cx="50%" cy="50%" innerRadius={36} outerRadius={62} dataKey="value" strokeWidth={0}>
                              {allAssetsForBreakdown.map((_, i) => <Cell key={i} fill={BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length]} />)}
                            </Pie>
                            <Tooltip content={<BreakdownTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <div className="flex-1 min-w-0 space-y-1">
                      {allAssetsForBreakdown.map((a, idx) => (
                        <div key={a.id} className="flex items-center justify-between gap-2 py-1 text-xs min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: BREAKDOWN_COLORS[idx % BREAKDOWN_COLORS.length] }} />
                            <span className="font-medium truncate">{a.name}</span>
                          </div>
                          <span className="font-bold font-display text-success whitespace-nowrap shrink-0">{formatCurrency(Number(a.value), false)}</span>
                        </div>
                      ))}
                      {allAssetsForBreakdown.length === 0 && <p className="text-xs text-muted-foreground">No assets yet.</p>}
                    </div>
                  </div>
                </div>
                {/* Liabilities Breakdown */}
                <div className="min-w-0 overflow-hidden">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Liabilities Breakdown</h4>
                  <div className="flex flex-col sm:flex-row gap-4">
                    {allLiabilitiesForBreakdown.length > 0 && (
                      <div className="flex justify-center sm:block shrink-0">
                        <ResponsiveContainer width={140} height={140}>
                          <PieChart>
                            <Pie data={allLiabilitiesForBreakdown.map(l => ({ name: l.name, value: Number(l.balance) }))} cx="50%" cy="50%" innerRadius={36} outerRadius={62} dataKey="value" strokeWidth={0}>
                              {allLiabilitiesForBreakdown.map((_, i) => <Cell key={i} fill={BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length]} />)}
                            </Pie>
                            <Tooltip content={<BreakdownTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <div className="flex-1 min-w-0 space-y-1">
                      {allLiabilitiesForBreakdown.map((l, idx) => (
                        <div key={l.id} className="flex items-center justify-between gap-2 py-1 text-xs min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: BREAKDOWN_COLORS[idx % BREAKDOWN_COLORS.length] }} />
                            <span className="font-medium truncate">{l.name}</span>
                          </div>
                          <span className="font-bold font-display text-destructive whitespace-nowrap shrink-0">{formatCurrency(Number(l.balance), false)}</span>
                        </div>
                      ))}
                      {allLiabilitiesForBreakdown.length === 0 && <p className="text-xs text-muted-foreground">No liabilities yet.</p>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </PremiumGate>
        );

      case 'debt_recommendations':
        return (
          <DebtRecommendationsWidget
            key="debt_recommendations"
            debtBreakdown={debtBreakdown}
          />
        );

      default:
        return null;
    }
  };

  // ─── Loading state ────────────────────────────────────────────────────────

  if (essentialLoading) {
    return (
      <div className="py-4 lg:py-6 max-w-6xl mx-auto space-y-8 overflow-x-hidden min-h-[calc(100vh-8rem)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 w-48 bg-muted/50 rounded animate-pulse" />
            <div className="h-4 w-64 bg-muted/50 rounded animate-pulse mt-2" />
          </div>
          <div className="h-9 w-36 bg-muted/50 rounded animate-pulse" />
        </div>
        <ScheduleSkeleton />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <MetricSkeleton key={i} />)}
        </div>
        <ChartSkeleton />
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto space-y-8 overflow-x-hidden">
      {founderNoteVisible && <FounderNoteModal onDismiss={handleFounderNoteDismiss} />}
      {wizardVisible && <OnboardingWizard onComplete={() => setWizardVisible(false)} onDismiss={() => setWizardVisible(false)} />}
      {!isDemo && <AppTour variant="new-user" />}
      <AccountUpdateReminder />
      {!isDemo && <SubscriptionExpiryBanner />}

      {!isDemo && showSecurityBanner && (
        <div className="flex items-start justify-between gap-3 bg-amber-500/8 border border-amber-500/25 px-4 py-3" style={{ borderRadius: 'var(--radius)' }}>
          <div className="flex items-start gap-3">
            <Shield size={15} className="text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-amber-600">Your account has no two-factor protection</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Adding 2FA takes under a minute and significantly reduces the risk of unauthorized access.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link to="/settings#security" className="flex items-center gap-1.5 bg-amber-500 text-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-600 transition-colors btn-press" style={{ borderRadius: 'var(--radius)' }}>
              <Shield size={10} /> Secure my account
            </Link>
            <button onClick={() => setShowSecurityBanner(false)} className="text-muted-foreground hover:text-foreground transition-colors p-1">
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {!isDemo && !profile?.onboarding_completed && !profileLoading && (
        <OnboardingChecklist profile={profile} accounts={accounts} debts={debts} goals={goals} plaidItems={plaidItems} />
      )}

      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Command Center</h1>
              <InstructionsModal
                pageTitle="Dashboard Guide"
                sections={[
                  { title: 'What is this page?', body: 'The Command Center gives you a real-time snapshot of your financial health — income, expenses, net worth, savings, debt, and upcoming bills for the current month.' },
                  { title: 'KPI Cards', body: 'Click any metric card to see exactly how it is calculated, including which accounts and transactions are included.' },
                  { title: 'Projected Month-End Cash', body: 'Shows your expected cash position at month end: current liquid cash + remaining paychecks − remaining expenses − debt payments. Must stay above your cash floor.' },
                  { title: 'Cash Flow Chart', body: 'Displays the last 6 months of income vs expenses with net cash flow trend line.' },
                  { title: 'Customize Dashboard', body: 'Click the Customize button to show/hide widgets and use the up/down arrows to reorder them. Layout is saved to your account.' },
                  { title: 'How edits affect this page', body: 'Changes to Accounts, Budget Control rules, or Debt Payoff recommendations instantly update all dashboard metrics.' },
                ]}
              />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Your financial control system &bull; {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <button
              onClick={() => setCustomizing(true)}
              className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-secondary border border-border px-3 py-2 text-xs font-medium btn-press hover:border-primary/40 hover:text-primary transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <LayoutDashboard size={13} /> Customize
            </button>

            {(isPremium || isDemo) && (
              <button
                onClick={async () =>
                  await exportDashboardPdf({
                    month: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
                    liquidCash: accountSummary.liquidCash,
                    netWorth: accountSummary.netWorth,
                    income: summary.income,
                    // ALL-IN: the PDF has no DEBT SERVICE row, so an Option B figure here would
                    // drop the auto-loan principal out of the document entirely.
                    expenses: expenseModel.expensesAllIn,
                    totalDebtPayments,
                    savingsRate: summary.savingsRate,
                    totalSaved: summary.totalSaved,
                    ccDebt: accountSummary.ccDebt ?? 0,
                  })
                }
                className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-secondary border border-border px-3 py-2 text-xs font-medium btn-press hover:border-primary/40 hover:text-primary transition-colors"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <FileDown size={13} /> PDF
              </button>
            )}

            <Link
              to="/transactions"
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <Plus size={14} /> Add Transaction
            </Link>
          </div>
        </div>
      </div>

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-4">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-foreground">Jordan&apos;s Story — How it all connects</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                26 y/o with $12,700 in CC debt, a steady paycheck, and a plan to be debt-free in under a year.
                Every number here is live-calculated from the data below.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { label: 'Budget Control', desc: 'Recurring rules define income, bills, and transfers — this is the engine behind every projection.', path: '/budget' },
              { label: 'Debt Payoff', desc: 'Avalanche engine computes how fast each card gets paid using every dollar above the cash floor.', path: '/debt' },
              { label: 'Forecast', desc: '60-month sim. Debt payoff adjusts monthly so end cash never sits idle — it goes straight to debt.', path: '/forecast' },
              { label: 'Transactions', desc: 'One-time income (tax refund, bonus) and expenses update cash flow and feed the debt engine.', path: '/transactions' },
              { label: 'Savings & Car Fund', desc: 'Goals track toward specific targets. The car fund models the full purchase: down payment + loan.', path: '/goals' },
              { label: 'Accounts', desc: 'Net worth history, assets/liabilities breakdown, and all account balances in one place.', path: '/accounts' },
            ].map(f => (
              <Link key={f.path} to={f.path} className="group flex gap-2.5 p-3 bg-secondary/40 hover:bg-secondary/70 transition-colors btn-press" style={{ borderRadius: 'var(--radius)' }}>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-primary group-hover:underline">{f.label} →</p>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{f.desc}</p>
                </div>
              </Link>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">All data is fictional and resets when you close the tab.</p>
            <Link to="/auth" className="text-xs font-semibold text-primary hover:underline">Set up your own profile →</Link>
          </div>
        </div>
      )}

      {/* Dynamic widget stack */}
      {visibleWidgets.map(id => renderWidget(id))}

      {/* Customizer panel */}
      {isCustomizing && (
        <DashboardCustomizer
          layout={layout}
          onLayoutChange={setLayout}
          onClose={() => setCustomizing(false)}
          onReset={resetLayout}
        />
      )}

      {calcDrawer && (
        <CalcDrawer
          open={true}
          onClose={() => setCalcDrawer(null)}
          title={calcDrawer.title}
          lines={calcDrawer.lines}
        />
      )}
    </div>
  );
}
