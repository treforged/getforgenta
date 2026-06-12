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
import { useTransactions, useDebts, useSavingsGoals, useCarFunds, useAccounts, useProfile, useRecurringRules, useAssets, useLiabilities } from '@/hooks/useSupabaseData';
import { usePlaidItems } from '@/hooks/usePlaidItems';
import { usePersistedState } from '@/hooks/usePersistedState';
import { generateScheduledEvents, getUpcomingEvents, formatDateShort } from '@/lib/scheduling';
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
import { buildCardData, getMonthlyDebtBreakdown, CC_DEFAULT_CATEGORIES, type MonthlyDebtBreakdown } from "@/lib/credit-card-engine";
import { useCardProjection } from '@/hooks/useCardProjection';
import { getTotalCarLoanMonthly, getActiveCarLoanPayments } from '@/lib/vehicle-loan-engine';
import {
  Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
  Line, CartesianGrid, ComposedChart,
  PieChart, Pie, Cell,
} from 'recharts';
import MonthlyBudgetSnapshot from '@/components/dashboard/MonthlyBudgetSnapshot';
import DebtRecommendationsWidget from '@/components/dashboard/DebtRecommendationsWidget';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import {
  Plus, ArrowUpRight, DollarSign, CreditCard,
  TrendingUp, PiggyBank, Landmark, Percent, Wallet, Repeat,
  CalendarDays, AlertTriangle, Info, X, Car, Shield, Check, FileDown, LayoutDashboard,
} from 'lucide-react';
import { exportDashboardPdf } from '@/lib/exportPdf';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { calculateMonthlyPayment } from '@/lib/calculations';
import { supabase } from '@/integrations/supabase/client';
import type { WidgetId } from '@/lib/dashboard-widgets';

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border px-3 py-2 text-xs" style={{ borderRadius: 'var(--radius)' }}>
      <p className="font-medium text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
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

function BreakdownTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border px-3 py-2 text-xs" style={{ borderRadius: 'var(--radius)' }}>
      <p className="font-medium">{payload[0].payload.name}</p>
      <p className="text-primary font-semibold">{formatCurrency(payload[0].value, false)}</p>
    </div>
  );
}

