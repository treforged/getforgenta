import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PageSkeleton } from '@/components/shared/PageSkeleton';
import { formatCurrency, calculatePayoffMonths, calculateTotalInterest, simulateDebtPayoff } from '@/lib/calculations';
import { useDebts, useAccounts, useTransactions, useRecurringRules, useProfile, useAccountReconciliations, useSavingsGoals, useCarFunds, usePaymentPlans } from '@/hooks/useSupabaseData';
import FormModal from '@/components/shared/FormModal';
import InstructionsModal from '@/components/shared/InstructionsModal';
import CreditCardEngine from '@/components/debt/CreditCardEngine';
import { useDemo } from '@/contexts/DemoContext';
import { Plus, Edit2, Trash2, CreditCard, Landmark, Car } from 'lucide-react';
import { buildAmortizationSchedule, getActiveCarLoanPayments, calculateScheduledPayment } from '@/lib/vehicle-loan-engine';
import { useCardProjectionContext } from '@/contexts/CardProjectionContext';

const emptyForm = { name: '', balance: '', apr: '', min_payment: '', target_payment: '', credit_limit: '' };

export default function DebtPayoff() {
  const { data: debts, update, remove } = useDebts();
  const { add: addReconciliation } = useAccountReconciliations();
  const { data: accounts, loading: accountsLoading } = useAccounts();
  const { data: transactions } = useTransactions();
  const { data: rules } = useRecurringRules();
  const { data: profile } = useProfile();
  const { data: goals } = useSavingsGoals();
  const { data: carFunds } = useCarFunds();
  const { data: paymentPlans } = usePaymentPlans();
  const { isDemo } = useDemo();

  const {
    cardProjection,
    assumptions,
    pauseSavings,
    setPauseSavings,
  } = useCardProjectionContext();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'cards' | 'auto' | 'mortgage' | 'student' | 'other'>('cards');

  const ccAccountNames = useMemo(() => new Set(
    accounts?.filter((a: any) => a.account_type === 'credit_card').map((a: any) => a.name.toLowerCase()) ?? []
  ), [accounts]);

  const mortgageAccountNames = useMemo(() => new Set(
    accounts?.filter((a: any) => a.account_type === 'mortgage').map((a: any) => a.name.toLowerCase()) ?? []
  ), [accounts]);

  const studentAccountNames = useMemo(() => new Set(
    accounts?.filter((a: any) => a.account_type === 'student_loan').map((a: any) => a.name.toLowerCase()) ?? []
  ), [accounts]);

  const mortgageDebts = useMemo(() => debts?.filter(d => mortgageAccountNames.has(d.name.toLowerCase())) ?? [], [debts, mortgageAccountNames]);
  const studentDebts = useMemo(() => debts?.filter(d => studentAccountNames.has(d.name.toLowerCase())) ?? [], [debts, studentAccountNames]);
  const otherDebts = useMemo(() => debts?.filter(d =>
    !ccAccountNames.has(d.name.toLowerCase()) &&
    !mortgageAccountNames.has(d.name.toLowerCase()) &&
    !studentAccountNames.has(d.name.toLowerCase())
  ) ?? [], [debts, ccAccountNames, mortgageAccountNames, studentAccountNames]);

  const totalBalance = otherDebts.reduce((s, d) => s + Number(d.balance), 0);
  const totalMinPayment = otherDebts.reduce((s, d) => s + Number(d.min_payment), 0);
  const totalTargetPayment = otherDebts.reduce((s, d) => s + Number(d.target_payment), 0);

  const snowballOrder = [...otherDebts].sort((a, b) => Number(a.balance) - Number(b.balance));
  const avalancheOrder = [...otherDebts].sort((a, b) => Number(b.apr) - Number(a.apr));

  const debtInputs = useMemo(() => otherDebts.map(d => ({
    id: d.id,
    name: d.name,
    balance: Number(d.balance),
    apr: Number(d.apr),
    min_payment: Number(d.min_payment),
  })), [otherDebts]);

  const snowballSim = useMemo(
    () => simulateDebtPayoff(debtInputs, 'snowball', totalTargetPayment),
    [debtInputs, totalTargetPayment],
  );
  const avalancheSim = useMemo(
    () => simulateDebtPayoff(debtInputs, 'avalanche', totalTargetPayment),
    [debtInputs, totalTargetPayment],
  );


  const debtFreeDate = (months: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  const openEdit = (d: any) => {
    setForm({ name: d.name, balance: String(d.balance), apr: String(d.apr), min_payment: String(d.min_payment), target_payment: String(d.target_payment), credit_limit: String(d.credit_limit || '') });
    setEditId(d.id); setShowForm(true);
  };

  const handleSave = () => {
    const balance = parseFloat(form.balance);
    if (!form.name || isNaN(balance)) return;
    const payload = {
      name: form.name, balance, apr: parseFloat(form.apr) || 0, min_payment: parseFloat(form.min_payment) || 0,
      target_payment: parseFloat(form.target_payment) || parseFloat(form.min_payment) || 0, credit_limit: parseFloat(form.credit_limit) || 0,
    };
    if (!editId) return;
    const existingDebt = debts?.find((d: any) => d.id === editId);
    const projectedBalance = existingDebt ? Number(existingDebt.balance) : balance;
    const delta = balance - projectedBalance;
    update.mutate({ id: editId, ...payload });
    if (delta !== 0) {
      addReconciliation.mutate({
        account_id: editId,
        source_table: 'debts',
        effective_date: new Date().toISOString().split('T')[0],
        delta,
        actual_balance: balance,
        projected_balance: projectedBalance,
      });
    }
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) { remove.mutate(id); setDeleteConfirm(null); }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
  };

  const hasCreditCards = accounts?.some((a: any) => a.account_type === 'credit_card' && a.active) ?? false;

  const activeAutoLoans = useMemo(() => getActiveCarLoanPayments(carFunds as any[]), [carFunds]);
  const loanVehicles = useMemo(() => (carFunds as any[]).filter((c: any) => c.phase === 'loan'), [carFunds]);
  const savingVehicles = useMemo(() => (carFunds as any[]).filter((c: any) => c.phase === 'saving'), [carFunds]);

  if (accountsLoading) return <PageSkeleton />;

  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto space-y-4 sm:space-y-6 overflow-x-hidden">
      <div className="flex items-start sm:items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="min-w-0">
            <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Debt Payoff Planner</h1>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">Eliminate debt with realistic, due-date-aware projections</p>
          </div>
          <InstructionsModal pageTitle="Debt Payoff Guide" sections={[
            { title: 'What is this page?', body: 'The Debt Payoff Planner runs a full 36-month simulation with real monthly interest, minimum payments, and optional payment plan charges. It tells you exactly when each card is paid off and how much interest you will pay.' },
            { title: 'Strategies', body: 'Avalanche pays the highest-APR card first to minimize total interest. Snowball pays the smallest balance first for early momentum. Both always cover every card\'s minimum first, then put the remaining available cash toward the priority card.' },
            { title: 'Statement vs. revolving cards', body: 'Cards set to "pay in full" clear their full balance each month — new purchases are included in the payment. Revolving cards carry a balance month-to-month and accrue interest. The engine handles both correctly and never over-pays a statement card.' },
            { title: 'Payment plans on cards', body: 'Installment plans (Amazon, Apple Pay Later, etc.) linked to a credit card are added as monthly charges to that card — they are not deducted from your cash directly. The engine factors these charges into each card\'s projected balance and interest each month.' },
            { title: 'Due dates', body: 'Each card can have a due date. The engine estimates how much cash you will have by that date — accounting for scheduled income and expenses — so it knows exactly what is safe to pay without dropping below your floor before the next paycheck.' },
            { title: 'Est. Liquid Cash & Safe to Pay', body: 'Liquid Cash = your funding account balance + Transactions income scheduled before the due date. Safe to Pay = Liquid Cash − Safe Minimum − other cards\' autopay amounts. Budget Control income is not separately counted — Transactions is the source of truth to prevent double-counting.' },
            { title: 'Minimum payment priority', body: 'All minimums across every card are covered first. Only after every minimum is met does the engine allocate the extra available amount to the strategy\'s priority card.' },
            { title: 'Recommended Safe Minimum', body: 'The greater of your cash floor setting and estimated next-month bills due before your next paycheck. This prevents your account from going negative between pay periods.' },
            { title: 'Overrides & reset', body: 'Click any monthly payment cell to manually set an amount. Use "Revert" to restore the engine\'s recommendation for that month. "Reset & Recalculate" clears all manual overrides and recalculates from scratch — only needed after manual adjustments.' },
          ]} />
        </div>
        <Link
          to={`/accounts?new=1&type=${
            activeTab === 'cards' ? 'credit_card'
            : activeTab === 'auto' ? 'auto_loan'
            : activeTab === 'mortgage' ? 'mortgage'
            : activeTab === 'student' ? 'student_loan'
            : 'other_liability'
          }`}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium btn-press shrink-0"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <Plus size={12} /> Add Account
        </Link>
      </div>

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-3">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-foreground">Avalanche engine — eliminate $12,700 using every spare dollar</p>
              <p className="text-xs text-muted-foreground mt-0.5">Jordan has two credit cards. The engine targets the highest APR first, pays minimums on the rest, and never drops below the $1,000 cash floor.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: 'Avalanche order', desc: 'Chase Sapphire (22.99% APR) gets all extra payments first. Discover It (18.99%) only gets extra after Sapphire is paid off.' },
              { label: 'Cash floor protection', desc: 'Each month the engine checks available cash after expenses and bills — extra payments only happen above the $1,000 floor.' },
              { label: 'Monthly projection table', desc: 'Shows exact payment, interest, and remaining balance each month. Click any payment to override the recommended amount.' },
              { label: 'Connects to Forecast', desc: 'These exact payment amounts feed the 36-month Forecast — debt payoff progress and end cash are synchronized.' },
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

      {/* Tabs */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button onClick={() => setActiveTab('cards')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border btn-press ${activeTab === 'cards' ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <CreditCard size={13} /> Credit Card Payoff {hasCreditCards && <span className="ml-1 text-xs bg-primary/20 text-primary px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>{accounts?.filter((a: any) => a.account_type === 'credit_card' && a.active).length ?? 0}</span>}
        </button>
        <button onClick={() => setActiveTab('auto')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border btn-press ${activeTab === 'auto' ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <Car size={13} /> Auto Loans {activeAutoLoans.length > 0 && <span className="ml-1 text-xs bg-primary/20 text-primary px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>{activeAutoLoans.length}</span>}
        </button>
        <button onClick={() => setActiveTab('mortgage')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border btn-press ${activeTab === 'mortgage' ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <Landmark size={13} /> Mortgage {mortgageDebts.length > 0 && <span className="ml-1 text-xs bg-primary/20 text-primary px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>{mortgageDebts.length}</span>}
        </button>
        <button onClick={() => setActiveTab('student')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border btn-press ${activeTab === 'student' ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <Landmark size={13} /> Student Loans {studentDebts.length > 0 && <span className="ml-1 text-xs bg-primary/20 text-primary px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>{studentDebts.length}</span>}
        </button>
        <button onClick={() => setActiveTab('other')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border btn-press ${activeTab === 'other' ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <Landmark size={13} /> Other Debts {otherDebts.length > 0 && <span className="ml-1 text-xs bg-primary/20 text-primary px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>{otherDebts.length}</span>}
        </button>
      </div>

      {activeTab === 'cards' && (
        <div className="flex items-center justify-between p-3 bg-secondary border border-border" style={{ borderRadius: 'var(--radius)' }}>
          <div className="min-w-0">
            <p className="text-xs font-medium">Pause optional savings transfers during payoff</p>
            <p className="text-xs text-muted-foreground">Excludes Savings &amp; Investing transfers from available cash calculation</p>
          </div>
          <button
            onClick={() => setPauseSavings((v: boolean) => !v)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ml-3 ${pauseSavings ? 'bg-primary' : 'bg-muted'}`}
            aria-label="Toggle pause savings"
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${pauseSavings ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </div>
      )}

      {activeTab === 'auto' && (
        <div className="space-y-4">
          {activeAutoLoans.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="card-forged p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">Monthly Payments</p>
                <p className="text-lg font-display font-bold text-primary">{formatCurrency(activeAutoLoans.reduce((s, l) => s + l.payment, 0), false)}</p>
              </div>
              <div className="card-forged p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">Total Remaining</p>
                <p className="text-lg font-display font-bold text-destructive">{formatCurrency(activeAutoLoans.reduce((s, l) => s + l.remainingBalance, 0), false)}</p>
              </div>
            </div>
          )}
          <div className="space-y-3">
            {loanVehicles.map((cf: any) => {
              if (!cf.payment_start_date || !cf.loan_start_date) return null;
              const proj = buildAmortizationSchedule({
                loanAmount: cf.loan_amount, apr: cf.expected_apr, termMonths: cf.loan_term_months,
                loanStartDate: cf.loan_start_date, paymentStartDate: cf.payment_start_date,
                interestStartDate: cf.interest_start_date ?? cf.payment_start_date,
                actualMonthlyPayment: cf.actual_monthly_payment,
              });
              const payoffFmt = new Date(proj.payoffDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
              return (
                <div key={cf.id} className="card-forged p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Car size={15} className="text-success shrink-0" />
                      <div>
                        <h3 className="text-sm font-semibold">{cf.vehicle_name}</h3>
                        <p className="text-xs text-muted-foreground">{cf.expected_apr}% APR · {cf.loan_term_months} mo loan</p>
                      </div>
                    </div>
                    <p className="text-lg font-display font-bold text-destructive">{formatCurrency(proj.remainingBalance, false)}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div><p className="text-xs text-muted-foreground">Monthly Pmt</p><p className="text-xs font-semibold text-primary">{formatCurrency(proj.effectivePayment, false)}/mo</p></div>
                    <div><p className="text-xs text-muted-foreground">Payoff</p><p className="text-xs font-semibold">{payoffFmt}</p></div>
                    <div><p className="text-xs text-muted-foreground">Total Interest</p><p className="text-xs font-semibold text-destructive">{formatCurrency(proj.totalInterest, false)}</p></div>
                  </div>
                  <Link to="/vehicles" className="mt-3 text-[10px] text-muted-foreground hover:text-primary underline-offset-2 hover:underline block">
                    Edit on Vehicles page →
                  </Link>
                </div>
              );
            })}
            {loanVehicles.length === 0 && savingVehicles.length === 0 && (
              <div className="card-forged p-12 text-center">
                <Car size={28} className="text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No active auto loans.</p>
                <Link to="/vehicles" className="mt-2 text-xs text-primary hover:underline block">Set up on the Vehicles page →</Link>
              </div>
            )}
          </div>

          {savingVehicles.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Planned Loans — Estimate</p>
              {savingVehicles.map((cf: any) => {
                const loanPrincipal = Math.max(0, Number(cf.target_price || 0) + Number(cf.tax_fees || 0) - Number(cf.down_payment_goal || 0));
                const termMonths = Number(cf.loan_term_months) || 60;
                const apr = Number(cf.expected_apr) || 0;
                const payment = calculateScheduledPayment(loanPrincipal, apr, termMonths);
                const totalInterest = payment * termMonths - loanPrincipal;
                let payoffDesc = `~${termMonths} months after purchase`;
                if (cf.planned_purchase_date) {
                  const parts = (cf.planned_purchase_date as string).split('-').map(Number);
                  const payoff = new Date(parts[0], parts[1] - 1 + termMonths, 1);
                  payoffDesc = payoff.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                }
                return (
                  <div key={cf.id} className="card-forged p-4 border-dashed opacity-80">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Car size={15} className="text-muted-foreground shrink-0" />
                        <div>
                          <h3 className="text-sm font-semibold">{cf.vehicle_name}</h3>
                          <p className="text-xs text-muted-foreground">{apr}% APR · {termMonths} mo loan · Saving phase</p>
                        </div>
                      </div>
                      <p className="text-lg font-display font-bold text-muted-foreground">{formatCurrency(loanPrincipal, false)}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div><p className="text-xs text-muted-foreground">Est. Payment</p><p className="text-xs font-semibold text-primary">{formatCurrency(payment, false)}/mo</p></div>
                      <div><p className="text-xs text-muted-foreground">Payoff Est.</p><p className="text-xs font-semibold">{payoffDesc}</p></div>
                      <div><p className="text-xs text-muted-foreground">Total Interest</p><p className="text-xs font-semibold text-destructive">{formatCurrency(Math.max(0, totalInterest), false)}</p></div>
                    </div>
                    <Link to="/vehicles" className="mt-3 text-[10px] text-muted-foreground hover:text-primary underline-offset-2 hover:underline block">
                      Edit on Vehicles page →
                    </Link>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-xs text-muted-foreground">Auto loans are managed on the <Link to="/vehicles" className="text-primary hover:underline">Vehicles page</Link>. Monthly payments automatically flow into Forecast.</p>
        </div>
      )}

      {activeTab === 'cards' && (
        <CreditCardEngine
          accounts={accounts} transactions={transactions} rules={rules} debts={debts} profile={profile}
          goals={goals ?? []} carFunds={carFunds ?? []}
          incomeGrowthEnabled={assumptions.incomeGrowthEnabled}
          incomeGrowth={assumptions.incomeGrowth}
          raiseMonth={assumptions.raiseMonth}
          raiseMode={assumptions.raiseMode}
          bonusEnabled={assumptions.bonusEnabled}
          bonusAmount={assumptions.bonusAmount}
          bonusMode={assumptions.bonusMode}
          bonusMonth={assumptions.bonusMonth}
          bonusRecurring={assumptions.bonusRecurring}
          taxReturnEnabled={assumptions.taxReturnEnabled}
          taxReturnAmountOverride={assumptions.taxReturnAmountOverride}
          taxReturnMonth={assumptions.taxReturnMonth}
          month0={cardProjection?.month0 ?? null}
          perCardPayments={cardProjection?.perCardPayments ?? null}
          perCardPaymentsScaled={cardProjection?.perCardPaymentsScaled ?? null}
          monthlyRevolvingBalances={cardProjection?.monthlyRevolvingBalances ?? null}
          monthlyCyclingOwed={cardProjection?.monthlyCyclingOwed ?? null}
          monthlyCyclingInterest={cardProjection?.monthlyCyclingInterest ?? null}
          monthlyBalances={cardProjection?.monthlyBalances ?? null}
          paymentPlans={paymentPlans ?? []}
        />
      )}

      {activeTab === 'other' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="card-forged p-4 text-center"><p className="text-xs text-muted-foreground uppercase">Total Owed</p><p className="text-lg font-display font-bold text-destructive">{formatCurrency(totalBalance, false)}</p></div>
            <div className="card-forged p-4 text-center"><p className="text-xs text-muted-foreground uppercase">Monthly Min</p><p className="text-lg font-display font-bold text-foreground">{formatCurrency(totalMinPayment, false)}</p></div>
            <div className="card-forged p-4 text-center"><p className="text-xs text-muted-foreground uppercase">Target Payment</p><p className="text-lg font-display font-bold text-primary">{formatCurrency(totalTargetPayment, false)}</p></div>
          </div>
          <div className="space-y-3">
            {otherDebts.map(d => {
              const bal = Number(d.balance), apr = Number(d.apr), tp = Number(d.target_payment);
              const months = calculatePayoffMonths(bal, apr, tp);
              const interest = calculateTotalInterest(bal, apr, tp);
              return (
                <div key={d.id} className="card-forged p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-semibold">{d.name}</h3>
                      <p className="text-xs text-muted-foreground">{apr}% APR · Min {formatCurrency(Number(d.min_payment), false)}/mo</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-display font-bold text-destructive">{formatCurrency(bal, false)}</p>
                      <button onClick={() => openEdit(d)} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
                      <button onClick={() => handleDelete(d.id)} className={`icon-btn ${deleteConfirm === d.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div><p className="text-xs text-muted-foreground">Target Payment</p><p className="text-xs font-semibold text-primary">{formatCurrency(tp, false)}/mo</p></div>
                    <div><p className="text-xs text-muted-foreground">Payoff In</p><p className="text-xs font-semibold">{bal <= 0 ? 'Paid' : months === Infinity ? '—' : `${months} months`}</p></div>
                    <div><p className="text-xs text-muted-foreground">Total Interest</p><p className="text-xs font-semibold text-destructive">{interest === Infinity ? '—' : formatCurrency(interest, false)}</p></div>
                  </div>
                </div>
              );
            })}
            {otherDebts.length === 0 && <div className="card-forged p-12 text-center"><p className="text-sm text-muted-foreground">No other debts tracked yet.</p></div>}
          </div>
          {otherDebts.length > 1 && (
            <div className="grid md:grid-cols-2 gap-4">
              {([
                { label: 'Snowball', desc: 'Smallest balance first', sim: snowballSim, order: snowballOrder, orderLabel: (d: any) => formatCurrency(Number(d.balance), false) },
                { label: 'Avalanche', desc: 'Highest APR first — minimizes total interest', sim: avalancheSim, order: avalancheOrder, orderLabel: (d: any) => `${Number(d.apr)}% APR` },
              ] as const).map(({ label, desc, sim, order, orderLabel }) => (
                <div key={label} className="card-forged p-4 space-y-3">
                  <div>
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-muted/20 rounded p-2 text-center">
                      <p className="text-[9px] text-muted-foreground uppercase">Debt-Free</p>
                      <p className="text-xs font-display font-bold text-primary">{debtFreeDate(sim.totalMonths)}</p>
                      <p className="text-[9px] text-muted-foreground">month {sim.totalMonths}</p>
                    </div>
                    <div className="bg-muted/20 rounded p-2 text-center">
                      <p className="text-[9px] text-muted-foreground uppercase">Total Interest</p>
                      <p className="text-xs font-display font-bold text-destructive">{formatCurrency(sim.totalInterest, false)}</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {order.map((d, i) => {
                      const result = sim.schedule.find(r => r.debtId === d.id);
                      return (
                        <div key={d.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                          <div>
                            <span className="text-xs"><span className="text-primary font-semibold mr-1.5">#{i + 1}</span>{d.name}</span>
                            <p className="text-[9px] text-muted-foreground ml-4">{orderLabel(d)}</p>
                          </div>
                          {result && (
                            <div className="text-right">
                              <p className="text-xs font-medium">Month {result.paidOffMonth}</p>
                              <p className="text-[9px] text-muted-foreground">{formatCurrency(result.totalInterest, false)} interest</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'mortgage' && (
        <div className="space-y-4">
          <div className="p-3 bg-primary/5 border border-primary/20 text-xs text-muted-foreground" style={{ borderRadius: 'var(--radius)' }}>
            Mortgage payments are deducted from your cash floor before credit card payoff — they always take priority. Add your mortgage as a debt entry matching the name of your mortgage account in Accounts.
          </div>
          {mortgageDebts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="card-forged p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">Total Owed</p>
                <p className="text-lg font-display font-bold text-destructive">{formatCurrency(mortgageDebts.reduce((s, d) => s + Number(d.balance), 0), false)}</p>
              </div>
              <div className="card-forged p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">Monthly Payment</p>
                <p className="text-lg font-display font-bold text-primary">{formatCurrency(mortgageDebts.reduce((s, d) => s + Number(d.target_payment), 0), false)}</p>
              </div>
            </div>
          )}
          <div className="space-y-3">
            {mortgageDebts.map(d => {
              const bal = Number(d.balance), apr = Number(d.apr), tp = Number(d.target_payment);
              const months = calculatePayoffMonths(bal, apr, tp);
              const interest = calculateTotalInterest(bal, apr, tp);
              return (
                <div key={d.id} className="card-forged p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-semibold">{d.name}</h3>
                      <p className="text-xs text-muted-foreground">{apr}% APR · Min {formatCurrency(Number(d.min_payment), false)}/mo</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-display font-bold text-destructive">{formatCurrency(bal, false)}</p>
                      <button onClick={() => openEdit(d)} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
                      <button onClick={() => handleDelete(d.id)} className={`icon-btn ${deleteConfirm === d.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div><p className="text-xs text-muted-foreground">Monthly Payment</p><p className="text-xs font-semibold text-primary">{formatCurrency(tp, false)}/mo</p></div>
                    <div><p className="text-xs text-muted-foreground">Payoff In</p><p className="text-xs font-semibold">{bal <= 0 ? 'Paid' : months === Infinity ? '—' : `${months} months`}</p></div>
                    <div><p className="text-xs text-muted-foreground">Total Interest</p><p className="text-xs font-semibold text-destructive">{interest === Infinity ? '—' : formatCurrency(interest, false)}</p></div>
                  </div>
                </div>
              );
            })}
            {mortgageDebts.length === 0 && (
              <div className="card-forged p-12 text-center">
                <Landmark size={28} className="text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No mortgage tracked yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Add a mortgage account in Accounts, then add a matching debt entry here.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'student' && (
        <div className="space-y-4">
          {studentDebts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="card-forged p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">Total Owed</p>
                <p className="text-lg font-display font-bold text-destructive">{formatCurrency(studentDebts.reduce((s, d) => s + Number(d.balance), 0), false)}</p>
              </div>
              <div className="card-forged p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">Monthly Payment</p>
                <p className="text-lg font-display font-bold text-primary">{formatCurrency(studentDebts.reduce((s, d) => s + Number(d.target_payment), 0), false)}</p>
              </div>
            </div>
          )}
          <div className="space-y-3">
            {studentDebts.map(d => {
              const bal = Number(d.balance), apr = Number(d.apr), tp = Number(d.target_payment);
              const months = calculatePayoffMonths(bal, apr, tp);
              const interest = calculateTotalInterest(bal, apr, tp);
              return (
                <div key={d.id} className="card-forged p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-semibold">{d.name}</h3>
                      <p className="text-xs text-muted-foreground">{apr}% APR · Min {formatCurrency(Number(d.min_payment), false)}/mo</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-display font-bold text-destructive">{formatCurrency(bal, false)}</p>
                      <button onClick={() => openEdit(d)} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
                      <button onClick={() => handleDelete(d.id)} className={`icon-btn ${deleteConfirm === d.id ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div><p className="text-xs text-muted-foreground">Target Payment</p><p className="text-xs font-semibold text-primary">{formatCurrency(tp, false)}/mo</p></div>
                    <div><p className="text-xs text-muted-foreground">Payoff In</p><p className="text-xs font-semibold">{bal <= 0 ? 'Paid' : months === Infinity ? '—' : `${months} months`}</p></div>
                    <div><p className="text-xs text-muted-foreground">Total Interest</p><p className="text-xs font-semibold text-destructive">{interest === Infinity ? '—' : formatCurrency(interest, false)}</p></div>
                  </div>
                </div>
              );
            })}
            {studentDebts.length === 0 && (
              <div className="card-forged p-12 text-center">
                <Landmark size={28} className="text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No student loans tracked yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Add a student loan account in Accounts, then add a matching debt entry here.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <FormModal
          title={editId ? 'Edit Debt' : 'Add Debt'}
          fields={[
            { key: 'name', label: 'Debt Name', type: 'text', placeholder: 'e.g., Student Loan' },
            { key: 'balance', label: 'Balance', type: 'number', placeholder: '0.00', step: '0.01' },
            { key: 'apr', label: 'APR %', type: 'number', placeholder: '5.5', step: '0.01' },
            { key: 'min_payment', label: 'Minimum Payment', type: 'number', placeholder: '0.00', step: '0.01' },
            { key: 'target_payment', label: 'Target Payment', type: 'number', placeholder: '0.00', step: '0.01' },
            { key: 'credit_limit', label: 'Credit Limit (if card)', type: 'number', placeholder: '0', step: '0.01' },
          ]}
          values={form}
          onChange={(k, v) => setForm(prev => ({ ...prev, [k]: v }))}
          onSave={handleSave}
          onClose={() => setShowForm(false)}
          saving={update.isPending}
          saveLabel={editId ? 'Update Debt' : 'Add Debt'}
        />
      )}
    </div>
  );
}
