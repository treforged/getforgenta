import PanelBar from '@/components/shared/PanelBar';
import SurfaceGuide from '@/components/shared/SurfaceGuide';
import { useMemo, useState, useEffect, useRef, lazy, Suspense } from 'react';
import { toast } from 'sonner';
import { useRetirementAutoUpdate } from '@/hooks/useRetirementAutoUpdate';
import MetricCard from '@/components/shared/MetricCard';
import AppTour from '@/components/shared/AppTour';
import ProgressBar from '@/components/shared/ProgressBar';
import CategoryIcon from '@/components/shared/CategoryIcon';
import PremiumGate from '@/components/shared/PremiumGate';
import AccountUpdateReminder from '@/components/shared/AccountUpdateReminder';
import FounderNoteModal from '@/components/shared/FounderNoteModal';
import OnboardingChecklist from '@/components/dashboard/OnboardingChecklist';
import SubscriptionExpiryBanner from '@/components/dashboard/SubscriptionExpiryBanner';
import DashboardCustomizer from '@/components/dashboard/DashboardCustomizer';
import { formatCurrency, formatYAxisTick } from '@/lib/calculations';
import { categorizeExpenses, getDebtPaymentsByCard } from '@/lib/expense-filtering';
import { MetricSkeleton, ChartSkeleton, ScheduleSkeleton } from '@/components/dashboard/DashboardSkeleton';
import { useTransactions, useDebts, useSavingsGoals, useCarFunds, useAccounts, useProfile, useRecurringRules, useAssets, useLiabilities, usePaymentPlans, useNetWorthSnapshots, type AccountRow } from '@/hooks/useSupabaseData';
import { useMatchedOccurrences } from '@/hooks/useMatchedOccurrences';
import { substituteSettledOccurrences } from '@/lib/matched-occurrence-display';
import { usePlaidItems } from '@/hooks/usePlaidItems';
import { generateScheduledEvents, getUpcomingEvents, formatDateShort, PROJECTION_MONTHS, type ScheduledEvent } from '@/lib/scheduling';
import { toScheduledObligations } from '@/lib/upcoming-obligations';
import { useSubscription } from '@/hooks/useSubscription';
import { useDashboardLayout } from '@/hooks/useDashboardLayout';
import {
  buildPayConfig,
  getRemainingIncomeThisMonth,
  getMonthlyNetIncome,
  getRemainingPaychecksThisMonth,
  getNextPaycheckDate,
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
} from '@/lib/pay-schedule';
import { CC_DEFAULT_CATEGORIES } from "@/lib/credit-card-engine";
import { getMonthlyPlanCashExpenses, generatePaymentPlanTransactions } from '@/lib/payment-plan-generator';
import { buildMonthlyExpenseModel } from '@/lib/monthly-expense-model';
import { useCardProjectionContext } from '@/contexts/CardProjectionContext';
import { useMonth0DebtBreakdown } from '@/hooks/useMonth0DebtBreakdown';
import { getTotalCarLoanMonthly, generateCarLoanTransactions, getActiveCarLoanPayments, getSavingPhaseCarFund, getCarFundSaved } from '@/lib/vehicle-loan-engine';
import {
  buildNetWorthBreakdown, totalsFromBreakdown, nonCardLiabilityTotal, sumBalanceByAccountType,
  isLiabilityAccountType,
  LIQUID_ACCOUNT_TYPES, INVESTMENT_ACCOUNT_TYPES, RETIREMENT_ACCOUNT_TYPES,
} from '@/lib/net-worth';
import { isCardOpenAsOf } from '@/lib/card-start-date';
import { buildGoalOwnCompletionCutoffs } from '@/lib/goal-linkage';
import {
  Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
  Line, CartesianGrid, ComposedChart,
  PieChart, Pie, Cell,
} from 'recharts';
import MonthlyBudgetSnapshot from '@/components/dashboard/MonthlyBudgetSnapshot';
import BudgetTotalsCard from '@/components/dashboard/BudgetTotalsCard';
import DashboardHero from '@/components/dashboard/DashboardHero';
import DashboardOverviewStrip from '@/components/dashboard/DashboardOverviewStrip';
import CalcDrawer from '@/components/shared/CalcDrawer';
import { selectRevolvingPayoff, selectDashboardHero } from '@/lib/payoff-summary';
import { buildPayoffTrajectory } from '@/lib/payoff-trajectory';
import { debtToIncomeRatio } from '@/lib/debt-to-income';
import { buildMonth0Snapshot } from '@/lib/month0-budget-snapshot';
import DebtRecommendationsWidget from '@/components/dashboard/DebtRecommendationsWidget';
import NetWorthTrendCard from '@/components/dashboard/NetWorthTrendCard';
import LearnCard from '@/components/dashboard/LearnCard';
import { useLearnProgress } from '@/hooks/useLearnProgress';
import { useValueMoments } from '@/hooks/useValueMoments';
import { useNetWorthSnapshotRecorder } from '@/hooks/useNetWorthSnapshotRecorder';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import { useNotificationCheck } from '@/hooks/useNotificationCheck';
import {
  Plus, ArrowUpRight, TrendingUp, Percent, Wallet, Repeat,
  X, Car, Shield, Check, FileDown, LayoutDashboard, Building2, PiggyBank, ChevronDown,
} from 'lucide-react';
import { exportDashboardPdf } from '@/lib/exportPdf';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { calculateMonthlyPayment } from '@/lib/calculations';
import { supabase } from '@/integrations/supabase/client';
import { widgetLabel, type WidgetId } from '@/lib/dashboard-widgets';
import { LESSON_PARAM } from '@/lib/notification-routes';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
// LAZY, not a plain import. Accounts was its own route chunk until today; importing it statically
// folded ~40 kB of it into the Dashboard's chunk, i.e. every Overview paint paid for a panel most
// visits never open. The split is what keeps the merge free.
const Accounts = lazy(() => import('@/pages/Accounts'));
// Lazy for the same reason: Goals owns its own queries, its growth chart and the ranked-surplus
// section, and Overview should not pay for any of them on a visit that never opens the panel.
const GoalsPanel = lazy(() => import('@/pages/SavingsGoals'));
import { usePersistedState } from '@/hooks/usePersistedState';
import { dashboardTabFromSearch, type DashboardTab } from '@/lib/dashboard-tab';
import { resolveCashFloor } from '@/lib/cash-floor';
import { automaticFloorComponents } from '@/lib/auto-cash-floor';
import { isManualCashFloor } from '@/lib/cash-floor';

