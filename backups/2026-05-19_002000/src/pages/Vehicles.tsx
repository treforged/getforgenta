import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PageSkeleton } from '@/components/shared/PageSkeleton';
import InstructionsModal from '@/components/shared/InstructionsModal';
import FormModal from '@/components/shared/FormModal';
import ProgressBar from '@/components/shared/ProgressBar';
import { formatCurrency, calculateMonthlyPayment } from '@/lib/calculations';
import { buildAmortizationSchedule, getActiveCarLoanPayments } from '@/lib/vehicle-loan-engine';
import { useCarFunds, useAccounts } from '@/hooks/useSupabaseData';
import { useSubscription } from '@/hooks/useSubscription';
import { useDemo } from '@/contexts/DemoContext';
import { Plus, Edit2, Trash2, Car, Crown, TrendingDown, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { CarFund } from '@/lib/types';

const emptySavingForm = {
  vehicle_name: '', target_price: '', tax_fees: '', down_payment_goal: '', current_saved: '',
  monthly_insurance: '', expected_apr: '', loan_term_months: '60',
};

const emptyLoanForm = {
  vehicle_name: '', loan_amount: '', expected_apr: '', loan_term_months: '60',
  loan_start_date: '', payment_start_date: '', interest_start_date: '', actual_monthly_payment: '',
  monthly_insurance: '',
};

function estimateSavingCompletion(downGoal: number, saved: number, monthly: number): string {
  const rem = downGoal - saved;
  if (rem <= 0) return 'Reached';
  if (monthly <= 0) return 'Set contribution';
  const months = Math.ceil(rem / monthly);
  const dt = new Date();
  dt.setMonth(dt.getMonth() + months);
  return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function SavingCard({ cf, onEdit, onDelete, onBuyIt, deleteConfirm }:
  { cf: CarFund; onEdit: () => void; onDelete: () => void; onBuyIt: () => void; deleteConfirm: boolean }) {
  const pct = cf.down_payment_goal > 0 ? (cf.current_saved / cf.down_payment_goal) * 100 : 0;
  const monthlyEst = calculateMonthlyPayment(
    cf.target_price + cf.tax_fees - cf.down_payment_goal,
    cf.expected_apr,
    cf.loan_term_months,
  );
  return (
    <div className="card-forged p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Car size={16} className="text-primary shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{cf.vehicle_name}</h3>
            <p className="text-xs text-muted-foreground">Saving for down payment</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <button onClick={onEdit} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
          <button onClick={onDelete} className={`icon-btn ${deleteConfirm ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
        </div>
      </div>

      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">Down payment progress</span>
          <span className="font-medium">{formatCurrency(cf.current_saved, false)} / {formatCurrency(cf.down_payment_goal, false)}</span>
        </div>
        <ProgressBar value={Math.min(pct, 100)} max={100} />
        <p className="text-[10px] text-muted-foreground mt-1">{Math.round(pct)}% · Est. ready {estimateSavingCompletion(cf.down_payment_goal, cf.current_saved, 0)}</p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-secondary/40 p-2" style={{ borderRadius: 'var(--radius)' }}>
          <p className="text-[10px] text-muted-foreground">Target Price</p>
          <p className="text-xs font-semibold">{formatCurrency(cf.target_price, false)}</p>
        </div>
        <div className="bg-secondary/40 p-2" style={{ borderRadius: 'var(--radius)' }}>
          <p className="text-[10px] text-muted-foreground">Est. Monthly Pmt</p>
          <p className="text-xs font-semibold text-primary">{formatCurrency(monthlyEst, false)}</p>
        </div>
        <div className="bg-secondary/40 p-2" style={{ borderRadius: 'var(--radius)' }}>
          <p className="text-[10px] text-muted-foreground">Insurance/mo</p>
          <p className="text-xs font-semibold">{formatCurrency(cf.monthly_insurance, false)}</p>
        </div>
      </div>

      <button
        onClick={onBuyIt}
        className="w-full flex items-center justify-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 text-xs font-medium btn-press"
        style={{ borderRadius: 'var(--radius)' }}
      >
        <Car size={12} /> I bought it — start loan tracking
      </button>
    </div>
  );
}

function LoanCard({ cf, onEdit, onDelete, deleteConfirm }:
  { cf: CarFund; onEdit: () => void; onDelete: () => void; deleteConfirm: boolean }) {
  const proj = useMemo(() => {
    if (!cf.payment_start_date || !cf.loan_start_date) return null;
    return buildAmortizationSchedule({
      loanAmount: cf.loan_amount,
      apr: cf.expected_apr,
      termMonths: cf.loan_term_months,
      loanStartDate: cf.loan_start_date,
      paymentStartDate: cf.payment_start_date,
      interestStartDate: cf.interest_start_date ?? cf.payment_start_date,
      actualMonthlyPayment: cf.actual_monthly_payment,
    });
  }, [cf]);

  const [showSchedule, setShowSchedule] = useState(false);

  if (!proj) return null;

  const pct = cf.loan_amount > 0 ? ((cf.loan_amount - proj.remainingBalance) / cf.loan_amount) * 100 : 0;

  const chartData = proj.schedule
    .filter((_, i) => i % 3 === 0 || i === proj.schedule.length - 1)
    .map(r => ({ month: r.month, balance: r.endBalance }));

  const payoffDateFmt = new Date(proj.payoffDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  return (
    <div className="card-forged p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Car size={16} className="text-success shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{cf.vehicle_name}</h3>
            <p className="text-xs text-muted-foreground">{cf.expected_apr}% APR · {cf.loan_term_months} mo</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <span className="text-[10px] bg-success/15 text-success px-1.5 py-0.5 font-medium" style={{ borderRadius: 'var(--radius)' }}>Active Loan</span>
          <button onClick={onEdit} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
          <button onClick={onDelete} className={`icon-btn ${deleteConfirm ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
        </div>
      </div>

      {proj.isDeferredInterest && proj.monthsElapsed === 0 && (
        <div className="flex items-center gap-2 p-2 bg-amber-400/10 border border-amber-400/20 text-xs text-amber-400" style={{ borderRadius: 'var(--radius)' }}>
          <AlertTriangle size={12} />
          <span>Deferred interest until {new Date((cf.interest_start_date ?? '') + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
        </div>
      )}

      {proj.isNegativeAmortization && (
        <div className="flex items-center gap-2 p-2 bg-destructive/10 border border-destructive/20 text-xs text-destructive" style={{ borderRadius: 'var(--radius)' }}>
          <AlertTriangle size={12} />
          <span>Payment is below interest-only — balance is growing. Consider raising to {formatCurrency(proj.scheduledPayment, false)}/mo.</span>
        </div>
      )}

      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">Loan payoff progress</span>
          <span className="font-medium">{formatCurrency(proj.remainingBalance, false)} remaining</span>
        </div>
        <ProgressBar value={Math.min(pct, 100)} max={100} />
        <p className="text-[10px] text-muted-foreground mt-1">{Math.round(pct)}% paid · {proj.monthsElapsed} of {proj.schedule.length} payments made</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <div className="bg-secondary/40 p-2" style={{ borderRadius: 'var(--radius)' }}>
          <p className="text-[10px] text-muted-foreground">Monthly Payment</p>
          <p className="text-xs font-semibold text-primary">{formatCurrency(proj.effectivePayment, false)}</p>
        </div>
        <div className="bg-secondary/40 p-2" style={{ borderRadius: 'var(--radius)' }}>
          <p className="text-[10px] text-muted-foreground">Payoff Date</p>
          <p className="text-xs font-semibold">{payoffDateFmt}</p>
        </div>
        <div className="bg-secondary/40 p-2" style={{ borderRadius: 'var(--radius)' }}>
          <p className="text-[10px] text-muted-foreground">Interest Paid</p>
          <p className="text-xs font-semibold text-destructive">{formatCurrency(proj.interestPaidToDate, false)}</p>
        </div>
        <div className="bg-secondary/40 p-2" style={{ borderRadius: 'var(--radius)' }}>
          <p className="text-[10px] text-muted-foreground">Total Interest</p>
          <p className="text-xs font-semibold text-muted-foreground">{formatCurrency(proj.totalInterest, false)}</p>
        </div>
      </div>

      {chartData.length > 1 && (
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={chartData} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,15%)" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(240,4%,46%)' }} axisLine={false} tickLine={false} label={{ value: 'Payment #', position: 'insideBottom', offset: -2, fontSize: 10, fill: 'hsl(240,4%,46%)' }} />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(240,4%,46%)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip contentStyle={{ background: 'hsl(0,0%,8%)', border: '1px solid hsl(0,0%,15%)', borderRadius: 'var(--radius)', fontSize: 11 }} formatter={(v: number) => [formatCurrency(v, false), 'Remaining']} />
            <Line dataKey="balance" stroke="hsl(43,56%,52%)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}

      <button
        onClick={() => setShowSchedule(v => !v)}
        className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
      >
        {showSchedule ? 'Hide' : 'Show'} full amortization schedule
      </button>

      {showSchedule && (
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-background">
              <tr className="text-muted-foreground">
                <th className="text-left py-1 px-1">#</th>
                <th className="text-right py-1 px-1">Payment</th>
                <th className="text-right py-1 px-1">Principal</th>
                <th className="text-right py-1 px-1">Interest</th>
                <th className="text-right py-1 px-1">Balance</th>
              </tr>
            </thead>
            <tbody>
              {proj.schedule.map(r => (
                <tr key={r.month} className={`border-t border-border/20 ${r.month === proj.monthsElapsed ? 'bg-primary/5' : ''}`}>
                  <td className="py-1 px-1 text-muted-foreground">{r.month}</td>
                  <td className="py-1 px-1 text-right">{formatCurrency(r.payment, false)}</td>
                  <td className="py-1 px-1 text-right text-success">{formatCurrency(r.principal, false)}</td>
                  <td className="py-1 px-1 text-right text-destructive">{r.deferred ? '—' : formatCurrency(r.interest, false)}</td>
                  <td className="py-1 px-1 text-right font-medium">{formatCurrency(r.endBalance, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BuyItDialog({ cf, onConfirm, onClose }:
  { cf: CarFund; onConfirm: (fields: Partial<CarFund>) => void; onClose: () => void }) {
  const today = new Date().toISOString().split('T')[0];
  const nextMonth = new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().split('T')[0];
  const loanAmountDefault = Math.max(0, cf.target_price + cf.tax_fees - cf.down_payment_goal);
  const [form, setForm] = useState({
    loan_amount: String(loanAmountDefault),
    expected_apr: String(cf.expected_apr),
    loan_term_months: String(cf.loan_term_months),
    loan_start_date: today,
    payment_start_date: nextMonth,
    interest_start_date: nextMonth,
    actual_monthly_payment: '',
  });

  const scheduledPmt = useMemo(() => {
    const amt = parseFloat(form.loan_amount) || 0;
    const apr = parseFloat(form.expected_apr) || 0;
    const term = parseInt(form.loan_term_months) || 60;
    return calculateMonthlyPayment(amt, apr, term);
  }, [form.loan_amount, form.expected_apr, form.loan_term_months]);

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const handleConfirm = () => {
    const loan_amount = parseFloat(form.loan_amount);
    if (!loan_amount || !form.payment_start_date) return;
    if (form.interest_start_date < form.loan_start_date) {
      toast.error('Interest start date cannot be before loan start date');
      return;
    }
    onConfirm({
      phase: 'loan',
      loan_amount,
      expected_apr: parseFloat(form.expected_apr) || cf.expected_apr,
      loan_term_months: parseInt(form.loan_term_months) || cf.loan_term_months,
      loan_start_date: form.loan_start_date,
      payment_start_date: form.payment_start_date,
      interest_start_date: form.interest_start_date || form.payment_start_date,
      actual_monthly_payment: parseFloat(form.actual_monthly_payment) || 0,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }} onClick={onClose}>
      <div className="bg-background border border-border p-5 w-full max-w-sm space-y-4" style={{ borderRadius: 'var(--radius)' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-semibold">Start Loan Tracking — {cf.vehicle_name}</h2>
        <p className="text-xs text-muted-foreground">Enter your actual loan details. Payments will flow into Forecast and Debt Payoff.</p>

        {[
          { k: 'loan_amount', label: 'Loan Amount', type: 'number', placeholder: String(loanAmountDefault) },
          { k: 'expected_apr', label: 'APR %', type: 'number', placeholder: '5.9' },
          { k: 'loan_term_months', label: 'Term (months)', type: 'number', placeholder: '60' },
          { k: 'loan_start_date', label: 'Loan Start Date', type: 'date' },
          { k: 'payment_start_date', label: 'First Payment Date', type: 'date' },
          { k: 'interest_start_date', label: 'Interest Start Date', type: 'date' },
        ].map(field => (
          <div key={field.k}>
            <label className="text-xs font-medium text-muted-foreground block mb-1">{field.label}</label>
            <input
              type={field.type}
              value={(form as any)[field.k]}
              onChange={f(field.k)}
              placeholder={field.placeholder ?? ''}
              className="w-full bg-secondary border border-border px-3 py-1.5 text-xs"
              style={{ borderRadius: 'var(--radius)' }}
            />
          </div>
        ))}

        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Monthly Payment Override <span className="text-muted-foreground/60">(leave blank to use {formatCurrency(scheduledPmt, false)}/mo)</span>
          </label>
          <input
            type="number"
            value={form.actual_monthly_payment}
            onChange={f('actual_monthly_payment')}
            placeholder={formatCurrency(scheduledPmt, false)}
            className="w-full bg-secondary border border-border px-3 py-1.5 text-xs"
            style={{ borderRadius: 'var(--radius)' }}
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 border border-border text-xs py-2 btn-press hover:bg-muted/20" style={{ borderRadius: 'var(--radius)' }}>Cancel</button>
          <button onClick={handleConfirm} className="flex-1 bg-primary text-primary-foreground text-xs py-2 btn-press" style={{ borderRadius: 'var(--radius)' }}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

export default function Vehicles() {
  const { data: carFunds, add, update, remove, loading } = useCarFunds();
  const { data: accounts } = useAccounts();
  const { isPremium } = useSubscription();
  const { isDemo } = useDemo();

  const [activeTab, setActiveTab] = useState<'saving' | 'loan'>('saving');
  const [showSavingForm, setShowSavingForm] = useState(false);
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [buyItFor, setBuyItFor] = useState<CarFund | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [savingForm, setSavingForm] = useState(emptySavingForm);
  const [loanForm, setLoanForm] = useState(emptyLoanForm);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const savingVehicles = useMemo(() => carFunds.filter((c: any) => (c.phase ?? 'saving') === 'saving'), [carFunds]);
  const loanVehicles = useMemo(() => carFunds.filter((c: any) => c.phase === 'loan'), [carFunds]);

  const activeLoans = useMemo(() => getActiveCarLoanPayments(carFunds as CarFund[]), [carFunds]);
  const totalMonthlyLoanPayments = activeLoans.reduce((s, l) => s + l.payment, 0);

  const openAddSaving = () => { setSavingForm(emptySavingForm); setEditId(null); setShowSavingForm(true); };
  const openAddLoan = () => { setLoanForm(emptyLoanForm); setEditId(null); setShowLoanForm(true); };

  const openEditSaving = (cf: CarFund) => {
    setSavingForm({
      vehicle_name: cf.vehicle_name, target_price: String(cf.target_price),
      tax_fees: String(cf.tax_fees), down_payment_goal: String(cf.down_payment_goal),
      current_saved: String(cf.current_saved), monthly_insurance: String(cf.monthly_insurance),
      expected_apr: String(cf.expected_apr), loan_term_months: String(cf.loan_term_months),
    });
    setEditId(cf.id); setShowSavingForm(true);
  };

  const openEditLoan = (cf: CarFund) => {
    setLoanForm({
      vehicle_name: cf.vehicle_name, loan_amount: String(cf.loan_amount),
      expected_apr: String(cf.expected_apr), loan_term_months: String(cf.loan_term_months),
      loan_start_date: cf.loan_start_date ?? '', payment_start_date: cf.payment_start_date ?? '',
      interest_start_date: cf.interest_start_date ?? '', actual_monthly_payment: String(cf.actual_monthly_payment || ''),
      monthly_insurance: String(cf.monthly_insurance),
    });
    setEditId(cf.id); setShowLoanForm(true);
  };

  const handleSaveSaving = () => {
    if (!savingForm.vehicle_name) return;
    const payload = {
      vehicle_name: savingForm.vehicle_name,
      target_price: parseFloat(savingForm.target_price) || 0,
      tax_fees: parseFloat(savingForm.tax_fees) || 0,
      down_payment_goal: parseFloat(savingForm.down_payment_goal) || 0,
      current_saved: parseFloat(savingForm.current_saved) || 0,
      monthly_insurance: parseFloat(savingForm.monthly_insurance) || 0,
      expected_apr: parseFloat(savingForm.expected_apr) || 0,
      loan_term_months: parseInt(savingForm.loan_term_months) || 60,
      phase: 'saving' as const,
      loan_amount: 0, loan_start_date: null, payment_start_date: null,
      interest_start_date: null, actual_monthly_payment: 0,
    };
    if (editId) update.mutate({ id: editId, ...payload });
    else add.mutate(payload);
    setShowSavingForm(false);
  };

  const handleSaveLoan = () => {
    if (!loanForm.vehicle_name || !loanForm.payment_start_date) return;
    const payload = {
      vehicle_name: loanForm.vehicle_name,
      loan_amount: parseFloat(loanForm.loan_amount) || 0,
      expected_apr: parseFloat(loanForm.expected_apr) || 0,
      loan_term_months: parseInt(loanForm.loan_term_months) || 60,
      loan_start_date: loanForm.loan_start_date || null,
      payment_start_date: loanForm.payment_start_date || null,
      interest_start_date: loanForm.interest_start_date || loanForm.payment_start_date || null,
      actual_monthly_payment: parseFloat(loanForm.actual_monthly_payment) || 0,
      monthly_insurance: parseFloat(loanForm.monthly_insurance) || 0,
      phase: 'loan' as const,
      target_price: 0, tax_fees: 0, down_payment_goal: 0, current_saved: 0,
    };
    if (editId) update.mutate({ id: editId, ...payload });
    else add.mutate(payload);
    setShowLoanForm(false);
  };

  const handleBuyIt = (updates: Partial<CarFund>) => {
    if (!buyItFor) return;
    update.mutate({ id: buyItFor.id, ...updates });
    setBuyItFor(null);
    setActiveTab('loan');
    toast.success('Loan tracking started');
  };

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) { remove.mutate(id); setDeleteConfirm(null); }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto space-y-5 overflow-x-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Vehicles</h1>
            <InstructionsModal pageTitle="Vehicles Guide" sections={[
              { title: 'Two phases', body: 'Saving phase: track your down payment goal and preview loan costs. Loan phase: activated when you buy — enter your actual loan terms and track the full amortization until payoff.' },
              { title: 'I bought it', body: 'Hit "I bought it" on a saving-phase card to enter your real loan amount, APR, start date, first payment date, and interest start date. The scheduled monthly payment is pre-filled.' },
              { title: 'Deferred interest', body: 'If your dealer offers deferred interest (e.g. 90 days same as cash), set interest_start_date to when it actually starts. Interest is zero until that date.' },
              { title: 'Connects to Forecast', body: 'Active loan payments appear as "Car Loan Payments" in the Forecast row drawer — separate from credit card debt payments.' },
              { title: 'Connects to Debt Payoff', body: 'Active loans appear under the Auto Loans tab in Debt Payoff for a full picture of all fixed obligations.' },
            ]} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Track every vehicle from saving to payoff</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {(isPremium || isDemo || carFunds.length < 3) ? (
            <>
              {activeTab === 'saving' && (
                <button onClick={openAddSaving} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}>
                  <Plus size={12} /> Add Vehicle Goal
                </button>
              )}
              {activeTab === 'loan' && (
                <button onClick={openAddLoan} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}>
                  <Plus size={12} /> Add Loan
                </button>
              )}
            </>
          ) : (
            <Link to="/premium" className="flex items-center gap-1.5 bg-primary/20 text-primary px-3 py-1.5 text-xs font-medium btn-press" style={{ borderRadius: 'var(--radius)' }}>
              <Crown size={12} /> Upgrade
            </Link>
          )}
        </div>
      </div>

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-3">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-foreground">Vehicles — save for the down payment, then track the loan to payoff</p>
              <p className="text-xs text-muted-foreground mt-0.5">Jordan is saving for a Honda Civic while tracking a RAV4 they already bought. The RAV4 loan feeds into Forecast and Debt Payoff automatically.</p>
            </div>
          </div>
          <div className="mt-2 flex justify-end">
            <Link to="/auth" className="text-xs font-semibold text-primary hover:underline">Use with your own data →</Link>
          </div>
        </div>
      )}

      {loanVehicles.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="card-forged p-4 text-center">
            <p className="text-xs text-muted-foreground uppercase">Active Loan Payments / mo</p>
            <p className="text-lg font-display font-bold text-primary">{formatCurrency(totalMonthlyLoanPayments, false)}</p>
          </div>
          <div className="card-forged p-4 text-center">
            <p className="text-xs text-muted-foreground uppercase">Active Loans</p>
            <p className="text-lg font-display font-bold text-foreground">{loanVehicles.length}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <button onClick={() => setActiveTab('saving')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border btn-press ${activeTab === 'saving' ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <Car size={13} /> Saving for Down Payment
          {savingVehicles.length > 0 && <span className="ml-1 bg-primary/20 text-primary px-1.5 py-0.5 text-[10px]" style={{ borderRadius: 'var(--radius)' }}>{savingVehicles.length}</span>}
        </button>
        <button onClick={() => setActiveTab('loan')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border btn-press ${activeTab === 'loan' ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <TrendingDown size={13} /> Active Loans
          {loanVehicles.length > 0 && <span className="ml-1 bg-primary/20 text-primary px-1.5 py-0.5 text-[10px]" style={{ borderRadius: 'var(--radius)' }}>{loanVehicles.length}</span>}
        </button>
      </div>

      {activeTab === 'saving' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {savingVehicles.map((cf: any) => (
            <SavingCard
              key={cf.id}
              cf={cf}
              onEdit={() => openEditSaving(cf)}
              onDelete={() => handleDelete(cf.id)}
              onBuyIt={() => setBuyItFor(cf)}
              deleteConfirm={deleteConfirm === cf.id}
            />
          ))}
          {savingVehicles.length === 0 && (
            <div className="card-forged p-12 text-center col-span-2">
              <p className="text-sm text-muted-foreground">No vehicle goals yet.</p>
              <button onClick={openAddSaving} className="mt-3 text-xs text-primary hover:underline">Add one</button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'loan' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {loanVehicles.map((cf: any) => (
            <LoanCard
              key={cf.id}
              cf={cf}
              onEdit={() => openEditLoan(cf)}
              onDelete={() => handleDelete(cf.id)}
              deleteConfirm={deleteConfirm === cf.id}
            />
          ))}
          {loanVehicles.length === 0 && (
            <div className="card-forged p-12 text-center col-span-2">
              <Car size={32} className="text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No active loans yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Hit "I bought it" on a saving-phase card to start tracking.</p>
            </div>
          )}
        </div>
      )}

      {buyItFor && (
        <BuyItDialog cf={buyItFor} onConfirm={handleBuyIt} onClose={() => setBuyItFor(null)} />
      )}

      {showSavingForm && (
        <FormModal
          title={editId ? 'Edit Vehicle Goal' : 'Add Vehicle Goal'}
          fields={[
            { key: 'vehicle_name', label: 'Vehicle Name', type: 'text', placeholder: 'e.g., 2025 Honda Civic' },
            { key: 'target_price', label: 'Target Price', type: 'number', placeholder: '28000', step: '0.01' },
            { key: 'tax_fees', label: 'Tax & Fees', type: 'number', placeholder: '2000', step: '0.01' },
            { key: 'down_payment_goal', label: 'Down Payment Goal', type: 'number', placeholder: '5600', step: '0.01' },
            { key: 'current_saved', label: 'Current Saved', type: 'number', placeholder: '0', step: '0.01' },
            { key: 'monthly_insurance', label: 'Monthly Insurance Est.', type: 'number', placeholder: '180', step: '0.01' },
            { key: 'expected_apr', label: 'Expected Loan APR %', type: 'number', placeholder: '5.9', step: '0.01' },
            { key: 'loan_term_months', label: 'Loan Term (months)', type: 'number', placeholder: '60' },
          ]}
          values={savingForm}
          onChange={(k, v) => setSavingForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSaveSaving}
          onClose={() => setShowSavingForm(false)}
        />
      )}

      {showLoanForm && (
        <FormModal
          title={editId ? 'Edit Auto Loan' : 'Add Auto Loan'}
          fields={[
            { key: 'vehicle_name', label: 'Vehicle Name', type: 'text', placeholder: 'e.g., Toyota RAV4' },
            { key: 'loan_amount', label: 'Loan Amount', type: 'number', placeholder: '25000', step: '0.01' },
            { key: 'expected_apr', label: 'APR %', type: 'number', placeholder: '5.9', step: '0.01' },
            { key: 'loan_term_months', label: 'Term (months)', type: 'number', placeholder: '60' },
            { key: 'loan_start_date', label: 'Loan Start Date', type: 'date' },
            { key: 'payment_start_date', label: 'First Payment Date', type: 'date' },
            { key: 'interest_start_date', label: 'Interest Start Date', type: 'date' },
            { key: 'actual_monthly_payment', label: 'Payment Override (blank = scheduled)', type: 'number', placeholder: '0', step: '0.01' },
            { key: 'monthly_insurance', label: 'Monthly Insurance', type: 'number', placeholder: '180', step: '0.01' },
          ]}
          values={loanForm}
          onChange={(k, v) => setLoanForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSaveLoan}
          onClose={() => setShowLoanForm(false)}
        />
      )}
    </div>
  );
}
