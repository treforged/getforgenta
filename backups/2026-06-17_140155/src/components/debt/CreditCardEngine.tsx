import { useState, useMemo, useEffect, useRef } from 'react';
import { formatCurrency, formatYAxisTick } from '@/lib/calculations';
import {
  buildCardData, projectCard, projectCardVariable,
  simulateVariablePayoff, CardData, CardProjection, CC_DEFAULT_CATEGORIES,
} from '@/lib/credit-card-engine';
import {
  buildPayConfig, getNormalizedMonthNetIncome, getPrePaycheckNextMonthBills, getMinSafeCash,
  getRemainingTransactionIncomeByDay, getRemainingTransactionExpensesByDay,
  getRemainingTransactionIncomeItemsByDay, getRemainingTransactionExpenseItemsByDay,
  mergeWithGeneratedTransactions, generateMonthTransactionsFromRules,
  type TransactionLineItem,
} from '@/lib/pay-schedule';
import { generateScheduledEvents, countWeekdayInMonth, countRuleOccurrencesInMonth } from '@/lib/scheduling';
import { getTotalCarLoanMonthly } from '@/lib/vehicle-loan-engine';
import { type Month0Result } from '@/hooks/useCardProjection';
import { type PaymentPlan, getPaymentDates } from '@/lib/payment-plan-generator';
import { ChevronDown, ChevronUp, CreditCard, AlertTriangle, TrendingDown, Info, Zap, Target, Edit2, Check, CheckCircle2, RotateCcw, Wallet, ShieldCheck, CalendarDays } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useDebts, useAccounts, useProfile, useRecurringRules } from '@/hooks/useSupabaseData';
import { usePlaidItems } from '@/hooks/usePlaidItems';
import { usePersistedState } from '@/hooks/usePersistedState';
import { toast } from 'sonner';
import { useSubscription } from '@/hooks/useSubscription';
import { useDemo } from '@/contexts/DemoContext';
import PremiumGate from '@/components/shared/PremiumGate';

type Props = {
  accounts: any[];
  transactions: any[];
  rules: any[];
  debts: any[];
  profile: any;
  goals: any[];
  carFunds: any[];
  incomeGrowthEnabled?: boolean;
  incomeGrowth?: number;
  raiseMonth?: number;
  raiseMode?: 'pct' | 'flat';
  bonusEnabled?: boolean;
  bonusAmount?: number;
  bonusMode?: 'flat' | 'pct';
  bonusMonth?: number;
  bonusRecurring?: boolean;
  taxReturnEnabled?: boolean;
  taxReturnAmountOverride?: number;
  taxReturnMonth?: number;
  /** Pass-3 simulation result — drives all month 0 recommendation display (payments, safe-to-pay, floor). */
  month0?: Month0Result | null;
  /** Full 36-month payment arrays from useCardProjection — when provided, projections use Forecast's sim instead of the internal variableSim. */
  perCardPayments?: { id: string; payments: number[] }[] | null;
  /** Cash-floor-constrained version of perCardPayments (pass-3 scaled). Preferred over perCardPayments when provided. */
  perCardPaymentsScaled?: { id: string; payments: number[] }[] | null;
  /** Sim revolving balances from useCardProjection — passed to projectCardVariable to fix cycling detection for statement cards. */
  monthlyRevolvingBalances?: Map<string, number[]> | null;
  /** Payment plans with CC payment_source — charges are injected into per-month CC purchases so the accordion reflects installment spending. */
  paymentPlans?: PaymentPlan[];
};

const STRATEGY_TIPS = {
  avalanche: 'Pays minimums on all cards, then sends extra money to the highest APR card first to reduce total interest fastest. Cash floor and bill reserves are always enforced.',
  snowball: 'Pays minimums on all cards, then sends extra money to the smallest balance first for faster wins and momentum. Cash floor and bill reserves are always enforced.',
};

const PAYMENT_MODE_TIPS = {
  variable: 'Adjusts payments dynamically month to month based on available cash to reduce interest faster.',
  consistent: 'Uses your chosen target payment amount each month for predictable budgeting.',
};