// Runs renderWidget INSIDE the boundary's own subtree. Calling renderWidget(id)
// straight in the map would execute the widget's data-mapping during the
// Dashboard's render instead, so a bad number in one card would throw past its
// own boundary and take the whole page down — the exact failure being fixed.
function Widget({ id, render }: { id: WidgetId; render: (id: WidgetId) => React.ReactNode }) {
  return <>{render(id)}</>;
}

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

export default function Dashboard() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const { isPremium } = useSubscription();
  const navigate = useNavigate();

  /**
   * Two panels instead of two tabs — the same shell the Garage uses for `Builds`, for the reason
   * Tre gave on 2026-08-18: *"we need to reduce how many separate tabs. especially on mobile. they
   * can have sections within tabs."* Accounts stopped being a route and became this page's second
   * panel; `/accounts` redirects here naming it.
   *
   * The panel persists so the page reopens where the user left it, and a `?tab=` link overrides it
   * ONCE and is then stripped — see `dashboard-tab.ts` for why an unknown value must not default.
   */
  const [activeTab, setActiveTab] = usePersistedState<DashboardTab>('tre:dashboard:activeTab', 'overview');
  const [searchParams, setSearchParams] = useSearchParams();
  const askedTab = dashboardTabFromSearch(searchParams);
  useEffect(() => {
    if (!askedTab) return;
    setActiveTab(askedTab);
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    setSearchParams(next, { replace: true });
  }, [askedTab, searchParams, setSearchParams, setActiveTab]);

  const { data: transactions, loading: txnLoading } = useTransactions();
  const { data: accounts, loading: acctLoading } = useAccounts();
  const { data: profile, loading: profileLoading } = useProfile();
  const { data: netWorthSnapshots, loading: netWorthSnapshotsLoading } = useNetWorthSnapshots();

  useRetirementAutoUpdate(profile as Parameters<typeof useRetirementAutoUpdate>[0], accounts, isDemo, isPremium);
  const { data: debts, loading: debtsLoading } = useDebts();
  const { data: goals, loading: goalsLoading } = useSavingsGoals();
  const { data: carFunds, loading: carFundsLoading } = useCarFunds();
  const { data: rules, loading: rulesLoading } = useRecurringRules();
  const { items: plaidItems } = usePlaidItems();
  const { data: manualAssets, loading: assetsLoading } = useAssets();
  const { data: manualLiabilities, loading: liabilitiesLoading } = useLiabilities();
  const { data: paymentPlans } = usePaymentPlans();
  // §1B — rule occurrences a real payment has already answered: the ones the user confirmed AND the
  // ones the bank proves on its own. This page took the confirmed half only until 2026-08-25, so a
  // bill the forecast had already captured was still charged against remaining cash here.
  const { index: matchedOccurrences, occurrences: confirmedOccurrences } = useMatchedOccurrences();

  const { layout, setLayout, visibleWidgets, isCustomizing, setCustomizing, resetLayout } = useDashboardLayout();

  /**
   * ⚠️ A DEEP-LINKED LESSON MUST OPEN EVEN IF THE LEARN CARD IS HIDDEN.
   *
   * `?lesson=<id>` is consumed by `LearnCard`, and `learn` is a REMOVABLE widget. So a person who
   * takes it off their dashboard taps "a 2-minute lesson" in a notification and lands here with
   * nothing to consume the param — the tap does nothing, silently, which is the exact shape the
   * deep-linking work exists to remove.
   *
   * The card is appended for THIS RENDER ONLY, so a link always has somewhere to land and nobody's
   * saved layout is edited behind their back.
   *
   * ⚠️ NOT VERIFIED IN A BROWSER, AND HERE IS EXACTLY WHY, because the obvious test does not work.
   * `/demo` looks like the failing environment — the Learn card is absent there — but it is absent
   * for a DIFFERENT reason: `useLearnProgress` is `enabled: !isDemo && !!user`, so the query never
   * runs and `LearnCard` returns null on its own loading guard, whatever the layout says. Demo
   * therefore cannot distinguish this fix working from it doing nothing, which makes it worse than
   * no test. `DEFAULT_LAYOUT` also marks every widget visible, so a default account never hits
   * this path either.
   * **What WOULD verify it: a signed-in account with the Learn widget switched OFF in Customize,
   * then `/dashboard?lesson=what-a-cash-floor-is`.** Until somebody does that, this is reasoned
   * and not measured, and it is labelled that way rather than counted as evidence.
   */
  const widgetsToRender = useMemo(() => (
    searchParams.has(LESSON_PARAM) && !visibleWidgets.includes('learn')
      ? ([...visibleWidgets, 'learn'] as WidgetId[])
      : visibleWidgets
  ), [visibleWidgets, searchParams]);

  // Signal Swift cover that the dashboard has mounted and is ready to paint.
  useEffect(() => {
    window.__forgenta_dashboard_ready = true;
    return () => { window.__forgenta_dashboard_ready = false; };
  }, []);

  const { cardProjection, pauseSavings, debtStrategy } = useCardProjectionContext();
  const [calcDrawer, setCalcDrawer] = useState<{ title: string; lines: { label: string; value: string; op?: string }[] } | null>(null);
  const [showSecurityBanner, setShowSecurityBanner] = useState(false);
  const [founderNoteVisible, setFounderNoteVisible] = useState(false);
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
    // One-shot founder-note decision, latched by onboardingInitRef so it runs once
    // per mount. It waits on four async queries (profile/debts/goals/accounts)
    // and reads sessionStorage, so it can be decided neither during render nor in
    // a lazy initializer — the inputs simply do not exist yet at mount.
    //
    // The onboarding wizard used to be the other branch here. It retired on 2026-08-14:
    // /onboarding is the single flow now (it gained this modal's bank-connect step), the
    // route gate sends anyone unfinished there, and what remains on this page is the
    // checklist nudge below.
    if (profile?.founder_note_seen === false && !alreadySeenThisSession) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFounderNoteVisible(true);
    }
  }, [isDemo, profileLoading, debtsLoading, goalsLoading, acctLoading, profile]);

  const handleFounderNoteDismiss = () => {
    sessionStorage.setItem(FOUNDER_NOTE_KEY, '1');
    setFounderNoteVisible(false);
  };

  const essentialLoading = txnLoading || acctLoading || profileLoading;

  const payConfig = useMemo(() => buildPayConfig(profile), [profile]);
  // `paycheckNet` was here too: it was the retired Next Paycheck chip's VALUE and the income
  // drawer's first line, and Tre re-anchored the chip's DATE only. Gone with its last reader.
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

    const liquidCash = sumBalanceByAccountType(active, LIQUID_ACCOUNT_TYPES);
    // The asset split the overview strip carries, from the same lists the Accounts panel
    // read before the tiles moved up here. See lib/net-worth.ts for why these are not
    // ACCOUNT_TYPE_GROUP.
    const investments = sumBalanceByAccountType(active, INVESTMENT_ACCOUNT_TYPES);
    const retirement = sumBalanceByAccountType(active, RETIREMENT_ACCOUNT_TYPES);
    // A card with a future card_start_date has not been opened yet, so its limit is
    // not available credit and must not dilute utilization. Both sides of the ratio
    // use the same filter so the tile's "$debt / $limit" sub-line stays consistent.
    const openCards = active.filter(a => a.account_type === 'credit_card' && isCardOpenAsOf(a, new Date()));
    const ccDebt = openCards.reduce((s, a) => s + Number(a.balance || 0), 0);
    const ccLimit = openCards.filter(a => a.credit_limit).reduce((s, a) => s + Number(a.credit_limit || 0), 0);

    return { liquidCash, investments, retirement, ...totalsFromBreakdown(netWorthBreakdown), ccDebt, ccLimit };
  }, [accounts, netWorthBreakdown]);

  // The strip's totals aggregate accounts + manual assets + manual liabilities + amortized
  // vehicle loans. `essentialLoading` covers only the first, so a strip gated on it alone
  // paints a confident net worth built from three empty arrays for as long as the other
  // three queries are in flight — the same defect the Accounts panel closed on 2026-08-20.
  const overviewStripLoading = acctLoading || assetsLoading || liabilitiesLoading || carFundsLoading;

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
    // Phase 1 was a RELABEL, not a revaluation: `expenses + debtService` equalled the old
    // `expensesAllIn + totalDebtPayments` exactly.
    //
    // ⚠️ §2.4 PHASE 2 (2026-08-19) BREAKS THAT IDENTITY ON PURPOSE, and it is now
    // `expenses + debtService + transfers`. Contributions to your own savings and investment
    // accounts left `expenses`, because they are not spending — and while they sat inside it the
    // "Annual Savings" tile went DOWN the more the user saved. On the demo account, $1,375/mo of
    // 401k, Roth, brokerage and emergency-fund transfers were being counted as money gone, which
    // is what put that tile at −$3,185 a year for someone saving $16,500 of it.
    // `expensesAllIn` is unchanged to the cent, so every cash-that-left surface is untouched.
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

  // The 30-day window that fed the retired "Bills This Month" chip is gone with the chip: Tre
  // took Next Paycheck and Month-End Cash into the Monthly Snapshot hero on 2026-08-23 and left
  // Bills This Month and Debt Service dropped. `upcomingWeek` is live (the Upcoming This Week
  // widget reads it), and `nextPayday` above is now read by the snapshot.
  //
  // ⚠️ THE SUBSTITUTION HAPPENS BEFORE THE WINDOW FILTER, and the order is the whole fix. This
  // widget had no suppression at all: a bill paid on the 3rd went on being listed as upcoming until
  // its DUE DATE passed. `substituteSettledOccurrences` gives a matched occurrence the date and the
  // amount of the charge that actually paid it, so one paid early now falls outside the seven-day
  // window on its own, and one settling later this week stays and shows what it really cost.
  // Re-sorted, because a substitution MOVES a date: a bill due the 28th and settled on the 26th
  // would otherwise sit wherever its due date had put it in the already-sorted list.
  const upcomingWeek = useMemo(
    () => getUpcomingEvents(substituteSettledOccurrences(scheduledEvents, matchedOccurrences), 7)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [scheduledEvents, matchedOccurrences],
  );
  const upcomingBillsWeek = upcomingWeek.filter(e => e.type === 'expense');

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

  const cashFloor = resolveCashFloor(profile);


  const month0SaveUpNote = useMemo(() => {
    const event = cardProjection?.month0?.holdbackEvent;
    const amount = cardProjection?.month0?.holdback;
    if (!event || !amount) return null;
    return { ...event, amount };
  }, [cardProjection]);

  const minSafeCash = useMemo(
    () => getMinSafeCash(rules, payConfig, cashFloor, fundingAccountId, new Date(),
      automaticFloorComponents(isManualCashFloor(profile), accounts, carFunds, new Date())),
    [rules, payConfig, cashFloor, fundingAccountId, profile, accounts, carFunds],
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


  // ─── Hero (slice 2) ───────────────────────────────────────────────────────
  // Both hero numbers were already computed on this page and neither was rendered. Nothing
  // below re-derives either: the payoff month is picked from the readings the engine
  // published (see lib/payoff-summary.ts, which copies /debt's resolution order verbatim),
  // and the floor is the same `forecastFloor0` the drawer and the donut already use.

  const heroPayoff = useMemo(
    () => selectRevolvingPayoff({
      simRevolvingPayoffMonth: cardProjection?.simRevolvingPayoffMonth ?? null,
      forecastRevolvingPayoffMonth: cardProjection?.forecastRevolvingPayoffMonth ?? null,
      forecastAdjustedRevolvingBalances: cardProjection?.forecastAdjustedRevolvingBalances ?? null,
      cardIds: cardProjection?.simCards.map(c => c.id) ?? [],
      months: PROJECTION_MONTHS,
    }),
    [cardProjection],
  );

  // The engine's own month-0 revolving balance, not the raw card balance: a card paid in
  // full every cycle owes money but revolves none, and so has no payoff month at all.
  const revolvingDebtNow = useMemo(() => {
    if (!cardProjection) return accountSummary.ccDebt;
    let total = 0;
    cardProjection.monthlyRevolvingBalances.forEach(bals => {
      total += Math.max(0, bals[0] ?? 0);
    });
    return total;
  }, [cardProjection, accountSummary.ccDebt]);

  // Same comparison `openMonthEndCalc`'s "cash is above safety threshold" line makes —
  // PRE-debt-payment when the engine is driving, because the engine caps its debt payments
  // at the floor and a post-payment figure would read ~$0 above the floor by construction.
  // Null (never 0) when there is nothing to read: an unknown floor and a met floor must not
  // render identically.
  const cashAboveFloor = useMemo(() => {
    if (accounts.length === 0) return null;
    const cash = cardProjection?.month0 ? cardProjection.month0.chain.cashPreDebt : monthEndCash;
    if (!Number.isFinite(cash) || !Number.isFinite(forecastFloor0.monthMinSafe)) return null;
    return cash - forecastFloor0.monthMinSafe;
  }, [accounts.length, cardProjection, monthEndCash, forecastFloor0.monthMinSafe]);

  // The payoff date is a CREDIT-CARD date — the revolving engine never sees a car loan — so
  // the hero needs to know whether anything else is still owed before it may say "debt free".
  // Read off the same breakdown the net-worth tile itemises, so the two cannot disagree about
  // what counts as a loan.
  const otherDebtNow = useMemo(() => nonCardLiabilityTotal(netWorthBreakdown), [netWorthBreakdown]);

  const heroState = useMemo(
    () => selectDashboardHero({
      hasAccounts: accounts.length > 0,
      revolvingDebt: revolvingDebtNow,
      cardBalance: accountSummary.ccDebt,
      otherDebt: otherDebtNow,
      payoff: heroPayoff,
      cashAboveFloor,
      projectionReady: cardProjection != null,
    }),
    [accounts.length, revolvingDebtNow, accountSummary.ccDebt, otherDebtNow, heroPayoff, cashAboveFloor, cardProjection],
  );

  // The curve under the milestone. Same converged map `selectRevolvingPayoff`'s per-card
  // fallback reads, so the drawn run and the printed date cannot disagree; null whenever
  // there is nothing honest to draw and the hero then renders as it did before.
  const heroTrajectory = useMemo(
    () => (heroPayoff
      ? buildPayoffTrajectory({
          monthlyRevolvingBalances: cardProjection?.monthlyRevolvingBalances ?? null,
          cardIds: cardProjection?.simCards.map(c => c.id) ?? [],
          payoffMonth: heroPayoff.month,
        })
      : null),
    [cardProjection, heroPayoff],
  );

  /**
   * ⚠️ MOUNTED HERE, ABOVE THE PANEL SWITCH, ON PURPOSE.
   *
   * `useNetWorthSnapshotRecorder` is the SOLE writer of `net_worth_snapshots`, and it has already
   * been orphaned once: it lived on `/net-worth`, that route became a redirect, and recording
   * silently died on 2026-05-22 with the chart frozen behind it. It was re-hooked to the Accounts
   * page on 2026-08-02, and on 2026-08-20 the chart it feeds moved up here to the Overview — so
   * the writer moved with it, and to the level ABOVE the pills rather than into the Overview
   * panel, so that it runs on every Dashboard visit no matter which panel the user lands on.
   * Grep what a page WRITES before moving what it SHOWS.
   */
  useNetWorthSnapshotRecorder();

  useWidgetSync({
    monthEndCash,
    netWorth: accountSummary.netWorth,
    currency: profile?.currency,
    enabled: !isDemo && !essentialLoading,
  });

  // The caller that makes the notification feature exist: policy + service + toggle all shipped
  // before anything invoked them, so all of it was inert. Signals come from figures this page
  // already holds, and only the ones it can source TRUTHFULLY - see the hook for what is
  // deliberately absent and why passing zeros there would invent warnings.
  const lastFundingSyncAt = useMemo((): string | null => {
    if (!fundingAccountId) return null;
    const acct = accounts.find(a => a.id === fundingAccountId);
    if (!acct?.plaid_item_id) return null;
    return plaidItems.find(pi => pi.plaid_item_id === acct.plaid_item_id)?.last_synced_at ?? null;
  }, [fundingAccountId, accounts, plaidItems]);

  // Learn signals for the two engagement notifications. Read from the same hook the Learn card
  // uses, so the notification can never offer a lesson the card says is already finished.
  const learnProgress = useLearnProgress();

  useNotificationCheck({
    monthMinSafe: forecastFloor0.monthMinSafe,
    floorItems: forecastFloor0.floorItems,
    // `cashPreDebt` is the figure this page already compares against the floor (see the
    // safe-to-spend line below); month-end cash answers a different question and must not stand in.
    cashPreDebt: cardProjection?.month0 ? cardProjection.month0.chain.cashPreDebt : null,
    netWorth: accountSummary.netWorth,
    monthEndCash,
    lastAccountSyncAt: lastFundingSyncAt,
    nextLesson: learnProgress.next
      ? { id: learnProgress.next.id, title: learnProgress.next.title, minutes: learnProgress.next.minutes }
      : null,
    learnStreak: learnProgress.streak,
    learnedToday: learnProgress.readToday,
    // Also waits on the Learn rows: firing before they land would offer lesson one to someone who
    // has read eight, which is worse than staying quiet for a second.
    enabled: !isDemo && !essentialLoading && !learnProgress.loading,
  });

  // The review prompt, asked at a VALUE MOMENT rather than on an action count. It used to fire on
  // the third budget rule or savings goal a user CREATED — work done for the app — and both
  // stores rate-limit the prompt so hard that the one ask most users ever see was spent there.
  // See review-moment.ts for what counts as value received and why nothing here fires on bad news.
  useValueMoments({
    goals,
    debts,
    hasLinkedAccounts: plaidItems.length > 0,
    projectedCash: cardProjection?.month0 ? cardProjection.month0.chain.cashPreDebt : null,
    cashFloor: forecastFloor0.monthMinSafe,
    enabled: !isDemo && !essentialLoading,
  });

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

  // ⚠️ NOT `debtBreakdown.totalMinimumsDue`, which is what is still UNPAID on the cards this month.
  // Dividing that by income gave a ratio that fell to 0% as the month's minimums cleared, ignored
  // every loan, and ignored autopay-in-full cards — 0.5% and "healthy" for an account carrying
  // $47,200. `debt-to-income.ts` carries the reasoning and the contractual-not-chosen rule.
  const dti = useMemo(
    () => debtToIncomeRatio({ debts, accounts, carFunds, income: summary.income }),
    [debts, accounts, carFunds, summary.income],
  );

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
  //
  // `openMonthEndCalc` regained its caller on 2026-08-23: the Monthly Snapshot's Month-End Cash
  // sub-figure opens it, and prints the same `monthEndCash` this drawer derives its column to.
  // The openers for the chips Tre did NOT re-anchor (income, expenses, debt payments) were
  // deleted in the same pass rather than left standing as unreachable derivations.

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
          // Ranked automatic extra payments: surplus the user's ranking sent to goals and car
          // funds ahead of the cards. Omit it and the column is short by exactly that amount.
          ...t('Extra to goals & car funds', m0.chain.autoExtraReserve, '−'),
          // §2.9: 'Balance on hand' is the GROSS balance now, so this row is what keeps the drawer's
          // column adding up to `cashPreDebt`. Omit it and the equation is short by the earmark.
          ...t('Already saved toward a car', m0.chain.carSavedEarmark, '−'),
          ...t('Car down payment reserve', m0.chain.carReserve, '−'),
          ...t('Auto loan payment', m0.chain.carLoanPayment, '−'),
          ...t('Vehicle insurance (est.)', m0.chain.vehicleInsurance, '−'),
          ...t('Other loan payments', m0.chain.otherDebtPayment, '−'),
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
      // Tre, 2026-09-02: "if cash floor set to automatic, dont show cash floor set in
      // forecast pop ups". In automatic mode `resolveCashFloor` returns 0 by design -- it
      // means "contribute nothing of your own, let the measured bills decide" -- so this row
      // printed $0.00 and read as a floor of nothing rather than as "not in use".
      ...(isManualCashFloor(profile)
        ? [{ label: 'Your Cash Floor Setting', value: formatCurrency(cashFloor, true) }]
        : []),
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

  const openNetWorthCalc = () => {
    const active = accounts.filter(a => a.active);
    const lines: { label: string; value: string; op?: string }[] = [];
    // Split by net-worth.ts's own predicate, not a list copied into this file. The copy had
    // drifted: it omitted 'mortgage', so a mortgage was ITEMISED under Assets while the totals
    // beneath it (accountSummary, built from net-worth.ts) correctly counted it as a liability —
    // a drawer that exists to explain a number, contradicting it. Totals are untouched.
    const assetAccts = active.filter(a => !isLiabilityAccountType(a.account_type));
    const liabAccts = active.filter(a => isLiabilityAccountType(a.account_type));
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
      // Omitted in automatic mode: the setting is not contributing to the floor, and a
      // $0.00 row is indistinguishable from a floor the user set to zero. See the note on
      // the debt drawer above.
      ...(isManualCashFloor(profile)
        ? [{ label: 'Settings floor', value: formatCurrency(cashFloor, false) },
           { label: '', value: '' }]
        : []),
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
            // The two re-anchored chip figures, both passed already derived. `monthEndCash` is the
            // page's one definition of it (line ~628), which `openMonthEndCalc` prints as the
            // total of its own column, so the sub-figure and its drawer read the same number.
            nextPayday={nextPayday}
            // Taps through to the page the pay schedule lives on — the destination the retired
            // Next Paycheck chip carried as `to: '/budget'`.
            onPaydayClick={() => navigate('/budget')}
            monthEndCash={monthEndCash}
            onMonthEndClick={openMonthEndCalc}
          />
        );

      case 'budget_totals':
        // Budget Control's KPI row, moved here on 2026-08-27. It reads `useBudgetMonthTotals` and
        // derives nothing of its own, so this page and that one cannot disagree about the month.
        return <BudgetTotalsCard key="budget_totals" />;

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
                    {/* A settled row is the REAL charge standing in for the rule's prediction, so it
                        says so: the amount beside it is what left the account, not what was due. */}
                    {e.settledDate && (
                      <span
                        className="text-[9px] text-success bg-success/10 px-1 py-0.5 ml-2"
                        style={{ borderRadius: 'var(--radius)' }}
                        title={e.projectedAmount !== undefined
                          ? `A settled transaction paid this. Scheduled ${formatCurrency(e.projectedAmount, false)}.`
                          : 'A settled transaction paid this.'}
                      >
                        paid
                      </span>
                    )}
                    {e.source && <span className="text-muted-foreground ml-2">· {e.source}</span>}
                  </div>
                  <span className="font-display font-bold text-destructive">{formatCurrency(e.amount, false)}</span>
                </div>
              ))}
            </div>
          </div>
        );

      // Net worth OVER TIME. The three current totals it used to lead with are in the
      // overview strip above the panel switcher, permanently on screen, so repeating them
      // one card lower was the same figure twice on one scroll.
      case 'net_worth_trend':
        return (
          <NetWorthTrendCard
            key="net_worth_trend"
            snapshots={netWorthSnapshots}
            snapshotsLoading={netWorthSnapshotsLoading}
            netWorth={accountSummary.netWorth}
          />
        );

      case 'car_goal':
        if (!carGoalData) return null;
        return (
          <div key="car_goal" className="card-forged p-5 card-clickable" onClick={() => navigate(carGoalData.isCarFund ? '/debt?tab=auto' : '/goals')}>
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
                      <p className="text-lg font-display font-bold text-primary">{formatCurrency(carGoalData.monthlyNeeded, false)}</p>
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
                const renderRow = ({ name, value }: { name: string; value: number }, i: number) => {
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
                };
                return (
                  <div className="space-y-3">
                    {top.map((entry, i) => renderRow(entry, i))}
                    {rest.length > 0 && (
                      <details className="group">
                        <summary className="flex items-center justify-between pt-1.5 border-t border-border/40 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
                          <span className="flex items-center gap-1.5">
                            <ChevronDown size={11} className="shrink-0" />
                            <span className="text-[10px] text-muted-foreground">+{rest.length} more</span>
                          </span>
                          <span className="text-[10px] font-display font-semibold text-muted-foreground">{formatCurrency(rest.reduce((s, c) => s + c.value, 0), false)}</span>
                        </summary>
                        <div className="space-y-3 pt-3">
                          {rest.map((entry, i) => renderRow(entry, i + top.length))}
                        </div>
                      </details>
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
                        {/* MONEY MOVED IS NOT MONEY SPENT (Tre, 2026-09-02: transfers "need to
                            show on the homepage as well"). Same defect this panel shared with
                            Transactions until 0f92da5c: a transfer rendered as a red outflow with
                            a category, indistinguishable from spending. For a transfer the
                            destination is the more useful half - "Business" says less than "to
                            General Operations" - so it replaces the category on this cramped row
                            rather than crowding in beside it. */}
                        <p className="text-xs text-muted-foreground">
                          {t.isTransfer
                            ? <>transfer {'→'} {t.transferDestination ? (accountMap[t.transferDestination]?.name ?? 'another account') : 'another account'}</>
                            : t.category}
                        </p>
                      </div>
                    </div>
                    {/* A transfer leaves the account, so it keeps its minus - but it is not a
                        loss, so it does not get the red that means one. */}
                    <span className={`text-xs font-bold font-display ${t.isTransfer ? 'text-muted-foreground' : t.type === 'income' ? 'text-success' : 'text-destructive'}`}>
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

      // Learn: financial lessons + one achievement each. It reads and writes only
      // `learn_progress`, so it needs nothing from this page's figures — which is also why it is
      // safe to render for an account whose money data is still loading.
      case 'learn':
        return <LearnCard key="learn" />;

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
    <div className="py-4 lg:py-6 max-w-6xl mx-auto stack-section overflow-x-hidden">
      {founderNoteVisible && <FounderNoteModal onDismiss={handleFounderNoteDismiss} />}
      {!isDemo && <AppTour variant="new-user" />}
      <AccountUpdateReminder />
      {!isDemo && <SubscriptionExpiryBanner />}

      {!isDemo && showSecurityBanner && (
        /* Tokens, not raw palette classes. `text-gold` is the warning tone this codebase
           actually has — `text-warning` generates no rule at all (see BalanceTrancheEditor). */
        <div className="flex items-start justify-between gap-3 bg-secondary border border-border px-4 py-3" style={{ borderRadius: 'var(--radius)' }}>
          <div className="flex items-start gap-3">
            <Shield size={15} className="text-gold mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-gold">Your account has no two-factor protection</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Adding 2FA takes under a minute and significantly reduces the risk of unauthorized access.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link to="/settings#security" className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold hover:bg-primary/90 transition-colors btn-press" style={{ borderRadius: 'var(--radius)' }}>
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

      {/* Header. Demoted to the section-label style: the hero number below is the biggest
          thing on the page, and the <h1> outranking it was the old shape, not a bug here. */}
      <div className="flex flex-col gap-4">
        {/* ⚠️ STACKS ON NARROW. This was `flex-row` at every width with four `shrink-0` buttons in
            it, and at 390px the arithmetic could only end one way: the buttons refused to shrink,
            the title's `min-w-0` let it collapse, and the row overflowed left ACROSS the title —
            "COMMAND CENTER / August 2026" wrapped to three lines with Customize/PDF/Add/Guide
            drawn on top of it (Tre, 2026-08-19, iPhone). Every other page header in the app
            already used this pattern; the dashboard was the one that did not. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xs uppercase tracking-wider text-muted-foreground">Command Center</h1>
            </div>
            <p className="text-[11px] text-muted-foreground/80 mt-0.5">
              {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </p>
          </div>

          {/* The labels stay — collapsing to bare icons would take the affordance away, and these
              are the page's only actions. What changed is WHERE the row goes when it does not fit:
              onto its own line, rather than over the title. */}
          {/* ⚠️ CENTRED WHEN IT STACKS, right-aligned when it does not (Tre, 2026-08-19). On its
              own line the row is the only thing there, and left-aligning it put it out of step
              with the panel pills directly beneath, which have always been centred. At sm+ the
              parent is a `justify-between` row again and the buttons belong at the end. */}
          <div className="flex flex-row items-center justify-center sm:justify-end gap-1.5 shrink-0">
            <button
              onClick={() => setCustomizing(true)}
              className="flex items-center justify-center gap-1.5 bg-secondary border border-border px-2.5 py-1.5 text-[11px] font-medium btn-press hover:border-primary/40 hover:text-primary transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <LayoutDashboard size={12} /> Customize
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
                className="flex items-center justify-center gap-1.5 bg-secondary border border-border px-2.5 py-1.5 text-[11px] font-medium btn-press hover:border-primary/40 hover:text-primary transition-colors"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <FileDown size={12} /> PDF
              </button>
            )}

            <Link
              to="/transactions"
              className="flex items-center justify-center gap-1.5 bg-primary text-primary-foreground px-2.5 py-1.5 text-[11px] font-semibold btn-press hover:bg-primary/90 transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <Plus size={13} /> Add
              <span className="sr-only"> Transaction</span>
            </Link>
            <SurfaceGuide surface="dashboard" />
          </div>
        </div>
      </div>

      {/* What the accounts add up to, above the panel switcher so it is on screen for Overview,
          Accounts AND Goals alike (Tre, 2026-08-22: "move the overview data from the accounts tab
          to the top of the dashboard"). Fixed, like the hero: NOT a `useDashboardLayout` widget,
          so it is neither reorderable nor hideable. */}
      <DashboardOverviewStrip
        loading={overviewStripLoading}
        netWorth={accountSummary.netWorth}
        totalAssets={accountSummary.totalAssets}
        totalLiabilities={accountSummary.totalLiabilities}
        liquidCash={accountSummary.liquidCash}
        investments={accountSummary.investments}
        retirement={accountSummary.retirement}
        ccDebt={accountSummary.ccDebt}
        ccLimit={accountSummary.ccLimit}
        onNetWorthClick={openNetWorthCalc}
        onLiquidCashClick={openLiquidCashCalc}
      />

      {/* The panel row and the panel it switches are ONE group (`stack-row`): a control row
          belongs to the content below it, so it reads as that content's label instead of as a
          region of its own. See the vertical-rhythm block in `src/index.css`.

          The panel row is styled exactly like the Garage's (`Vehicles.tsx`). THREE entries since
          Goals moved here (Tre, 2026-08-20), so it no longer fits 320px — and that is fine, it
          does not wrap. `seg-track` is a horizontal scroller and `seg-item` is `shrink-0`, so the
          row swipes to the third pill instead of breaking to a second line. MEASURED, not assumed:
          the three pills are 331px intrinsic, and inside a 286px content box they still report one
          row at 42px high with `scrollWidth` 331 > `clientWidth` 286. Debt Payoff has run five
          segments this way since 2026-08-18. */}
      <div className="stack-row">
      <PanelBar>
        <button onClick={() => setActiveTab('overview')}
          className={`seg-item btn-press ${activeTab === 'overview' ? 'seg-item-active' : ''}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <LayoutDashboard size={13} /> Overview
        </button>
        {/* Goals sits ahead of Accounts (Tre, 2026-08-27: "move goals before accounts on the
            dashboard"). Pill order only — each panel still owns its own content below. */}
        <button onClick={() => setActiveTab('goals')}
          className={`seg-item btn-press ${activeTab === 'goals' ? 'seg-item-active' : ''}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <PiggyBank size={13} /> Goals
        </button>
        <button onClick={() => setActiveTab('accounts')}
          className={`seg-item btn-press ${activeTab === 'accounts' ? 'seg-item-active' : ''}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <Building2 size={13} /> Accounts
        </button>
      </PanelBar>

      {/*
        ⚠️ RENDERED, NOT LINKED TO — and `Accounts` is unchanged apart from an `embedded` prop that
        drops its duplicate <h1>. It owns its three sub-panels, its Add Account button and every
        write it ever made, so hosting it here is a change of shell and nothing else. It is mounted
        only on its own panel, so the Dashboard does not pay for its nine queries while a user is
        looking at the Overview — the same trade the Garage makes for `Builds`.
      */}
      {activeTab === 'accounts' && (
        <Suspense fallback={<div className="h-64" />}>
          <Accounts embedded />
        </Suspense>
      )}

      {/*
        ⚠️ RENDERED, NOT LINKED TO — `SavingsGoals` is unchanged apart from the `embedded` prop that
        drops its duplicate <h1>. It owns its own queries, its Add Goal button, the growth chart and
        the "Where the extra money goes" section, so hosting it here is a change of shell and
        nothing else. It calls `useMonth0DebtBreakdown()`, which needs `CardProjectionProvider` —
        `DashboardLayout` mounts that above this page, so the panel is covered here exactly as it
        was on the Forecast.
      */}
      {activeTab === 'goals' && (
        <Suspense fallback={<div className="h-64" />}>
          <GoalsPanel embedded />
        </Suspense>
      )}

      {activeTab === 'overview' && (
      <div className="stack-section">
      {/* The hero. Fixed at the top: NOT a `useDashboardLayout` widget, so it is neither
          reorderable nor hideable — it is the one thing the page is for. It keeps a full
          section gap below it; the widgets under it are siblings and sit at `stack-block`. */}
      <DashboardHero state={heroState} onFloorClick={openFloorCalc} trajectory={heroTrajectory} />

      <div className="stack-block">

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-4">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-foreground">Jordan&apos;s Story — How it all connects</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                26 y/o with $12,700 in CC debt, a steady paycheck, and a plan that clears the cards in a little over a year.
                Every number here is live-calculated from the data below.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { label: 'Plan', desc: 'Recurring rules define income, bills, and transfers — this is the engine behind every projection.', path: '/budget' },
              { label: 'Debt Payoff', desc: 'Avalanche engine computes how fast each card gets paid using every dollar above the cash floor.', path: '/debt' },
              { label: 'Forecast', desc: '60-month sim. Debt payoff adjusts monthly so end cash never sits idle — it goes straight to debt.', path: '/forecast' },
              { label: 'Transactions', desc: 'One-time income (tax refund, bonus) and expenses update cash flow and feed the debt engine.', path: '/transactions' },
              { label: 'Savings & Car Fund', desc: 'Goals track toward specific targets. The car fund models the full purchase: down payment + loan.', path: '/goals' },
              { label: 'Accounts', desc: 'Net worth history, assets/liabilities breakdown, and all account balances in one place.', path: '/dashboard?tab=accounts' },
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

      {/* Dynamic widget stack. Each widget gets its own boundary so a crash in
          one card replaces only that card — the rest of the dashboard keeps
          rendering, and the fallback names the widget that failed. */}
      {widgetsToRender.map(id => (
        <ErrorBoundary key={id} variant="widget" label={widgetLabel(id)}>
          <Widget id={id} render={renderWidget} />
        </ErrorBoundary>
      ))}
      </div>
      </div>
      )}
      </div>

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
