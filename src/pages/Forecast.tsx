import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { PageSkeleton } from '@/components/shared/PageSkeleton';
import { useDemo } from '@/contexts/DemoContext';
import { useSubscription } from '@/hooks/useSubscription';
import { formatCurrency } from '@/lib/calculations';
import { usePersistedState } from '@/hooks/usePersistedState';
import InstructionsModal from '@/components/shared/InstructionsModal';
import { useDebts, useSavingsGoals, useCarFunds, useAccounts, useSubscriptions, useBudgetItems, useProfile, useRecurringRules, useTransactions } from '@/hooks/useSupabaseData';
import { generateScheduledEvents, aggregateByMonth } from '@/lib/scheduling';
import { simulateVariablePayoff, buildCardData, projectCardVariable, getCurrentMonthDebtRecommendations, CC_DEFAULT_CATEGORIES } from '@/lib/credit-card-engine';
import { getDebtPaymentsByMonth, getDebtBalancesByMonth } from '@/lib/debt-transaction-generator';
import { buildPayConfig, getMonthNetIncome, getPaychecksInMonth, getMinSafeCash, getPrePaycheckNextMonthBills, mergeWithGeneratedTransactions, getRemainingTransactionIncomeByDay, getRemainingTransactionExpensesByDay } from '@/lib/pay-schedule';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  Bar, ComposedChart, ReferenceLine,
} from 'recharts';
import { Settings2, List, BarChart3, TrendingUp, CreditCard, Info, X, FileDown, Crown } from 'lucide-react';
import { exportForecastPdf, type ForecastRow } from '@/lib/exportPdf';
import { exportForecastCsv } from '@/lib/exportCsv';
import { estimateTaxReturn, STATE_TAX_RATES, type FilingStatus } from '@/lib/tax-estimator';

function CalcDrawer({ open, onClose, title, lines }: { open: boolean; onClose: () => void; title: string; lines: { label: string; value: string; op?: string }[] }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }} onClick={onClose}>
  <div
    className="card-forged p-4 sm:p-6 w-full max-w-sm sm:max-w-md space-y-3 max-h-[75vh] overflow-y-auto popup-scroll"
    onClick={e => e.stopPropagation()}
  >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display font-semibold text-sm flex items-center gap-2 min-w-0"><Info size={14} className="text-primary shrink-0" /> <span className="truncate">{title}</span></h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 p-1"><X size={16} /></button>
        </div>
        <div className="space-y-2 pt-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0 gap-2">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
                {l.op && <span className="text-primary font-bold shrink-0">{l.op}</span>}
                <span className="truncate">{l.label}</span>
              </span>
              <span className="text-xs font-display font-bold text-foreground whitespace-nowrap shrink-0">{l.value}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground pt-2 border-t border-border/30">
          A negative monthly cash flow can be acceptable if prior saved cash covers the difference and ending cash stays above the required floor. One-time purchases (e.g. car down payment) reduce available cash and may auto-adjust debt recommendations.
        </p>
      </div>
    </div>
  );
}

function ForecastTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border p-2 sm:p-3 text-xs space-y-1 max-w-[140px] sm:max-w-xs" style={{ borderRadius: 'var(--radius)' }}>
      <p className="font-display font-bold text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
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

  const [assumptions, setAssumptions] = usePersistedState('tre:forecast:assumptions', {
    incomeGrowthEnabled: true, incomeGrowth: 3, raiseMonth: 3, raiseMode: 'pct' as 'pct' | 'flat',
    investmentGrowth: 7, savingsInterest: 4.5, expenseGrowth: 2.5, taxOverride: 0,
    bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as 'flat' | 'pct', bonusMonth: 12, bonusRecurring: true,
    taxReturnEnabled: false, taxReturnFilingStatus: 'single' as FilingStatus, taxReturnDependents: 0,
    taxReturnState: 'FL', taxReturnFederalWithheld: 0, taxReturnMonth: 2, taxReturnAmountOverride: 0,
  });
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [assumptionsTutorialSeen, setAssumptionsTutorialSeen] = usePersistedState('tre:forecast:assumptionsTutorialSeen', false);
  const [filterYear, setFilterYear] = usePersistedState<'all' | '1' | '2' | '3'>('tre:forecast:filterYear', 'all');
  const [chartMode, setChartMode] = usePersistedState<'combo' | 'line'>('tre:forecast:chartMode', 'combo');
  const [viewMode, setViewMode] = usePersistedState<'monthly' | 'detailed'>('tre:forecast:viewMode', 'monthly');
  const [hiddenSeries, setHiddenSeries] = usePersistedState<string[]>('tre:forecast:hidden', []);
  const [calcDrawer, setCalcDrawer] = useState<{ title: string; lines: { label: string; value: string; op?: string }[] } | null>(null);
  const [pauseSavings] = usePersistedState<boolean>('tre:debtpayoff:pause-savings', false);

  const toggleSeries = useCallback((key: string) => {
    setHiddenSeries((prev: string[]) => {
      const next = prev.includes(key) ? prev.filter((k: string) => k !== key) : [...prev, key];
      return next;
    });
  }, [setHiddenSeries]);

  const payConfig = useMemo(() => buildPayConfig(profile), [profile]);

  // Resolve the funding account the same way CreditCardEngine does — profile preference first,
  // then first active checking account. Used to scope pre-paycheck bills and safe-floor to the
  // account that actually funds debt payments.
  const forecastFundingAccountId = useMemo((): string | null => {
    const defaultId = (profile as any)?.default_deposit_account;
    if (defaultId) {
      const acct = accounts.find((a: any) => a.id === defaultId && a.active && ['checking', 'business_checking', 'cash'].includes(a.account_type));
      if (acct) return acct.id as string;
    }
    const checking = accounts.find((a: any) => a.active && a.account_type === 'checking');
    return (checking?.id as string) ?? null;
  }, [accounts, profile]);

  const prePaycheckBillsInfo = useMemo(() => getPrePaycheckNextMonthBills(rules, payConfig, forecastFundingAccountId), [rules, payConfig, forecastFundingAccountId]);
  const scheduledEvents = useMemo(() => generateScheduledEvents(rules, accounts, 36), [rules, accounts]);
  const monthlyAggregates = useMemo(() => aggregateByMonth(scheduledEvents), [scheduledEvents]);

  const debtPayoffOptions = useMemo(() => ({
    strategy: 'avalanche' as const,
    paymentMode: 'variable' as const,
    cashFloor: Number(profile?.cash_floor) || 1000,
    overrides: {} as Record<string, Record<number, number>>,
  }), [profile]);

  const debtPaymentsByMonth = useMemo(() =>
    getDebtPaymentsByMonth(accounts, transactions, rules, debts, profile, debtPayoffOptions, 36),
    [accounts, transactions, rules, debts, profile, debtPayoffOptions],
  );

  const debtBalancesByMonth = useMemo(() =>
    getDebtBalancesByMonth(accounts, transactions, rules, debts, profile, debtPayoffOptions, 36),
    [accounts, transactions, rules, debts, profile, debtPayoffOptions],
  );

  // Current-month recommended debt total — ensures forecast month 0 matches Debt Payoff
  const currentMonthRecommendedDebt = useMemo(() => {
    try {
      const allTxns = mergeWithGeneratedTransactions(transactions, rules, accounts);
      const recs = getCurrentMonthDebtRecommendations(accounts, allTxns, rules, debts, profile);
      return recs.reduce((s, r) => s + r.payment, 0);
    } catch { return null; }
  }, [accounts, transactions, rules, debts, profile]);

  // ── Shared CC-filtered month events ─────────────────────────────────────────
  // Excludes CC-tagged expense rules from cash expenses so the main projections
  // engine doesn't double-count them with the debt engine's autopay pass-through
  // payments after cards are paid off.
  const forecastMonthEvents = useMemo((): { income: number; expenses: number }[] => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const liquidAccountIds = new Set<string>(
      accounts
        .filter((a: any) => a.active && ['checking', 'business_checking', 'cash'].includes(a.account_type))
        .map((a: any) => a.id),
    );

    const incomeToLiquidRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'income' &&
        (!r.deposit_account || liquidAccountIds.has(r.deposit_account)),
      ).map((r: any) => r.id),
    );

    const ccPaymentSources = new Set<string>(
      accounts
        .filter((a: any) => a.active && a.account_type === 'credit_card')
        .flatMap((a: any) => [a.id, `account:${a.id}`]),
    );

    const ccExplicitRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'expense' &&
        r.payment_source && ccPaymentSources.has(r.payment_source),
      ).map((r: any) => r.id),
    );

    const ccDefaultRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'expense' &&
        !r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category),
      ).map((r: any) => r.id),
    );

    const allCcRuleIds = new Set<string>([...ccExplicitRuleIds, ...ccDefaultRuleIds]);

    const savingsRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'expense' &&
        (r.category === 'Savings' || r.category === 'Investing'),
      ).map((r: any) => r.id),
    );

    return Array.from({ length: 36 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const eventsInMonth = scheduledEvents.filter(e =>
        e.date.startsWith(monthKey) && (i > 0 || e.date >= todayStr),
      );

      const income = eventsInMonth
        .filter(e => e.type === 'income' && e.ruleId && incomeToLiquidRuleIds.has(e.ruleId))
        .reduce((s, e) => s + e.amount, 0);

      const expenses = eventsInMonth
        .filter(e =>
          e.type === 'expense' &&
          !(e.ruleId && allCcRuleIds.has(e.ruleId)) &&
          !(pauseSavings && e.ruleId && savingsRuleIds.has(e.ruleId)),
        )
        .reduce((s, e) => s + e.amount, 0);

      return { income, expenses };
    });
  }, [accounts, rules, scheduledEvents, pauseSavings]);

  const cardProjectionData = useMemo(() => {
  try {
    const cards = buildCardData(accounts, transactions, rules, debts);
    if (cards.length === 0) return null;

    const liquidTypes = ['checking', 'business_checking', 'cash'];
    const liquidCash = accounts.filter((a: any) => a.active && liquidTypes.includes(a.account_type))
      .reduce((s: number, a: any) => s + Number(a.balance), 0);
    // Scalar fallbacks (used only when monthEvents not provided by legacy callers)
    const weeklyGross = Number(profile?.weekly_gross_income) || 1875;
    const taxRate = Number(profile?.tax_rate) || 22;
    const monthlyTakeHome = weeklyGross * (1 - taxRate / 100) * 4.33;
    const monthlyExpenses = rules.filter((r: any) => r.active && r.rule_type === 'expense')
      .reduce((s: number, r: any) => {
        const amt = Number(r.amount);
        if (r.frequency === 'weekly') return s + amt * 4.33;
        if (r.frequency === 'yearly') return s + amt / 12;
        return s + amt;
      }, 0);

    // ── Build cardPurchasesPerMonth using shared forecastMonthEvents ──
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Default-card rules: no payment_source, category in CC_DEFAULT_CATEGORIES
    // These go to the highest-APR card by convention
    const highestAprCardId = cards.length > 0
      ? [...cards].sort((a, b) => b.apr - a.apr)[0].id : null;
    const ccDefaultRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'expense' &&
        !r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category),
      ).map((r: any) => r.id),
    );

    // Per-card rule ID map for purchase tracking
    const cardRuleIdMap = new Map<string, Set<string>>(
      cards.map(c => {
        const cKey = `account:${c.id}`;
        const ids = new Set<string>(
          rules.filter((r: any) =>
            r.active && r.rule_type === 'expense' &&
            (r.payment_source === c.id || r.payment_source === cKey),
          ).map((r: any) => r.id),
        );
        if (c.id === highestAprCardId) {
          ccDefaultRuleIds.forEach(id => ids.add(id));
        }
        return [c.id, ids];
      }),
    );

    const cardPurchasesPerMonth: { [cardId: string]: number }[] = [];

    for (let i = 0; i < 36; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const eventsInMonth = scheduledEvents.filter(e =>
        e.date.startsWith(monthKey) && (i > 0 || e.date >= todayStr),
      );

      const cardPurchases: { [cardId: string]: number } = {};
      if (i > 0) {
        for (const card of cards) {
          const ruleIds = cardRuleIdMap.get(card.id) ?? new Set<string>();
          const scheduledAmt = eventsInMonth
            .filter(e => e.type === 'expense' && e.ruleId && ruleIds.has(e.ruleId))
            .reduce((s, e) => s + e.amount, 0);

          const oneTimeCCAmt = (transactions as any[])
            .filter((t: any) =>
              !(t as any).isGenerated &&
              t.date?.startsWith(monthKey) &&
              t.type === 'expense' &&
              (t.payment_source === card.id || t.payment_source === `account:${card.id}`),
            )
            .reduce((s: number, t: any) => s + Number(t.amount), 0);

          cardPurchases[card.id] = scheduledAmt + oneTimeCCAmt;
        }
      }
      cardPurchasesPerMonth.push(cardPurchases);
    }

    const ccSourceIds = new Set(cards.flatMap(c => [c.id, `account:${c.id}`]));
    const oneTimeArr: { income: number; expenses: number }[] = [{ income: 0, expenses: 0 }];

    for (let oi = 1; oi < 36; oi++) {
      const od = new Date(now.getFullYear(), now.getMonth() + oi, 1);
      const omk = `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}`;
      const txns = (transactions as any[]).filter((t: any) =>
        t.date && t.date.startsWith(omk) && !(t as any).isGenerated,
      );

      const inc = txns
        .filter((t: any) => t.type === 'income')
        .reduce((s: number, t: any) => s + Number(t.amount), 0);

      const exp = txns
        .filter((t: any) => {
          if (t.type !== 'expense') return false;
          if (t.payment_source && ccSourceIds.has(t.payment_source)) return false;
          return true;
        })
        .reduce((s: number, t: any) => s + Number(t.amount), 0);

      oneTimeArr.push({ income: inc, expenses: exp });
    }

    const allTxnsForM0 = mergeWithGeneratedTransactions(transactions, rules, accounts);
    const m0Income = getRemainingTransactionIncomeByDay(allTxnsForM0, 31);
    const m0Expenses = getRemainingTransactionExpensesByDay(allTxnsForM0, 31, true);
    const m0SafeFloor = getMinSafeCash(rules, payConfig, debtPayoffOptions.cashFloor, forecastFundingAccountId, new Date());

    const projs = (() => {
      const sim = simulateVariablePayoff(
        cards,
        liquidCash,
        debtPayoffOptions.cashFloor,
        'avalanche',
        monthlyTakeHome,
        monthlyExpenses,
        36,
        forecastMonthEvents,
        undefined,
        cardPurchasesPerMonth,
        m0Income,
        m0Expenses,
        oneTimeArr,
        m0SafeFloor,
      );

      return cards.map(c => {
        const pays = sim.monthlyPayments.get(c.id) || [];
        return projectCardVariable(c, pays, 36, true);
      });
    })();

    const totalLimit = cards.reduce((s, c) => s + c.creditLimit, 0);
    const data = Array.from({ length: 36 }, (_, i) => {
      const now = new Date();
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const row: any = {
        month: d.toLocaleString('en', { month: 'short', year: 'numeric' }),
        totalCCBalance: 0,
        totalInterest: 0,
      };

      for (const p of projs) {
        const m = p.months[i];
        if (m) {
          row[p.card.name] = Math.round(m.endBalance);
          row.totalCCBalance += m.endBalance;
          row.totalInterest += m.interest;
        }
      }

      row.totalCCBalance = Math.round(Math.max(0, row.totalCCBalance));
      row.totalInterest = Math.round(row.totalInterest);
      row.utilization = totalLimit > 0 ? Math.round((row.totalCCBalance / totalLimit) * 100) : 0;
      return row;
    });

    const debtPaymentTotals = Array.from({ length: 36 }, (_, i) =>
      projs.reduce((total, proj) => {
        const m = proj.months[i];
        if (!m || m.startBalance <= 0) return total;
        return total + m.payment;
      }, 0),
    );

    const allPaymentTotals = Array.from({ length: 36 }, (_, i) =>
      projs.reduce((total, proj) => {
        const m = proj.months[i];
        if (!m) return total;
        return total + m.payment;
      }, 0),
    );

    return {
      data,
      cards: projs.map(p => ({ name: p.card.name, color: p.card.color })),
      debtPaymentTotals,
      allPaymentTotals,
    };
  } catch (e) {
    console.error('Forecast projection failed:', e);
    return null;
  }
}, [
  accounts,
  transactions,
  rules,
  debts,
  profile,
  debtPayoffOptions,
  payConfig,
  scheduledEvents,
  pauseSavings,
  forecastMonthEvents,
  forecastFundingAccountId,
]);

  // One-time manual transactions for forecast.
  // CC-tagged expenses are excluded — they increase CC balance (tracked by the debt
  // engine via cardPurchasesPerMonth) and do NOT reduce checking account cash.
  // Past transactions in the current month are excluded — starting cash already reflects them.
  const oneTimeByMonth = useMemo(() => {
    const result: Record<string, { income: number; expense: number }> = {};
    const ccSources = new Set(
      accounts
        .filter((a: any) => a.account_type === 'credit_card' && a.active)
        .flatMap((a: any) => [a.id, `account:${a.id}`]),
    );
    const todayStr = new Date().toISOString().split('T')[0];
    const currentMonthKey = todayStr.substring(0, 7);
    for (const t of transactions) {
      if ((t as any).isGenerated) continue;
      const monthKey = t.date?.substring(0, 7);
      if (!monthKey) continue;
      if (monthKey === currentMonthKey && t.date && t.date < todayStr) continue;
      if (!result[monthKey]) result[monthKey] = { income: 0, expense: 0 };
      if (t.type === 'income') result[monthKey].income += Number(t.amount);
      else if (!t.payment_source || !ccSources.has(t.payment_source)) result[monthKey].expense += Number(t.amount);
    }
    return result;
  }, [transactions, accounts]);

  // CC-only one-time purchases per month — display-only, does NOT affect cash floor math.
  // Past transactions in the current month are excluded — starting cash already reflects them.
  const ccOneTimeByMonth = useMemo(() => {
    const result: Record<string, number> = {};
    const ccSources = new Set(
      accounts
        .filter((a: any) => a.account_type === 'credit_card' && a.active)
        .flatMap((a: any) => [a.id, `account:${a.id}`]),
    );
    const todayStr = new Date().toISOString().split('T')[0];
    const currentMonthKey = todayStr.substring(0, 7);
    for (const t of transactions) {
      if ((t as any).isGenerated) continue;
      if (t.type !== 'expense') continue;
      if (!t.payment_source || !ccSources.has(t.payment_source)) continue;
      const monthKey = t.date?.substring(0, 7);
      if (!monthKey) continue;
      if (monthKey === currentMonthKey && t.date && t.date < todayStr) continue;
      result[monthKey] = (result[monthKey] || 0) + Number(t.amount);
    }
    return result;
  }, [transactions, accounts]);

  // Scheduled CC rule purchases per month — the recurring spend on credit cards.
  // Combined with ccOneTimeByMonth to show total CC purchases in the popup.
  const ccScheduledByMonth = useMemo(() => {
    const ccPaymentSources = new Set<string>(
      accounts
        .filter((a: any) => a.active && a.account_type === 'credit_card')
        .flatMap((a: any) => [a.id, `account:${a.id}`]),
    );
    const ccRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'expense' &&
        (
          (r.payment_source && ccPaymentSources.has(r.payment_source)) ||
          (!r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category))
        )
      ).map((r: any) => r.id),
    );
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    return Array.from({ length: 36 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return scheduledEvents
        .filter(e =>
          e.type === 'expense' &&
          e.date.startsWith(monthKey) &&
          (i > 0 || e.date >= todayStr) &&
          e.ruleId && ccRuleIds.has(e.ruleId),
        )
        .reduce((s, e) => s + e.amount, 0);
    });
  }, [accounts, rules, scheduledEvents]);

  const projections = useMemo(() => {
    const taxRate = assumptions.taxOverride || Number((profile as any)?.tax_rate) || 22;
    const cashFloor = Number((profile as any)?.cash_floor) || 1000;

    const active = accounts.filter((a: any) => a.active);
    // FIX: Aligned with debt engine — only checking/business_checking/cash are "liquid"
    // for cash floor and debt payment purposes. Savings/HYS are tracked in savingsBal
    // separately and appear in net worth but NOT in ending cash calculations.
    const liquidTypes = ['checking', 'business_checking', 'cash'];
    const investTypes = ['brokerage'];
    const retireTypes = ['roth_ira', '401k', 'ira', 'hsa'];
    const liabilityTypes = ['credit_card', 'student_loan', 'auto_loan', 'other_liability'];

    let liquidBal = active.filter((a: any) => liquidTypes.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance), 0);
    let investBal = active.filter((a: any) => investTypes.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance), 0);
    let retireBal = active.filter((a: any) => retireTypes.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance), 0);
    let totalLiabilityBal = active.filter((a: any) => liabilityTypes.includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.balance), 0);

    const accountMap = new Map(accounts.map((a: any) => [a.id, a]));
    let savingsBal = goals.reduce((s: number, g: any) => {
      if (g.linked_account && accountMap.has(g.linked_account)) {
        return s + Number(accountMap.get(g.linked_account).balance);
      }
      return s + Number(g.current_amount);
    }, 0);

    const monthlyInvestGrowth = Math.pow(1 + assumptions.investmentGrowth / 100, 1 / 12) - 1;
    const monthlySavingsInterest = Math.pow(1 + assumptions.savingsInterest / 100, 1 / 12) - 1;
    const monthlyExpenseGrowth = Math.pow(1 + assumptions.expenseGrowth / 100, 1 / 12) - 1;

    // Per-account weighted APY for retirement growth — falls back to global investmentGrowth
    const retireAccounts = active.filter((a: any) => retireTypes.includes(a.account_type));
    const totalRetireBal = retireAccounts.reduce((s: number, a: any) => s + Number(a.balance), 0);
    const weightedRetireApy = totalRetireBal > 0
      ? retireAccounts.reduce((s: number, a: any) => {
          const apy = a.apy_rate != null ? Number(a.apy_rate) : assumptions.investmentGrowth;
          return s + apy * (Number(a.balance) / totalRetireBal);
        }, 0)
      : assumptions.investmentGrowth;
    const monthlyRetireGrowth = Math.pow(1 + weightedRetireApy / 100, 1 / 12) - 1;

    // Monthly retirement paycheck contributions — reads paycheck_deductions JSONB first,
    // falls back to legacy deduction_401k_value if no linked deductions exist
    const prof = profile as any;
    const paycheckGrossForForecast = payConfig
      ? (payConfig.frequency === 'biweekly' ? payConfig.weeklyGross * 2 : payConfig.frequency === 'monthly' ? payConfig.weeklyGross * 52 / 12 : payConfig.weeklyGross)
      : 0;
    const paychecksPerYear = payConfig?.frequency === 'biweekly' ? 26 : payConfig?.frequency === 'monthly' ? 12 : 52;
    const retireAccountIds = new Set(retireAccounts.map((a: any) => a.id as string));
    const payDeds: { value: number; mode: 'flat' | 'pct'; accountId?: string }[] =
      Array.isArray(prof?.paycheck_deductions) ? prof.paycheck_deductions : [];
    const linkedRetireMonthly = payDeds
      .filter(d => d.accountId && retireAccountIds.has(d.accountId) && d.value > 0)
      .reduce((s, d) => {
        const perCheck = d.mode === 'pct' ? paycheckGrossForForecast * (d.value / 100) : d.value;
        return s + perCheck * (paychecksPerYear / 12);
      }, 0);
    // Fallback: legacy deduction_401k_value column
    const monthly401kContrib = linkedRetireMonthly > 0
      ? linkedRetireMonthly
      : (() => {
          const d401kVal = Number(prof?.deduction_401k_value) || 0;
          const d401kMode = prof?.deduction_401k_mode || 'pct';
          const perCheck = d401kMode === 'pct' ? paycheckGrossForForecast * (d401kVal / 100) : d401kVal;
          return perCheck * (paychecksPerYear / 12);
        })();

    const monthlyCarContrib = carFunds.reduce((s: number, c: any) => {
      const rem = Number(c.down_payment_goal) - Number(c.current_saved);
      return s + (rem > 0 ? Math.min(rem / 12, 500) : 0);
    }, 0);

    const transferRulesAll = rules.filter((r: any) => r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment'));

    const nowDate = new Date();

    // ═══ PASS 1: Compute base values without debt payment adjustments ═══
    const baseData: {
      monthLabel: string; monthKey: string; netIncome: number; baseExpenses: number;
      rawDebtPayment: number; monthTransfers: number; monthBrokerageContrib: number; monthRetireContrib: number; oneTimeNet: number;
      ccDebtBalance: number; otherDebtBalance: number; monthMinSafe: number; monthlySavingsContrib: number;
    }[] = [];
    let incomeMultiplier = 1;
    let expenseMultiplier = 1;

    // Index of the first (or only) bonus month in the 36-month window — used for non-recurring bonus
    const nextBonusMonthIndex = !assumptions.bonusRecurring && assumptions.bonusEnabled && assumptions.bonusAmount > 0
      ? (() => {
          for (let k = 0; k < 36; k++) {
            const dd = new Date(nowDate.getFullYear(), nowDate.getMonth() + k, 1);
            if (dd.getMonth() + 1 === assumptions.bonusMonth) return k;
          }
          return -1;
        })()
      : -1;

    for (let i = 0; i < 36; i++) {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() + i, 1);
      const monthLabel = d.toLocaleString('en', { month: 'short', year: 'numeric' });
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      // Apply annual raise as a step in the specified month (not continuous compounding)
      if (assumptions.incomeGrowthEnabled && assumptions.incomeGrowth > 0 && i > 0 && d.getMonth() + 1 === assumptions.raiseMonth) {
        if ((assumptions as any).raiseMode === 'flat') {
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

      let netIncome: number;
      if (i === 0 && scheduledIncome > 0) {
        netIncome = scheduledIncome + (isBonusMonth ? grossBonusAmt : 0);
      } else {
        const otherIncome = Math.max(0, (forecastMonthEvents[i]?.income ?? 0) - fallbackTakeHome);
        netIncome = fallbackTakeHome + otherIncome + (isBonusMonth ? grossBonusAmt : 0);
      }

      // Tax return injection — estimate or override, applied annually in the configured month
      if (assumptions.taxReturnEnabled && d.getMonth() + 1 === assumptions.taxReturnMonth) {
        const refundAmt = assumptions.taxReturnAmountOverride > 0
          ? assumptions.taxReturnAmountOverride
          : (() => {
              const federalWithheld = assumptions.taxReturnFederalWithheld || Math.round(annualGrossHere * (taxRate / 100));
              const stateRate = STATE_TAX_RATES[assumptions.taxReturnState] ?? 0;
              const stateWithheld = Math.round(annualGrossHere * stateRate);
              return Math.max(0, estimateTaxReturn({
                annualGrossIncome: annualGrossHere,
                federalWithheld,
                filingStatus: assumptions.taxReturnFilingStatus,
                dependentsUnder17: assumptions.taxReturnDependents,
                stateCode: assumptions.taxReturnState,
                stateWithheld,
              }).totalRefund);
            })();
        netIncome += refundAmt;
      }

      // FIX #4: Expenses — use CC-filtered forecastMonthEvents to avoid double-counting
      // CC purchases with the debt engine's autopay pass-through payments post-payoff.
      const filteredExpenses = forecastMonthEvents[i]?.expenses ?? 0;
      const budgetFallback = budgetItems.reduce((s: number, b: any) => s + Number(b.amount), 0);
      let baseExpenses: number;
      if (i === 0 && filteredExpenses > 0) {
        baseExpenses = filteredExpenses;
      } else if (filteredExpenses > 0) {
        baseExpenses = filteredExpenses * expenseMultiplier;
      } else {
        baseExpenses = budgetFallback * expenseMultiplier;
      }

      // rawDebtPayment drives the cash-flow calculation (PASS 2 floor protection, PASS 3 surplus).
      // All months use cardProjectionData's real-debt-only totals (startBalance > 0 guard kept to
      // avoid post-payoff autopay inflating PASS 2's look-ahead). Falls back to scalar sim.
      let rawDebtPayment = cardProjectionData?.debtPaymentTotals?.[i]
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

      // Month 0: pin to Debt Payoff tab recommendations so forecast matches what user sees there
      if (i === 0 && currentMonthRecommendedDebt !== null && currentMonthRecommendedDebt > 0) {
        rawDebtPayment = currentMonthRecommendedDebt;
      }

      let monthTransfers = 0;
      let monthBrokerageContrib = 0;
      let monthRetireContrib = 0;
      for (const tr of transferRulesAll) {
        if (tr.start_date && new Date(tr.start_date) > d) continue;
        if (tr.end_date && new Date(tr.end_date) < d) continue;
        const amt = Number(tr.amount);
        let monthAmt = amt;
        if (tr.frequency === 'weekly') monthAmt = amt * 4.33;
        else if (tr.frequency === 'yearly') monthAmt = amt / 12;
        monthTransfers += monthAmt;

        // Categorize by destination account type
        const destAcct = tr.deposit_account ? accountMap.get(tr.deposit_account) : null;
        const destType = destAcct?.account_type || '';
        if (['roth_ira', '401k', 'ira', 'hsa'].includes(destType)) {
          monthRetireContrib += monthAmt;
        } else if (destType === 'brokerage') {
          monthBrokerageContrib += monthAmt;
        }
      }

      // Add paycheck 401k deduction contribution (not double-count if also has a transfer rule to 401k)
      monthRetireContrib += monthly401kContrib;

      const oneTime = oneTimeByMonth[monthKey] || { income: 0, expense: 0 };
      const oneTimeNet = oneTime.income - oneTime.expense;

      // Use cardProjectionData (event-based, includes all outflows) as the source of truth
      // for CC balance — this ensures the chart and monthly table show identical trajectories.
      // Fallback to debtBalancesByMonth if cardProjectionData isn't available (no CC cards).
      const ccDebtBalance = cardProjectionData?.data[i]?.totalCCBalance
        ?? (debtBalancesByMonth[i]?.totalBalance ?? 0);

      const nonCCLiabilities = active
        .filter((a: any) => !['credit_card'].includes(a.account_type) && liabilityTypes.includes(a.account_type))
        .reduce((s: number, a: any) => s + Number(a.balance), 0);
      const otherDebtPayments = debts
        .filter((dd: any) => !accounts.some((a: any) => a.account_type === 'credit_card' && a.name.toLowerCase() === dd.name.toLowerCase()))
        .reduce((s: number, dd: any) => s + Number(dd.target_payment), 0);
      const otherDebtBalance = Math.max(0, nonCCLiabilities - otherDebtPayments * i);

      const monthMinSafe = getMinSafeCash(rules, payConfig, cashFloor, forecastFundingAccountId, d);

      // Respect contribution_start_date on savings goals — don't subtract contributions before they begin
      const monthlySavingsContrib = goals.reduce((s: number, g: any) => {
        if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > d) return s;
        return s + Number(g.monthly_contribution);
      }, 0);

      baseData.push({
        monthLabel, monthKey, netIncome, baseExpenses, rawDebtPayment,
        monthTransfers, monthBrokerageContrib, monthRetireContrib, oneTimeNet, ccDebtBalance, otherDebtBalance, monthMinSafe, monthlySavingsContrib,
      });

      expenseMultiplier *= (1 + monthlyExpenseGrowth);
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

    // Total CC minimum payment across all cards (floor for save-up reduction)
    const ccCards = active.filter((a: any) => a.account_type === 'credit_card');
    const ccMinTotal = debts
      .filter((d: any) => ccCards.some((a: any) => a.name.toLowerCase() === d.name.toLowerCase()))
      .reduce((s: number, d: any) => s + Number(d.min_payment), 0);

    const debtPayments = baseData.map(b => b.rawDebtPayment);

    // Months where PASS 2 reduced debt to save up — PASS 3 skips redirect in these months
    const saveUpMonths = new Set<number>();

    // Simulate cash flow accounting for PASS 3 pinning in normal months.
    // Save-up months are NOT pinned — their extra cash carries forward to cover future expenses.
    const recomputeSimCash = (simCash: number[]) => {
      let bal = liquidBal;
      for (let i = 0; i < 36; i++) {
        const b = baseData[i];
        const totalOut = b.baseExpenses + debtPayments[i] + b.monthlySavingsContrib + monthlyCarContrib + b.monthTransfers;
        bal += b.netIncome - totalOut + b.oneTimeNet;
        // Simulate PASS 3 redirect: pin to monthMinSafe in normal months (not save-up months)
        if (!saveUpMonths.has(i) && b.ccDebtBalance > 0 && bal > b.monthMinSafe) {
          bal = b.monthMinSafe;
        }
        simCash[i] = bal;
      }
    };

    const simCash: number[] = Array.from({ length: 36 });
    recomputeSimCash(simCash);

    const minAdjustableMonthIndex = 0;

    // Iteratively find floor breaches and reduce debt in months immediately before each breach,
    // working backward (prefer the 1 month before, then 2, etc.) and stopping at CC minimums.
    for (let pass = 0; pass < 20; pass++) {
      let anyFixed = false;
      for (let i = 0; i < 36; i++) {
        if (simCash[i] >= baseData[i].monthMinSafe) continue;
        const shortfall = baseData[i].monthMinSafe - simCash[i];
        let toRecover = shortfall;

        // Scan BACKWARD from the breached month — prefer reducing the month closest to the breach
        for (let j = i; j >= minAdjustableMonthIndex && toRecover > 0; j--) {
          const minPayment = ccMinTotal; // minimums always required — even in the expense month
          const canReduce = Math.max(0, Math.min(debtPayments[j] - minPayment, toRecover));
          if (canReduce > 0) {
            debtPayments[j] -= canReduce;
            toRecover -= canReduce;
            if (j < i && baseData[i].oneTimeNet < 0) saveUpMonths.add(j); // only save-up when breach is caused by a one-time cash expense
            anyFixed = true;
          }
        }

        if (anyFixed) {
          recomputeSimCash(simCash);
          break; // restart scan to catch cascading effects
        }
      }
      if (!anyFixed) break;
    }

    // ═══ PASS 3: Build final projection data ═══
    let finalLiquid = liquidBal;
    const data: any[] = [];
    const milestones: { month: string; event: string }[] = [];

    for (let i = 0; i < 36; i++) {
      const b = baseData[i];
      let monthDebtPayment = debtPayments[i];
      const startingCash = Math.round(finalLiquid);

      totalLiabilityBal = b.ccDebtBalance + b.otherDebtBalance;

      const investGrowthAmt = Math.round(investBal * monthlyInvestGrowth * 100) / 100;
      const retireGrowthAmt = Math.round(retireBal * monthlyRetireGrowth * 100) / 100;

      savingsBal += b.monthlySavingsContrib;
      savingsBal *= (1 + monthlySavingsInterest);
      investBal += b.monthBrokerageContrib;
      investBal *= (1 + monthlyInvestGrowth);
      retireBal += b.monthRetireContrib;
      retireBal *= (1 + monthlyRetireGrowth);

      let totalMonthlyOut = b.baseExpenses + monthDebtPayment + b.monthlySavingsContrib + monthlyCarContrib + b.monthTransfers;

      finalLiquid += b.netIncome - totalMonthlyOut + b.oneTimeNet;

      // Final safety net for forecasted months
      if (i >= minAdjustableMonthIndex && finalLiquid < b.monthMinSafe) {
        const shortfall = b.monthMinSafe - finalLiquid;
        const adjustment = Math.min(shortfall, monthDebtPayment);
        finalLiquid += adjustment;
        monthDebtPayment -= adjustment;
        totalMonthlyOut -= adjustment;
      }

      // Redirect surplus to debt when CC balance exists — EXCEPT in save-up months.
      // Save-up months (identified by PASS 2) intentionally hold cash above the floor
      // to cover an upcoming one-time CASH expense without breaching the floor.
      // CC one-time purchases are excluded from oneTimeByMonth and never trigger save-up.
      if (!saveUpMonths.has(i) && b.ccDebtBalance > 0 && finalLiquid > b.monthMinSafe) {
        const surplus = finalLiquid - b.monthMinSafe;
        monthDebtPayment += surplus;
        totalMonthlyOut += surplus;
        finalLiquid -= surplus;
      }

      // FIX #9: Don't floor at 0 — allow display of negative to alert user
      const endingCash = Math.round(finalLiquid);

      // Flag: floor breached AND the one-time expense alone caused it
      const floorBreachedByOneTime =
        endingCash < b.monthMinSafe &&
        b.oneTimeNet < 0 &&
        (endingCash - b.oneTimeNet) >= b.monthMinSafe;
      const debtWasReduced = debtPayments[i] < b.rawDebtPayment;

      const totalAssets = finalLiquid + investBal + retireBal + savingsBal;
      const netWorth = totalAssets - totalLiabilityBal;

      if (b.ccDebtBalance <= 0 && i > 0 && (data[data.length - 1]?.debtBalance || 0) > 0) {
        milestones.push({ month: b.monthLabel, event: 'CC Debt Free! 🎉' });
      }
      goals.forEach((g: any) => {
        const projected = Number(g.current_amount) + Number(g.monthly_contribution) * i;
        if (projected >= Number(g.target_amount) && (i === 0 || Number(g.current_amount) + Number(g.monthly_contribution) * (i - 1) < Number(g.target_amount))) {
          milestones.push({ month: b.monthLabel, event: `${g.name} Complete! 🎯` });
        }
      });
      if (floorBreachedByOneTime) {
        milestones.push({ month: b.monthLabel, event: '💸 One-time expense caused floor breach' });
      } else if (endingCash < 0 && (i === 0 || data[data.length - 1]?.endingCash >= 0)) {
        milestones.push({ month: b.monthLabel, event: '⚠️ Cash goes negative!' });
      } else if (endingCash >= 0 && endingCash < b.monthMinSafe && (data.length === 0 || data[data.length - 1]?.endingCash >= b.monthMinSafe)) {
        milestones.push({ month: b.monthLabel, event: '⚠️ Cash below safe minimum' });
      }

      data.push({
        month: b.monthLabel, netWorth: Math.round(netWorth), totalAssets: Math.round(totalAssets),
        totalLiabilities: Math.round(totalLiabilityBal), debtBalance: Math.round(b.ccDebtBalance + b.otherDebtBalance),
        savingsBalance: Math.round(savingsBal), investmentBalance: Math.round(investBal),
        retirementBalance: Math.round(retireBal), liquidCash: Math.round(finalLiquid),
        endingCash,
        startingCash,
        takeHome: Math.round(b.netIncome), totalExpenses: Math.round(totalMonthlyOut),
        debtPayment: Math.round(monthDebtPayment),
        plannedDebtPayment: cardProjectionData?.allPaymentTotals?.[i] ?? Math.round(monthDebtPayment),

        brokerageContrib: Math.round(b.monthBrokerageContrib),
        retireContrib: Math.round(b.monthRetireContrib),
        paycheckRetireContrib: Math.round(monthly401kContrib),
        investGrowth: Math.round(investGrowthAmt),
        retireGrowth: Math.round(retireGrowthAmt),
        oneTimeNet: Math.round(b.oneTimeNet),
        ccOneTime: Math.round(ccOneTimeByMonth[b.monthKey] || 0),
        monthMinSafe: Math.round(b.monthMinSafe),
        floorBreachedByOneTime,
        debtWasReduced,
        // Popup breakdown fields
        baseExpenses: Math.round(b.baseExpenses),
        savingsContrib: Math.round(b.monthlySavingsContrib),
        carContrib: Math.round(monthlyCarContrib),
        transfersTotal: Math.round(b.monthTransfers),
        totalCCPurchases: Math.round((ccScheduledByMonth[i] ?? 0) + (ccOneTimeByMonth[b.monthKey] || 0)),
      });
    }

    return { data, milestones };
  }, [debts, goals, carFunds, accounts, subs, budgetItems, profile, assumptions, rules, monthlyAggregates, debtPaymentsByMonth, debtBalancesByMonth, cardProjectionData, payConfig, oneTimeByMonth, ccOneTimeByMonth, ccScheduledByMonth, transactions, currentMonthRecommendedDebt, forecastMonthEvents, forecastFundingAccountId]);

  // Live tax refund preview for the assumptions panel UI — always computed so it shows even when disabled
  const taxRefundPreview = useMemo(() => {
    try {
      if (assumptions.taxReturnAmountOverride > 0) {
        return { federalRefund: assumptions.taxReturnAmountOverride, stateRefund: 0, totalRefund: assumptions.taxReturnAmountOverride, federalTaxOwed: 0, stateTaxOwed: 0 };
      }
      const annualGross = payConfig.weeklyGross * 52;
      if (!annualGross || annualGross <= 0) return null;
      const txRate = assumptions.taxOverride || Number((profile as any)?.tax_rate) || 22;
      const federalWithheld = assumptions.taxReturnFederalWithheld || Math.round(annualGross * (txRate / 100));
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
  }, [assumptions, payConfig, profile]);

  const filteredData = useMemo(() => {
    if (filterYear === 'all') return projections.data;
    const yr = parseInt(filterYear);
    return projections.data.slice((yr - 1) * 12, yr * 12);
  }, [projections.data, filterYear]);

  const detailedEvents = useMemo(() => {
    if (filterYear === 'all') return scheduledEvents.slice(0, 100);
    const yr = parseInt(filterYear);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + (yr - 1) * 12, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + yr * 12, 0);
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    return scheduledEvents.filter(e => e.date >= startStr && e.date <= endStr).slice(0, 100);
  }, [scheduledEvents, filterYear]);

  const gridStroke = 'hsl(0, 0%, 18%)';
  const tickStyle = { fontSize: 10, fill: 'hsl(240, 4%, 50%)' };
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const xInterval = filterYear === 'all' ? (isMobile ? 5 : 2) : (isMobile ? 2 : 0);

  // Helper to check visibility — a series is visible if NOT in hiddenSeries
  const isVisible = (key: string) => !hiddenSeries.includes(key);

  const freePreview = !isPremium && !isDemo;
  const displayData = freePreview ? filteredData.slice(0, 3) : filteredData;

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
              <button onClick={() => setAssumptionsTutorialSeen(true)} className="text-muted-foreground hover:text-foreground p-1"><X size={16} /></button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              These six inputs directly drive every number in the 36-month projection. Changing them instantly re-runs the full forecast.
            </p>
            <div className="space-y-2">
              {[
                { label: 'Income Growth %', desc: 'Annual raise applied to your take-home. 3% means your income increases 3% each year.' },
                { label: 'Expense Growth %', desc: 'Annual inflation on recurring expenses. 2.5% reflects typical cost-of-living increases.' },
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
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1 truncate">36-month projections driven by live data</p>
          </div>
          <InstructionsModal pageTitle="Forecast Guide" sections={[
            { title: 'What is this page?', body: 'The Forecast projects your financial trajectory over the next 36 months using your live accounts, recurring rules, debt payoff plan, savings goals, and one-time manual transactions.' },
            { title: 'How projections work', body: 'Each month computes: Take-Home Income + One-Time Income − Expenses − One-Time Expenses − Debt Payments − Transfers = Monthly Remaining. Ending Cash carries forward and must stay above the required safe minimum.' },
            { title: 'Look-ahead floor protection', body: 'The forecast engine proactively reduces earlier extra debt payments when a known future one-time purchase or cash drain would make a later month fall below the safe minimum. Minimums are still paid; only extra payments are reduced first.' },
            { title: 'One-time transactions', body: 'Manual transactions (e.g. car down payments, travel, bonuses) remain fixed. Debt payments flex to preserve the cash floor. One-time income before the due date is included in cash projections.' },
            { title: 'Savings & Liquid Cash', body: 'Ending Cash reflects only checking and cash accounts — savings and HYS are excluded to match the Debt Payoff engine. This protects emergency funds from being counted as available for debt payments. Savings balances still appear in Net Worth projections.' },
            { title: 'Charts & Legends', body: 'Click any legend item to toggle that series off/on. Hidden items are grayed out. Click again to restore. No refresh needed — your preferences are saved.' },
            { title: 'Cash Safety', body: 'Ending Cash enforces the Recommended Safe Minimum = max(your cash floor, pre-paycheck next-month bills). Debt payments automatically decrease to maintain the safety reserve. Minimums are always prioritized.' },
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
                  const label = filterYear === 'all' ? 'All 36 Months' : `Year ${filterYear}`;
                  await exportForecastPdf(filteredData.map((r: any) => ({
                    month: r.month,
                    takeHome: r.takeHome ?? 0,
                    totalExpenses: r.totalExpenses ?? 0,
                    debtPayment: r.debtPayment ?? 0,
                    liquidCash: r.liquidCash ?? 0,
                    endingCash: r.endingCash ?? 0,
                    netWorth: r.netWorth ?? 0,
                    debtBalance: r.debtBalance ?? 0,
                    savingsBalance: r.savingsBalance ?? 0,
                  } as ForecastRow)), label);
                }}
                className="w-full sm:w-auto min-w-0 flex items-center justify-center gap-1.5 bg-secondary border border-border px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-medium btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <FileDown size={12} /> PDF
              </button>
              <button
                onClick={async () => {
                  await exportForecastCsv(filteredData.map((r: any): ForecastRow => ({
                    month: r.month,
                    takeHome: r.takeHome ?? 0,
                    totalExpenses: r.totalExpenses ?? 0,
                    debtPayment: r.debtPayment ?? 0,
                    liquidCash: r.liquidCash ?? 0,
                    endingCash: r.endingCash ?? 0,
                    netWorth: r.netWorth ?? 0,
                    debtBalance: r.debtBalance ?? 0,
                    savingsBalance: r.savingsBalance ?? 0,
                  })));
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
              <p className="text-xs font-semibold text-foreground">36-month simulation — every data source feeding one projection</p>
              <p className="text-xs text-muted-foreground mt-0.5">The Forecast is where everything converges: income rules, debt payments, savings transfers, and one-time transactions all play out month by month.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: '3-pass engine', desc: 'PASS 1 builds base values. PASS 2 looks ahead and pre-saves cash for future one-time expenses. PASS 3 pushes all surplus above the cash floor to debt.' },
              { label: 'End cash at floor', desc: 'While CC debt exists, end cash lands exactly at $1,000 each month — no idle cash. The June car purchase causes PASS 2 to pre-save in April and May.' },
              { label: 'Debt payoff trajectory', desc: 'The debt chart shows each card\'s balance declining month by month. Sapphire goes first (22.99% APR), then Discover gets the full surplus.' },
              { label: 'Assumptions panel', desc: 'Adjust income growth, expense inflation, investment return, and savings interest to model different scenarios over 3 years.' },
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
            <button onClick={() => setShowAssumptions(false)} className="text-muted-foreground hover:text-foreground transition-colors p-1"><X size={14} /></button>
          </div>

          {/* Growth & Returns */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Growth & Returns</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { key: 'investmentGrowth', label: 'Investment %' },
                { key: 'savingsInterest', label: 'Savings Interest %' },
                { key: 'expenseGrowth', label: 'Expense Inflation %' },
                { key: 'taxOverride', label: 'Tax Override %' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="text-[9px] text-muted-foreground uppercase">{label}</label>
                  <input type="number" value={(assumptions as any)[key]}
                    onChange={e => setAssumptions(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                    className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step="0.1" />
                </div>
              ))}
            </div>
          </div>

          {/* Income Growth / Annual Raise */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setAssumptions(prev => ({ ...prev, incomeGrowthEnabled: !prev.incomeGrowthEnabled }))}
                className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${assumptions.incomeGrowthEnabled ? 'bg-primary' : 'bg-border'}`}
              >
                <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${assumptions.incomeGrowthEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Annual Raise</p>
            </div>
            <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 transition-opacity ${assumptions.incomeGrowthEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase">Mode</label>
                <div className="flex mt-1 border border-border overflow-hidden" style={{ borderRadius: 'var(--radius)' }}>
                  {(['pct', 'flat'] as const).map(m => (
                    <button key={m}
                      onClick={() => setAssumptions(prev => ({ ...prev, raiseMode: m }))}
                      className={`flex-1 py-1.5 text-xs font-medium transition-colors ${(assumptions as any).raiseMode === m ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
                      {m === 'pct' ? '%' : '$'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase">{(assumptions as any).raiseMode === 'flat' ? 'Raise $/yr' : 'Raise %'}</label>
                <input type="number" value={assumptions.incomeGrowth}
                  onChange={e => setAssumptions(prev => ({ ...prev, incomeGrowth: parseFloat(e.target.value) || 0 }))}
                  className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step={(assumptions as any).raiseMode === 'flat' ? '500' : '0.1'} />
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
                className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${assumptions.bonusEnabled ? 'bg-primary' : 'bg-border'}`}
              >
                <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${assumptions.bonusEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Expected Bonus</p>
            </div>
            <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 transition-opacity ${assumptions.bonusEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
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
                  className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${assumptions.taxReturnEnabled ? 'bg-primary' : 'bg-border'}`}
                >
                  <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${assumptions.taxReturnEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tax Return Estimator</p>
              </div>
              {taxRefundPreview && (
                <div className="bg-primary/5 border border-primary/20 px-2 py-1 text-xs" style={{ borderRadius: 'var(--radius)' }}>
                  <span className="text-muted-foreground">Est. </span>
                  <span className="font-display font-bold text-primary">{formatCurrency(taxRefundPreview.totalRefund, false)}</span>
                  {taxRefundPreview.stateRefund !== 0 && (
                    <span className="text-muted-foreground ml-1.5">({formatCurrency(taxRefundPreview.federalRefund, false)} fed + {formatCurrency(taxRefundPreview.stateRefund, false)} state)</span>
                  )}
                </div>
              )}
            </div>
            <div className={`space-y-3 transition-opacity ${assumptions.taxReturnEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
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
                    {[['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],['DC','Washington DC']].map(([code, name]) => (
                      <option key={code} value={code}>{name}</option>
                    ))}
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
                  <label className="text-[9px] text-muted-foreground uppercase">Fed. Withheld/yr (0 = auto)</label>
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
                    <p className="text-[9px] text-muted-foreground uppercase mb-1">Estimated Refund</p>
                    <div className="bg-primary/5 border border-primary/20 px-2 py-1.5 text-xs" style={{ borderRadius: 'var(--radius)' }}>
                      <span className="text-muted-foreground">Fed </span>
                      <span className="font-display font-bold text-foreground">{formatCurrency(taxRefundPreview.federalRefund, false)}</span>
                      {taxRefundPreview.stateRefund !== 0 && (
                        <><span className="text-muted-foreground ml-2">State </span>
                        <span className="font-display font-bold text-foreground">{formatCurrency(taxRefundPreview.stateRefund, false)}</span></>
                      )}
                      <div className="mt-0.5 font-display font-bold text-primary">{formatCurrency(taxRefundPreview.totalRefund, false)} total</div>
                    </div>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">Estimate uses 2025 federal brackets, standard deduction, and child tax credit. State uses a simplified flat rate. Injected as income in the selected month every year.</p>
            </div>
          </div>
        </div>
      )}

      {/* Year Filter — premium only */}
      {!freePreview && (
        <div className="flex gap-1.5 sm:gap-2 overflow-x-auto w-full pb-1">
          {(['all', '1', '2', '3'] as const).map(yr => (
            <button key={yr} onClick={() => setFilterYear(yr)} className={`px-3 sm:px-4 py-1 sm:py-1.5 text-xs font-medium border btn-press whitespace-nowrap ${filterYear === yr ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`} style={{ borderRadius: 'var(--radius)' }}>
              {yr === 'all' ? 'All 36 Months' : `Year ${yr}`}
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

      {/* Safe minimum override notice — shown when pre-paycheck bills exceed user cash floor */}
      {prePaycheckBillsInfo.total > debtPayoffOptions.cashFloor && (
        <div className="flex items-start gap-2.5 bg-primary/5 border border-primary/20 px-3 py-2.5 text-xs" style={{ borderRadius: 'var(--radius)' }}>
          <Info size={13} className="text-primary shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              Cash floor raised to {formatCurrency(Math.max(debtPayoffOptions.cashFloor, prePaycheckBillsInfo.total), false)} — pre-paycheck bills exceed your {formatCurrency(debtPayoffOptions.cashFloor, false)} floor.
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
              {freePreview && <span className="text-[9px] text-muted-foreground">Showing 3 of 36 months</span>}
            </div>
            <ResponsiveContainer width="100%" height={window.innerWidth < 640 ? 220 : 260}>
              {chartMode === 'combo' ? (
                <ComposedChart data={displayData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={tickStyle} interval={xInterval} />
                  <YAxis tick={tickStyle} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
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
                  <XAxis dataKey="month" tick={tickStyle} interval={xInterval} />
                  <YAxis tick={tickStyle} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
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
                <p className="text-sm font-semibold">See your full 36-month forecast</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">Upgrade to Premium to unlock all 36 months, the CC debt payoff trajectory chart, the monthly breakdown table, and PDF export.</p>
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

          {/* Debt Projection Chart — premium only */}
          {!freePreview && cardProjectionData && (
            <div className="card-forged p-3 sm:p-5 min-w-0 overflow-x-hidden">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 sm:mb-4 flex items-center gap-2"><CreditCard size={12} /> Credit Card Debt Payoff Trajectory</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={cardProjectionData.data.slice(0, filterYear === 'all' ? 36 : parseInt(filterYear) * 12)} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={tickStyle} interval={xInterval} />
                  <YAxis tick={tickStyle} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ForecastTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {cardProjectionData.cards.map(c => (
                    <Line key={c.name} type="monotone" dataKey={c.name} stroke={c.color} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Monthly Cash Flow Table — premium only */}
          {!freePreview && <div className="card-forged p-3 sm:p-5">
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
            {displayData.map((row: any, i: number) => {
              const openDrawer = () => {
                const isCurrentMonth = i === 0 && (filterYear === 'all' || filterYear === '1');
                setCalcDrawer({
                  title: `${row.month} Breakdown`,
                  lines: [
                    ...(isCurrentMonth ? [{ label: '⏱ Reflects remaining of month — settled transactions excluded', value: '' }] : []),
                    { label: 'Starting Cash', value: formatCurrency(row.startingCash, false) },
                    { label: 'Take-Home Income', value: formatCurrency(row.takeHome, false), op: '+' },
                    { label: '  Bills & Expenses', value: formatCurrency(row.baseExpenses ?? 0, false), op: '−' },
                    { label: '  Debt Payments', value: formatCurrency(row.debtPayment, false), op: '−' },
                    ...((row.savingsContrib ?? 0) + (row.carContrib ?? 0) > 0
                      ? [{ label: '  Savings + Car Fund', value: formatCurrency((row.savingsContrib ?? 0) + (row.carContrib ?? 0), false), op: '−' }]
                      : []),
                    ...((row.transfersTotal ?? 0) > 0
                      ? [{ label: '  Investment & Retirement Transfers', value: formatCurrency(row.transfersTotal ?? 0, false), op: '−' }]
                      : []),
                    { label: 'One-Time Net (Cash)', value: formatCurrency(Math.abs(row.oneTimeNet || 0), false), op: (row.oneTimeNet || 0) >= 0 ? '+' : '−' },
                    { label: 'Ending Cash', value: formatCurrency(row.endingCash, false), op: '=' },
                    { label: '', value: '' },
                    { label: 'CC Purchases', value: (row.totalCCPurchases ?? 0) > 0 ? formatCurrency(row.totalCCPurchases, false) : '—' },
                    { label: 'Paycheck 401k Deduction', value: (row.paycheckRetireContrib ?? 0) > 0 ? formatCurrency(row.paycheckRetireContrib, false) : '—' },
                    { label: 'Total Retirement Contrib', value: formatCurrency(row.retireContrib, false) },
                    { label: 'Brokerage Contrib', value: formatCurrency(row.brokerageContrib, false) },
                    { label: 'Retirement Balance', value: formatCurrency(row.retirementBalance, false) },
                    { label: 'Net Worth', value: formatCurrency(row.netWorth, false) },
                  ],
                });
              };
              const hasCC = (row.totalCCPurchases ?? 0) > 0;
              const hasOneTime = (row.oneTimeNet ?? 0) !== 0;
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
                  {(hasCC || hasOneTime) && (
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

      <CalcDrawer
        open={!!calcDrawer}
        onClose={() => setCalcDrawer(null)}
        title={calcDrawer?.title || ''}
        lines={calcDrawer?.lines || []}
      />
    </div>
  );
}
