import { useState, useMemo, useEffect, useCallback } from 'react';
import type { Json, Tables } from '@/integrations/supabase/types';
import DateScrollPicker from '@/components/shared/DateScrollPicker';
import { usePersistedState } from '@/hooks/usePersistedState';
import { requestReviewAfterAction } from '@/hooks/useInAppReview';
import { Link } from 'react-router-dom';
import { PageSkeleton } from '@/components/shared/PageSkeleton';
import InstructionsModal from '@/components/shared/InstructionsModal';
import { formatCurrency, formatYAxisTick } from '@/lib/calculations';
import { useSavingsGoals, useCarFunds, useAccounts, useRecurringRules, useProfile, useTransactions, useDebts, type AccountRow } from '@/hooks/useSupabaseData';
import ProgressBar from '@/components/shared/ProgressBar';
import FormModal, { type Field } from '@/components/shared/FormModal';
import { useSubscription } from '@/hooks/useSubscription';
import { useDemo } from '@/contexts/DemoContext';
import { Plus, Edit2, Trash2, Car, Copy, Link2, Crown, X, Check } from 'lucide-react';
import * as DebtEngine from '@/lib/credit-card-engine';
import { mergeWithGeneratedTransactions, createDebtPaymentTransactions, mergeDebtPaymentsIntoStream, getAccountRemainingCashThisMonth } from '@/lib/pay-schedule';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { filterProfanity, LIMITS } from '@/lib/content-filter';
import { toast } from 'sonner';

const CHART_COLORS = ['hsl(43, 56%, 52%)', 'hsl(142, 50%, 40%)', 'hsl(200, 60%, 50%)', 'hsl(280, 50%, 50%)'];
const GOAL_TYPES = ['Emergency Fund', 'Vacation', 'Down Payment', 'Retirement', 'Custom'];
const ROTH_IRA_LIMIT = 7000;
const emptyForm = { name: '', target_amount: '', current_amount: '', monthly_contribution: '', target_date: '', goal_type: 'Custom', linked_account: '', contribution_start_date: '' };

// allGoals' shape: a real savings_goals row enriched with values computed from
// the linked account/rule (not DB columns themselves).
type LinkedRuleInfo = { name: string; amount: number; frequency: string; start_date: string | null };

type EnrichedGoal = Partial<Tables<'savings_goals'>> & {
  effective_apy: number;
  linked_rules: LinkedRuleInfo[];
  available_after_outflows: number | null;
};

type GoalLumpSum = { id: string; date: string; amount: number };

