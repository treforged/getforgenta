import { useState, useMemo } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { requestReviewAfterAction } from '@/hooks/useInAppReview';
import { Link } from 'react-router-dom';
import { PageSkeleton } from '@/components/shared/PageSkeleton';
import InstructionsModal from '@/components/shared/InstructionsModal';
import { formatCurrency } from '@/lib/calculations';
import { useSavingsGoals, useCarFunds, useAccounts, useRecurringRules, useProfile, useTransactions, useDebts, useLumpSumTransfers } from '@/hooks/useSupabaseData';
import ProgressBar from '@/components/shared/ProgressBar';
import FormModal from '@/components/shared/FormModal';
import { useSubscription } from '@/hooks/useSubscription';
import { useDemo } from '@/contexts/DemoContext';
import { Plus, Edit2, Trash2, Car, Copy, Link2, Crown } from 'lucide-react';
import * as DebtEngine from '@/lib/credit-card-engine';
import { mergeWithGeneratedTransactions, createDebtPaymentTransactions, mergeDebtPaymentsIntoStream, getAccountRemainingCashThisMonth } from '@/lib/pay-schedule';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { toast } from 'sonner';

const CHART_COLORS = ['hsl(43, 56%, 52%)', 'hsl(142, 50%, 40%)', 'hsl(200, 60%, 50%)', 'hsl(280, 50%, 50%)'];
const GOAL_TYPES = ['Emergency Fund', 'Vacation', 'Down Payment', 'Retirement', 'Custom'];
const ROTH_IRA_LIMIT = 7000;
const DEST_LABELS: Record<string, string> = { savings: 'HYS / Savings', brokerage: 'Brokerage', roth_ira: 'Roth IRA' };
const emptyTransferForm = { date: '', amount: '', label: '', destination_type: 'savings' };
const emptyForm = { name: '', target_amount: '', current_amount: '', monthly_contribution: '', target_date: '', goal_type: 'Custom', linked_account: '', contribution_start_date: '', linked_rule_id: '' };

const toMonthly = (amount: number, freq: string) =>
  freq === 'weekly' ? amount * 52 / 12
  : freq === 'biweekly' ? amount * 26 / 12
  : freq === 'yearly' ? amount / 12
  : amount;

