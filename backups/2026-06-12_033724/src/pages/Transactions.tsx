import { useState, useMemo, useCallback } from 'react';
import { PageSkeleton } from '@/components/shared/PageSkeleton';
import InstructionsModal from '@/components/shared/InstructionsModal';
import { formatCurrency } from '@/lib/calculations';
import { useTransactions, useAccounts, useRecurringRules, useDebts, useProfile, useAccountReconciliations, usePaymentPlans } from '@/hooks/useSupabaseData';
import { usePersistedState } from '@/hooks/usePersistedState';
import { CATEGORIES, CATEGORY_EMOJI } from '@/lib/types';
import { buildCardData, simulateVariablePayoff, CC_DEFAULT_CATEGORIES } from '@/lib/credit-card-engine';
import { buildPayConfig, getNormalizedMonthNetIncome, mergeDebtPaymentsIntoStream, mergeWithGeneratedTransactions, getRemainingTransactionIncomeByDay } from '@/lib/pay-schedule';
import { countRuleOccurrencesInMonth } from '@/lib/scheduling';
import FormModal from '@/components/shared/FormModal';
import { Plus, Edit2, Trash2, Copy, Repeat, AlertTriangle, SlidersHorizontal, Crown, Download, CreditCard, ChevronDown, ChevronUp } from 'lucide-react';
import { exportTransactionsCsv } from '@/lib/exportCsv';
import { exportTransactionsPdf } from '@/lib/exportPdf';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { useDemo } from '@/contexts/DemoContext';
import { useSubscription } from '@/hooks/useSubscription';
import { generatePaymentPlanTransactions, getPlanProgress, getNextPaymentDate, PaymentPlan, PaymentPlanFrequency } from '@/lib/payment-plan-generator';

const ALL_CATEGORIES = ['Income', ...CATEGORIES];

const emptyForm = { date: new Date().toISOString().split('T')[0], type: 'expense', amount: '', category: 'Other', account: 'Checking', note: '', payment_source: '' };

const emptyPlanForm = {
  name: '',
  provider: '',
  total_amount: '',
  payment_amount: '',
  frequency: 'monthly' as PaymentPlanFrequency,
  start_date: new Date().toISOString().split('T')[0],
  total_payments: '',
  category: 'Shopping',
  payment_source: '',
  notes: '',
};