function GoalLumpSumModal({
  mode, initialDate, initialAmount, projectedBalanceAt, liquidCash, onSave, onClose,
}: {
  mode: 'add' | 'edit';
  initialDate: string;
  initialAmount: string;
  projectedBalanceAt: (date: string) => number;
  liquidCash: number;
  onSave: (date: string, amount: number) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [amount, setAmount] = useState(initialAmount);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const proj = date ? projectedBalanceAt(date) : null;
  const canSave = !!date && parseFloat(amount) > 0;

  const handleSave = () => {
    const amt = parseFloat(amount);
    if (!date || !amt || amt <= 0) return;
    onSave(date, amt);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4"
      style={{ touchAction: 'none', background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <div
        className="card-forged w-full sm:max-w-md flex flex-col rounded-t-[var(--radius)] rounded-b-none sm:rounded-b-[var(--radius)]"
        style={{ maxHeight: 'calc(88dvh - env(safe-area-inset-bottom))', paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 pt-5 sm:pt-6 pb-3 shrink-0">
          <h2 className="font-display font-semibold text-sm">{mode === 'add' ? 'Add Contribution' : 'Edit Contribution'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-3 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 space-y-4 pb-2 popup-scroll" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Date</p>
            <DateScrollPicker value={date} onChange={setDate} />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Amount</p>
            <input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full bg-secondary border border-border px-3 py-3 text-sm text-foreground"
              style={{ borderRadius: 'var(--radius)' }}
            />
          </div>
          {date && proj !== null && (
            <div className="flex flex-wrap gap-4 text-[10px] text-muted-foreground p-2.5 bg-secondary/30 border border-border/30" style={{ borderRadius: 'var(--radius)' }}>
              <span>Goal balance at date: <span className="text-foreground font-medium">{formatCurrency(proj, false)}</span></span>
              <span>Cash available: <span className="text-success font-medium">{formatCurrency(liquidCash, false)}</span></span>
            </div>
          )}
        </div>
        <div className="px-4 sm:px-6 pt-3 pb-5 sm:pb-6 shrink-0 border-t border-border mt-1">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full bg-primary text-primary-foreground py-3.5 text-sm font-semibold btn-press disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <Check size={14} />
            {mode === 'add' ? 'Add Contribution' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function GoalLumpSumPanel({
  lumpSums, onSave, liquidCash, currentAmount, monthlyContrib, isRothIra, apyRate = 0,
}: {
  lumpSums: GoalLumpSum[];
  onSave: (lumps: GoalLumpSum[]) => void;
  liquidCash: number;
  currentAmount: number;
  monthlyContrib: number;
  isRothIra?: boolean;
  apyRate?: number;
}) {
  const [modal, setModal] = useState<null | { mode: 'add' } | { mode: 'edit'; id: string; date: string; amount: string }>(null);

  const projectedBalanceAt = (dateStr: string) => {
    const today = new Date();
    const target = new Date(dateStr + 'T00:00:00');
    const months = Math.max(0, (target.getFullYear() - today.getFullYear()) * 12 + (target.getMonth() - today.getMonth()));
    const r = apyRate / 12 / 100;
    if (r <= 0 || months === 0) return currentAmount + monthlyContrib * months;
    return currentAmount * Math.pow(1 + r, months) + monthlyContrib * (Math.pow(1 + r, months) - 1) / r;
  };

  const rothByYear = useMemo(() => {
    if (!isRothIra) return {} as Record<number, number>;
    return lumpSums.reduce((acc, ls) => {
      const yr = parseInt(ls.date.substring(0, 4), 10);
      acc[yr] = (acc[yr] || 0) + ls.amount;
      return acc;
    }, {} as Record<number, number>);
  }, [lumpSums, isRothIra]);

  const handleModalSave = (date: string, amount: number) => {
    if (!modal) return;
    if (isRothIra) {
      const yr = parseInt(date.substring(0, 4), 10);
      let otherTotal: number;
      if (modal.mode === 'edit') {
        otherTotal = lumpSums.filter(ls => ls.id !== modal.id && ls.date.substring(0, 4) === String(yr)).reduce((s, ls) => s + ls.amount, 0);
      } else {
        otherTotal = rothByYear[yr] || 0;
      }
      if (otherTotal + amount > ROTH_IRA_LIMIT) {
        toast.error(`Exceeds $${ROTH_IRA_LIMIT.toLocaleString()} Roth IRA limit for ${yr}`);
        return;
      }
    }
    if (modal.mode === 'add') {
      onSave([...lumpSums, { id: crypto.randomUUID(), date, amount }]);
    } else {
      onSave(lumpSums.map(ls => ls.id === modal.id ? { ...ls, date, amount } : ls));
    }
    setModal(null);
  };

  const handleRemove = (id: string) => onSave(lumpSums.filter(ls => ls.id !== id));

  return (
    <div className="space-y-2 border-t border-border/30 pt-3 mt-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Planned Contributions</span>
        <button onClick={() => setModal({ mode: 'add' })} className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80">
          <Plus size={10} /> Add
        </button>
      </div>

      {isRothIra && Object.keys(rothByYear).length > 0 && (
        <div className="space-y-1.5 p-2 bg-secondary/30 border border-border/30" style={{ borderRadius: 'var(--radius)' }}>
          {Object.entries(rothByYear).sort(([a], [b]) => Number(a) - Number(b)).map(([yr, total]) => {
            const pct = Math.min((total / ROTH_IRA_LIMIT) * 100, 100);
            const over = total > ROTH_IRA_LIMIT;
            const warn = !over && pct >= 80;
            const barColor = over ? 'hsl(0, 84%, 60%)' : warn ? 'hsl(38, 92%, 50%)' : 'hsl(43, 56%, 52%)';
            return (
              <div key={yr}>
                <div className="flex justify-between text-[10px] mb-0.5">
                  <span className="text-muted-foreground">{yr} Roth IRA</span>
                  <span className={over ? 'text-destructive font-semibold' : warn ? 'text-amber-400' : 'text-muted-foreground'}>
                    {formatCurrency(total, false)} / {formatCurrency(ROTH_IRA_LIMIT, false)}{over ? ' ⚠ over!' : ''}
                  </span>
                </div>
                <div className="w-full h-1 bg-secondary overflow-hidden" style={{ borderRadius: 'var(--radius)' }}>
                  <div className="h-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor, borderRadius: 'var(--radius)' }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lumpSums.length === 0 && (
        <p className="text-[10px] text-muted-foreground">No planned contributions yet.</p>
      )}

      {lumpSums.length > 0 && (
        <div className="space-y-1">
          {[...lumpSums].sort((a, b) => a.date.localeCompare(b.date)).map(ls => {
            const dateLabel = new Date(ls.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            return (
              <div key={ls.id} className="flex items-center justify-between py-1 px-2 bg-secondary/20 border border-border/30" style={{ borderRadius: 'var(--radius)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium">{dateLabel}</span>
                  <span className="text-[10px] text-primary font-semibold">{formatCurrency(ls.amount, false)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setModal({ mode: 'edit', id: ls.id, date: ls.date, amount: String(ls.amount) })}
                    className="text-muted-foreground hover:text-foreground"><Edit2 size={11} /></button>
                  <button onClick={() => handleRemove(ls.id)} className="text-muted-foreground hover:text-destructive"><X size={11} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <GoalLumpSumModal
          key={modal.mode === 'edit' ? modal.id : 'add'}
          mode={modal.mode}
          initialDate={modal.mode === 'edit' ? modal.date : ''}
          initialAmount={modal.mode === 'edit' ? modal.amount : ''}
          projectedBalanceAt={projectedBalanceAt}
          liquidCash={liquidCash}
          onSave={handleModalSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

const toMonthly = (amount: number, freq: string) =>
  freq === 'weekly' ? amount * 52 / 12
  : freq === 'biweekly' ? amount * 26 / 12
  : freq === 'yearly' ? amount / 12
  : amount;

function SavingsGrowthChart({ goals }: { goals: EnrichedGoal[] }) {
  const chartData = useMemo(() => {
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const months: Record<string, string | number>[] = [];
    for (let i = 0; i < 12; i++) {
      const entry: Record<string, string | number> = { month: new Date(todayYear, todayMonth + i).toLocaleString('en', { month: 'short', year: '2-digit' }) };
      goals.forEach(g => {
        let monthsContributed = i;
        if (g.contribution_start_date) {
          const start = new Date(g.contribution_start_date + 'T00:00:00');
          const j = (start.getFullYear() - todayYear) * 12 + (start.getMonth() - todayMonth);
          if (j > 0) monthsContributed = Math.max(0, i - (j - 1));
        }
        const r = Number(g.effective_apy || 0) / 12 / 100;
        const pv = Number(g.current_amount);
        const pmt = Number(g.monthly_contribution);
        const n = monthsContributed;
        const fv = r > 0 && n > 0
          ? pv * Math.pow(1 + r, n) + pmt * (Math.pow(1 + r, n) - 1) / r
          : pv + pmt * n;
        entry[g.name ?? ''] = Math.min(fv, Number(g.target_amount));
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
          <YAxis tick={{ fontSize: 11, fill: 'hsl(240, 4%, 46%)' }} axisLine={false} tickLine={false} tickFormatter={formatYAxisTick} />
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
  const { isPremium } = useSubscription();
  const { isDemo } = useDemo();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const cashFloor = profile?.cash_floor != null ? Number(profile.cash_floor) : 1000;
  const [pauseSavings] = usePersistedState<boolean>('tre:debtpayoff:pause-savings', false);

  const liquidCash = useMemo(() =>
    accounts
      .filter(a => a.active && ['checking', 'business_checking', 'cash'].includes(a.account_type))
      .reduce((s, a) => s + Number(a.balance), 0),
    [accounts]
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
    const savingsTotal = goals.reduce((s, g) => {
      if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > now) return s;
      if (g.linked_account && retireIds.has(g.linked_account)) return s;
      if (g.linked_account && activeTransferDests.has(g.linked_account)) return s;
      return s + Number(g.monthly_contribution);
    }, 0);
    const carTotal = carFunds.reduce((s, c) => {
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
    const fundId = profile?.default_deposit_account ||
      accounts.find(a => a.account_type === 'checking' && a.active)?.id || null;
    return createDebtPaymentTransactions(debtRecs, fundId);
  }, [debtRecs, profile, accounts]);
  const allTxns = useMemo(() => mergeDebtPaymentsIntoStream(baseTxns, debtTxns), [baseTxns, debtTxns]);

  const accountMap = useMemo(() => {
    const map: Record<string, AccountRow> = {};
    accounts.forEach(a => { map[a.id] = a; });
    return map;
  }, [accounts]);

  const getLinkedAmount = useCallback((accountId: string) => {
    const acct = accountMap[accountId];
    if (!acct) return 0;
    return getAccountRemainingCashThisMonth(accountId, acct.account_type, allTxns, Number(acct.balance), cashFloor);
  }, [accountMap, allTxns, cashFloor]);

  const allGoals: EnrichedGoal[] = useMemo(() => {
    return goals.map(g => {
      // Support multiple linked rules; fall back to legacy single linked_rule_id
      const ruleIds: string[] = (g.linked_rule_ids ?? []).length > 0
        ? (g.linked_rule_ids ?? [])
        : g.linked_rule_id ? [g.linked_rule_id] : [];
      const linkedRules: LinkedRuleInfo[] = ruleIds
        .map(id => rules.find(r => r.id === id))
        .filter((r): r is NonNullable<typeof r> => r != null)
        .map(r => ({ name: r.name, amount: r.amount, frequency: r.frequency, start_date: r.start_date ?? null }));
      const linkedAcct = g.linked_account ? accountMap[g.linked_account] : null;
      const rawRate = Number(linkedAcct?.apy_rate ?? linkedAcct?.apr ?? 0);
      const typeDefault = (['savings', 'high_yield_savings'].includes(linkedAcct?.account_type ?? '') ? 4.5
        : ['brokerage', 'roth_ira', '401k', 'ira', 'hsa'].includes(linkedAcct?.account_type ?? '') ? 7 : 0);
      const effective_apy = rawRate > 0 ? rawRate : typeDefault;
      const linkedMonthly = linkedRules.reduce((s, r) => s + toMonthly(r.amount, r.frequency), 0);
      const earliestStart = linkedRules
        .map(r => r.start_date)
        .filter((d): d is string => d != null)
        .sort()[0] ?? null;
      return {
        ...g,
        goal_type: g.goal_type || 'Custom',
        current_amount: g.linked_account && accountMap[g.linked_account]
          ? Number(accountMap[g.linked_account].balance)
          : Number(g.current_amount),
        available_after_outflows: g.linked_account && accountMap[g.linked_account]
          ? getLinkedAmount(g.linked_account)
          : null,
        monthly_contribution: linkedRules.length > 0
          ? linkedMonthly
          : Number(g.monthly_contribution),
        contribution_start_date: earliestStart ?? g.contribution_start_date ?? null,
        linked_rules: linkedRules,
        effective_apy,
      };
    });
  }, [goals, accountMap, rules, getLinkedAmount]);

  const totalSaved = allGoals.reduce((s, g) => s + Number(g.current_amount), 0);
  const totalTarget = allGoals.reduce((s, g) => s + Number(g.target_amount), 0);

  const accountOptions = useMemo(() => [
    { value: '', label: 'None (Manual)' },
    ...accounts.filter(a => a.active).map(a => ({ value: a.id, label: `${a.name} (${a.account_type.replace(/_/g, ' ')})` })),
  ], [accounts]);

  const transferRuleOptions = useMemo(() => [
    { value: '', label: 'None (manual)' },
    ...rules
      .filter(r => (r.rule_type === 'transfer' || r.rule_type === 'investment') && r.active)
      .map(r => ({ value: r.id, label: `${r.name} — ${formatCurrency(r.amount, false)}/${r.frequency}` })),
  ], [rules]);

  const openAdd = (goalType = 'Custom') => {
    setForm({ ...emptyForm, goal_type: goalType });
    setSelectedRuleIds([]);
    setEditId(null); setShowForm(true);
  };

  const openEdit = (g: EnrichedGoal) => {
    setForm({
      name: g.name ?? '', target_amount: String(g.target_amount), current_amount: String(g.current_amount),
      monthly_contribution: String(g.monthly_contribution), target_date: g.target_date || '',
      goal_type: g.goal_type || 'Custom', linked_account: g.linked_account || '',
      contribution_start_date: g.contribution_start_date || '',
    });
    // Populate from linked_rule_ids, falling back to legacy single linked_rule_id
    const ids = (g.linked_rule_ids ?? []).length > 0
      ? (g.linked_rule_ids ?? [])
      : g.linked_rule_id ? [g.linked_rule_id] : [];
    setSelectedRuleIds(ids);
    setEditId(g.id ?? null); setShowForm(true);
  };

  const handleDuplicate = (g: EnrichedGoal) => {
    setForm({
      name: `${g.name} (Copy)`, target_amount: String(g.target_amount), current_amount: '0',
      monthly_contribution: String(g.monthly_contribution), target_date: g.target_date || '',
      goal_type: g.goal_type || 'Custom', linked_account: g.linked_account || '',
      contribution_start_date: g.contribution_start_date || '',
    });
    const ids = (g.linked_rule_ids ?? []).length > 0
      ? (g.linked_rule_ids ?? [])
      : g.linked_rule_id ? [g.linked_rule_id] : [];
    setSelectedRuleIds(ids);
    setEditId(null); setShowForm(true);
    toast.info('Goal duplicated — edit and save');
  };

  const handleSave = () => {
    const target_amount = parseFloat(form.target_amount);
    if (!form.name || isNaN(target_amount)) return;
    const { clean: cleanName, flagged: nameFlagged } = filterProfanity(form.name.trim().slice(0, LIMITS.goalName));
    if (nameFlagged) toast.warning('Goal name contained inappropriate language and was cleaned.');
    const payload: Partial<Tables<'savings_goals'>> & {
      name: string; target_amount: number; current_amount: number; monthly_contribution: number;
    } = {
      name: cleanName, target_amount, current_amount: parseFloat(form.current_amount) || 0,
      monthly_contribution: parseFloat(form.monthly_contribution) || 0,
      target_date: form.target_date || null,
      linked_account: form.linked_account || null,
      goal_type: form.goal_type || 'Custom',
      contribution_start_date: form.contribution_start_date || null,
      linked_rule_ids: selectedRuleIds,
      linked_rule_id: selectedRuleIds.length === 1 ? selectedRuleIds[0] : null,
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

  const handleSaveLumpSums = (goalId: string, lumps: GoalLumpSum[]) => {
    update.mutate({ id: goalId, lump_sum_payments: lumps as unknown as Json });
  };

  function estimateCompletion(g: EnrichedGoal): string {
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
    const fields: Field[] = [
      { key: 'name', label: 'Goal Name', type: 'text', placeholder: 'e.g., Emergency Fund' },
      { key: 'goal_type', label: 'Goal Type', type: 'select', options: GOAL_TYPES.map(t => ({ value: t, label: t })) },
      { key: 'linked_account', label: 'Linked Account (auto-pull balance)', type: 'select', options: accountOptions },
      { key: 'target_amount', label: 'Target Amount', type: 'number', placeholder: '10000', step: '0.01' },
    ];
    if (!form.linked_account) {
      fields.push({ key: 'current_amount', label: 'Current Saved', type: 'number', placeholder: '0', step: '0.01' });
    }
    if (selectedRuleIds.length === 0) {
      fields.push({ key: 'monthly_contribution', label: 'Monthly Contribution', type: 'number', placeholder: '500', step: '0.01' });
      fields.push({ key: 'contribution_start_date', label: 'Contributions Start (optional)', type: 'date' });
    }
    fields.push({ key: 'target_date', label: 'Target Date', type: 'date' });
    return fields;
  }, [form.linked_account, selectedRuleIds.length, accountOptions]);

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
          const isLinked = !!g.linked_account && accountMap[g.linked_account];
          const linkedAcct = isLinked ? accountMap[g.linked_account!] : null;
          const linkedAccountType = linkedAcct?.account_type ?? '';
          const isRothIra = ['roth_ira', 'ira', '401k', 'hsa'].includes(linkedAccountType) || (g.goal_type || '').toLowerCase() === 'retirement';
          const goalLumps: GoalLumpSum[] = Array.isArray(g.lump_sum_payments) ? (g.lump_sum_payments as unknown as GoalLumpSum[]) : [];

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
                    {g.linked_rules && g.linked_rules.length > 0
                      ? <span className="text-primary/80">{formatCurrency(Number(g.monthly_contribution), false)}/mo · via {g.linked_rules.map(r => r.name).join(', ')}</span>
                      : `${formatCurrency(Number(g.monthly_contribution), false)}/mo contribution`
                    }
                    {isLinked && ' · Auto-synced from account'}
                    {g.available_after_outflows != null && (
                      <span className="ml-1 text-muted-foreground">· Available after bills: {formatCurrency(g.available_after_outflows, false)}</span>
                    )}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0 self-end sm:self-auto">
                  <button onClick={() => handleDuplicate(g)} className="icon-btn text-muted-foreground hover:text-primary" title="Duplicate"><Copy size={13} /></button>
                  <button onClick={() => openEdit(g)} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
                  <button onClick={() => handleDelete(g.id!)} className={`icon-btn ${deleteConfirm === g.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
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
              {!isDemo && (
                <GoalLumpSumPanel
                  lumpSums={goalLumps}
                  onSave={lumps => handleSaveLumpSums(g.id!, lumps)}
                  liquidCash={liquidCash}
                  currentAmount={Number(g.current_amount)}
                  monthlyContrib={Number(g.monthly_contribution)}
                  isRothIra={isRothIra}
                  apyRate={g.effective_apy || 0}
                />
              )}
            </div>
          );
        })}
      </div>

      {allGoals.length === 0 && (
        <div className="card-forged p-12 text-center"><p className="text-sm text-muted-foreground">No savings goals yet.</p><p className="text-xs text-muted-foreground mt-1">Set a target. Build discipline.</p></div>
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
        >
          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Transfer Rules (auto-sync contributions)</label>
            {transferRuleOptions.filter(o => o.value).length === 0 ? (
              <p className="text-xs text-muted-foreground">No active transfer or investment rules found.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {transferRuleOptions.filter(o => o.value).map(o => {
                  const active = selectedRuleIds.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setSelectedRuleIds(prev =>
                        active ? prev.filter(id => id !== o.value) : [...prev, o.value]
                      )}
                      className={`px-3 py-1.5 text-xs border transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-muted-foreground border-border hover:text-foreground'}`}
                      style={{ borderRadius: 'var(--radius)' }}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            )}
            {selectedRuleIds.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                Total: {formatCurrency(
                  selectedRuleIds.reduce((s, id) => {
                    const r = rules.find(r => r.id === id);
                    return r ? s + toMonthly(r.amount, r.frequency) : s;
                  }, 0),
                  false
                )}/mo · Monthly contribution and start date auto-synced from rules
              </p>
            )}
          </div>
        </FormModal>
      )}
    </div>
  );
}