function SavingsGrowthChart({ goals }: { goals: any[] }) {
  const chartData = useMemo(() => {
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const months: Record<string, any>[] = [];
    for (let i = 0; i < 12; i++) {
      const entry: Record<string, any> = { month: new Date(todayYear, todayMonth + i).toLocaleString('en', { month: 'short', year: '2-digit' }) };
      goals.forEach(g => {
        let monthsContributed = i;
        if (g.contribution_start_date) {
          const start = new Date(g.contribution_start_date + 'T00:00:00');
          const j = (start.getFullYear() - todayYear) * 12 + (start.getMonth() - todayMonth);
          if (j > 0) monthsContributed = Math.max(0, i - (j - 1));
        }
        entry[g.name] = Math.min(Number(g.current_amount) + Number(g.monthly_contribution) * monthsContributed, Number(g.target_amount));
      });
      months.push(entry);
    }
    return months;
  }, [goals]);

  if (goals.length === 0) return null;
  return (
    <div className="card-forged p-4 sm:p-5 overflow-hidden w-full">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 sm:mb-5">Savings Growth Projection</h3>
      <ResponsiveContainer width="100%" height={window.innerWidth < 640 ? 200 : 260}>
        <LineChart data={chartData} margin={{ left: 0, right: 0, top: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 15%)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(240, 4%, 46%)', textAnchor: 'end' }} angle={-45} height={50} axisLine={false} tickLine={false} interval={window.innerWidth < 640 ? Math.ceil(chartData.length / 5) : 0} />
          <YAxis tick={{ fontSize: 11, fill: 'hsl(240, 4%, 46%)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip contentStyle={{ background: 'hsl(0, 0%, 8%)', border: '1px solid hsl(0, 0%, 15%)', borderRadius: 'var(--radius)', fontSize: 12 }} formatter={(value: number) => formatCurrency(value, false)} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          {goals.map((g, i) => <Line key={g.id} dataKey={g.name} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2.5} dot={{ r: 3 }} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function SavingsGoals() {
  const { data: goals, add, update, remove } = useSavingsGoals();
  const { data: carFunds } = useCarFunds();
  const { data: accounts, loading: accountsLoading } = useAccounts();
  const { data: rules } = useRecurringRules();
  const { data: profile } = useProfile();
  const { data: txns } = useTransactions();
  const { data: debts } = useDebts();
  const { data: transfers, add: addTransfer, update: updateTransfer, remove: removeTransfer } = useLumpSumTransfers();
  const { isPremium } = useSubscription();
  const { isDemo } = useDemo();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [editTransferId, setEditTransferId] = useState<string | null>(null);
  const [transferForm, setTransferForm] = useState(emptyTransferForm);
  const [deleteTransferConfirm, setDeleteTransferConfirm] = useState<string | null>(null);
  const cashFloor = Number((profile as any)?.cash_floor) || 1000;
  const [pauseSavings] = usePersistedState<boolean>('tre:debtpayoff:pause-savings', false);

  const rothByYear = useMemo(() => {
    const map: Record<number, number> = {};
    (transfers as any[]).filter(t => t.destination_type === 'roth_ira').forEach(t => {
      const year = parseInt(t.date.substring(0, 4), 10);
      map[year] = (map[year] || 0) + Number(t.amount);
    });
    return map;
  }, [transfers]);

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
    const savingsTotal = (goals as any[] ?? []).reduce((s: number, g: any) => {
      if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > now) return s;
      if (g.linked_account && retireIds.has(g.linked_account)) return s;
      if (g.linked_account && activeTransferDests.has(g.linked_account)) return s;
      return s + Number(g.monthly_contribution);
    }, 0);
    const carTotal = (carFunds as any[] ?? []).reduce((s: number, c: any) => {
      const rem = Number(c.down_payment_goal) - Number(c.current_saved);
      return s + (rem > 0 ? Math.min(rem / 12, 500) : 0);
    }, 0);
    return savingsTotal + carTotal;
  }, [pauseSavings, goals, carFunds, accounts, rules]);

  // Build full transaction stream including debt payments for linked-account math
  const baseTxns = useMemo(() => mergeWithGeneratedTransactions(txns || [], rules, accounts), [txns, rules, accounts]);
  const debtRecs = useMemo(() => {
  try {
    return DebtEngine.getCurrentMonthDebtRecommendations(
      accounts,
      baseTxns,
      rules,
      debts,
      profile,
      monthlySavingsAndCar
    );
  } catch (e) {
    console.error('Debt engine failed:', e);
    return [];
  }
}, [accounts, baseTxns, rules, debts, profile, monthlySavingsAndCar]);
  const debtTxns = useMemo(() => {
    const fundId = (profile as any)?.default_deposit_account ||
      accounts.find((a: any) => a.account_type === 'checking' && a.active)?.id || null;
    return createDebtPaymentTransactions(debtRecs, fundId);
  }, [debtRecs, profile, accounts]);
  const allTxns = useMemo(() => mergeDebtPaymentsIntoStream(baseTxns, debtTxns), [baseTxns, debtTxns]);

  const accountMap = useMemo(() => {
    const map: Record<string, any> = {};
    accounts.forEach((a: any) => { map[a.id] = a; });
    return map;
  }, [accounts]);

  const getLinkedAmount = (accountId: string) => {
    const acct = accountMap[accountId];
    if (!acct) return 0;
    return getAccountRemainingCashThisMonth(accountId, acct.account_type, allTxns, Number(acct.balance), cashFloor);
  };

  const allGoals = useMemo(() => {
    return goals.map(g => {
      const linkedRule = (g as any).linked_rule_id
        ? rules.find((r: any) => r.id === (g as any).linked_rule_id)
        : null;
      return {
        ...g,
        goal_type: (g as any).goal_type || 'Custom',
        current_amount: (g as any).linked_account && accountMap[(g as any).linked_account]
          ? Number(accountMap[(g as any).linked_account].balance)
          : Number(g.current_amount),
        available_after_outflows: (g as any).linked_account && accountMap[(g as any).linked_account]
          ? getLinkedAmount((g as any).linked_account)
          : null,
        monthly_contribution: linkedRule
          ? toMonthly(Number(linkedRule.amount), linkedRule.frequency)
          : Number(g.monthly_contribution),
        contribution_start_date: linkedRule?.start_date ?? (g as any).contribution_start_date ?? null,
        linked_rule: linkedRule || null,
      };
    });
  }, [goals, accountMap, rules, cashFloor]);

  const totalSaved = allGoals.reduce((s, g) => s + Number(g.current_amount), 0);
  const totalTarget = allGoals.reduce((s, g) => s + Number(g.target_amount), 0);

  const accountOptions = useMemo(() => [
    { value: '', label: 'None (Manual)' },
    ...accounts.filter((a: any) => a.active).map((a: any) => ({ value: a.id, label: `${a.name} (${a.account_type.replace(/_/g, ' ')})` })),
  ], [accounts]);

  const transferRuleOptions = useMemo(() => [
    { value: '', label: 'None (manual)' },
    ...rules
      .filter((r: any) => (r.rule_type === 'transfer' || r.rule_type === 'investment') && r.active)
      .map((r: any) => ({ value: r.id, label: `${r.name} — ${formatCurrency(r.amount, false)}/${r.frequency}` })),
  ], [rules]);

  const openAdd = (goalType = 'Custom') => {
    setForm({ ...emptyForm, goal_type: goalType });
    setEditId(null); setShowForm(true);
  };

  const openEdit = (g: any) => {
    setForm({
      name: g.name, target_amount: String(g.target_amount), current_amount: String(g.current_amount),
      monthly_contribution: String(g.monthly_contribution), target_date: g.target_date || '',
      goal_type: g.goal_type || 'Custom', linked_account: (g as any).linked_account || '',
      contribution_start_date: (g as any).contribution_start_date || '',
      linked_rule_id: (g as any).linked_rule_id || '',
    });
    setEditId(g.id); setShowForm(true);
  };

  const handleDuplicate = (g: any) => {
    setForm({
      name: `${g.name} (Copy)`, target_amount: String(g.target_amount), current_amount: '0',
      monthly_contribution: String(g.monthly_contribution), target_date: g.target_date || '',
      goal_type: g.goal_type || 'Custom', linked_account: (g as any).linked_account || '',
      contribution_start_date: (g as any).contribution_start_date || '',
      linked_rule_id: (g as any).linked_rule_id || '',
    });
    setEditId(null); setShowForm(true);
    toast.info('Goal duplicated — edit and save');
  };

  const handleSave = () => {
    const target_amount = parseFloat(form.target_amount);
    if (!form.name || isNaN(target_amount)) return;
    const payload: any = {
      name: form.name, target_amount, current_amount: parseFloat(form.current_amount) || 0,
      monthly_contribution: parseFloat(form.monthly_contribution) || 0,
      target_date: form.target_date || null,
      linked_account: form.linked_account || null,
      goal_type: form.goal_type || 'Custom',
      contribution_start_date: (form as any).contribution_start_date || null,
      linked_rule_id: (form as any).linked_rule_id || null,
    };
    if (editId) {
      update.mutate({ id: editId, ...payload });
    } else {
      add.mutate(payload);
      requestReviewAfterAction();
    }
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) { remove.mutate(id); setDeleteConfirm(null); }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
  };

  const openAddTransfer = () => { setTransferForm(emptyTransferForm); setEditTransferId(null); setShowTransferForm(true); };
  const openEditTransfer = (t: any) => {
    setTransferForm({ date: t.date, amount: String(t.amount), label: t.label || '', destination_type: t.destination_type });
    setEditTransferId(t.id); setShowTransferForm(true);
  };
  const handleSaveTransfer = () => {
    const amount = parseFloat(transferForm.amount);
    if (!transferForm.date || isNaN(amount) || amount <= 0) return;
    if (transferForm.destination_type === 'roth_ira') {
      const year = parseInt(transferForm.date.substring(0, 4), 10);
      const existingTotal = rothByYear[year] || 0;
      const alreadyCounted = editTransferId ? Number((transfers as any[]).find(t => t.id === editTransferId)?.amount ?? 0) : 0;
      if (existingTotal - alreadyCounted + amount > ROTH_IRA_LIMIT) {
        toast.error(`Exceeds $${ROTH_IRA_LIMIT.toLocaleString()} Roth IRA limit for ${year}`);
        return;
      }
    }
    const payload = { date: transferForm.date, amount, label: transferForm.label || null, destination_type: transferForm.destination_type };
    if (editTransferId) { updateTransfer.mutate({ id: editTransferId, ...payload }); }
    else { addTransfer.mutate(payload); }
    setShowTransferForm(false);
  };
  const handleDeleteTransfer = (id: string) => {
    if (deleteTransferConfirm === id) { removeTransfer.mutate(id); setDeleteTransferConfirm(null); }
    else { setDeleteTransferConfirm(id); setTimeout(() => setDeleteTransferConfirm(null), 3000); }
  };

  function estimateCompletion(g: any): string {
    const remaining = Number(g.target_amount) - Number(g.current_amount);
    if (remaining <= 0) return 'Complete';
    if (Number(g.monthly_contribution) <= 0) return 'Set contribution';
    let delay = 0;
    if (g.contribution_start_date) {
      const today = new Date();
      const start = new Date(g.contribution_start_date + 'T00:00:00');
      const j = (start.getFullYear() - today.getFullYear()) * 12 + (start.getMonth() - today.getMonth());
      delay = Math.max(0, j - 1);
    }
    const months = delay + Math.ceil(remaining / Number(g.monthly_contribution));
    const date = new Date(); date.setMonth(date.getMonth() + months);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  const formFields = useMemo(() => {
    const fields: any[] = [
      { key: 'name', label: 'Goal Name', type: 'text', placeholder: 'e.g., Emergency Fund' },
      { key: 'goal_type', label: 'Goal Type', type: 'select', options: GOAL_TYPES.map(t => ({ value: t, label: t })) },
      { key: 'linked_account', label: 'Linked Account (auto-pull balance)', type: 'select', options: accountOptions },
      { key: 'linked_rule_id', label: 'Transfer Rule (auto-sync amount & start date)', type: 'select', options: transferRuleOptions },
      { key: 'target_amount', label: 'Target Amount', type: 'number', placeholder: '10000', step: '0.01' },
    ];
    if (!form.linked_account) {
      fields.push({ key: 'current_amount', label: 'Current Saved', type: 'number', placeholder: '0', step: '0.01' });
    }
    if (!(form as any).linked_rule_id) {
      fields.push({ key: 'monthly_contribution', label: 'Monthly Contribution', type: 'number', placeholder: '500', step: '0.01' });
      fields.push({ key: 'contribution_start_date', label: 'Contributions Start (optional)', type: 'date' });
    }
    fields.push({ key: 'target_date', label: 'Target Date', type: 'date' });
    return fields;
  }, [form.goal_type, form.linked_account, (form as any).linked_rule_id, accountOptions, transferRuleOptions]);

  if (accountsLoading) return <PageSkeleton />;

  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto space-y-6 overflow-x-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Goals</h1>
            <InstructionsModal pageTitle="Savings Goals Guide" sections={[
              { title: 'What is this page?', body: 'Track progress toward your financial goals — emergency fund, vacation, down payment, or retirement. Link goals to real accounts for automatic balance sync.' },
              { title: 'Linked Accounts', body: 'When linked to an account, the goal\'s "current saved" automatically reflects that account balance. "Available after bills" shows the realistic amount after subtracting scheduled outflows.' },
              { title: 'Target Date', body: 'Set a target date to see estimated completion. The chart projects growth based on your monthly contribution.' },
              { title: 'Vehicles', body: 'Tracking a car purchase? Use the Vehicles page for down payment goals and full loan amortization.' },
            ]} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Build your financial runway</p>
        </div>
        <div className="flex flex-col gap-2 w-full sm:w-auto sm:flex-row sm:shrink-0">
          {(isPremium || isDemo || goals.length < 3) ? (
            <button onClick={() => openAdd('Custom')} className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}><Plus size={12} /> Add Goal</button>
          ) : (
            <Link to="/premium" className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-primary/20 text-primary px-3 py-1.5 text-xs font-medium btn-press hover:bg-primary/30 transition-colors" style={{ borderRadius: 'var(--radius)' }}><Crown size={12} /> Add Goal</Link>
          )}
          <Link to="/vehicles" className="w-full sm:w-auto flex items-center justify-center gap-1.5 border border-border text-foreground px-3 py-1.5 text-xs font-medium btn-press hover:bg-muted/30" style={{ borderRadius: 'var(--radius)' }}><Car size={12} /> Vehicles</Link>
        </div>
      </div>

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-3">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-foreground">Savings goals — track every target in one place</p>
              <p className="text-xs text-muted-foreground mt-0.5">Jordan is building an emergency fund. Goals link to real accounts and auto-sync balances.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {[
              { label: 'Emergency Fund', desc: 'Linked to Marcus HYS — the $5,800 balance auto-syncs here. Monthly $300 contribution tracked against the $15,000 target.' },
              { label: 'Linked accounts', desc: 'When an account is linked, "current saved" always reflects the live balance — no manual updates needed.' },
              { label: 'Connects to Forecast', desc: 'Monthly contributions here are deducted in the Forecast before sizing debt payments — goals don\'t compete with the debt engine.' },
              { label: 'Vehicles', desc: 'Car goals have moved to the Vehicles page — save for a down payment, then track the full loan to payoff.' },
            ].map((f, i) => (
              <div key={i} className="flex gap-2 p-2.5 bg-secondary/40 text-xs" style={{ borderRadius: 'var(--radius)' }}>
                <span className="text-primary font-bold shrink-0">→</span>
                <div><span className="font-medium text-foreground">{f.label}: </span><span className="text-muted-foreground">{f.desc}</span></div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">All data is fictional.</p>
            <Link to="/auth" className="text-xs font-semibold text-primary hover:underline">Use with your own data →</Link>
          </div>
        </div>
      )}

      {carFunds.length > 0 && (
        <Link to="/vehicles" className="card-forged p-3 flex items-center gap-3 hover:border-primary/30 transition-colors">
          <Car size={16} className="text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold">You have {carFunds.length} vehicle{carFunds.length > 1 ? 's' : ''} tracked</p>
            <p className="text-xs text-muted-foreground">Car funds have moved to Vehicles — view saving progress &amp; loan details there →</p>
          </div>
        </Link>
      )}

      <SavingsGrowthChart goals={allGoals} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="card-forged p-4 text-center"><p className="text-xs text-muted-foreground uppercase">Total Saved</p><p className="text-lg font-display font-bold text-success">{formatCurrency(totalSaved, false)}</p></div>
        <div className="card-forged p-4 text-center"><p className="text-xs text-muted-foreground uppercase">Total Target</p><p className="text-lg font-display font-bold text-foreground">{formatCurrency(totalTarget, false)}</p></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {allGoals.map(g => {
          const pct = Number(g.target_amount) > 0 ? (Number(g.current_amount) / Number(g.target_amount)) * 100 : 0;
          const isLinked = !!(g as any).linked_account && accountMap[(g as any).linked_account];
          const linkedAcct = isLinked ? accountMap[(g as any).linked_account] : null;

          return (
            <div key={g.id} className="card-forged p-4 space-y-3 hover:border-primary/20 transition-colors">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <h3 className="text-sm font-semibold break-words">{g.name}</h3>
                    <span className="text-[9px] px-1.5 py-0.5 bg-muted/50 border border-border text-muted-foreground" style={{ borderRadius: 'var(--radius)' }}>{g.goal_type || 'Custom'}</span>
                    {isLinked && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-primary/10 border border-primary/20 text-primary flex items-center gap-1" style={{ borderRadius: 'var(--radius)' }}>
                        <Link2 size={8} /> {linkedAcct?.name}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground break-words leading-relaxed">
                    {(g as any).linked_rule
                      ? <span className="text-primary/80">{formatCurrency(Number(g.monthly_contribution), false)}/mo · via {(g as any).linked_rule.name}</span>
                      : `${formatCurrency(Number(g.monthly_contribution), false)}/mo contribution`
                    }
                    {isLinked && ' · Auto-synced from account'}
                    {(g as any).available_after_outflows != null && (
                      <span className="ml-1 text-muted-foreground">· Available after bills: {formatCurrency((g as any).available_after_outflows, false)}</span>
                    )}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0 self-end sm:self-auto">
                  <button onClick={() => handleDuplicate(g)} className="icon-btn text-muted-foreground hover:text-primary" title="Duplicate"><Copy size={13} /></button>
                  <button onClick={() => openEdit(g)} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
                  <button onClick={() => handleDelete(g.id)} className={`icon-btn ${deleteConfirm === g.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <span className="text-lg font-display font-bold text-primary break-words">{formatCurrency(Number(g.current_amount), false)}</span>
                <span className="text-xs text-muted-foreground">of {formatCurrency(Number(g.target_amount), false)}</span>
              </div>
              <ProgressBar value={Number(g.current_amount)} max={Number(g.target_amount)} color={pct >= 100 ? 'success' : 'gold'} />
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground">
                <span>{pct.toFixed(0)}% complete</span>
                <span>Est. completion: {estimateCompletion(g)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {allGoals.length === 0 && (
        <div className="card-forged p-12 text-center"><p className="text-sm text-muted-foreground">No savings goals yet.</p><p className="text-xs text-muted-foreground mt-1">Set a target. Build discipline.</p></div>
      )}

      {/* Planned Contributions */}
      {!isDemo && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Planned Contributions</h2>
              <p className="text-xs text-muted-foreground">One-time future transfers to savings, brokerage, or retirement</p>
            </div>
            <button onClick={openAddTransfer} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}>
              <Plus size={12} /> Add Transfer
            </button>
          </div>

          {Object.keys(rothByYear).length > 0 && (
            <div className="card-forged p-4 space-y-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Roth IRA Contribution Limit</p>
              {Object.entries(rothByYear).sort(([a], [b]) => Number(a) - Number(b)).map(([yearStr, total]) => {
                const year = Number(yearStr);
                const pct = Math.min((total / ROTH_IRA_LIMIT) * 100, 100);
                const over = total > ROTH_IRA_LIMIT;
                const warn = !over && pct >= 80;
                const barColor = over ? 'hsl(0, 84%, 60%)' : warn ? 'hsl(38, 92%, 50%)' : 'hsl(43, 56%, 52%)';
                return (
                  <div key={year} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-foreground font-medium">{year}</span>
                      <span className={over ? 'text-destructive font-semibold' : warn ? 'text-amber-400' : 'text-muted-foreground'}>
                        {formatCurrency(total, false)} / {formatCurrency(ROTH_IRA_LIMIT, false)}{over ? ' — over limit!' : ''}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-secondary overflow-hidden" style={{ borderRadius: 'var(--radius)' }}>
                      <div className="h-full transition-all duration-500 ease-out" style={{ width: `${pct}%`, background: barColor, borderRadius: 'var(--radius)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {(transfers as any[]).length > 0 ? (
            <div className="space-y-2">
              {[...(transfers as any[])].sort((a, b) => a.date.localeCompare(b.date)).map(t => (
                <div key={t.id} className="card-forged p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{formatCurrency(Number(t.amount), false)}</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-primary/10 border border-primary/20 text-primary" style={{ borderRadius: 'var(--radius)' }}>{DEST_LABELS[t.destination_type] || t.destination_type}</span>
                      {t.label && <span className="text-xs text-muted-foreground truncate">{t.label}</span>}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(t.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEditTransfer(t)} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={13} /></button>
                    <button onClick={() => handleDeleteTransfer(t.id)} className={`icon-btn ${deleteTransferConfirm === t.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-forged p-6 text-center">
              <p className="text-xs text-muted-foreground">No planned contributions yet.</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Schedule a one-time transfer to savings, brokerage, or Roth IRA.</p>
            </div>
          )}
        </div>
      )}

      {showTransferForm && (
        <FormModal
          title={editTransferId ? 'Edit Transfer' : 'Plan a Transfer'}
          fields={[
            { key: 'date', label: 'Transfer Date', type: 'date' },
            { key: 'amount', label: 'Amount', type: 'number', placeholder: '1000', step: '0.01' },
            { key: 'destination_type', label: 'Destination', type: 'select', options: [
              { value: 'savings', label: 'HYS / Savings' },
              { value: 'brokerage', label: 'Brokerage' },
              { value: 'roth_ira', label: `Roth IRA ($${ROTH_IRA_LIMIT.toLocaleString()}/yr limit)` },
            ]},
            { key: 'label', label: 'Label (optional)', type: 'text', placeholder: 'e.g., Tax refund to Roth' },
          ]}
          values={transferForm}
          onChange={(k, v) => setTransferForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSaveTransfer}
          onClose={() => setShowTransferForm(false)}
          saving={addTransfer.isPending || updateTransfer.isPending}
          saveLabel={editTransferId ? 'Update Transfer' : 'Plan Transfer'}
        />
      )}

      {showForm && (
        <FormModal
          title={editId ? 'Edit Goal' : 'New Savings Goal'}
          fields={formFields}
          values={form}
          onChange={(k, v) => setForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSave}
          onClose={() => setShowForm(false)}
          saving={add.isPending || update.isPending}
          saveLabel={editId ? 'Update Goal' : 'Add Goal'}
        />
      )}
    </div>
  );
}