export default function Transactions() {
  const { isDemo } = useDemo();
  const { isPremium } = useSubscription();
  const { data: transactions, add, update, remove } = useTransactions();
  const { data: accounts, loading: accountsLoading } = useAccounts();
  const { data: rules, update: updateRule } = useRecurringRules();
  const { data: debts } = useDebts();
  const { data: profile } = useProfile();
  const { data: reconciliations } = useAccountReconciliations();
  const { data: paymentPlans, add: addPlan, update: updatePlan, remove: removePlan } = usePaymentPlans();

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterSource, setFilterSource] = useState('all');

  // Month filter: 'YYYY-MM' | 'all'
  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const [filterMonth, setFilterMonth] = useState<string>(currentMonthStr);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editChoiceId, setEditChoiceId] = useState<string | null>(null);
  const [editChoiceRule, setEditChoiceRule] = useState<any>(null);

  // Payment plan state
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editPlanId, setEditPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState(emptyPlanForm);
  const [planDeleteConfirm, setPlanDeleteConfirm] = useState<string | null>(null);
  const [showPlans, setShowPlans] = useState(true);

  // Build account lookup map
  const accountMap = useMemo(() => {
    const map: Record<string, any> = {};
    accounts.forEach((a: any) => { map[a.id] = a; map[`account:${a.id}`] = a; });
    return map;
  }, [accounts]);

  // Normalize a payment_source to `account:ID` format
  const normalizeSource = useCallback((src: string | null | undefined): string => {
    if (!src) return '';
    if (src.startsWith('account:')) return src;
    // If it's a raw account ID, prefix it
    if (accountMap[src]) return `account:${src}`;
    return src;
  }, [accountMap]);

  // Base transaction stream (real + generated recurring) shared across pages
  const baseTxns = useMemo(() => {
    return mergeWithGeneratedTransactions(transactions, rules, accounts)
      .map((t: any) => ({ ...t, isGenerated: Boolean((t as any).isGenerated), isDebtPayment: false }));
  }, [transactions, rules, accounts]);

  // Generate debt payment transactions from Debt Payoff schedule
  // Resolve funding account from profile or default to first checking account
  const fundingAccountId = useMemo(() => {
    const defaultId = profile?.default_deposit_account;
    if (defaultId) {
      const acct = accounts.find((a: any) => a.id === defaultId && a.active);
      if (acct) return acct.id;
    }
    const checking = accounts.find((a: any) => a.account_type === 'checking' && a.active);
    return checking?.id || '';
  }, [accounts, profile]);

  const [pauseSavings] = usePersistedState<boolean>('tre:debtpayoff:pause-savings', false);

  // Savings/investing rule IDs for "paused" badge
  const savingsRuleIdsForBadge = useMemo(() => new Set<string>(
    rules.filter((r: any) =>
      r.active && r.rule_type === 'expense' &&
      (r.category === 'Savings' || r.category === 'Investing'),
    ).map((r: any) => r.id),
  ), [rules]);

  const debtPaymentTransactions = useMemo(() => {
    // Use simulateVariablePayoff month 0 output so Transactions matches the Debt Payoff tab.
    // generateRecommendations (old approach) only counted income up to the primary due day,
    // missing any paycheck that arrives after that date but before month end.
    const cards = buildCardData(accounts, baseTxns, rules, debts);
    if (cards.length === 0) return [];

    const liquidTypes = ['checking', 'business_checking', 'cash'];
    const liquidCash = accounts
      .filter((a: any) => a.active && liquidTypes.includes(a.account_type))
      .reduce((s: number, a: any) => s + Number(a.balance), 0);
    const fundingAcct = accounts.find((a: any) => a.id === fundingAccountId && a.active);
    const fundingBalance = fundingAcct ? Number(fundingAcct.balance) : liquidCash;
    const cashFloor = profile?.cash_floor != null ? Number(profile.cash_floor) : 1000;

    const ccIds = new Set(cards.flatMap(c => [c.id, `account:${c.id}`]));
    const nowDate = new Date();
    const monthStr = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}`;
    const todayStr = nowDate.toISOString().split('T')[0];

    // Full remaining month income (day 31) — same window as CreditCardEngine variableSim
    const month0Income = getRemainingTransactionIncomeByDay(baseTxns, 31);
    const month0Expenses = (baseTxns as any[])
      .filter((t: any) => {
        if (t.type !== 'expense') return false;
        if (!t.date || !t.date.startsWith(monthStr)) return false;
        if (t.date < todayStr) return false;
        if (t.category === 'Debt Payments') return false;
        if (t.category === 'Balance Adjustment') return false;
        return true;
      })
      .reduce((s: number, t: any) => s + Number(t.amount), 0);

    // Scalar fallbacks for months 1+ (only month 0 matters here)
    const payConfig = buildPayConfig(profile);
    const monthlyTakeHome = getNormalizedMonthNetIncome(payConfig);
    const ccPaymentSources = new Set(cards.flatMap(c => [c.id, `account:${c.id}`]));
    const _now = new Date();
    const monthlyExpenses = rules.filter((r: any) => {
      if (!r.active || r.rule_type !== 'expense') return false;
      if (r.payment_source && ccPaymentSources.has(r.payment_source)) return false;
      if (!r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category)) return false;
      return true;
    }).reduce((s: number, r: any) => {
      const amt = Number(r.amount);
      return s + amt * countRuleOccurrencesInMonth(r, _now.getFullYear(), _now.getMonth());
    }, 0);

    const sim = simulateVariablePayoff(
      cards, fundingBalance, cashFloor, 'avalanche',
      monthlyTakeHome, monthlyExpenses, 1,
      undefined, undefined, undefined,
      month0Income, month0Expenses,
    );

    const checkingAccount = fundingAccountId
      ? accounts.find((a: any) => a.id === fundingAccountId && a.active)
      : accounts.find((a: any) => a.account_type === 'checking' && a.active);
    const paymentSource = checkingAccount ? `account:${checkingAccount.id}` : 'bank_account';

    const results: any[] = [];
    for (const card of cards) {
      const pay = (sim.monthlyPayments.get(card.id) || [])[0] ?? 0;
      if (pay <= 0) continue;
      const dueDay = card.dueDay || 31;
      const monthEnd = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
      const effectiveDay = Math.min(dueDay, monthEnd);
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth(), effectiveDay);
      const dateStr = d.toISOString().split('T')[0];
      results.push({
        id: `debtpay:${card.id}:${dateStr}`,
        date: dateStr,
        type: 'expense',
        amount: Math.round(pay * 100) / 100,
        category: 'Debt Payments',
        note: `${card.name} Payment`,
        payment_source: paymentSource,
        isGenerated: true,
        isDebtPayment: true,
      });
    }
    return results;
  }, [accounts, baseTxns, rules, debts, profile, fundingAccountId]);

  // Map reconciliation records to transaction-like shape for rendering
  const reconciliationTxns = useMemo(() => {
    return (reconciliations || []).map((r: any) => ({
      id: `recon:${r.id}`,
      date: r.effective_date,
      type: r.delta >= 0 ? 'income' : 'expense',
      amount: Math.abs(r.delta),
      category: 'Balance Adjustment',
      note: 'Balance Adjustment',
      payment_source: '',
      account: '',
      isGenerated: false,
      isDebtPayment: false,
      isReconciliation: true,
      reconciliationDelta: r.delta,
    }));
  }, [reconciliations]);

  const planTransactions = useMemo(() => generatePaymentPlanTransactions(paymentPlans), [paymentPlans]);

  // Merge real + generated recurring + debt payments + reconciliations + plan payments
  const allTransactions = useMemo(() => {
    return [
      ...mergeDebtPaymentsIntoStream(baseTxns, debtPaymentTransactions),
      ...reconciliationTxns,
      ...planTransactions,
    ].sort((a, b) => b.date.localeCompare(a.date));
  }, [baseTxns, debtPaymentTransactions, reconciliationTxns, planTransactions]);

  const paymentSourceOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: 'cash', label: 'Cash' }];
    accounts.filter((a: any) => a.active).forEach((a: any) => {
      const typeLabel = a.account_type === 'credit_card' ? 'Credit Card'
        : a.account_type === 'high_yield_savings' ? 'HYS'
        : a.account_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      opts.push({ value: `account:${a.id}`, label: `${a.name} (${typeLabel})` });
    });
    if (opts.length === 1) {
      opts.push({ value: 'bank_account', label: 'Bank Account' });
      opts.push({ value: 'credit_card', label: 'Credit Card' });
    }
    return opts;
  }, [accounts]);

  const getSourceLabel = useCallback((source: string) => {
    if (!source) return 'Unassigned';
    // Try direct match
    const opt = paymentSourceOptions.find(o => o.value === source);
    if (opt) return opt.label;
    // Try with account: prefix
    const prefixed = paymentSourceOptions.find(o => o.value === `account:${source}`);
    if (prefixed) return prefixed.label;
    // Try raw account lookup
    const acct = accountMap[source];
    if (acct) return acct.name;
    if (source === 'bank_account') return 'Bank Account';
    if (source === 'credit_card') return 'Credit Card';
    if (source === 'cash') return 'Cash';
    return source;
  }, [paymentSourceOptions, accountMap]);

  // Check if a source account is missing/deleted
  const isSourceMissing = useCallback((source: string) => {
    if (!source || source === 'cash' || source === 'bank_account' || source === 'credit_card') return false;
    const id = source.startsWith('account:') ? source.slice(8) : source;
    return !accountMap[id] && !accountMap[`account:${id}`];
  }, [accountMap]);

  const filtered = useMemo(() => {
    return allTransactions.filter(t => {
      if (filterMonth !== 'all' && t.date.slice(0, 7) !== filterMonth) return false;
      if (filterType !== 'all' && t.type !== filterType) return false;
      if (filterCategory !== 'all' && t.category !== filterCategory) return false;
      if (filterSource !== 'all' && t.payment_source !== filterSource) return false;
      return true;
    });
  }, [allTransactions, filterMonth, filterType, filterCategory, filterSource]);

  // Build month options from distinct months in allTransactions (up to 24), plus forecast option
  const monthOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const t of allTransactions) {
      const m = t.date.slice(0, 7);
      seen.add(m);
      if (seen.size >= 24) break;
    }
    return [...seen].sort((a, b) => b.localeCompare(a)).map(m => {
      const [y, mo] = m.split('-');
      const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
      return { value: m, label };
    });
  }, [allTransactions]);

  const totals = useMemo(() => {
    const income = filtered.filter(t => t.type === 'income' && t.category !== 'Balance Adjustment').reduce((s, t) => s + Number(t.amount), 0);
    const expense = filtered.filter(t => t.type === 'expense' && t.category !== 'Balance Adjustment').reduce((s, t) => s + Number(t.amount), 0);
    return { income, expense, net: income - expense };
  }, [filtered]);

  const spendBySource = useMemo(() => {
    const acc: Record<string, number> = {};
    filtered.filter(t => t.type === 'expense').forEach(t => {
      const src = getSourceLabel(t.payment_source || '');
      acc[src] = (acc[src] || 0) + Number(t.amount);
    });
    return acc;
  }, [filtered, getSourceLabel]);

  const openAdd = () => { setForm(emptyForm); setEditId(null); setShowForm(true); };

  const openEditDirect = (t: any) => {
    setForm({ date: t.date, type: t.type, amount: String(t.amount), category: t.category, account: t.account || 'Checking', note: t.note || '', payment_source: normalizeSource(t.payment_source) || '' });
    setEditId(t.id); setShowForm(true);
  };

  const handleEditClick = (t: any) => {
    if (t.isGenerated && t.ruleId) {
      const rule = rules.find((r: any) => r.id === t.ruleId);
      setEditChoiceId(t.id);
      setEditChoiceRule(rule || null);
      return;
    }
    openEditDirect(t);
  };

  const handleEditOccurrence = (t: any) => {
    // Create as a real transaction (overrides this generated occurrence)
    setForm({ date: t.date, type: t.type, amount: String(t.amount), category: t.category, account: t.account || 'Checking', note: t.note || '', payment_source: normalizeSource(t.payment_source) || '' });
    setEditId(null); // null = new transaction (override)
    setShowForm(true);
    setEditChoiceId(null);
    setEditChoiceRule(null);
    toast.info('Editing this occurrence only — saving will create a standalone transaction.');
  };

  const handleEditRule = () => {
    if (!editChoiceRule) return;
    // Navigate to Budget Control or open edit for the rule
    // For now, open a form pre-filled with rule data
    const r = editChoiceRule;
    setForm({
      date: new Date().toISOString().split('T')[0],
      type: r.rule_type === 'income' ? 'income' : 'expense',
      amount: String(r.amount),
      category: r.rule_type === 'income' ? 'Income' : r.category,
      account: 'Checking',
      note: r.name,
      payment_source: normalizeSource(r.payment_source || r.deposit_account) || '',
    });
    // Store the rule ID for update
    setEditId(`rule:${r.id}`);
    setShowForm(true);
    setEditChoiceId(null);
    setEditChoiceRule(null);
    toast.info('Editing the recurring rule — changes affect all future occurrences.');
  };

  const duplicateTransaction = (t: any) => {
    setForm({
      date: new Date().toISOString().split('T')[0],
      type: t.type,
      amount: String(t.amount),
      category: t.category,
      account: t.account || 'Checking',
      note: t.note || '',
      payment_source: normalizeSource(t.payment_source) || '',
    });
    setEditId(null);
    setShowForm(true);
  };

  const handleSave = () => {
    const amount = parseFloat(form.amount);
    if (!amount) return;

    if (editId && editId.startsWith('rule:')) {
      // Update the recurring rule
      const ruleId = editId.slice(5);
      const rulePayload: any = {
        id: ruleId,
        amount,
        name: form.note || 'Transaction',
        category: form.category,
      };
      if (form.type === 'income') {
        rulePayload.rule_type = 'income';
        rulePayload.deposit_account = form.payment_source?.startsWith('account:') ? form.payment_source.slice(8) : form.payment_source;
      } else {
        rulePayload.rule_type = 'expense';
        rulePayload.payment_source = form.payment_source?.startsWith('account:') ? form.payment_source.slice(8) : form.payment_source;
      }
      updateRule.mutate(rulePayload);
      toast.success('Recurring rule updated — future transactions will reflect this change.');
    } else {
      const payload = { date: form.date, type: form.type, amount, category: form.category, account: form.account, note: form.note || 'Transaction', payment_source: form.payment_source };
      if (editId && !editId.startsWith('gen:')) {
        update.mutate({ id: editId, ...payload });
        toast.success('Transaction updated');
      } else {
        add.mutate(payload);
        toast.success('Transaction added');
      }
    }
    setShowForm(false); setForm(emptyForm); setEditId(null);
  };

  const handleDelete = (id: string) => {
    if (id.startsWith('gen:')) return;
    if (deleteConfirm === id) { remove.mutate(id); setDeleteConfirm(null); }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
  };

  const openAddPlan = () => { setPlanForm(emptyPlanForm); setEditPlanId(null); setShowPlanForm(true); };
  const openEditPlan = (plan: PaymentPlan) => {
    setPlanForm({
      name: plan.name,
      provider: plan.provider ?? '',
      total_amount: String(plan.total_amount),
      payment_amount: String(plan.payment_amount),
      frequency: plan.frequency,
      start_date: plan.start_date,
      total_payments: String(plan.total_payments),
      category: plan.category,
      payment_source: plan.payment_source ?? '',
      notes: plan.notes ?? '',
    });
    setEditPlanId(plan.id);
    setShowPlanForm(true);
  };

  const handleSavePlan = () => {
    const totalAmt = parseFloat(planForm.total_amount);
    const payAmt = parseFloat(planForm.payment_amount);
    const totalPay = parseInt(planForm.total_payments, 10);
    if (!planForm.name.trim()) { toast.error('Plan name is required'); return; }
    if (!totalAmt || totalAmt <= 0) { toast.error('Total amount must be greater than 0'); return; }
    if (!payAmt || payAmt <= 0) { toast.error('Payment amount must be greater than 0'); return; }
    if (!totalPay || totalPay <= 0) { toast.error('Number of payments must be at least 1'); return; }
    const payload = {
      name: planForm.name.trim(),
      provider: planForm.provider.trim() || null,
      total_amount: totalAmt,
      payment_amount: payAmt,
      frequency: planForm.frequency,
      start_date: planForm.start_date,
      total_payments: totalPay,
      category: planForm.category,
      payment_source: planForm.payment_source || null,
      notes: planForm.notes.trim() || null,
      active: true,
    };
    if (editPlanId) {
      updatePlan.mutate({ id: editPlanId, ...payload });
    } else {
      addPlan.mutate(payload);
    }
    setShowPlanForm(false);
    setPlanForm(emptyPlanForm);
    setEditPlanId(null);
  };

  const handleDeletePlan = (id: string) => {
    if (planDeleteConfirm === id) {
      removePlan.mutate(id);
      setPlanDeleteConfirm(null);
    } else {
      setPlanDeleteConfirm(id);
      setTimeout(() => setPlanDeleteConfirm(null), 3000);
    }
  };

  const formFields = useMemo(() => [
    { key: 'date', label: 'Date', type: 'date' as const },
    { key: 'type', label: 'Type', type: 'select' as const, options: [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] },
    { key: 'amount', label: 'Amount', type: 'number' as const, placeholder: '0.00', step: '0.01' },
    { key: 'category', label: 'Category', type: 'select' as const, options: ALL_CATEGORIES.map(c => ({ value: c, label: c })) },
    { key: 'payment_source', label: editId?.startsWith('rule:') ? 'Account' : 'Payment Source', type: 'select' as const, options: paymentSourceOptions },
    { key: 'note', label: 'Note', type: 'text' as const, placeholder: 'What was this for?' },
  ], [paymentSourceOptions, editId]);

  if (accountsLoading) return <PageSkeleton />;

  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto space-y-6 overflow-x-hidden">
      {/* Header */}
<div className="space-y-3">
  {/* Title Row */}
  <div className="flex items-center gap-3">
    <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">
      Transactions
    </h1>

    <InstructionsModal
      pageTitle="Transactions Guide"
      sections={[
        { title: 'What is this page?', body: 'Transactions shows your complete ledger — real transactions you enter plus auto-generated ones from your Budget Control recurring rules and debt payoff plan.' },
        { title: 'Generated vs Real', body: 'Entries with badges (recurring, debt payment) are auto-generated from rules. Edit the occurrence to override just that instance, or edit the rule to change all future occurrences.' },
        { title: 'Filters', body: 'Filter by type (income/expense), category, or payment source to find specific entries.' },
        { title: 'How it affects the rest', body: 'Transactions feed the Dashboard monthly totals, Forecast projections, and spending breakdowns.' },
      ]}
    />
  </div>

  {/* Action Buttons */}
  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
    {(isPremium || isDemo) ? (
      <>
        <button
          onClick={async () => {
            const filename = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
            await exportTransactionsCsv(filtered, filename);
          }}
          className="w-full sm:w-auto flex items-center justify-center gap-2 bg-secondary border border-border px-4 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <Download size={14} /> Export CSV
        </button>

        <button
          onClick={async () => {
            const period = filterMonth === 'all' ? 'All Time' : filterMonth;

            await exportTransactionsPdf(filtered, period);
          }}
          className="w-full sm:w-auto flex items-center justify-center gap-2 bg-secondary border border-border px-4 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <Download size={14} /> Export PDF
        </button>
      </>
    ) : (
      <Link
        to="/premium"
        className="w-full sm:w-auto flex items-center justify-center gap-2 bg-secondary border border-border px-4 py-2 text-sm font-medium text-primary/70 hover:text-primary hover:border-primary/40 transition-colors"
        style={{ borderRadius: 'var(--radius)' }}
      >
        <Crown size={14} /> Export
      </Link>
    )}

    {(isPremium || isDemo) ? (
      <button
        onClick={openAdd}
        className="w-full sm:w-auto flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold"
        style={{ borderRadius: 'var(--radius)' }}
      >
        <Plus size={14} /> Add Transaction
      </button>
    ) : (
      <Link
        to="/premium"
        className="w-full sm:w-auto flex items-center justify-center gap-2 bg-primary/20 text-primary px-4 py-2 text-sm font-semibold hover:bg-primary/30 transition-colors"
        style={{ borderRadius: 'var(--radius)' }}
      >
        <Crown size={14} /> Add Transaction
      </Link>
    )}
  </div>
</div>

      {!isPremium && !isDemo && (
        <div className="card-forged p-4 border-primary/20 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 space-y-2">
            <p className="text-xs font-semibold text-foreground">One-time transactions — Premium</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Record income windfalls and large one-time expenses that instantly update your Debt Payoff engine and 36-month Forecast.
            </p>
            <ul className="space-y-1">
              {[
                'Windfalls (bonuses, tax refunds) automatically boost payoff speed',
                "Big expenses (car down payment, medical bill) reduce that month's payments",
                'Adjustments flow instantly to Dashboard, Forecast, and Debt Payoff',
              ].map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="text-primary font-bold shrink-0 mt-px">→</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
          <Link
            to="/premium"
            className="shrink-0 self-start sm:self-center flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <Crown size={12} /> Upgrade Now
          </Link>
        </div>
      )}

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-3">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-foreground">The live ledger — real entries + auto-generated ones</p>
              <p className="text-xs text-muted-foreground mt-0.5">Everything that has happened or is planned flows through here. One-time entries directly shape what the debt engine and forecast can do.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: 'Auto-generated entries', desc: 'Budget Control recurring rules create transactions automatically — weekly paychecks, rent, groceries, and more.' },
              { label: 'One-time expenses', desc: 'The $6,000 car purchase in June reduces available cash that month — the forecast pre-saves in prior months to cover it.' },
              { label: 'Income windfalls', desc: 'The $3,000 gift in June is a one-time income entry — the debt engine adds it to available surplus for that month.' },
              { label: 'Debt payments', desc: 'Auto-generated from the Debt Payoff engine each month — click to see the recommended amount per card.' },
            ].map((f, i) => (
              <div key={i} className="flex gap-2 p-2.5 bg-secondary/40 text-xs" style={{ borderRadius: 'var(--radius)' }}>
                <span className="text-primary font-bold shrink-0">→</span>
                <div><span className="font-medium text-foreground">{f.label}: </span><span className="text-muted-foreground">{f.desc}</span></div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">All data is fictional.</p>
            <Link to="/auth" className="text-xs font-semibold text-primary hover:underline">Use with your own data →</Link>
          </div>
        </div>
      )}

      {/* Payment Plans Section */}
      {(isPremium || isDemo) && (
        <div className="card-forged overflow-hidden">
          <button
            onClick={() => setShowPlans(p => !p)}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/20 transition-colors"
          >
            <div className="flex items-center gap-2">
              <CreditCard size={14} className="text-primary" />
              <span className="text-sm font-display font-semibold">Payment Plans</span>
              {paymentPlans.filter(p => p.active).length > 0 && (
                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 font-medium" style={{ borderRadius: 'var(--radius)' }}>
                  {paymentPlans.filter(p => p.active).length} active
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={e => { e.stopPropagation(); openAddPlan(); }}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium"
              >
                <Plus size={12} /> Add Plan
              </button>
              {showPlans ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
            </div>
          </button>

          {showPlans && (
            <div className="border-t border-border">
              {paymentPlans.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-xs text-muted-foreground">No payment plans yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">Track PayPal Pay in 4, 0% APR promos, and any installment plan.</p>
                  <button onClick={openAddPlan} className="mt-3 text-xs text-primary hover:underline font-medium">Add your first plan</button>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {paymentPlans.map(plan => {
                    const { paid, remaining, endDate } = getPlanProgress(plan);
                    const nextDate = getNextPaymentDate(plan);
                    const pct = Math.round((paid / plan.total_payments) * 100);
                    const remainingAmt = remaining * plan.payment_amount;
                    return (
                      <div key={plan.id} className={`p-4 ${!plan.active ? 'opacity-50' : ''}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-xs font-semibold truncate">{plan.name}</p>
                              {plan.provider && (
                                <span className="text-[10px] bg-secondary border border-border px-1.5 py-0.5 text-muted-foreground shrink-0" style={{ borderRadius: 'var(--radius)' }}>
                                  {plan.provider}
                                </span>
                              )}
                              {!plan.active && <span className="text-[10px] text-muted-foreground">(inactive)</span>}
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[10px] text-muted-foreground shrink-0">{paid}/{plan.total_payments}</span>
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                              <p className="text-[11px] text-muted-foreground">
                                {formatCurrency(plan.payment_amount, false)}/{plan.frequency === 'biweekly' ? '2 wks' : plan.frequency === 'weekly' ? 'wk' : 'mo'}
                              </p>
                              {remaining > 0 && nextDate && (
                                <p className="text-[11px] text-muted-foreground">Next: {nextDate}</p>
                              )}
                              <p className="text-[11px] text-muted-foreground">Remaining: {formatCurrency(remainingAmt, false)}</p>
                              <p className="text-[11px] text-muted-foreground">Ends: {endDate}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => openEditPlan(plan)} className="icon-btn text-muted-foreground hover:text-foreground" title="Edit"><Edit2 size={12} /></button>
                            <button
                              onClick={() => handleDeletePlan(plan.id)}
                              className={`icon-btn ${planDeleteConfirm === plan.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}
                              title="Delete"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="bg-secondary border border-border px-2 py-1 text-xs text-foreground font-medium min-w-[120px]" style={{ borderRadius: 'var(--radius)' }}>
          {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          <option value="all">All Time</option>
        </select>
        {(['all', 'income', 'expense'] as const).map(t => (
          <button key={t} onClick={() => setFilterType(t)} className={`px-3 py-1 text-xs font-medium border btn-press ${filterType === t ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`} style={{ borderRadius: 'var(--radius)' }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="bg-secondary border border-border px-2 py-1 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }}>
          <option value="all">All Categories</option>
          {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="bg-secondary border border-border px-2 py-1 text-xs text-foreground" style={{ borderRadius: 'var(--radius)' }}>
          <option value="all">All Sources</option>
          {paymentSourceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="card-forged p-3 text-center"><p className="text-xs text-muted-foreground uppercase">Income</p><p className="text-sm font-display font-bold text-success">{formatCurrency(totals.income, false)}</p></div>
        <div className="card-forged p-3 text-center"><p className="text-xs text-muted-foreground uppercase">Expenses</p><p className="text-sm font-display font-bold text-destructive">{formatCurrency(totals.expense, false)}</p></div>
        <div className="card-forged p-3 text-center"><p className="text-xs text-muted-foreground uppercase">Net</p><p className={`text-sm font-display font-bold ${totals.net >= 0 ? 'text-primary' : 'text-destructive'}`}>{formatCurrency(totals.net, false)}</p></div>
      </div>

      {Object.keys(spendBySource).length > 0 && (
        <div className="card-forged p-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Spend by Payment Source</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(spendBySource).map(([src, amt]) => (
              <div key={src} className="p-3 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
                <p className="text-xs text-muted-foreground truncate">{src}</p>
                <p className="text-sm font-display font-bold text-destructive">{formatCurrency(amt, false)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-forged divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="p-8 text-center"><p className="text-sm text-muted-foreground">No transactions found.</p></div>
        ) : filtered.map(t => {
          const isRecon = (t as any).isReconciliation;
          const sourceMissing = !isRecon && isSourceMissing(t.payment_source);
          const reconDelta = (t as any).reconciliationDelta as number | undefined;
          return (
            <div key={t.id} className={`flex items-center justify-between px-4 py-3 ${t.isGenerated ? 'bg-muted/5' : ''} ${(t as any).isDebtPayment ? 'border-l-2 border-l-primary/40' : ''} ${isRecon ? 'border-l-2 border-l-amber-500/40' : ''}`}>
              <div className="flex items-center gap-3">
                {isRecon
                  ? <SlidersHorizontal size={14} className="text-amber-500" />
                  : <span className="text-base leading-none w-5 text-center shrink-0">{(t as any).isDebtPayment ? '💳' : t.type === 'income' ? '💰' : (CATEGORY_EMOJI[t.category] ?? '📦')}</span>
                }
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium">{t.note || '—'}</p>
                    {t.isGenerated && !(t as any).isDebtPayment && <Repeat size={10} className="text-primary" />}
                    {(t as any).isDebtPayment && <span className="text-[9px] text-primary bg-primary/10 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }}>debt payoff</span>}
                    {(t as any).isPlanPayment && <span className="text-[9px] text-blue-600 bg-blue-500/10 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }}>installment</span>}
                    {pauseSavings && (t as any).ruleId && savingsRuleIdsForBadge.has((t as any).ruleId) && (
                      <span className="text-[9px] text-muted-foreground bg-muted/20 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }}>paused</span>
                    )}
                    {isRecon && <span className="text-[9px] text-amber-600 bg-amber-500/10 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }} title="Manual balance correction">reconciled</span>}
                    {sourceMissing && <span className="text-destructive" aria-label="Linked account not found"><AlertTriangle size={10} /></span>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.date} · {t.category}{!isRecon && <> · {sourceMissing ? <span className="text-destructive">⚠ Missing account</span> : getSourceLabel(t.payment_source)}</>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold font-display whitespace-nowrap ${isRecon ? (reconDelta !== undefined && reconDelta >= 0 ? 'text-success' : 'text-destructive') : t.type === 'income' ? 'text-success' : 'text-destructive'}`}>
                  {isRecon ? (reconDelta !== undefined && reconDelta >= 0 ? '+' : '') : (t.type === 'income' ? '+' : '-')}{isRecon && reconDelta !== undefined ? formatCurrency(reconDelta, false) : formatCurrency(Number(t.amount), false)}
                </span>
                {!isRecon && <button onClick={() => duplicateTransaction(t)} className="icon-btn text-muted-foreground hover:text-foreground" title="Duplicate"><Copy size={12} /></button>}
                {!isRecon && <button onClick={() => handleEditClick(t)} className="icon-btn text-muted-foreground hover:text-foreground" title="Edit"><Edit2 size={12} /></button>}
                {!isRecon && !t.isGenerated && (
                  <button onClick={() => handleDelete(t.id)} className={`icon-btn ${deleteConfirm === t.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={12} /></button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Choice Dialog for Generated Transactions */}
      {editChoiceId && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4" onClick={() => { setEditChoiceId(null); setEditChoiceRule(null); }}>
          <div className="bg-card border border-border p-4 sm:p-6 w-full sm:max-w-sm space-y-4 rounded-t-[var(--radius)] rounded-b-none sm:rounded-b-[var(--radius)]" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-display font-bold">Edit Recurring Transaction</h3>
            <p className="text-xs text-muted-foreground">This transaction was auto-generated from a recurring rule. How would you like to edit it?</p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  const t = allTransactions.find(tx => tx.id === editChoiceId);
                  if (t) handleEditOccurrence(t);
                }}
                className="w-full text-left p-3 border border-border hover:border-primary hover:bg-primary/5 transition-colors" style={{ borderRadius: 'var(--radius)' }}>
                <p className="text-xs font-semibold">Edit This Occurrence Only</p>
                <p className="text-xs text-muted-foreground">Creates a one-time override. Future months are unaffected.</p>
              </button>
              {editChoiceRule && (
                <button
                  onClick={handleEditRule}
                  className="w-full text-left p-3 border border-border hover:border-primary hover:bg-primary/5 transition-colors" style={{ borderRadius: 'var(--radius)' }}>
                  <p className="text-xs font-semibold">Edit Recurring Rule</p>
                  <p className="text-xs text-muted-foreground">Updates the source rule in Budget Control. All future occurrences change.</p>
                </button>
              )}
            </div>
            <button onClick={() => { setEditChoiceId(null); setEditChoiceRule(null); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}

      {showForm && (
        <FormModal
          title={editId?.startsWith('rule:') ? 'Edit Recurring Rule' : editId ? 'Edit Transaction' : 'Add Transaction'}
          fields={formFields}
          values={form}
          onChange={(k, v) => setForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditId(null); }}
          saving={add.isPending || update.isPending || updateRule.isPending}
          saveLabel={editId?.startsWith('rule:') ? 'Update Rule' : editId ? 'Update' : 'Add Transaction'}
        />
      )}

      {/* Payment Plan Form Modal */}
      {showPlanForm && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4" onClick={() => setShowPlanForm(false)}>
          <div className="bg-card border border-border w-full sm:max-w-md rounded-t-[var(--radius)] rounded-b-none sm:rounded-b-[var(--radius)] overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-sm font-display font-bold">{editPlanId ? 'Edit Payment Plan' : 'Add Payment Plan'}</h3>
              <button onClick={() => setShowPlanForm(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Plan Name *</label>
                <input
                  type="text"
                  value={planForm.name}
                  onChange={e => setPlanForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. AirPods Pro, MacBook Pro"
                  className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Provider / Program</label>
                <input
                  type="text"
                  value={planForm.provider}
                  onChange={e => setPlanForm(p => ({ ...p, provider: e.target.value }))}
                  placeholder="e.g. PayPal Pay in 4, Prime Visa 12 months"
                  className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Total Amount *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={planForm.total_amount}
                    onChange={e => setPlanForm(p => ({ ...p, total_amount: e.target.value }))}
                    placeholder="0.00"
                    className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                    style={{ borderRadius: 'var(--radius)' }}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Payment Amount *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={planForm.payment_amount}
                    onChange={e => setPlanForm(p => ({ ...p, payment_amount: e.target.value }))}
                    placeholder="0.00"
                    className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                    style={{ borderRadius: 'var(--radius)' }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Frequency *</label>
                  <select
                    value={planForm.frequency}
                    onChange={e => setPlanForm(p => ({ ...p, frequency: e.target.value as PaymentPlanFrequency }))}
                    className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every 2 Weeks</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Total Payments *</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={planForm.total_payments}
                    onChange={e => setPlanForm(p => ({ ...p, total_payments: e.target.value }))}
                    placeholder="e.g. 4 or 12"
                    className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                    style={{ borderRadius: 'var(--radius)' }}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">First Payment Date *</label>
                <input
                  type="date"
                  value={planForm.start_date}
                  onChange={e => setPlanForm(p => ({ ...p, start_date: e.target.value }))}
                  className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Category</label>
                <select
                  value={planForm.category}
                  onChange={e => setPlanForm(p => ({ ...p, category: e.target.value }))}
                  className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Payment Source</label>
                <select
                  value={planForm.payment_source}
                  onChange={e => setPlanForm(p => ({ ...p, payment_source: e.target.value }))}
                  className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  <option value="">Unassigned</option>
                  {paymentSourceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Notes</label>
                <input
                  type="text"
                  value={planForm.notes}
                  onChange={e => setPlanForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Optional note"
                  className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                />
              </div>
              {planForm.payment_amount && planForm.total_payments && (
                <div className="p-3 bg-muted/30 text-xs text-muted-foreground" style={{ borderRadius: 'var(--radius)' }}>
                  Total scheduled: {formatCurrency(parseFloat(planForm.payment_amount || '0') * parseInt(planForm.total_payments || '0', 10), false)}
                  {' · '}
                  {planForm.frequency === 'weekly' ? 'weekly' : planForm.frequency === 'biweekly' ? 'every 2 weeks' : 'monthly'} from {planForm.start_date}
                </div>
              )}
              <button
                onClick={handleSavePlan}
                disabled={addPlan.isPending || updatePlan.isPending}
                className="w-full bg-primary text-primary-foreground py-2 text-xs font-semibold disabled:opacity-50"
                style={{ borderRadius: 'var(--radius)' }}
              >
                {addPlan.isPending || updatePlan.isPending ? 'Saving...' : editPlanId ? 'Update Plan' : 'Add Plan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