export default function CreditCardEngine({ accounts, transactions, rules, debts, profile, goals, carFunds, incomeGrowthEnabled, incomeGrowth, raiseMonth, raiseMode, bonusEnabled, bonusAmount, bonusMode, bonusMonth, bonusRecurring, taxReturnEnabled, taxReturnAmountOverride, taxReturnMonth, month0, perCardPayments, perCardPaymentsScaled, monthlyRevolvingBalances, paymentPlans }: Props) {
  const { update: updateDebt, add: addDebt } = useDebts();
  const { update: updateAccount } = useAccounts();
  const { update: updateProfile } = useProfile();
  const { items: plaidItems } = usePlaidItems();
  const [pauseSavings] = usePersistedState<boolean>('tre:debtpayoff:pause-savings', false);
  const { isPremium } = useSubscription();
  const { isDemo } = useDemo();
  const [strategy, setStrategy] = usePersistedState<'avalanche' | 'snowball'>('tre:debt:strategy', 'avalanche');
  const [paymentMode, setPaymentMode] = usePersistedState<'variable' | 'consistent'>('tre:debt:paymentMode', 'variable');
  const [cashFloor, setCashFloorLocal] = useState(() => profile?.cash_floor != null ? Number(profile.cash_floor) : 1000);
  useEffect(() => {
    if (profile?.cash_floor != null) setCashFloorLocal(Number(profile.cash_floor));
  }, [profile?.cash_floor]);
  const [expandedCards, setExpandedCards] = usePersistedState<string[]>('tre:debt:expanded-cards', []);
  const [editingTarget, setEditingTarget] = useState<string | null>(null);
  const [editingStatementBal, setEditingStatementBal] = useState<string | null>(null);
  const [statementBalInput, setStatementBalInput] = useState('');

  const [targetInput, setTargetInput] = useState('');
  const [overrides, setOverrides] = useState<Record<string, Record<number, number>>>({});
  const [editingMonth, setEditingMonth] = useState<{ cardId: string; month: number } | null>(null);
  const [monthPayInput, setMonthPayInput] = useState('');
  const [liquidCashOpen, setLiquidCashOpen] = useState(false);
  const [safeToPayOpen, setSafeToPayOpen] = useState(false);

  // Auto-save cash floor to profile on change
  const cashFloorSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setCashFloor = (val: number) => {
    setCashFloorLocal(val);
    if (cashFloorSaveTimer.current) clearTimeout(cashFloorSaveTimer.current);
    cashFloorSaveTimer.current = setTimeout(() => {
      updateProfile.mutate({ cash_floor: val } as any);
    }, 1000);
  };

  // Pay config
  const payConfig = useMemo(() => buildPayConfig(profile), [profile]);

  // Merge real DB transactions with generated recurring transactions from rules
  // This is the SINGLE SOURCE OF TRUTH — all transaction-based helpers read from this
  const allTransactions = useMemo(() =>
    mergeWithGeneratedTransactions(transactions, rules, accounts),
    [transactions, rules, accounts],
  );

  // Funding account selection — exclude savings
  const liquidTypes = ['checking', 'business_checking', 'cash'];
  const liquidAccounts = useMemo(() => accounts.filter((a: any) => a.active && liquidTypes.includes(a.account_type)), [accounts]);
  const defaultFunding = useMemo(() => {
    const defaultId = (profile as any)?.default_deposit_account;
    if (defaultId) {
      const acct = liquidAccounts.find((a: any) => a.id === defaultId);
      if (acct) return acct.id;
    }
    const checking = liquidAccounts.find((a: any) => a.account_type === 'checking');
    return checking?.id || liquidAccounts[0]?.id || '';
  }, [liquidAccounts, profile]);
  const [fundingAccountId, setFundingAccountIdLocal] = usePersistedState<string>('tre:debt:fundingAccount', defaultFunding);
  const setFundingAccountId = (id: string) => {
    setFundingAccountIdLocal(id);
    updateProfile.mutate({ default_deposit_account: id } as any);
  };

  const liquidCash = liquidAccounts.reduce((s: number, a: any) => s + Number(a.balance), 0);
  // Use defaultFunding as fallback so fundingAccount resolves correctly while
  // accounts are still loading and fundingAccountId may be '' (no localStorage value yet).
  const resolvedFundingId = fundingAccountId || defaultFunding;
  const fundingAccount = liquidAccounts.find((a: any) => a.id === resolvedFundingId);
  const fundingBalance = fundingAccount ? Number(fundingAccount.balance) : liquidCash;

  // Use Plaid last_synced_at as cutoff so estimated liquid cash rolls over at 9am ET
  // when accounts update, not at midnight. Mirrors Dashboard/Forecast syncCutoffDate logic.
  const syncCutoffDate = useMemo((): string => {
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (!fundingAccount?.plaid_item_id) return localDate;
    const plaidItem = plaidItems.find((pi: any) => pi.plaid_item_id === fundingAccount.plaid_item_id);
    if (!plaidItem?.last_synced_at) return localDate;
    return plaidItem.last_synced_at.split('T')[0];
  }, [fundingAccount, plaidItems]);

  // Persist defaultFunding to localStorage the first time accounts load so future
  // reloads initialize fundingAccountId correctly without needing a navigation.
  useEffect(() => {
    if (!fundingAccountId && defaultFunding) {
      setFundingAccountIdLocal(defaultFunding);
    }
  }, [defaultFunding, fundingAccountId]);

  // Allow-list of payment source strings that match the funding account.
  // Expenses with a source NOT in this set (CC, other checking, savings) are excluded
  // from the liquid cash estimate since they don't draw from the funding account.
  // Falls back to defaultFunding so the filter is non-empty even before the persisted
  // value resolves (accounts still loading → fundingAccountId may be '').
  const fundingAccountSources = useMemo(() => {
    const id = fundingAccountId || defaultFunding;
    return id ? new Set([id, `account:${id}`]) : new Set<string>();
  }, [fundingAccountId, defaultFunding]);

  const monthlyTakeHome = useMemo(() => {
    const now = new Date();
    const paycheckIncome = getNormalizedMonthNetIncome(payConfig);
    const nonPaycheckIncome = rules
      .filter((r: any) =>
        r.active &&
        r.rule_type === 'income' &&
        !['paycheck', 'salary', 'wages', 'pay'].some(kw => r.name?.toLowerCase().includes(kw))
      )
      .reduce((s: number, r: any) => {
        const amt = Number(r.amount);
        const count = countRuleOccurrencesInMonth(r, now.getFullYear(), now.getMonth());
        return s + amt * count;
      }, 0);
    return paycheckIncome + nonPaycheckIncome;
  }, [payConfig, rules]);

  const cards: CardData[] = useMemo(() => buildCardData(accounts, transactions, rules, debts), [accounts, transactions, rules, debts]);

  // When any revolving card is due on a day that already passed this month, the next
  // payment falls in next month. Generate those transactions so income/expense helpers
  // can correctly project cash through the actual upcoming due date.
  const allTransactionsWithNextMonth = useMemo(() => {
    const now = new Date();
    const today = now.getDate();
    const hasEarlyDueCard = cards.some(c => !c.autopayFullBalance && c.balance > 0 && (c.dueDay || 31) < today);
    if (!hasEarlyDueCard) return allTransactions;
    const nextYear = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    const nextMonth = (now.getMonth() + 1) % 12;
    const nextMonthTxns = generateMonthTransactionsFromRules(rules, accounts, nextYear, nextMonth);
    return [...allTransactions, ...nextMonthTxns];
  }, [allTransactions, cards, rules, accounts]);

  // CC account IDs in both raw and prefixed form — shared by expense filters
  const ccPaymentSources = useMemo(
    () => new Set(cards.flatMap(c => [c.id, `account:${c.id}`])),
    [cards],
  );

  const monthlyRecurringExpenses = useMemo(() => {
    // CC-tagged rules are tracked via cardPurchasesPerMonth in the engine (Step 2.5).
    // Including them here AND there would double-count, draining available cash
    // and causing UNSTABLE flags every month → no extra payments ever applied.
    return rules.filter((r: any) => {
      if (!r.active || r.rule_type !== 'expense') return false;
      // Safety: if no CC accounts loaded yet, include all expenses (no CC data to filter on)
      if (ccPaymentSources.size === 0) return true;
      if (r.payment_source && ccPaymentSources.has(r.payment_source)) return false; // explicit CC
      if (!r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category)) return false; // default-card CC
      if (pauseSavings && (r.category === 'Savings' || r.category === 'Investing')) return false;
      return true;
    }).reduce((s: number, r: any) => {
      const amt = Number(r.amount);
      const now = new Date();
      return s + amt * countRuleOccurrencesInMonth(r, now.getFullYear(), now.getMonth());
    }, 0);
  }, [rules, cards, accounts, pauseSavings]);

  // Pre-paycheck next-month bills
  const prePaycheckBills = useMemo(() => getPrePaycheckNextMonthBills(rules, payConfig, fundingAccountId || null), [rules, payConfig, fundingAccountId]);

  // recommendedSafeMinimum is computed after variableSim below so it can use the sim's
  // monthlyRevolvingBalances and perCardMinPayments to exactly match Forecast month 0.

  // Use the earliest card due day as the default window for the top-level display
  const primaryDueDay = useMemo(() => {
    const revolving = cards.filter(c => !c.autopayFullBalance && c.balance > 0);
    if (revolving.length === 0) return 31;
    // Use the earliest due day among revolving cards
    const dueDays = revolving.map(c => c.dueDay || 31);
    return Math.min(...dueDays);
  }, [cards]);

  // Computed income/expense breakdown for display — full month (day 31).
  // Only funding-account expenses are counted (CC purchases excluded) so estLiquidCash
  // reflects what actually hits the funding account, not charges to credit cards.
  const fundingSources = useMemo(() =>
    resolvedFundingId
      ? new Set([resolvedFundingId, `account:${resolvedFundingId}`])
      : new Set<string>(),
    [resolvedFundingId],
  );

  const cashBreakdown = useMemo(() => {
    const transactionIncome = getRemainingTransactionIncomeByDay(allTransactionsWithNextMonth, 31, syncCutoffDate);
    const transactionExpenses = getRemainingTransactionExpensesByDay(allTransactionsWithNextMonth, 31, true, fundingSources, CC_DEFAULT_CATEGORIES, syncCutoffDate);
    return { transactionIncome, transactionExpenses };
  }, [allTransactionsWithNextMonth, syncCutoffDate, fundingSources]);

  // Line-item breakdown so the tooltip can show exactly what's included
  const cashBreakdownItems = useMemo(() => {
    const incomeItems = getRemainingTransactionIncomeItemsByDay(allTransactionsWithNextMonth, 31, syncCutoffDate);
    const expenseItems = getRemainingTransactionExpenseItemsByDay(allTransactionsWithNextMonth, 31, true, fundingSources, CC_DEFAULT_CATEGORIES, syncCutoffDate);
    return { incomeItems, expenseItems };
  }, [allTransactionsWithNextMonth, syncCutoffDate, fundingSources]);

  // Estimated liquid cash: funding balance + full-month income − full-month non-debt expenses.
  // Pre-debt-payment cash — feeds Safe to Pay (estLiquidCash − safeMinimum − autopay).
  // Dashboard's Month-End Cash is lower by the debt payment amounts (post-debt metric).
  const estLiquidCash = useMemo(() => {
    return fundingBalance + cashBreakdown.transactionIncome - cashBreakdown.transactionExpenses;
  }, [fundingBalance, cashBreakdown]);

  // Estimated liquid cash per card by due date (no expense deduction — safe minimum covers bills)
  const cardEstimatedCash = useMemo(() => {
    const result: Record<string, number> = {};
    for (const card of cards) {
      const dueDay = card.dueDay || 31;
      const incByDue = getRemainingTransactionIncomeByDay(allTransactionsWithNextMonth, dueDay, syncCutoffDate);
      result[card.id] = fundingBalance + incByDue;
    }
    return result;
  }, [cards, fundingBalance, allTransactionsWithNextMonth, syncCutoffDate]);

  // ── Event-based monthEvents + cardPurchasesPerMonth ──────────────────────────
  // Uses actual scheduled income/expense occurrences instead of flat scalars so
  // that month 0 only counts income from today forward (already-received income
  // is baked into the live checking balance and must not be double-counted).
  const { monthEvents, cardPurchasesPerMonth: ccPurchasesPerMonth } = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const scheduledEvents = generateScheduledEvents(rules, accounts, 36);

    const liquidAccountIds = new Set<string>(
      accounts.filter((a: any) => a.active && ['checking', 'business_checking', 'cash'].includes(a.account_type))
        .map((a: any) => a.id),
    );

    const incomeToLiquidRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'income' &&
        (!r.deposit_account || liquidAccountIds.has(r.deposit_account)),
      ).map((r: any) => r.id),
    );

    const ccPaymentSources = new Set<string>(cards.flatMap(c => [c.id, `account:${c.id}`]));
    const ccExplicitRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'expense' && r.payment_source && ccPaymentSources.has(r.payment_source),
      ).map((r: any) => r.id),
    );
    const highestAprCardId = cards.length > 0 ? [...cards].sort((a, b) => b.apr - a.apr)[0].id : '';
    const ccDefaultRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'expense' && !r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category),
      ).map((r: any) => r.id),
    );
    const allCcRuleIds = new Set<string>([...ccExplicitRuleIds, ...ccDefaultRuleIds]);

    const cardRuleIdMap = new Map<string, Set<string>>(
      cards.map(c => {
        const cKey = `account:${c.id}`;
        const ids = new Set<string>(
          rules.filter((r: any) =>
            r.active && r.rule_type === 'expense' &&
            (r.payment_source === c.id || r.payment_source === cKey),
          ).map((r: any) => r.id),
        );
        if (c.id === highestAprCardId) ccDefaultRuleIds.forEach(id => ids.add(id));
        return [c.id, ids];
      }),
    );

    const savingsRuleIds = new Set<string>(
      rules.filter((r: any) =>
        r.active && r.rule_type === 'expense' && (r.category === 'Savings' || r.category === 'Investing'),
      ).map((r: any) => r.id),
    );

    const evMonthEvents: { income: number; expenses: number }[] = [];
    const evCardPurchases: { [cardId: string]: number }[] = [];

    for (let i = 0; i < 36; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const eventsInMonth = scheduledEvents.filter(e =>
        e.date.startsWith(monthKey) && (i > 0 || e.date >= todayStr),
      );

      const income = eventsInMonth
        .filter(e => e.type === 'income' && e.ruleId && incomeToLiquidRuleIds.has(e.ruleId))
        .reduce((s, e) => s + e.amount, 0);

      const cashExpenses = eventsInMonth
        .filter(e =>
          e.type === 'expense' &&
          !(e.ruleId && allCcRuleIds.has(e.ruleId)) &&
          !(pauseSavings && e.ruleId && savingsRuleIds.has(e.ruleId)),
        )
        .reduce((s, e) => s + e.amount, 0);

      evMonthEvents.push({ income, expenses: cashExpenses });

      const cardPurchases: { [cardId: string]: number } = {};
      if (i > 0) {
        for (const card of cards) {
          if (card.startDate) {
            const startD = new Date(card.startDate + 'T00:00:00');
            if (d < startD) continue; // no purchases before card's start date
          }
          const ruleIds = cardRuleIdMap.get(card.id) ?? new Set<string>();
          cardPurchases[card.id] = eventsInMonth
            .filter(e => e.type === 'expense' && e.ruleId && ruleIds.has(e.ruleId))
            .reduce((s, e) => s + e.amount, 0);
        }
      }
      evCardPurchases.push(cardPurchases);
    }

    return { monthEvents: evMonthEvents, cardPurchasesPerMonth: evCardPurchases };
  }, [rules, accounts, cards, pauseSavings]);

  const variableSim = useMemo(() => {
    // Derive month 0 remaining income/expenses from allTransactions (today → EOM).
    // allTransactions now contains only future-dated generated transactions (past
    // events are excluded by generateCurrentMonthTransactionsFromRules) plus all
    // real DB transactions. getRemainingTransactionIncomeByDay/ExpensesByDay then
    // filter to txDay >= today, giving the correct month 0 remaining values without
    // double-counting income already reflected in the live account balance.
    const now = new Date();

    const month0Income = getRemainingTransactionIncomeByDay(allTransactions, 31, syncCutoffDate);

    const month0Expenses = getRemainingTransactionExpensesByDay(allTransactions, 31, true, new Set(), new Set(), syncCutoffDate);

    // CC account IDs used to exclude CC-charged one-time expenses from future cash-flow months.
    const ccIds = new Set(
      accounts
        .filter((a: any) => a.account_type === 'credit_card' && a.active)
        .flatMap((a: any) => [a.id, `account:${a.id}`])
    );

    // One-time (non-generated) transactions per future month — applied AFTER debt allocation
    // in simulateVariablePayoff so they don't cause look-ahead cash hoarding in prior months.
    // Month 0 is handled separately via month0Income/month0Expenses above.
    const oneTimeByMonth: { income: number; expenses: number }[] = [{ income: 0, expenses: 0 }];

    // Augment ccPurchasesPerMonth with one-time (non-generated) CC transactions per card.
    // ccPurchasesPerMonth from the outer useMemo only includes recurring rule events.
    // One-time future CC purchases (e.g. $410 Prime Visa in June) must be added here
    // so the simulation knows that month's purchases on that card.
    const augmentedCCPurchases: { [cardId: string]: number }[] = [{}]; // month 0 = empty

    for (let i = 1; i < 36; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const txns = (allTransactions as any[]).filter((t: any) =>
        t.date && t.date.startsWith(mk) && !(t as any).isGenerated,
      );
      const inc = txns
        .filter((t: any) => t.type === 'income' && t.category !== 'Balance Adjustment')
        .reduce((s: number, t: any) => s + Number(t.amount), 0);
      const exp = txns
        .filter((t: any) => {
          if (t.type !== 'expense') return false;
          if (t.category === 'Debt Payments' || t.category === 'Balance Adjustment') return false;
          if (t.payment_source && ccIds.has(t.payment_source)) return false;
          return true;
        })
        .reduce((s: number, t: any) => s + Number(t.amount), 0);
      oneTimeByMonth.push({ income: inc, expenses: exp });

      // Build per-card one-time CC purchases for this month
      const baseMonth = ccPurchasesPerMonth[i] ?? {};
      const monthCCPurchases: { [cardId: string]: number } = { ...baseMonth };
      for (const card of cards) {
        const cKey = `account:${card.id}`;
        const oneTimePurchases = txns
          .filter((t: any) =>
            t.type === 'expense' &&
            (t.payment_source === card.id || t.payment_source === cKey),
          )
          .reduce((s: number, t: any) => s + Number(t.amount), 0);
        if (oneTimePurchases > 0) {
          monthCCPurchases[card.id] = (monthCCPurchases[card.id] || 0) + oneTimePurchases;
        }
      }
      augmentedCCPurchases.push(monthCCPurchases);
    }

    // Inject CC-sourced payment plan charges into augmentedCCPurchases so the
    // accordion shows installment spending on the correct card per month.
    if (paymentPlans && paymentPlans.length > 0) {
      const todayStr = now.toISOString().split('T')[0];
      const cutoff = syncCutoffDate ?? todayStr;
      const sourceToCardId = new Map<string, string>(
        cards.flatMap(c => [[c.id, c.id], [`account:${c.id}`, c.id]]),
      );
      for (const plan of paymentPlans) {
        if (!plan.active || !plan.payment_source) continue;
        const cardId = sourceToCardId.get(plan.payment_source);
        if (!cardId) continue;
        const planDates = getPaymentDates(plan.start_date, plan.frequency, plan.total_payments);
        for (const date of planDates) {
          if (date <= cutoff) continue;
          const pd = new Date(date + 'T00:00:00');
          for (let mi = 0; mi < 36; mi++) {
            const md = new Date(now.getFullYear(), now.getMonth() + mi, 1);
            if (pd.getFullYear() === md.getFullYear() && pd.getMonth() === md.getMonth()) {
              augmentedCCPurchases[mi][cardId] = (augmentedCCPurchases[mi][cardId] ?? 0) + plan.payment_amount;
              break;
            }
          }
        }
      }
    }

    // ── Apply Forecast growth-rate assumptions to future months ──────────────
    // Income raises apply as a step in the configured month each year.
    // Month 0 is left unchanged (uses actual remaining transaction amounts).
    let incMult = 1;
    // Pre-compute bonus month index for non-recurring bonus (first occurrence in window)
    const firstBonusIdx = (!bonusRecurring && bonusEnabled && (bonusAmount ?? 0) > 0)
      ? (() => {
          for (let k = 1; k < 36; k++) {
            const kd = new Date(now.getFullYear(), now.getMonth() + k, 1);
            if (kd.getMonth() + 1 === (bonusMonth ?? 12)) return k;
          }
          return -1;
        })()
      : -1;
    const growthAdjustedMonthEvents = (monthEvents ?? []).map((ev, m) => {
      if (m === 0) return ev;
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      if (incomeGrowthEnabled && (incomeGrowth ?? 0) > 0 && d.getMonth() + 1 === (raiseMonth ?? 3)) {
        if (raiseMode === 'flat') {
          const currentAnnual = monthlyTakeHome * 12 * incMult;
          if (currentAnnual > 0) incMult *= (1 + (incomeGrowth ?? 0) / currentAnnual);
        } else {
          incMult *= (1 + (incomeGrowth ?? 0) / 100);
        }
      }
      // Inject bonus + tax return into regular monthly income — same slot as Forecast PASS 1
      // so extra cash is available for debt allocation that month, not deferred post-allocation.
      let bonusTaxInc = 0;
      if (bonusEnabled && (bonusAmount ?? 0) > 0 && d.getMonth() + 1 === (bonusMonth ?? 12)) {
        if (bonusRecurring || m === firstBonusIdx) {
          bonusTaxInc += bonusMode === 'pct'
            ? monthlyTakeHome * 12 * incMult * ((bonusAmount ?? 0) / 100)
            : (bonusAmount ?? 0);
        }
      }
      if (taxReturnEnabled && (taxReturnAmountOverride ?? 0) > 0 && d.getMonth() + 1 === (taxReturnMonth ?? 2)) {
        bonusTaxInc += (taxReturnAmountOverride ?? 0);
      }
      return { income: ev.income * incMult + bonusTaxInc, expenses: ev.expenses };
    });

    // Per-month car loan payments from carFunds (mirrors Forecast's activeCarLoanByMonth).
    // Car loans live outside rules so they are absent from monthEvents; add them explicitly.
    const activeCarLoanByMonth = Array.from({ length: 36 }, (_, m) => {
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      return getTotalCarLoanMonthly(carFunds as any[], d);
    });

    // Savings goals + transfer rules + saving-phase car contributions — mirrors what
    // Forecast's cardProjectionData simulationMonthEvents adds on top of forecastMonthEvents.
    // These are absent from monthEvents because:
    //   goals → separate DB table, not in rules
    //   transfer/investment rules → type !== 'expense', filtered out of monthEvents
    //   saving-phase car → from carFunds, not rules
    const simRetireIds = new Set<string>(
      (accounts as any[]).filter((a: any) =>
        a.active && ['401k', 'roth_ira', 'ira', 'hsa'].includes(a.account_type)
      ).map((a: any) => a.id),
    );
    const simTransferRules = (rules as any[]).filter((r: any) =>
      r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment'),
    );

    const extraExpensesByMonth = Array.from({ length: 36 }, (_, m) => {
      if (m === 0) return 0; // month 0 handled by month0Expenses
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      const simMonthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);

      const activeTransferDests = new Set<string>();
      let monthTransfers = 0;
      for (const tr of simTransferRules) {
        if (tr.start_date && new Date(tr.start_date + 'T00:00:00') > simMonthEnd) continue;
        if (tr.end_date && new Date(tr.end_date + 'T00:00:00') < d) continue;
        if (tr.deposit_account) activeTransferDests.add(tr.deposit_account);
        const amt = Number(tr.amount);
        monthTransfers += amt * countRuleOccurrencesInMonth(tr, d.getFullYear(), d.getMonth(), now);
      }

      const monthSavings = pauseSavings ? 0 : (goals as any[]).reduce((s: number, g: any) => {
        if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > d) return s;
        if (g.linked_account && simRetireIds.has(g.linked_account)) return s;
        if (g.linked_account && activeTransferDests.has(g.linked_account)) return s;
        return s + Number(g.monthly_contribution);
      }, 0);

      const monthCarSaving = pauseSavings ? 0 : (carFunds as any[]).reduce((s: number, c: any) => {
        if (c.phase !== 'saving') return s;
        if (c.linked_account) return s; // balance is live in current_saved — no monthly checking deduction
        const rem = Math.max(0, Number(c.down_payment_goal) - Number(c.current_saved) - Number(c.gift_contribution || 0));
        if (rem <= 0) return s;
        let purchaseMonthIdx = 12;
        if (c.planned_purchase_date) {
          const parts = (c.planned_purchase_date as string).split('-').map(Number);
          const pd = new Date(parts[0], parts[1] - 1, parts[2]);
          purchaseMonthIdx = Math.max(1, (pd.getFullYear() - d.getFullYear()) * 12 + (pd.getMonth() - d.getMonth()));
        }
        return s + Math.min(rem / purchaseMonthIdx, rem);
      }, 0);

      return monthTransfers + monthSavings + monthCarSaving;
    });

    const carAdjustedMonthEvents = growthAdjustedMonthEvents.map((ev, m) => ({
      ...ev,
      expenses: ev.expenses + activeCarLoanByMonth[m] + extraExpensesByMonth[m],
    }));

    // ── Per-month safe floor (mirrors Forecast monthMinSafe) ─────────────────────
    // getMinSafeCash = max(cashFloor, prePaycheckNextMonthBills) for that specific month.
    // Month 0 is already handled by month0SafeFloor in the sim call.
    const cashFloorByMonth: number[] = Array.from({ length: 36 }, (_, m) => {
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      return getMinSafeCash(rules, payConfig, cashFloor, fundingAccountId ?? null, d);
    });

    // ── Look-ahead pre-pass (mirrors Forecast PASS 2) ─────────────────────────────
    // Identifies save-up months: months where debt payments are capped at CC minimums
    // so cash accumulates before future large one-time cash expenses (e.g. car purchase).
    const ccMinTotalPrepass = cards
      .filter(c => !c.autopayFullBalance && c.balance > 0)
      .reduce((s, c) => s + c.minPayment, 0);

    const maxDebtPaymentByMonth: number[] = Array(36).fill(Infinity);

    if (ccMinTotalPrepass > 0 && oneTimeByMonth.some((o, i) => i > 0 && o.expenses > 0)) {
      const saveUpMonths = new Set<number>();

      // Initialize: greedy estimate (all surplus above floor → debt)
      // Month 0 uses fundingBalance; months 1+ approximate PASS 3 (start at floor)
      const simDebtPay: number[] = [];
      for (let m = 0; m < 36; m++) {
        const mInc = m === 0 ? month0Income : (carAdjustedMonthEvents[m]?.income ?? monthlyTakeHome);
        const mExp = m === 0 ? month0Expenses : (carAdjustedMonthEvents[m]?.expenses ?? monthlyRecurringExpenses);
        const mFloor = cashFloorByMonth[m];
        const startBal = m === 0 ? fundingBalance : mFloor;
        const available = Math.max(0, startBal + mInc - mExp - mFloor);
        simDebtPay.push(Math.max(ccMinTotalPrepass, available));
      }

      const recomputeSimCash = (): number[] => {
        let bal = fundingBalance;
        const cash: number[] = [];
        for (let m = 0; m < 36; m++) {
          const mInc = m === 0 ? month0Income : (carAdjustedMonthEvents[m]?.income ?? monthlyTakeHome);
          const mExp = m === 0 ? month0Expenses : (carAdjustedMonthEvents[m]?.expenses ?? monthlyRecurringExpenses);
          const oneTime = m === 0 ? { income: 0, expenses: 0 } : (oneTimeByMonth[m] ?? { income: 0, expenses: 0 });
          const mFloor = cashFloorByMonth[m];
          const availForDebt = Math.max(0, bal + mInc - mExp - mFloor);
          const effectivePay = Math.min(simDebtPay[m], availForDebt + ccMinTotalPrepass);
          bal += mInc - mExp - effectivePay;
          if (!saveUpMonths.has(m) && bal > mFloor) bal = mFloor;
          bal += oneTime.income - oneTime.expenses;
          cash.push(bal);
        }
        return cash;
      };

      for (let pass = 0; pass < 20; pass++) {
        const simCash = recomputeSimCash();
        let anyFixed = false;
        for (let i = 0; i < 36; i++) {
          if (simCash[i] >= cashFloorByMonth[i]) continue;
          const shortfall = cashFloorByMonth[i] - simCash[i];
          let toRecover = shortfall;
          for (let j = i; j >= 0 && toRecover > 0; j--) {
            const canReduce = Math.max(0, Math.min(simDebtPay[j] - ccMinTotalPrepass, toRecover));
            if (canReduce > 0) {
              simDebtPay[j] -= canReduce;
              toRecover -= canReduce;
              if (j < i && (oneTimeByMonth[i]?.expenses ?? 0) > 0) saveUpMonths.add(j);
              anyFixed = true;
            }
          }
          if (anyFixed) break;
        }
        if (!anyFixed) break;
      }

      for (const m of saveUpMonths) {
        maxDebtPaymentByMonth[m] = ccMinTotalPrepass;
      }
    }

    const sim = simulateVariablePayoff(
      cards, fundingBalance, cashFloor, strategy,
      monthlyTakeHome, monthlyRecurringExpenses, 36,
      carAdjustedMonthEvents, undefined, augmentedCCPurchases,
      month0Income, month0Expenses,
      oneTimeByMonth,
      Math.max(cashFloor, prePaycheckBills.total), // month0SafeFloor — match recommendations
      maxDebtPaymentByMonth,
      cashFloorByMonth,
    );
    // Return augmentedCCPurchases alongside the sim so projections can use it
    // to pass per-month purchase amounts to projectCardVariable.
    return { ...sim, augmentedCCPurchases };
  }, [cards, fundingBalance, cashFloor, strategy, monthlyTakeHome,
      monthlyRecurringExpenses, allTransactions, accounts, ccPurchasesPerMonth, monthEvents,
      incomeGrowthEnabled, incomeGrowth, raiseMonth, raiseMode,
      bonusEnabled, bonusAmount, bonusMode, bonusMonth, bonusRecurring,
      taxReturnEnabled, taxReturnAmountOverride, taxReturnMonth,
      rules, payConfig, fundingAccountId, carFunds, goals, pauseSavings, syncCutoffDate, fundingAccountSources,
      paymentPlans]);

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
    const savingsTotal = (goals as any[]).reduce((s: number, g: any) => {
      if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > now) return s;
      if (g.linked_account && retireIds.has(g.linked_account)) return s;
      if (g.linked_account && activeTransferDests.has(g.linked_account)) return s;
      return s + Number(g.monthly_contribution);
    }, 0);
    const carTotal = (carFunds as any[]).reduce((s: number, c: any) => {
      if (c.phase === 'loan') return s;
      if (c.linked_account) return s; // savings are in the checking pool — no separate monthly reservation
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
      // over months-to-goal so safe-to-pay properly accounts for the upcoming cash event.
      // Always use rem (remaining after current_saved) to avoid overstating the monthly reserve.
      const reserve = Math.min(rem / monthsToGoal, rem);
      return s + reserve;
    }, 0);
    const carLoanTotal = getTotalCarLoanMonthly(carFunds as any[]);
    return savingsTotal + carTotal + carLoanTotal;
  }, [goals, carFunds, accounts, rules, pauseSavings]);

  // Exact Forecast month 0 floor formula: prePaycheckBills + carLoans + sim-based CC obligations.
  // Uses variableSim.monthlyRevolvingBalances[0] to distinguish revolving from paid/autopay cards,
  // matching forecastFloor0.monthMinSafe in Dashboard.tsx exactly.
  // Declared after monthlySavingsAndCar to avoid temporal dead zone on first render.
  const recommendedSafeMinimum = useMemo(() => {
    const now = new Date();
    const carLoanTotal = getTotalCarLoanMonthly(carFunds as any[], now);
    let ccFloor = 0;
    for (const card of cards) {
      const revBal = variableSim.monthlyRevolvingBalances?.get(card.id)?.[0] ?? 1;
      if (revBal > 0) {
        const minPay = variableSim.perCardMinPayments?.get(card.id)?.[0] ?? 0;
        if (minPay > 0) ccFloor += minPay;
      } else {
        if (card.paymentPreference !== 'statement' && card.paymentPreference !== 'full' && !card.autopayFullBalance) continue;
        if (!card.dueDay || card.minPayment <= 0) continue;
        ccFloor += card.minPayment;
      }
    }
    const base = Math.max(cashFloor, prePaycheckBills.total + ccFloor + carLoanTotal);
    // monthlySavingsAndCar includes carLoanTotal; add only the savings/car-reserve portion
    // that Safe to Pay already deducts so the displayed floor matches the actual holdback.
    const savingsReserve = Math.max(0, monthlySavingsAndCar - carLoanTotal);
    return base + savingsReserve;
  }, [cashFloor, prePaycheckBills.total, cards, carFunds, variableSim, monthlySavingsAndCar]);

  const month0Recs = useMemo(() => {
    const perCardAdj = month0?.perCardAdjusted ?? [];
    const totalAvailableCash = month0?.safeToPayTotal ?? 0;
    const strategyLabel = strategy === 'avalanche' ? 'Avalanche' : 'Snowball';
    const totalMinimumsdue = cards
      .filter(c => !c.autopayFullBalance && c.balance > 0)
      .reduce((s, c) => s + Math.min(c.minPayment, c.balance), 0);
    const cashWarning = Math.ceil(totalAvailableCash - totalMinimumsdue) < 0;
    const recs = perCardAdj.map(item => {
      const card = cards.find(c => c.id === item.id);
      let reason = '';
      let isMinimumOnly = false;
      if (card?.autopayFullBalance || (card && card.balance <= 0)) {
        // Cycling / zero-balance card — show preference-aware label
        if (card?.paymentPreference === 'statement') reason = 'Statement balance';
        else if (card?.paymentPreference === 'full') reason = 'Full balance';
        else reason = 'Autopay Full Balance';
      } else {
        const min = Math.min(card?.minPayment ?? 0, card?.balance ?? 0);
        isMinimumOnly = item.payment <= min + 0.01;
        reason = isMinimumOnly
          ? 'Minimum payment'
          : strategy === 'avalanche'
            ? 'Avalanche priority'
            : 'Snowball priority';
      }
      return {
        cardId: item.id,
        cardName: item.name,
        color: card?.color ?? '#888',
        payment: item.payment,
        maxPayment: item.maxPayment,
        dueDay: card?.dueDay ?? null,
        reason,
        isMinimumOnly,
      };
    });
    return { totalAvailableCash, totalMinimumsdue, cashWarning, strategyLabel, recs };
  }, [month0, cards, strategy]);

  const projections: CardProjection[] = useMemo(() => {
    // Month 0: use pass-3 constrained amount (matches "Recommended This Month" panel).
    // Months 1-35: use unscaled sim amounts so the payoff trajectory reflects what the
    // simulation actually pays — avoids the chart showing cards stuck near-zero when
    // pass-3 scaling reduces Discover's payments due to cycling-card cost reallocation.
    const baseProjs = cards.map(c => {
      const cardOverrides = overrides[c.id] || {};
      const cardPurchases = variableSim.augmentedCCPurchases.map(
        (monthData: { [cardId: string]: number }) => monthData[c.id] ?? 0,
      );
      if (paymentMode === 'variable') {
        const forecastPays = (perCardPaymentsScaled ?? perCardPayments)?.find(p => p.id === c.id)?.payments;
        const localPays = variableSim.monthlyPayments.get(c.id) ?? [];
        const basePays = forecastPays ?? localPays;
        const m0Pay = month0?.perCardAdjusted?.find(x => x.id === c.id)?.payment ?? basePays[0] ?? 0;
        const payments = basePays.map((p, i) => {
          if (cardOverrides[i] !== undefined) return cardOverrides[i];
          return i === 0 ? m0Pay : p;
        });
        const revBals = (monthlyRevolvingBalances ?? variableSim.monthlyRevolvingBalances)?.get(c.id) ?? [];
        return projectCardVariable(c, payments, 36, true, cardPurchases, revBals);
      }
      if (Object.keys(cardOverrides).length > 0) {
        const payments = Array.from({ length: 36 }, (_, i) => cardOverrides[i] !== undefined ? cardOverrides[i] : c.targetPayment);
        return projectCardVariable(c, payments, 36, false, cardPurchases);
      }
      return projectCard(c, 36);
    });

    return baseProjs;
  }, [cards, paymentMode, variableSim, overrides, perCardPayments, perCardPaymentsScaled, month0, monthlyRevolvingBalances]);

  const debtChartData = useMemo(() => {
    if (projections.length === 0) return [];
    const now = new Date();
    return Array.from({ length: 36 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const row: Record<string, number | string | null> = {
        month: d.toLocaleString('en', { month: 'short', year: 'numeric' }),
      };
      for (const p of projections) {
        if (p.card.startDate) {
          const startD = new Date(p.card.startDate + 'T00:00:00');
          const startMonth = new Date(startD.getFullYear(), startD.getMonth(), 1);
          if (d < startMonth) { row[p.card.name] = null; continue; } // null creates a gap, not a $0 line
        }
        const m = p.months[i];
        if (m) {
          row[p.card.name] = Math.round(m.endBalance);
        } else if (p.payoffMonth !== null && i >= p.payoffMonth) {
          row[p.card.name] = p.card.paymentPreference === 'full' || p.card.paymentPreference === 'statement'
            ? Math.round(p.card.monthlyNewPurchases)
            : 0;
        }
      }
      return row;
    });
  }, [projections]);

  const utilizationMilestones = useMemo(() => {
    const limit = cards.reduce((s, c) => s + (c.creditLimit ?? 0), 0);
    if (limit === 0) return [];
    return [25, 50, 75].map(threshold => {
      for (let i = 0; i < 36; i++) {
        const bal = projections.reduce((s, p) => s + (p.months[i]?.endBalance ?? 0), 0);
        if (bal <= limit * threshold / 100) return { threshold, month: i };
      }
      return { threshold, month: null };
    });
  }, [cards, projections]);

  const interestAvoided = useMemo(() => {
    const recommendedInterest = projections.reduce((s, p) => s + p.totalInterest, 0);
    const minInterest = cards.reduce((s, c) => {
      if (c.balance <= 0) return s;
      const minPays = Array.from({ length: 36 }, () => c.minPayment);
      return s + projectCardVariable(c, minPays, 36, false).totalInterest;
    }, 0);
    return Math.max(0, minInterest - recommendedInterest);
  }, [cards, projections]);

  const totalBalance = cards.reduce((s, c) => s + c.balance, 0);
  const totalLimit = cards.reduce((s, c) => s + c.creditLimit, 0);
  const overallUtil = totalLimit > 0 ? (totalBalance / totalLimit) * 100 : 0;

  const syncDebtAndAccount = (card: CardData, updates: { min_payment?: number; target_payment?: number }) => {
    const matchDebt = debts.find((d: any) => d.name.toLowerCase() === card.name.toLowerCase());
    if (matchDebt) {
      updateDebt.mutate({ id: matchDebt.id, ...updates });
    } else {
      addDebt.mutate({
        name: card.name, balance: card.balance, apr: card.apr,
        min_payment: updates.min_payment ?? card.minPayment,
        target_payment: updates.target_payment ?? card.targetPayment,
        credit_limit: card.creditLimit,
      });
    }
  };

  const handleSaveTarget = (card: CardData) => {
    const newTarget = parseFloat(targetInput);
    if (isNaN(newTarget) || newTarget < card.minPayment) {
      toast.error(`Target must be at least minimum payment (${formatCurrency(card.minPayment, false)})`);
      return;
    }
    syncDebtAndAccount(card, { target_payment: newTarget });
    setEditingTarget(null);
    toast.success(`Target payment for ${card.name} updated to ${formatCurrency(newTarget, false)}`);
  };

  const handleSaveStatementBal = (card: CardData) => {
    const val = statementBalInput.trim();
    if (val === '') {
      updateAccount.mutate({ id: card.id, statement_balance: null } as any);
      setEditingStatementBal(null);
      return;
    }
    const parsed = parseFloat(val);
    if (isNaN(parsed) || parsed < 0) {
      toast.error('Enter a valid balance amount');
      return;
    }
    updateAccount.mutate({ id: card.id, statement_balance: parsed } as any);
    setEditingStatementBal(null);
    toast.success(`Statement balance for ${card.name} set to ${formatCurrency(parsed, false)}`);
  };

  const handleOverrideMonth = (cardId: string, monthIdx: number) => {
    const val = parseFloat(monthPayInput);
    if (isNaN(val) || val < 0) {
      toast.error('Enter a valid payment amount');
      return;
    }
    setOverrides(prev => ({
      ...prev,
      [cardId]: { ...prev[cardId], [monthIdx]: val },
    }));
    setEditingMonth(null);
    toast.success('Payment override applied — future months recalculated');
  };

  const revertMonth = (cardId: string, monthIdx: number) => {
    setOverrides(prev => {
      const copy = { ...prev };
      if (copy[cardId]) {
        const { [monthIdx]: _, ...rest } = copy[cardId];
        copy[cardId] = rest;
        if (Object.keys(rest).length === 0) delete copy[cardId];
      }
      return copy;
    });
    toast.info('Reverted to recommended payment');
  };

  const revertAllForCard = (cardId: string) => {
    setOverrides(prev => {
      const copy = { ...prev };
      delete copy[cardId];
      return copy;
    });
    toast.info('All overrides reverted for this card');
  };

  // Reset & Recalculate: target ending cash ≈ recommended safe minimum
  const handleAutoAdjust = () => {
    const totalRecPay = (month0?.perCardAdjusted ?? []).reduce((s, r) => s + r.payment, 0);
    const currentEndingCash = liquidCash - totalRecPay;
    const surplus = currentEndingCash - recommendedSafeMinimum;
    
    if (surplus > 50) {
      toast.success(`Debt payments are safe. Ending cash ${formatCurrency(currentEndingCash, false)} is above minimum ${formatCurrency(recommendedSafeMinimum, false)}.`);
    } else if (surplus < -50) {
      const reduction = Math.abs(surplus);
      toast.warning(`Reduced debt payments by ${formatCurrency(reduction, false)} to meet safe minimum of ${formatCurrency(recommendedSafeMinimum, false)}.`);
    } else {
      toast.success(`Debt payments already aligned with safe minimum of ${formatCurrency(recommendedSafeMinimum, false)}.`);
    }
    
    setOverrides({});
  };

  if (cards.length === 0) {
    return (
      <div className="card-forged p-8 text-center">
        <CreditCard size={32} className="mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">No credit card accounts found. Add credit card accounts to use the payoff engine.</p>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4 sm:space-y-5">
        {/* Debt Payoff Trajectory Chart */}
        {debtChartData.length > 0 && (
          <div className="card-forged p-3 sm:p-5 min-w-0 overflow-x-hidden">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 sm:mb-4 flex items-center gap-2">
              <CreditCard size={12} /> Credit Card Debt Payoff Trajectory
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={debtChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid stroke="hsl(0, 0%, 18%)" strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(240, 4%, 50%)', textAnchor: 'end' }} angle={-45} height={50} interval={5} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(240, 4%, 50%)' }} tickFormatter={formatYAxisTick} />
                <RechartsTooltip formatter={(v: number, name: string) => [`$${Number(v).toLocaleString()}`, name]} labelStyle={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }} itemStyle={{ fontSize: 13 }} contentStyle={{ background: 'hsl(240, 6%, 10%)', border: '1px solid hsl(240, 4%, 20%)', borderRadius: '4px', fontSize: 13, padding: '8px 12px' }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {projections.map(p => (
                  <Line key={p.card.name} type="monotone" dataKey={p.card.name} stroke={p.card.color} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Reset & Recalculate Button */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <button
            onClick={handleAutoAdjust}
            className="flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 text-[10px] sm:text-xs font-medium btn-press hover:bg-primary/20" style={{ borderRadius: 'var(--radius)' }}
          >
            <ShieldCheck size={12} /> Reset & Recalculate
          </button>
          <span className="text-[9px] sm:text-[10px] text-muted-foreground">Targets ending cash ≈ safe minimum ({formatCurrency(recommendedSafeMinimum, false)})</span>
        </div>

        {/* Summary Stats */}
        <div className="card-forged p-4 sm:p-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 text-center">
            <div>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total CC Balance</p>
              <p className="text-lg sm:text-xl font-display font-bold mt-0.5 text-destructive">{formatCurrency(totalBalance, false)}</p>
            </div>
            <div>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total Limit</p>
              <p className="text-lg sm:text-xl font-display font-bold mt-0.5 text-foreground">{formatCurrency(totalLimit, false)}</p>
            </div>
            <div>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Utilization</p>
              <p className={`text-lg sm:text-xl font-display font-bold mt-0.5 ${overallUtil > 30 ? 'text-destructive' : overallUtil > 10 ? 'text-primary' : 'text-success'}`}>{overallUtil.toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Monthly Interest</p>
              <p className="text-lg sm:text-xl font-display font-bold mt-0.5 text-destructive">{formatCurrency(projections.reduce((s, p) => s + p.projectedInterestThisMonth, 0), true)}</p>
            </div>
            <div className="col-span-2 sm:col-span-1 sm:col-start-2 lg:col-start-auto">
              <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Payoff ETA</p>
              {(() => {
                const eta = Math.max(0, ...projections.map(p => p.payoffMonth ?? 0));
                const color = eta <= 1 ? 'text-success' : 'text-primary';
                return <p className={`text-lg sm:text-xl font-display font-bold mt-0.5 ${color}`}>{eta > 0 ? `${eta} mo` : 'Paid'}</p>;
              })()}
            </div>
          </div>
        </div>

        {/* Strategy + Controls */}
        <div className="card-forged p-3 sm:p-4 space-y-3 sm:space-y-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="text-[10px] sm:text-[11px] text-muted-foreground uppercase font-medium tracking-wider">Strategy:</span>
            {([
              { key: 'avalanche', label: 'Avalanche', icon: TrendingDown },
              { key: 'snowball', label: 'Snowball', icon: ChevronDown },
            ] as const).map(s => (
              <Tooltip key={s.key}>
                <TooltipTrigger asChild>
                  <button onClick={() => setStrategy(s.key)}
                    className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium border btn-press ${strategy === s.key ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
                    style={{ borderRadius: 'var(--radius)' }}>
                    <s.icon size={12} /> {s.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[260px] text-xs">{STRATEGY_TIPS[s.key]}</TooltipContent>
              </Tooltip>
            ))}
            <span className="text-[9px] px-2 py-1 bg-success/10 text-success border border-success/20" style={{ borderRadius: 'var(--radius)' }}>
              Cash floor always enforced
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] sm:text-[11px] text-muted-foreground uppercase font-medium tracking-wider">Payment Mode:</span>
              {([
                { key: 'variable', label: 'Variable', icon: Zap },
                { key: 'consistent', label: 'Consistent', icon: Target },
              ] as const).map(m => (
                <Tooltip key={m.key}>
                  <TooltipTrigger asChild>
                    <button onClick={() => setPaymentMode(m.key)}
                      className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium border btn-press ${paymentMode === m.key ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
                      style={{ borderRadius: 'var(--radius)' }}>
                      <m.icon size={12} /> {m.label}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[260px] text-xs">{PAYMENT_MODE_TIPS[m.key]}</TooltipContent>
                </Tooltip>
              ))}
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-[10px] text-muted-foreground uppercase">Cash Floor</label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span><Info size={11} className="text-muted-foreground cursor-help" /></span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                    Never recommend payments that push liquid cash below this amount. Also reserves for early next-month bills.
                  </TooltipContent>
                </Tooltip>
                <input type="number" value={cashFloor} onChange={e => setCashFloor(Number(e.target.value) || 0)}
                  className="w-20 sm:w-24 bg-secondary border border-border px-2 py-1 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step="100" min="0" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1 px-2 py-1 bg-primary/10 border border-primary/20 text-[10px] font-medium text-primary cursor-help" style={{ borderRadius: 'var(--radius)' }}>
                      <ShieldCheck size={10} /> Safe Min: {formatCurrency(recommendedSafeMinimum, false)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] text-xs">
                    <p className="font-semibold mb-1">Safe Minimum = max(cash floor, pre-paycheck bills)</p>
                    {prePaycheckBills.items.length > 0 ? (
                      <>
                        <p className="mb-1">Bills due before first paycheck next month:</p>
                        {prePaycheckBills.items.map((item, i) => (
                          <div key={i} className="flex justify-between gap-2">
                            <span>{item.name} (day {item.dueDay})</span>
                            <span className="font-bold">{formatCurrency(item.amount, false)}</span>
                          </div>
                        ))}
                      </>
                    ) : <p>No bills found before next paycheck</p>}
                  </TooltipContent>
                </Tooltip>
              </div>
              {prePaycheckBills.total > cashFloor && (
                <p className="text-[9px] text-primary flex items-center gap-1">
                  <Info size={9} className="shrink-0" />
                  Floor raised to {formatCurrency(recommendedSafeMinimum, false)} — pre-paycheck bills exceed your {formatCurrency(cashFloor, false)} floor.
                </p>
              )}
            </div>
          </div>

          {/* Funding Account Selector */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 pt-2 border-t border-border/50">
            <Wallet size={13} className="text-primary shrink-0" />
            <span className="text-[10px] sm:text-[11px] text-muted-foreground uppercase font-medium tracking-wider shrink-0">Funding Account:</span>
            <select
              value={fundingAccountId}
              onChange={e => setFundingAccountId(e.target.value)}
              className="flex-1 min-w-0 bg-secondary border border-border px-2 sm:px-3 py-1.5 text-[10px] sm:text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }}
            >
              {liquidAccounts.map((a: any) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {fundingAccount && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                Balance: <span className="font-display font-bold text-foreground">{formatCurrency(fundingBalance, false)}</span>
              </span>
            )}
          </div>
        </div>

        {/* Recommendation Panel */}
        <div className="card-forged p-3 sm:p-5">
          <div className="flex items-center gap-2 mb-3 sm:mb-4 flex-wrap">
            <h3 className="text-[10px] sm:text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Recommended This Month</h3>
            <span className="text-[9px] sm:text-[10px] px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 font-medium" style={{ borderRadius: 'var(--radius)' }}>
              {month0Recs.strategyLabel}
            </span>
            <span className="text-[9px] sm:text-[10px] px-2 py-0.5 bg-muted/30 text-muted-foreground border border-border font-medium" style={{ borderRadius: 'var(--radius)' }}>
              {paymentMode === 'variable' ? 'Variable' : 'Consistent'}
            </span>
          </div>

          {month0Recs.cashWarning && (
            <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 px-3 py-2 mb-3 sm:mb-4 text-[10px] sm:text-xs text-destructive" style={{ borderRadius: 'var(--radius)' }}>
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>Safe to Pay ({formatCurrency(month0Recs.totalAvailableCash, false)}) is less than minimum payments due ({formatCurrency(month0Recs.totalMinimumsdue, false)}). Not all minimums can be covered. Review cash flow urgently.</span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-3 sm:mb-4">
            <Tooltip open={liquidCashOpen} onOpenChange={setLiquidCashOpen}>
              <TooltipTrigger asChild>
                <div className="relative p-2 sm:p-3 bg-muted/30 border border-border text-center cursor-pointer active:bg-muted/50 transition-colors" style={{ borderRadius: 'var(--radius)' }} onClick={() => setLiquidCashOpen(v => !v)}>
                  <p className="text-[9px] sm:text-[10px] text-muted-foreground uppercase">Est. Liquid Cash</p>
                  <p className="text-xs sm:text-sm font-display font-bold text-foreground">{formatCurrency(estLiquidCash, false)}</p>
                  <Info size={9} className="absolute bottom-1.5 right-1.5 text-muted-foreground/60" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[360px] text-xs">
                {(() => {
                  const now = new Date();
                  const today = now.getDate();
                  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                  const fmtDate = (d: string) => {
                    const [,m,day] = d.split('-');
                    return `${MONTHS[parseInt(m)-1]} ${parseInt(day)}`;
                  };
                  const windowLabel = 'remaining this month';
                  const hasProjected = cashBreakdownItems.incomeItems.some(i => i.isGenerated) || cashBreakdownItems.expenseItems.some(i => i.isGenerated);
                  const hasTodayItems = [...cashBreakdownItems.incomeItems, ...cashBreakdownItems.expenseItems].some(i => i.date.split('-')[2] === String(today).padStart(2,'0'));
                  return (
                    <>
                      <p className="font-semibold mb-2">Est. Liquid Cash ({windowLabel})</p>
                      <div className="flex justify-between gap-3 mb-2">
                        <span className="text-muted-foreground">{fundingAccount?.name ?? 'Funding'} balance now</span>
                        <span className="font-bold">{formatCurrency(fundingBalance, false)}</span>
                      </div>
                      {cashBreakdownItems.incomeItems.length > 0 && (
                        <div className="mb-2">
                          <p className="text-[10px] text-success uppercase tracking-wider mb-1">+ Upcoming income</p>
                          {cashBreakdownItems.incomeItems.map((item: TransactionLineItem, i: number) => (
                            <div key={i} className="flex justify-between gap-3">
                              <span className="text-muted-foreground truncate max-w-[200px]">{fmtDate(item.date)} · {item.note}{item.isGenerated ? ' *' : ''}</span>
                              <span className="text-success shrink-0">+{formatCurrency(item.amount, false)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {cashBreakdownItems.incomeItems.length === 0 && (
                        <p className="text-muted-foreground mb-2 italic">No income scheduled in window</p>
                      )}
                      {cashBreakdown.transactionExpenses > 0 && (
                        <div className="mb-2">
                          <p className="text-[10px] text-destructive/80 uppercase tracking-wider mb-1">− Upcoming expenses</p>
                          {cashBreakdownItems.expenseItems.slice(0, 6).map((item: TransactionLineItem, i: number) => (
                            <div key={i} className="flex justify-between gap-3">
                              <span className="text-muted-foreground truncate max-w-[200px]">{fmtDate(item.date)} · {item.note}{item.isGenerated ? ' *' : ''}</span>
                              <span className="text-destructive/80 shrink-0">−{formatCurrency(item.amount, false)}</span>
                            </div>
                          ))}
                          {cashBreakdownItems.expenseItems.length > 6 && (
                            <p className="text-muted-foreground text-[10px]">+{cashBreakdownItems.expenseItems.length - 6} more expense items</p>
                          )}
                        </div>
                      )}
                      <hr className="my-1 border-border/50" />
                      <div className="flex justify-between gap-3 font-bold mb-2">
                        <span>= Est. Liquid Cash (net)</span>
                        <span>{formatCurrency(estLiquidCash, false)}</span>
                      </div>
                      {(() => {
                        const activeCards = cards.filter(c => !c.autopayFullBalance && c.balance > 0);
                        const uniqueDueDays = new Set(activeCards.map(c => c.dueDay || 31));
                        if (activeCards.length > 1 && uniqueDueDays.size > 1) {
                          return (
                            <div className="mb-2 space-y-0.5">
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Cash available by each card's due date</p>
                              {activeCards.map(c => (
                                <div key={c.id} className="flex justify-between gap-2">
                                  <span className="text-muted-foreground">{c.name} (due {c.dueDay || 31}th)</span>
                                  <span className="font-bold">{formatCurrency(cardEstimatedCash[c.id] || 0, false)}</span>
                                </div>
                              ))}
                            </div>
                          );
                        }
                        return null;
                      })()}
                      {hasProjected && <p className="text-muted-foreground text-[10px]">* Projected from your recurring rules — not yet a real transaction.</p>}
                      {hasTodayItems && <p className="text-muted-foreground text-[10px] mt-0.5">Items dated today may already be reflected in your balance.</p>}
                    </>
                  );
                })()}
              </TooltipContent>
            </Tooltip>
            <div className="p-2 sm:p-3 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground">Safe Minimum</p>
              <p className="text-xs sm:text-sm font-display font-bold text-foreground">{formatCurrency(recommendedSafeMinimum, false)}</p>
            </div>
            <Tooltip open={safeToPayOpen} onOpenChange={setSafeToPayOpen}>
              <TooltipTrigger asChild>
                <div className="relative p-2 sm:p-3 bg-muted/30 border border-border text-center cursor-pointer active:bg-muted/50 transition-colors" style={{ borderRadius: 'var(--radius)' }} onClick={() => setSafeToPayOpen(v => !v)}>
                  <p className="text-[9px] sm:text-[10px] text-muted-foreground">Safe to Pay</p>
                  <p className="text-xs sm:text-sm font-display font-bold text-primary">{formatCurrency(month0Recs.totalAvailableCash, false)}</p>
                  <Info size={9} className="absolute bottom-1.5 right-1.5 text-muted-foreground/60" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[340px] text-xs">
                <p className="font-semibold mb-1">Safe to Pay — how it's calculated:</p>
                <div className="space-y-0.5">
                  {(month0?.cyclingPayment ?? 0) > 0 && (
                    <div className="flex justify-between gap-3"><span>Cycling cards (statement/full)</span><span>{formatCurrency(month0!.cyclingPayment, false)}</span></div>
                  )}
                  {(month0?.revolvingPayment ?? 0) > 0 && (
                    <div className="flex justify-between gap-3"><span>Revolving debt payments</span><span>{formatCurrency(month0!.revolvingPayment, false)}</span></div>
                  )}
                  <hr className="my-1 border-border/50" />
                  <div className="flex justify-between gap-3 font-bold"><span>= Safe to Pay</span><span className="text-primary">{formatCurrency(month0Recs.totalAvailableCash, false)}</span></div>
                  {month0 != null && month0.holdback > 0 && month0.holdbackEvent && (
                    <div className="flex justify-between gap-3 text-amber-400 text-[10px] mt-1">
                      <span>Holdback: {formatCurrency(month0.holdback, false)} reserved for {month0.holdbackEvent.eventName} ({month0.holdbackEvent.monthLabel})</span>
                    </div>
                  )}
                </div>
                <p className="text-muted-foreground mt-2">Computed by the Forecast engine using your paycheck schedule, floor ({formatCurrency(month0?.m0SafeFloor ?? recommendedSafeMinimum, false)}), savings goals, and upcoming bills. Save-up months reserve additional cash, reducing the amount available for debt.</p>
              </TooltipContent>
            </Tooltip>
            <div className="p-2 sm:p-3 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground">Minimums Due</p>
              <p className="text-xs sm:text-sm font-display font-bold text-destructive">{formatCurrency(month0Recs.totalMinimumsdue, false)}</p>
            </div>
          </div>

          {month0 != null && month0.holdback > 0 && month0.holdbackEvent && (
            <div className="flex items-start gap-2 bg-amber-400/10 border border-amber-400/30 px-3 py-2 mb-3 sm:mb-4 text-[10px] sm:text-xs text-amber-400" style={{ borderRadius: 'var(--radius)' }}>
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>Forecast is reserving <strong>{formatCurrency(month0.holdback, false)}</strong> for <strong>{month0.holdbackEvent.eventName}</strong> ({month0.holdbackEvent.monthLabel}). Paying the full amounts below may reduce that reserve — see the per-card caps.</span>
            </div>
          )}

          <div className="space-y-2">
            {month0Recs.recs.map(r => {
              const hasHoldbackCap = (month0?.holdback ?? 0) > 0 && r.maxPayment > r.payment + 0.01;
              return (
                <div key={r.cardId} className="flex items-center justify-between py-2 px-2 sm:px-3 border border-border bg-muted/10 flex-wrap gap-1" style={{ borderRadius: 'var(--radius)' }}>
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
                    <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: r.color }} />
                    <span className="text-[10px] sm:text-xs font-medium">{r.cardName}</span>
                    {r.reason === 'Autopay Full Balance' ? (
                      <span className="text-[9px] sm:text-[10px] text-success bg-success/10 px-1.5 py-0.5 flex items-center gap-1" style={{ borderRadius: 'var(--radius)' }}>
                        <CheckCircle2 size={9} /> autopay
                      </span>
                    ) : r.isMinimumOnly ? (
                      <span className="text-[9px] sm:text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>min</span>
                    ) : (
                      <span className="text-[9px] sm:text-[10px] text-primary bg-primary/10 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>priority</span>
                    )}
                    <span className="text-[9px] sm:text-[10px] text-muted-foreground italic truncate">{r.reason}</span>
                    {r.dueDay && (
                      <span className="text-[9px] text-muted-foreground flex items-center gap-0.5"><CalendarDays size={8} /> Due {r.dueDay}th</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {hasHoldbackCap && month0?.holdbackEvent && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-[9px] sm:text-[10px] text-amber-400 bg-amber-400/10 border border-amber-400/30 px-1.5 py-0.5 cursor-pointer" style={{ borderRadius: 'var(--radius)' }}>
                            max {formatCurrency(r.maxPayment, false)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[260px] text-xs">
                          Forecast reserved {formatCurrency(month0.holdback, false)} for {month0.holdbackEvent.eventName} ({month0.holdbackEvent.monthLabel}), capping this from {formatCurrency(r.maxPayment, false)} to {formatCurrency(r.payment, false)}.
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <span className="text-xs sm:text-sm font-display font-bold text-primary">{formatCurrency(r.payment, false)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {utilizationMilestones.length > 0 && (
            <div className="mt-3 sm:mt-4 flex flex-wrap gap-2 sm:gap-3">
              {utilizationMilestones.map(m => (
                <span key={m.threshold} className="text-[9px] sm:text-[10px] px-2 py-1 bg-muted/30 border border-border text-muted-foreground" style={{ borderRadius: 'var(--radius)' }}>
                  Below {m.threshold}% util: {m.month !== null ? `~${m.month} months` : 'N/A'}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Individual Card Projections */}
        <div className="space-y-3">
          {projections.map(proj => {
            const isExpanded = expandedCards.includes(proj.card.id);
            const cardOverrides = overrides[proj.card.id] || {};
            const hasOverrides = Object.keys(cardOverrides).length > 0;

            return (
              <div key={proj.card.id} className="card-forged w-full max-w-full min-w-0">
                <button onClick={() => setExpandedCards(isExpanded ? expandedCards.filter(id => id !== proj.card.id) : [...expandedCards, proj.card.id])}
                  className="w-full p-3 sm:p-4 flex flex-row items-start justify-between text-left hover:bg-muted/10 transition-colors">
                  <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
                    <span className="w-3 sm:w-4 h-3 sm:h-4 rounded-sm shrink-0 mt-0.5" style={{ backgroundColor: proj.card.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        <h4 className="text-xs sm:text-sm font-semibold">{proj.card.name}</h4>
                        {proj.card.paymentPreference !== null && (
                          <span className="text-[8px] sm:text-[9px] px-1.5 py-0.5 bg-success/15 text-success border border-success/30 font-medium flex items-center gap-1" style={{ borderRadius: 'var(--radius)' }}>
                            <CheckCircle2 size={9} /> {proj.card.paymentPreference === 'full' ? 'Full Balance' : 'Statement Bal.'}
                          </span>
                        )}
                        {hasOverrides && (
                          <span className="text-[8px] sm:text-[9px] px-1.5 py-0.5 bg-primary/15 text-primary border border-primary/30 font-medium" style={{ borderRadius: 'var(--radius)' }}>
                            overrides
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] sm:text-xs text-muted-foreground">
                        {proj.card.apr}% APR · Limit {formatCurrency(proj.card.creditLimit, false)} · Utilization {proj.utilizationNow.toFixed(1)}%
                        {proj.card.dueDay && <span> · <CalendarDays size={10} className="inline" /> Due {proj.card.dueDay}{proj.card.dueDay === 1 ? 'st' : proj.card.dueDay === 2 ? 'nd' : proj.card.dueDay === 3 ? 'rd' : 'th'}</span>}
                      </p>
                      <p className={`text-sm sm:text-base font-display font-bold mt-0.5 ${proj.card.balance <= 0 ? 'text-success' : 'text-destructive'}`}>
                        {formatCurrency(Math.max(0, proj.card.balance), false)}
                      </p>
                      <p className="text-[11px] sm:text-xs text-muted-foreground">
                        {proj.card.balance <= 0
                          ? 'Debt free'
                          : (() => {
                              if (!proj.payoffMonth) return proj.card.paymentPreference === 'statement' ? 'Interest-free: N/A' : 'Payoff: N/A';
                              const d = new Date();
                              d.setMonth(d.getMonth() + proj.payoffMonth - 1);
                              const label = d.toLocaleString('en', { month: 'short', year: 'numeric' });
                              return proj.card.paymentPreference === 'statement'
                                ? `Interest-free: ${proj.payoffMonth} mo (${label})`
                                : `Payoff: ${proj.payoffMonth} months (${label})`;
                            })()
                        }
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 ml-2 flex items-center justify-center w-7 h-7 bg-secondary/60" style={{ borderRadius: 'var(--radius)' }}>
                    {isExpanded ? <ChevronUp size={13} className="text-muted-foreground" /> : <ChevronDown size={13} className="text-muted-foreground" />}
                  </div>
                </button>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 px-3 sm:px-4 pb-3 text-center">
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase">Min Payment</p>
                    <p className="text-xs font-semibold">{formatCurrency(proj.card.minPayment, false)}</p>
                    <p className="text-[8px] text-muted-foreground">Edit on Accounts</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase">Due Date</p>
                    <p className="text-xs font-semibold">{proj.card.dueDay ? `${proj.card.dueDay}${proj.card.dueDay === 1 ? 'st' : proj.card.dueDay === 2 ? 'nd' : proj.card.dueDay === 3 ? 'rd' : 'th'}` : '—'}</p>
                    <p className="text-[8px] text-muted-foreground">Edit on Accounts</p>
                  </div>
                  <div><p className="text-[9px] text-muted-foreground uppercase">Purchases/Mo</p><p className="text-xs font-semibold text-destructive">{formatCurrency(proj.card.monthlyNewPurchases, false)}</p></div>
                  <div><p className="text-[9px] text-muted-foreground uppercase">Interest/Mo</p><p className="text-xs font-semibold text-destructive">{formatCurrency(proj.projectedInterestThisMonth, true)}</p></div>
                  <div><p className="text-[9px] text-muted-foreground uppercase">Total Interest</p><p className="text-xs font-semibold text-destructive">{formatCurrency(proj.totalInterest, false)}</p></div>
                </div>

                {/* Payment preference selector */}
                <div className="px-3 sm:px-4 pb-2">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1.5">Payment type</p>
                  <div className="flex gap-2">
                    {([
                      ['Min Balance', null, 'Pay minimum required each month — strategy routes surplus to priority cards'],
                      ['Statement Bal.', 'statement', 'Pay carried balance + interest only — new purchases carry to next cycle'],
                      ['Full Balance', 'full', 'Pay entire balance + new purchases each month, as cash allows'],
                    ] as [string, 'statement' | 'full' | null, string][]).map(([label, key, desc]) => {
                      const active = proj.card.paymentPreference === key;
                      return (
                        <button
                          key={label}
                          onClick={() => { if (!active) updateAccount.mutate({ id: proj.card.id, payment_preference: key } as any); }}
                          className={`flex-1 py-1.5 text-[10px] font-medium border transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-muted-foreground border-border hover:text-foreground'}`}
                          style={{ borderRadius: 'var(--radius)' }}
                          aria-pressed={active}
                          title={desc}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[9px] text-muted-foreground mt-1">
                    {proj.card.paymentPreference === null && 'Strategy routes surplus to this card when it is the priority target'}
                    {proj.card.paymentPreference === 'statement' && 'Pay carried balance + interest — new purchases carry to next cycle'}
                    {proj.card.paymentPreference === 'full' && 'Pay entire balance + new purchases — as cash allows above floor'}
                  </p>
                </div>

                {/* Statement balance phase — only relevant for statement-preference cards with a balance */}
                {proj.card.paymentPreference === 'statement' && proj.card.balance > 0 && (
                  <div className="px-3 sm:px-4 pb-3 border-t border-border/50 pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Statement balance phase</p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">Already paying statement balance — simulation skips interest on current balance</p>
                      </div>
                      <button
                        onClick={() => {
                          const next = !proj.card.statementBalancePhase;
                          updateAccount.mutate({ id: proj.card.id, statement_balance_phase: next } as any);
                          if (!next) updateAccount.mutate({ id: proj.card.id, statement_balance: null } as any);
                        }}
                        className={`shrink-0 px-2.5 py-1 text-[10px] font-semibold border transition-colors ${proj.card.statementBalancePhase ? 'bg-success/20 text-success border-success/40' : 'bg-secondary text-muted-foreground border-border hover:text-foreground'}`}
                        style={{ borderRadius: 'var(--radius)' }}
                      >
                        {proj.card.statementBalancePhase ? 'On' : 'Off'}
                      </button>
                    </div>
                    {proj.card.statementBalancePhase && (
                      <div className="mt-2 flex items-center gap-2">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider shrink-0">Statement balance</p>
                        {editingStatementBal === proj.card.id ? (
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <span className="text-[10px] text-muted-foreground">$</span>
                            <input
                              type="number"
                              value={statementBalInput}
                              onChange={e => setStatementBalInput(e.target.value)}
                              className="w-20 bg-secondary border border-primary px-1.5 py-0.5 text-xs text-foreground font-semibold"
                              style={{ borderRadius: 'var(--radius)' }}
                              autoFocus
                              min={0}
                              step="1"
                              placeholder={String(Math.round(proj.card.balance))}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveStatementBal(proj.card);
                                if (e.key === 'Escape') setEditingStatementBal(null);
                              }}
                            />
                            <button onClick={() => handleSaveStatementBal(proj.card)} className="text-primary"><Check size={11} /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-semibold">
                              {proj.card.statementBalance != null
                                ? formatCurrency(proj.card.statementBalance, false)
                                : formatCurrency(proj.card.balance, false)}
                            </span>
                            <button
                              onClick={() => {
                                setEditingStatementBal(proj.card.id);
                                setStatementBalInput(String(Math.round(proj.card.statementBalance ?? proj.card.balance)));
                              }}
                              className="text-muted-foreground hover:text-primary"
                            >
                              <Edit2 size={10} />
                            </button>
                            {proj.card.statementBalance != null && (
                              <button
                                onClick={() => updateAccount.mutate({ id: proj.card.id, statement_balance: null } as any)}
                                className="text-[9px] text-muted-foreground hover:text-destructive"
                                title="Clear override"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="px-3 sm:px-4 pb-3">
                  <div className="w-full h-2 bg-muted/50 overflow-hidden" style={{ borderRadius: 'var(--radius)' }}>
                    <div className={`h-full transition-all ${proj.utilizationNow > 30 ? 'bg-destructive' : proj.utilizationNow > 10 ? 'bg-primary' : 'bg-success'}`}
                      style={{ width: `${Math.min(100, proj.utilizationNow)}%` }} />
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border">
                  <div className="px-3 sm:px-4 py-3">
                    {proj.card.balance <= 0 && (
                      <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-success/10 border border-success/20 text-[10px] sm:text-xs text-success" style={{ borderRadius: 'var(--radius)' }}>
                        <CheckCircle2 size={14} className="shrink-0" />
                        <span>Debt-free. Monthly purchases ({formatCurrency(proj.card.monthlyNewPurchases, false)}) paid as {proj.card.paymentPreference === 'full' ? 'full balance' : proj.card.paymentPreference === 'statement' ? 'statement balance' : 'minimum'} — as cash allows.</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                      <h5 className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                        Monthly Projection ({paymentMode === 'variable'
                          ? (perCardPaymentsScaled ? 'Forecast Sim' : 'Variable')
                          : 'Consistent'})
                      </h5>
                      {(isPremium || isDemo) && hasOverrides && (
                        <button onClick={() => revertAllForCard(proj.card.id)} className="flex items-center gap-1 text-[10px] text-primary hover:underline">
                          <RotateCcw size={10} /> Revert All
                        </button>
                      )}
                    </div>
                    <div className="w-full">
                      {/* Column headers */}
                      <div className="grid grid-cols-3 gap-x-3 border-b border-border pb-1.5 mb-0.5 text-[9px] text-muted-foreground uppercase tracking-wider font-medium">
                        <div className="px-2">Month</div>
                        <div className="px-2 text-right">Payment</div>
                        <div className="px-2 text-right">End Balance</div>
                      </div>
                      {/* Rows — free users see 3 months, premium sees 24 */}
                      {proj.months.slice(0, (isPremium || isDemo) ? 24 : 3).map((row, idx) => {
                        const isOverridden = cardOverrides[idx] !== undefined;
                        const isEditingThis = editingMonth?.cardId === proj.card.id && editingMonth?.month === idx;
                        return (
                          <div key={row.month} className={`border-b border-border/30 hover:bg-muted/10 ${isOverridden ? 'bg-primary/5' : ''}`}>
                            {/* Main row: Month | Payment | End Balance */}
                            <div className="grid grid-cols-3 gap-x-3 py-1.5">
                              <div className="px-2 text-[10px] sm:text-[11px] font-medium">{row.label}</div>
                              <div className="px-2 text-right text-[10px] sm:text-[11px]">
                                {isEditingThis ? (
                                  <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                                    <input type="number" value={monthPayInput} onChange={e => setMonthPayInput(e.target.value)}
                                      className="w-16 bg-secondary border border-primary px-1 py-0.5 text-xs text-foreground font-semibold text-center"
                                      style={{ borderRadius: 'var(--radius)' }} autoFocus min={0} step="10"
                                      onKeyDown={e => { if (e.key === 'Enter') handleOverrideMonth(proj.card.id, idx); if (e.key === 'Escape') setEditingMonth(null); }} />
                                    <button onClick={() => handleOverrideMonth(proj.card.id, idx)} className="text-primary"><Check size={10} /></button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-end gap-1">
                                    <span className="font-semibold text-primary">
                                      {row.payment > 0 ? `-${formatCurrency(row.payment, false)}` : '—'}
                                    </span>
                                    {isOverridden && <span className="text-[8px] text-primary bg-primary/10 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }}>edited</span>}
                                    {(isPremium || isDemo) && !proj.card.autopayFullBalance && row.startBalance > 0 && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setEditingMonth({ cardId: proj.card.id, month: idx }); setMonthPayInput(String(Math.round(row.payment))); }}
                                        className="text-muted-foreground hover:text-primary">
                                        <Edit2 size={9} />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="px-2 text-right font-semibold text-[10px] sm:text-[11px]">
                                {formatCurrency(Math.max(0, row.endBalance), false)}
                              </div>
                            </div>
                            {/* Detail row: constrained to first column so it never bleeds into Payment/End Bal */}
                            <div className="grid grid-cols-3 gap-x-3 pb-1.5">
                              <div className="px-2 flex flex-col gap-0.5 text-[10px] sm:text-[11px] text-muted-foreground">
                                <span>Start: {formatCurrency(row.startBalance, false)}</span>
                                {row.newPurchases > 0 && <span className="text-destructive">+{formatCurrency(row.newPurchases, false)} purchases</span>}
                                {row.interest > 0 && <span className="text-destructive">+{formatCurrency(row.interest, true)} interest</span>}
                                <span className={row.utilization > 30 ? 'text-destructive' : row.utilization > 10 ? 'text-primary' : 'text-success'}>
                                  {row.utilization.toFixed(1)}% utilization
                                </span>
                              </div>
                              <div />
                              <div className="px-2 flex items-start justify-end">
                                {isOverridden && (
                                  <button onClick={() => revertMonth(proj.card.id, idx)} className="text-muted-foreground hover:text-primary" title="Revert">
                                    <RotateCcw size={9} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {/* Gate remaining months for free users */}
                      {!(isPremium || isDemo) && proj.months.length > 3 && (
                        <PremiumGate
                          isPremium={false}
                          title="See the full payoff timeline"
                          features={[
                            `${proj.months.length - 3} more month${proj.months.length - 3 === 1 ? '' : 's'} remaining for ${proj.card.name}`,
                            `Save ${formatCurrency(proj.totalInterest, false)} in total interest`,
                            'Override any month\'s payment and watch balances update live',
                          ]}
                        >
                          <div>
                            {proj.months.slice(3, 24).map(row => (
                              <div key={row.month} className="grid grid-cols-3 gap-x-3 py-1.5 border-b border-border/30">
                                <div className="px-2 text-[10px] font-medium">{row.label}</div>
                                <div className="px-2 text-right text-[10px] font-semibold text-primary">{row.payment > 0 ? `-${formatCurrency(row.payment, false)}` : '—'}</div>
                                <div className="px-2 text-right text-[10px] font-semibold">{formatCurrency(Math.max(0, row.endBalance), false)}</div>
                              </div>
                            ))}
                          </div>
                        </PremiumGate>
                      )}
                    </div>
                  </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