const ACCOUNT_TYPE_TO_GROUP: Record<string, string> = {
  checking: 'Checking', savings: 'Savings', high_yield_savings: 'Savings',
  business_checking: 'Checking', cash: 'Cash', brokerage: 'Brokerage',
  '401k': 'Retirement', roth_ira: 'Retirement', ira: 'Retirement',
  hsa: 'Retirement', credit_card: 'Credit Card',
  mortgage: 'Mortgage', student_loan: 'Student Loan', auto_loan: 'Auto Loan',
  other_liability: 'Other Liability', other_asset: 'Other Asset',
};

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
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
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

  useRetirementAutoUpdate(profile, accounts, isDemo, isPremium);
  const { data: debts, loading: debtsLoading } = useDebts();
  const { data: goals, loading: goalsLoading } = useSavingsGoals();
  const { data: carFunds } = useCarFunds();
  const { data: rules, loading: rulesLoading } = useRecurringRules();
  const { items: plaidItems } = usePlaidItems();
  const { data: manualAssets } = useAssets();
  const { data: manualLiabilities } = useLiabilities();

  const { layout, setLayout, visibleWidgets, isCustomizing, setCustomizing, resetLayout } = useDashboardLayout();

  // Signal Swift cover that the dashboard has mounted and is ready to paint.
  useEffect(() => {
    (window as any).__forgenta_dashboard_ready = true;
    return () => { (window as any).__forgenta_dashboard_ready = false; };
  }, []);

  const [pauseSavings] = usePersistedState<boolean>('tre:debtpayoff:pause-savings', false);
  const [calcDrawer, setCalcDrawer] = useState<{ title: string; lines: { label: string; value: string; op?: string }[] } | null>(null);
  const [showSecurityBanner, setShowSecurityBanner] = useState(false);
  const [founderNoteVisible, setFounderNoteVisible] = useState(false);
  const [wizardVisible, setWizardVisible] = useState(false);
  const onboardingInitRef = useRef(false);

  useEffect(() => {
    if (isDemo) return;
    supabase.auth.mfa.listFactors().then(({ data }) => {
      if (!data) return;
      const raw = data as any;
      const all = [...(data.totp ?? []), ...(data.phone ?? []), ...((raw.email ?? []) as any[])];
      const hasVerified = all.some((f: any) => f.status === 'verified');
      setShowSecurityBanner(!hasVerified);
    });
  }, [isDemo]);

  const FOUNDER_NOTE_KEY = 'forged:founder_note_seen';

  useEffect(() => {
    if (isDemo || profileLoading || debtsLoading || goalsLoading || acctLoading || onboardingInitRef.current) return;
    onboardingInitRef.current = true;
    const p = profile as any;
    const alreadySeenThisSession = sessionStorage.getItem(FOUNDER_NOTE_KEY) === '1';
    if (p?.founder_note_seen === false && !alreadySeenThisSession) {
      setFounderNoteVisible(true);
    } else if (
      p?.onboarding_completed === false &&
      !sessionStorage.getItem('forged:onboarding_wizard_dismissed') &&
      (isReviewer || (accounts.length === 0 && debts.length === 0 && goals.length === 0))
    ) {
      setWizardVisible(true);
    }
  }, [isDemo, profileLoading, debtsLoading, goalsLoading, acctLoading, profile, accounts, debts, goals]);

  const handleFounderNoteDismiss = () => {
    sessionStorage.setItem(FOUNDER_NOTE_KEY, '1');
    setFounderNoteVisible(false);
    const p = profile as any;
    if (
      p?.onboarding_completed === false &&
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
    const map: Record<string, any> = {};
    accounts.forEach((a: any) => {
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
    const defaultId = (profile as any)?.default_deposit_account;
    if (defaultId) return defaultId;
    const checking = accounts.find((a: any) => a.account_type === 'checking' && a.active);
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
      accounts.filter((a: any) => a.active && ['401k', 'roth_ira', 'ira', 'hsa'].includes(a.account_type)).map((a: any) => a.id),
    );
    const now = new Date();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const activeTransferDests = new Set<string>(
      (rules as any[]).filter((r: any) =>
        r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment') && r.deposit_account &&
        !(r.start_date && new Date(r.start_date + 'T00:00:00') > monthEnd) &&
        !(r.end_date && new Date(r.end_date + 'T00:00:00') < now),
      ).map((r: any) => r.deposit_account),
    );
    const savingsTotal = goals.reduce((s: number, g: any) => {
      if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > now) return s;
      if (g.linked_account && retireIds.has(g.linked_account)) return s;
      if (g.linked_account && activeTransferDests.has(g.linked_account)) return s;
      return s + Number(g.monthly_contribution);
    }, 0);
    const carTotal = (carFunds as any[]).reduce((s: number, c: any) => {
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
      // Linked-account cars keep savings in the same checking pool used for CC payments.
      // For purchases within 12 months, reserve the full gift-adjusted down payment spread
      // over months-to-goal so available-to-deploy properly accounts for the upcoming cash event.
      const reserve = (c.linked_account && monthsToGoal <= 12)
        ? Math.min(giftAdjDownPmt / monthsToGoal, giftAdjDownPmt)
        : Math.min(rem / monthsToGoal, rem);
      return s + reserve;
    }, 0);
    const carLoanTotal = getTotalCarLoanMonthly(carFunds as any[]);
    return savingsTotal + carTotal + carLoanTotal;
  }, [pauseSavings, goals, carFunds, accounts, rules]);

  const month0SavingsBreakdown = useMemo((): { label: string; value: number }[] => {
    if (pauseSavings) return [];
    const retireIds = new Set<string>(
      accounts.filter((a: any) => a.active && ['401k', 'roth_ira', 'ira', 'hsa'].includes(a.account_type)).map((a: any) => a.id),
    );
    const now = new Date();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const activeTransferDests = new Set<string>(
      (rules as any[]).filter((r: any) =>
        r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment') && r.deposit_account &&
        !(r.start_date && new Date(r.start_date + 'T00:00:00') > monthEnd) &&
        !(r.end_date && new Date(r.end_date + 'T00:00:00') < now),
      ).map((r: any) => r.deposit_account),
    );
    const items: { label: string; value: number }[] = [];
    for (const g of goals as any[]) {
      if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > now) continue;
      if (g.linked_account && retireIds.has(g.linked_account)) continue;
      if (g.linked_account && activeTransferDests.has(g.linked_account)) continue;
      const contrib = Number(g.monthly_contribution);
      if (contrib > 0) items.push({ label: g.name, value: contrib });
    }
    for (const c of carFunds as any[]) {
      if (c.phase === 'loan') continue;
      const gift = Number(c.gift_contribution || 0);
      const giftAdjDownPmt = Math.max(0, Number(c.down_payment_goal) - gift);
      const savedAmt = c.linked_account && accountMap[c.linked_account]
        ? Number(accountMap[c.linked_account].balance)
        : Number(c.current_saved);
      const rem = Math.max(0, giftAdjDownPmt - savedAmt);
      if (rem <= 0) continue;
      let monthsToGoal = 12;
      if (c.planned_purchase_date) {
        const parts = (c.planned_purchase_date as string).split('-').map(Number);
        const pd = new Date(parts[0], parts[1] - 1, parts[2]);
        monthsToGoal = Math.max(1, (pd.getFullYear() - now.getFullYear()) * 12 + (pd.getMonth() - now.getMonth()) + 1);
      }
      const reserve = Math.min(rem / monthsToGoal, rem);
      if (reserve > 0) items.push({ label: c.vehicle_name, value: Math.round(reserve) });
    }
    return items;
  }, [pauseSavings, goals, carFunds, accounts, rules, accountMap]);

  const debtCards = useMemo(
    () => buildCardData(accounts, baseTxns, rules, debts),
    [accounts, baseTxns, rules, debts],
  );

  // Mirror Forecast's syncCutoffDate: use funding account's Plaid last_synced_at so remaining
  // transactions roll over at 9am ET when accounts update, not at midnight.
  const syncCutoffDate = useMemo((): string => {
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (!fundingAccountId) return localDate;
    const fundingAcct = accounts.find((a: any) => a.id === fundingAccountId);
    if (!fundingAcct?.plaid_item_id) return localDate;
    const plaidItem = plaidItems.find((pi: any) => pi.plaid_item_id === fundingAcct.plaid_item_id);
    if (!plaidItem?.last_synced_at) return localDate;
    return plaidItem.last_synced_at.split('T')[0];
  }, [fundingAccountId, accounts, plaidItems]);

  const debtBreakdown = useMemo<MonthlyDebtBreakdown>(() => {
    // No floorOverride — let buildCurrentMonthRecommendationSummary compute ppBills + ccFloor
    // so the safe minimum matches the Debt Payoff engine. syncCutoffDate aligns remaining
    // income/expense windows with the Debt Payoff page.
    return getMonthlyDebtBreakdown(accounts, baseTxns, rules, debts, profile, monthlySavingsAndCar, undefined, syncCutoffDate);
  }, [accounts, baseTxns, rules, debts, profile, monthlySavingsAndCar, syncCutoffDate]);

  const debtPaymentTxns = useMemo(
    () => createDebtPaymentTransactions(debtBreakdown.recommendations, fundingAccountId),
    [debtBreakdown.recommendations, fundingAccountId],
  );

  const allMonthTransactions = useMemo(
    () => mergeDebtPaymentsIntoStream(baseTxns, debtPaymentTxns),
    [baseTxns, debtPaymentTxns],
  );

  const accountSummary = useMemo(() => {
    if (!accounts.length) {
      return { liquidCash: 0, totalAssets: 0, totalLiabilities: 0, netWorth: 0, ccDebt: 0, ccLimit: 0 };
    }

    const active = accounts.filter((a: any) => a.active);
    const liquidTypes = ['checking', 'savings', 'high_yield_savings', 'business_checking', 'cash'];
    const investTypes = ['brokerage'];
    const retireTypes = ['roth_ira', '401k'];
    const liabilityTypes = ['credit_card', 'student_loan', 'auto_loan', 'other_liability'];
    const assetTypes = [...liquidTypes, ...investTypes, ...retireTypes, 'other_asset'];

    const liquidCash = active.filter((a: any) => liquidTypes.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance || 0), 0);
    const totalAssets = active.filter((a: any) => assetTypes.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance || 0), 0);
    const totalLiabilities = active.filter((a: any) => liabilityTypes.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance || 0), 0);
    const ccDebt = active.filter((a: any) => a.account_type === 'credit_card').reduce((s: number, a: any) => s + Number(a.balance || 0), 0);
    const ccLimit = active.filter((a: any) => a.account_type === 'credit_card' && a.credit_limit).reduce((s: number, a: any) => s + Number(a.credit_limit || 0), 0);

    return { liquidCash, totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities, ccDebt, ccLimit };
  }, [accounts]);

  const liveAssetsForBreakdown = useMemo(() => {
    const assetAccountTypes = ['checking', 'savings', 'high_yield_savings', 'business_checking', 'cash', 'brokerage', 'roth_ira', '401k', 'ira', 'hsa', 'other_asset'];
    return accounts
      .filter((a: any) => a.active && assetAccountTypes.includes(a.account_type))
      .map((a: any) => ({ id: `live:${a.id}`, name: a.name, type: ACCOUNT_TYPE_TO_GROUP[a.account_type] || 'Other', value: Number(a.balance), isLive: true }));
  }, [accounts]);

  const liveLiabilitiesForBreakdown = useMemo(() => {
    const liabilityAccountTypes = ['credit_card', 'mortgage', 'student_loan', 'auto_loan', 'other_liability'];
    return accounts
      .filter((a: any) => a.active && liabilityAccountTypes.includes(a.account_type))
      .map((a: any) => ({ id: `live:${a.id}`, name: a.name, type: ACCOUNT_TYPE_TO_GROUP[a.account_type] || 'Other Liability', balance: Number(a.balance), isLive: true }));
  }, [accounts]);

  const allAssetsForBreakdown = useMemo(() => {
    const liveNames = new Set(liveAssetsForBreakdown.map((a: any) => a.name.toLowerCase()));
    const manual = (manualAssets as any[]).filter((a: any) => !liveNames.has(a.name.toLowerCase())).map((a: any) => ({ ...a, isLive: false }));
    return [...liveAssetsForBreakdown, ...manual];
  }, [liveAssetsForBreakdown, manualAssets]);

  const allLiabilitiesForBreakdown = useMemo(() => {
    const liveNames = new Set(liveLiabilitiesForBreakdown.map((l: any) => l.name.toLowerCase()));
    const manual = (manualLiabilities as any[]).filter((l: any) => !liveNames.has(l.name.toLowerCase())).map((l: any) => ({ ...l, isLive: false }));
    return [...liveLiabilitiesForBreakdown, ...manual];
  }, [liveLiabilitiesForBreakdown, manualLiabilities]);

  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const currentMonthTransactions = useMemo(
    () => allMonthTransactions.filter((t: any) => t.date?.startsWith(currentMonthStr)),
    [allMonthTransactions, currentMonthStr],
  );

  const expenseBreakdown = useMemo(
    () => categorizeExpenses(currentMonthTransactions, true),
    [currentMonthTransactions],
  );

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
      .filter((t: any) => t.type === 'income' && t.category !== 'Balance Adjustment')
      .reduce((s: number, t: any) => s + Number(t.amount || 0), 0);

    const expenses = Object.values(expenseBreakdown).reduce((s: number, v: number) => s + v, 0);
    const totalDebt = debts.reduce((s: number, d: any) => s + Number(d.balance || 0), 0);

    const totalSaved = goals.reduce((s: number, g: any) => {
      if ((g as any).linked_account && accountMap[(g as any).linked_account]) {
        return s + Number(accountMap[(g as any).linked_account].balance);
      }
      return s + Number(g.current_amount || 0);
    }, 0);

    const cashFlow = income - expenses - totalDebtPayments;
    const savingsRate = income > 0 ? (cashFlow / income) * 100 : 0;
    const carSaved = carFunds[0] ? Number(carFunds[0].current_saved || 0) : 0;
    const carGoal = carFunds[0] ? Number(carFunds[0].down_payment_goal || 1) : 1;

    return { income, expenses, cashFlow, totalDebt, totalSaved, savingsRate, carSaved, carGoal };
  }, [currentMonthTransactions, expenseBreakdown, totalDebtPayments, debts, goals, carFunds, accountMap]);

  const scheduledEvents = useMemo(() => {
    if (!rules.length) return [];
    try { return generateScheduledEvents(rules, accounts, 1); } catch { return []; }
  }, [rules, accounts]);

  const upcomingWeek = useMemo(() => getUpcomingEvents(scheduledEvents, 7), [scheduledEvents]);
  const upcomingMonth = useMemo(() => getUpcomingEvents(scheduledEvents, 30), [scheduledEvents]);
  const upcomingBillsWeek = upcomingWeek.filter(e => e.type === 'expense');
  const upcomingBillsMonth = upcomingMonth.filter(e => e.type === 'expense');

  const utilization = accountSummary.ccLimit > 0 ? (accountSummary.ccDebt / accountSummary.ccLimit) * 100 : 0;

  const remainingTxIncome = useMemo(() => getRemainingTransactionIncomeThisMonth(allMonthTransactions, syncCutoffDate), [allMonthTransactions, syncCutoffDate]);
  const remainingTxExpenses = useMemo(() => getRemainingTransactionExpensesThisMonth(allMonthTransactions, true, syncCutoffDate, debtFundingSources, CC_DEFAULT_CATEGORIES), [allMonthTransactions, syncCutoffDate, debtFundingSources]);
  const remainingTxDebt = useMemo(() => getRemainingTransactionDebtPaymentsThisMonth(allMonthTransactions, syncCutoffDate), [allMonthTransactions, syncCutoffDate]);

  const cashFloor = (profile as any)?.cash_floor != null ? Number((profile as any).cash_floor) : 1000;

  // ── month0 via shared hook (mirrors Forecast PASS 3 Step 2) ─────────────────
  const [debtStrategy] = usePersistedState<'avalanche' | 'snowball'>('tre:debt:strategy', 'avalanche');
  const [persistedDebtFundingId] = usePersistedState<string>('tre:debt:fundingAccount', '');
  const [forecastAssumptions] = usePersistedState('tre:forecast:assumptions', {
    incomeGrowthEnabled: true, incomeGrowth: 3, raiseMonth: 3, raiseMode: 'pct' as 'pct' | 'flat',
    expenseGrowth: 2.5,
    bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as 'flat' | 'pct', bonusMonth: 12, bonusRecurring: true,
    taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
  });
  const scheduledEvents36 = useMemo(
    () => generateScheduledEvents(rules, accounts, 36),
    [rules, accounts],
  );
  const debtPayoffOptions = useMemo(() => ({
    strategy: debtStrategy,
    paymentMode: 'variable' as const,
    cashFloor,
    overrides: {} as Record<string, Record<number, number>>,
  }), [cashFloor, debtStrategy]);
  const projectionAssumptions = useMemo(() => ({
    incomeGrowthEnabled: forecastAssumptions.incomeGrowthEnabled,
    incomeGrowth: forecastAssumptions.incomeGrowth,
    raiseMonth: forecastAssumptions.raiseMonth,
    raiseMode: forecastAssumptions.raiseMode,
    expenseGrowth: forecastAssumptions.expenseGrowth,
    bonusEnabled: forecastAssumptions.bonusEnabled,
    bonusAmount: forecastAssumptions.bonusAmount,
    bonusMode: forecastAssumptions.bonusMode,
    bonusMonth: forecastAssumptions.bonusMonth,
    bonusRecurring: forecastAssumptions.bonusRecurring,
    taxReturnEnabled: forecastAssumptions.taxReturnEnabled,
    taxReturnAmountOverride: forecastAssumptions.taxReturnAmountOverride ?? 0,
    taxReturnMonth: forecastAssumptions.taxReturnMonth,
  }), [forecastAssumptions]);
  const cardProjection = useCardProjection({
    accounts, transactions, rules, debts, goals, carFunds: carFunds as any[],
    profile, debtPayoffOptions, payConfig, scheduledEvents: scheduledEvents36,
    pauseSavings, forecastFundingAccountId: fundingAccountId, debtStrategy,
    persistedDebtFundingId, assumptions: projectionAssumptions,
  });

  const month0SaveUpNote = useMemo(() => {
    if (!cardProjection?.saveUpMonths?.has(0)) return null;
    return cardProjection.saveUpReason?.get(0) ?? null;
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
  // Used to make the floor row in MonthlyBudgetSnapshot match Forecast's floor exactly.
  const forecastFloor0 = useMemo((): {
    monthMinSafe: number;
    floorItems: { name: string; amount: number; dueDay?: number }[];
    prePaycheckBillsTotal: number;
  } => {
    let prePaycheckBillsTotal = prePaycheckBills.total;
    const floorItems: { name: string; amount: number; dueDay?: number }[] = [...prePaycheckBills.items];

    for (const cf of (carFunds ?? []) as any[]) {
      if (cf.phase !== 'loan' || !cf.payment_start_date) continue;
      const loanDueDay = new Date(cf.payment_start_date + 'T00:00:00').getDate();
      const carPayments = getActiveCarLoanPayments([cf], new Date());
      for (const cp of carPayments) {
        prePaycheckBillsTotal += cp.payment;
        floorItems.push({ name: cf.vehicle_name + ' loan', amount: cp.payment, dueDay: loanDueDay });
      }
    }

    for (const card of (cardProjection?.simCards ?? [])) {
      const revBal = cardProjection?.monthlyRevolvingBalances?.get(card.id)?.[0] ?? 1;
      if (revBal > 0) {
        const minPay = cardProjection?.perCardMinPayments?.get(card.id)?.[0] ?? 0;
        if (minPay > 0 && card.dueDay) {
          prePaycheckBillsTotal += minPay;
          floorItems.push({ name: card.name + ' min', amount: minPay, dueDay: card.dueDay });
        }
      } else {
        if (card.paymentPreference !== 'statement' && card.paymentPreference !== 'full' && !card.autopayFullBalance) continue;
        if (!card.dueDay || card.monthlyNewPurchases <= 0) continue;
        prePaycheckBillsTotal += card.monthlyNewPurchases;
        floorItems.push({ name: card.name + ' purchases', amount: card.monthlyNewPurchases, dueDay: card.dueDay });
      }
    }

    const monthMinSafe = Math.max(cashFloor, prePaycheckBillsTotal);
    return { monthMinSafe, floorItems, prePaycheckBillsTotal };
  }, [prePaycheckBills, carFunds, cashFloor]);

  const fundingBalance = useMemo(() => {
    const fundAcct = accounts.find((a: any) => a.id === fundingAccountId);
    if (fundAcct) return Number(fundAcct.balance);
    return accountSummary.liquidCash;
  }, [accounts, fundingAccountId, accountSummary]);

  const monthEndCash = useMemo(
    () => fundingBalance + remainingTxIncome - remainingTxExpenses - remainingTxDebt,
    [fundingBalance, remainingTxIncome, remainingTxExpenses, remainingTxDebt],
  );

  // Implicit engine holdback: everything the engine reserves beyond the stated cashFloor
  // (savings goals, car reserves, floor differences). Derived as a residual so the
  // snapshot equation always balances: projSurplus − cashFloor − holdback = safeToPayTotal.
  const month0ImpliedSavings = useMemo(() => {
    const safeToPayTotal = cardProjection?.month0?.safeToPayTotal;
    if (safeToPayTotal == null) return 0;
    const projSurplus = fundingBalance + remainingTxIncome - remainingTxExpenses;
    return Math.max(0, projSurplus - forecastFloor0.monthMinSafe - safeToPayTotal);
  }, [cardProjection, fundingBalance, remainingTxIncome, remainingTxExpenses, forecastFloor0]);

  // Debt recommendations for Dashboard widget — driven by useCardProjection pass-3 (month0)
  // so floor, save-up reserves, income timing, and goals all match the Debt Payoff tab exactly.
  const dashboardDebtRecs = useMemo<MonthlyDebtBreakdown>(() => {
    const m0 = cardProjection?.month0;
    const simCards = cardProjection?.simCards ?? [];
    const strategyLabel = debtStrategy === 'avalanche' ? 'Avalanche' : 'Snowball';
    if (!debtCards.length || !m0) {
      return { recommendations: [], totalMinimumsDue: 0, totalRecommended: 0, totalAvailableCash: 0, autopayTotal: 0, strategyLabel, cashWarning: false, interestAvoided: 0 };
    }
    const totalAvailableCash = m0.safeToPayTotal;
    const totalMinimumsDue = simCards
      .filter(c => !c.autopayFullBalance && c.balance > 0)
      .reduce((s, c) => s + Math.min(c.minPayment, c.balance), 0);
    const autopayTotal = simCards
      .filter(c => c.autopayFullBalance)
      .reduce((s, c) => s + c.monthlyNewPurchases, 0);
    const recommendations = m0.perCardAdjusted.map(item => {
      const card = simCards.find(c => c.id === item.id);
      let reason = '';
      let isMinimumOnly = false;
      if (card?.autopayFullBalance || (card && card.balance <= 0)) {
        if (card?.paymentPreference === 'statement') reason = 'Statement balance';
        else if (card?.paymentPreference === 'full') reason = 'Full balance';
        else reason = 'Autopay Full Balance';
      } else {
        const min = Math.min(card?.minPayment ?? 0, card?.balance ?? 0);
        isMinimumOnly = item.payment <= min + 0.01;
        reason = isMinimumOnly
          ? 'Minimum payment'
          : debtStrategy === 'avalanche'
            ? 'Avalanche priority'
            : 'Snowball priority';
      }
      return {
        cardId: item.id, cardName: item.name,
        color: card?.color ?? '#888',
        payment: item.payment, dueDay: card?.dueDay ?? null,
        reason, isMinimumOnly,
      };
    });
    const totalRecommended = recommendations.reduce((s, r) => s + r.payment, 0);
    const cashWarning = totalAvailableCash < totalMinimumsDue;
    return { recommendations, totalMinimumsDue, totalRecommended, totalAvailableCash, autopayTotal, strategyLabel, cashWarning, interestAvoided: 0 };
  }, [cardProjection, debtCards, debtStrategy]);

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
        months.push({ month: monthName, income: summary.income, expenses: summary.expenses, net: summary.cashFlow });
      } else {
        const monthTxns = baseTxns.filter((t: any) => t.date?.startsWith(monthStr));
        const inc = monthTxns.filter((t: any) => t.type === 'income' && t.category !== 'Balance Adjustment').reduce((s: number, t: any) => s + Number(t.amount), 0);
        const expBreakdown = categorizeExpenses(monthTxns, true);
        const exp = Object.values(expBreakdown).reduce((s: number, v: number) => s + v, 0);
        months.push({ month: monthName, income: Math.round(inc), expenses: Math.round(exp), net: Math.round(inc - exp) });
      }
    }

    return months;
  }, [summary, baseTxns]);

  const avgMonthlySpend = useMemo(() => {
    const past = cashFlowData.slice(0, 5);
    const total = past.reduce((s, m) => s + m.expenses, 0);
    return past.length > 0 ? total / past.length : 0;
  }, [cashFlowData]);

  const emergencyRunwayMonths = useMemo(() => {
    const burn = summary.expenses + totalDebtPayments;
    if (burn <= 0) return null;
    const available = Math.max(0, accountSummary.liquidCash - cashFloor);
    return available / burn;
  }, [accountSummary.liquidCash, cashFloor, summary.expenses, totalDebtPayments]);

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
      .filter((t: any) => t.date <= todayStr && t.date >= cutoffStr)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6);
  }, [allMonthTransactions]);

  const carGoalData = useMemo(() => {
    if (carFunds && carFunds.length > 0) {
      const c = carFunds[0] as any;
      const linkedAcctBal = c.linked_account && accountMap[c.linked_account]
        ? Number(accountMap[c.linked_account].balance)
        : null;
      const saved = linkedAcctBal ?? Number(c.current_saved);
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
    const carGoal = goals?.find((g: any) => g.goal_type === 'Car Fund');
    if (carGoal) {
      return { name: (carGoal as any).name, saved: Number((carGoal as any).current_amount), target: Number((carGoal as any).target_amount), fullDownPayment: Number((carGoal as any).target_amount), gift: 0, monthlyNeeded: 0, price: 0, apr: 0, term: 0, isCarFund: false };
    }
    return null;
  }, [carFunds, goals, accountMap]);

  // ─── Calc drawer openers ──────────────────────────────────────────────────

  const openMonthEndCalc = () => {
    const engineMinimums = dashboardDebtRecs.totalMinimumsDue;
    const engineTotal = dashboardDebtRecs.totalRecommended;
    const engineExtra = Math.max(0, engineTotal - engineMinimums);
    const lines: { label: string; value: string; op?: string }[] = [
      { label: 'Funding Account Balance', value: formatCurrency(fundingBalance, false) },
      { label: 'Remaining Income', value: formatCurrency(remainingTxIncome, false), op: '+' },
      { label: 'Remaining Expenses', value: formatCurrency(remainingTxExpenses, false), op: '−' },
      { label: 'Remaining Debt Payments', value: formatCurrency(remainingTxDebt, false), op: '−' },
      { label: 'Projected Month-End Cash', value: formatCurrency(monthEndCash, false), op: '=' },
      { label: '', value: '' },
      { label: 'Minimum Payments Due (this month)', value: formatCurrency(engineMinimums, false) },
      ...(engineExtra > 0 ? [{ label: 'Extra Debt Payoff (above minimums)', value: formatCurrency(engineExtra, false), op: '+' }] : []),
      { label: 'Total Recommended Debt Payment', value: formatCurrency(engineTotal, false), op: '=' },
      { label: '', value: '' },
      { label: 'Your Cash Floor Setting', value: formatCurrency(cashFloor, false) },
      { label: `Pre-paycheck bills (${prePaycheckBills.items.length} items)`, value: formatCurrency(prePaycheckBills.total, false) },
      { label: 'Effective Cash Floor (used in debt payoff)', value: formatCurrency(forecastFloor0.monthMinSafe, false), op: '≥' },
      { label: '', value: '' },
      {
        label: monthEndCash >= forecastFloor0.monthMinSafe
          ? '✅ Cash is above safety threshold'
          : '⚠️ Cash is below safety threshold — debt payments may need adjustment',
        value: '',
      },
    ];
    setCalcDrawer({ title: 'Projected Month-End Cash', lines });
  };

  const openIncomeCalc = () => {
    const incomeItems = currentMonthTransactions.filter((t: any) => t.type === 'income');
    const paycheckCount = getPaychecksInMonth(payConfig, now.getFullYear(), now.getMonth());
    const lines: { label: string; value: string; op?: string }[] = [
      { label: `Pay Schedule: ${payConfig.frequency}`, value: `${payConfig.paycheckDay === 5 ? 'Fri' : `Day ${payConfig.paycheckDay}`}` },
      { label: 'Net per paycheck (post-tax)', value: formatCurrency(paycheckNet, false) },
      { label: 'Paychecks this month', value: String(paycheckCount.length) },
      { label: `${incomeItems.length} income transactions`, value: '' },
    ];
    incomeItems.slice(0, 8).forEach((t: any) => {
      lines.push({ label: `  ${(t as any).note || t.category}`, value: formatCurrency(Number(t.amount), false), op: '+' });
    });
    lines.push({ label: 'Total Monthly Income', value: formatCurrency(summary.income, false), op: '=' });
    setCalcDrawer({ title: 'Monthly Income', lines });
  };

  const openExpenseCalc = () => {
    const lines: { label: string; value: string; op?: string }[] = [
      { label: 'All current-month expense transactions (excluding debt):', value: '' },
    ];
    Object.entries(expenseBreakdown)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, val]) => lines.push({ label: `  ${cat}`, value: formatCurrency(val, false), op: '+' }));
    lines.push({ label: 'Total Monthly Expenses', value: formatCurrency(summary.expenses, false), op: '=' });
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
    const active = accounts.filter((a: any) => a.active);
    const lines: { label: string; value: string; op?: string }[] = [];
    const assetAccts = active.filter((a: any) => !['credit_card', 'student_loan', 'auto_loan', 'other_liability'].includes(a.account_type));
    const liabAccts = active.filter((a: any) => ['credit_card', 'student_loan', 'auto_loan', 'other_liability'].includes(a.account_type));
    lines.push({ label: `Assets (${assetAccts.length} accounts)`, value: '' });
    assetAccts.forEach((a: any) => lines.push({ label: `  ${a.name}`, value: formatCurrency(Number(a.balance), false), op: '+' }));
    lines.push({ label: 'Total Assets', value: formatCurrency(accountSummary.totalAssets, false), op: '=' });
    lines.push({ label: `Liabilities (${liabAccts.length} accounts)`, value: '' });
    liabAccts.forEach((a: any) => lines.push({ label: `  ${a.name}`, value: formatCurrency(Number(a.balance), false), op: '−' }));
    lines.push({ label: 'Total Liabilities', value: formatCurrency(accountSummary.totalLiabilities, false), op: '=' });
    lines.push({ label: 'Net Worth', value: formatCurrency(accountSummary.netWorth, false), op: '=' });
    setCalcDrawer({ title: 'Net Worth', lines });
  };

  const openLiquidCashCalc = () => {
    const active = accounts.filter((a: any) => a.active && ['checking', 'savings', 'high_yield_savings', 'business_checking', 'cash'].includes(a.account_type));
    const lines: { label: string; value: string; op?: string }[] = [];
    active.forEach((a: any) => lines.push({ label: a.name, value: formatCurrency(Number(a.balance), false), op: '+' }));
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
        return (
          <MonthlyBudgetSnapshot
            key="monthly_snapshot"
            fundingBalance={fundingBalance}
            remainingIncome={remainingTxIncome}
            spentSoFar={summary.expenses + totalDebtPayments}
            expectedRemainingExpenses={remainingTxExpenses}
            projectedSurplus={fundingBalance + remainingTxIncome - remainingTxExpenses}
            cashFloor={forecastFloor0.monthMinSafe}
            savingsAndReserves={month0ImpliedSavings}
            savingsBreakdown={month0SavingsBreakdown}
            availableToDeploy={cardProjection?.month0?.safeToPayTotal}
            saveUpNote={month0SaveUpNote}
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
          <div key="financial_health" className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <ClickableMetric onClick={openLiquidCashCalc} tooltip="View liquid cash breakdown">
              <MetricCard label="Liquid Cash" value={formatCurrency(accountSummary.liquidCash, false)} accent="success" icon={DollarSign} />
            </ClickableMetric>
            <ClickableMetric onClick={openIncomeCalc} tooltip="How income is calculated">
              <MetricCard label="Monthly Income" value={summary.income > 0 ? formatCurrency(summary.income, false) : '—'} accent="success" icon={TrendingUp} />
            </ClickableMetric>
            <ClickableMetric onClick={openExpenseCalc} tooltip="How expenses are calculated">
              <MetricCard label="Monthly Expenses" value={summary.expenses > 0 ? formatCurrency(summary.expenses, false) : '—'} accent="crimson" icon={CreditCard} />
            </ClickableMetric>
          </div>
        );

      case 'wealth_overview':
        return (
          <div key="wealth_overview" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <ClickableMetric onClick={openNetWorthCalc} tooltip="How net worth is calculated">
              <MetricCard label="Net Worth" value={formatCurrency(accountSummary.netWorth, false)} accent={accountSummary.netWorth >= 0 ? 'gold' : 'crimson'} icon={Wallet} sub={`${formatCurrency(accountSummary.totalAssets, false)} assets`} />
            </ClickableMetric>
            <ClickableMetric to="/budget" tooltip="Savings rate = (income - expenses) / income">
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
          <div key="car_goal" className="card-forged p-5 card-clickable" onClick={() => navigate('/goals')}>
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
                {recentTxns.map((t: any) => (
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
                const retireGoal = goals.find((g: any) => g.goal_type === 'Retirement');
                const otherGoals = [...goals.filter((g: any) => g.goal_type !== 'Retirement')].sort((a: any, b: any) => {
                  if (a.goal_type === 'Emergency Fund') return -1;
                  if (b.goal_type === 'Emergency Fund') return 1;
                  return 0;
                });
                const carEntry = carFunds[0] ? (() => {
                  const c = carFunds[0] as any;
                  const livebal = c.linked_account && accountMap[c.linked_account] ? Number(accountMap[c.linked_account].balance) : Number(c.current_saved);
                  const personalGoal = Math.max(0, Number(c.down_payment_goal) - Number(c.gift_contribution || 0));
                  return [{ id: 'car-dash', name: c.vehicle_name, current_amount: livebal, target_amount: personalGoal, isCar: true }];
                })() : [];
                return [
                  ...(retireGoal ? [retireGoal] : []),
                  ...otherGoals.slice(0, retireGoal ? 1 : 2),
                  ...carEntry,
                ].slice(0, 3);
              })().map((g: any) => {
                const pct = Number(g.target_amount) > 0 ? Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100) : 0;
                return (
                  <div key={g.id} className="space-y-3 p-4 bg-muted/30 border border-border" style={{ borderRadius: 'var(--radius)' }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold flex items-center gap-1.5">
                        {g.isCar && <Car size={11} className="text-primary" />}
                        {g.name}
                      </span>
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
              {goals.length === 0 && !carFunds[0] && <p className="text-xs text-muted-foreground col-span-3 text-center py-4">No savings goals yet.</p>}
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
                            <Pie data={allAssetsForBreakdown.map((a: any) => ({ name: a.name, value: Number(a.value) }))} cx="50%" cy="50%" innerRadius={36} outerRadius={62} dataKey="value" strokeWidth={0}>
                              {allAssetsForBreakdown.map((_: any, i: number) => <Cell key={i} fill={BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length]} />)}
                            </Pie>
                            <Tooltip content={<BreakdownTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <div className="flex-1 min-w-0 space-y-1">
                      {allAssetsForBreakdown.map((a: any, idx: number) => (
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
                            <Pie data={allLiabilitiesForBreakdown.map((l: any) => ({ name: l.name, value: Number(l.balance) }))} cx="50%" cy="50%" innerRadius={36} outerRadius={62} dataKey="value" strokeWidth={0}>
                              {allLiabilitiesForBreakdown.map((_: any, i: number) => <Cell key={i} fill={BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length]} />)}
                            </Pie>
                            <Tooltip content={<BreakdownTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <div className="flex-1 min-w-0 space-y-1">
                      {allLiabilitiesForBreakdown.map((l: any, idx: number) => (
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
            debtBreakdown={dashboardDebtRecs}
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

      {!isDemo && !(profile as any)?.onboarding_completed && !profileLoading && (
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
                    expenses: summary.expenses,
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
              { label: 'Forecast', desc: '36-month sim. Debt payoff adjusts monthly so end cash never sits idle — it goes straight to debt.', path: '/forecast' },
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
