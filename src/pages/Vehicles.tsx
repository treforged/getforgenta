import { useState, useMemo, useEffect } from 'react';
import DateScrollPicker from '@/components/shared/DateScrollPicker';
import { Link } from 'react-router-dom';
import { PageSkeleton } from '@/components/shared/PageSkeleton';
import { Skeleton } from '@/components/ui/skeleton';
import InstructionsModal from '@/components/shared/InstructionsModal';
import FormModal from '@/components/shared/FormModal';
import ProgressBar from '@/components/shared/ProgressBar';
import { formatCurrency, calculateMonthlyPayment, formatYAxisTick } from '@/lib/calculations';
import { buildAmortizationSchedule, getActiveCarLoanPayments, getLoanPrincipal, type LumpSumPayment } from '@/lib/vehicle-loan-engine';
import { useCarFunds, useAccounts, useRecurringRules, useTransactions, useProfile } from '@/hooks/useSupabaseData';
import { mergeWithGeneratedTransactions, getRemainingTransactionIncomeThisMonth, getRemainingTransactionExpensesThisMonth, getRemainingTransactionDebtPaymentsThisMonth } from '@/lib/pay-schedule';
import { useSubscription } from '@/hooks/useSubscription';
import { useDemo } from '@/contexts/DemoContext';
import { Plus, Edit2, Trash2, Car, Crown, TrendingDown, AlertTriangle, Link2, Undo2, CalendarClock, X, Check } from 'lucide-react';
import PremiumGate from '@/components/shared/PremiumGate';
import { filterProfanity, LIMITS } from '@/lib/content-filter';
import { toast } from 'sonner';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { CarFund } from '@/lib/types';

const toMonthly = (amount: number, freq: string) =>
  freq === 'weekly' ? amount * 52 / 12
  : freq === 'biweekly' ? amount * 26 / 12
  : freq === 'yearly' ? amount / 12
  : amount;

const emptySavingForm = {
  vehicle_name: '', target_price: '', tax_fees: '', down_payment_goal: '', gift_contribution: '',
  current_saved: '', monthly_insurance: '', expected_apr: '', loan_term_months: '60',
  linked_account: '', linked_rule_id: '', planned_purchase_date: '',
  payment_start_date: '',
};

const emptyLoanForm = {
  vehicle_name: '', loan_amount: '', expected_apr: '', loan_term_months: '60',
  loan_start_date: '', payment_start_date: '', interest_start_date: '', actual_monthly_payment: '',
  monthly_insurance: '', loan_payment_account: '',
};

function addMonthsStr(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return d.toISOString().split('T')[0];
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}


function LumpSumModal({
  mode, initialDate, initialAmount, schedule, liquidCash, onSave, onClose,
}: {
  mode: 'add' | 'edit';
  initialDate: string;
  initialAmount: string;
  schedule: { date: string; startBalance: number }[];
  liquidCash?: number;
  onSave: (entries: { date: string; amount: number }[]) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [amount, setAmount] = useState(initialAmount);
  // Repeat is add-only — editing always targets exactly the one existing entry.
  const [repeatMonths, setRepeatMonths] = useState('1');

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const bal = date
    ? (schedule.find(r => r.date.substring(0, 7) === date.substring(0, 7))?.startBalance ?? null)
    : null;
  const canSave = !!date && parseFloat(amount) > 0;

  const handleSave = () => {
    const amt = parseFloat(amount);
    if (!date || !amt || amt <= 0) return;
    const count = mode === 'add' ? Math.max(1, Math.min(60, parseInt(repeatMonths) || 1)) : 1;
    const entries = Array.from({ length: count }, (_, k) => ({ date: addMonthsStr(date, k), amount: amt }));
    onSave(entries);
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
          <h2 className="font-display font-semibold text-sm">{mode === 'add' ? 'Add Extra Payment' : 'Edit Extra Payment'}</h2>
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
          {mode === 'add' && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                Repeat <span className="text-muted-foreground/60">(consecutive months, starting this date)</span>
              </p>
              <input
                type="number"
                min={1}
                max={60}
                placeholder="1"
                value={repeatMonths}
                onChange={e => setRepeatMonths(e.target.value)}
                className="w-full bg-secondary border border-border px-3 py-3 text-sm text-foreground"
                style={{ borderRadius: 'var(--radius)' }}
              />
            </div>
          )}
          {date && (bal !== null || liquidCash !== undefined) && (
            <div className="flex flex-wrap gap-4 text-[10px] text-muted-foreground p-2.5 bg-secondary/30 border border-border/30" style={{ borderRadius: 'var(--radius)' }}>
              {bal !== null && <span>Balance at date: <span className="text-foreground font-medium">{formatCurrency(bal, false)}</span></span>}
              {liquidCash !== undefined && <span>Cash available: <span className="text-success font-medium">{formatCurrency(liquidCash, false)}</span></span>}
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
            {mode === 'add' ? 'Add Payment' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LumpSumPanel({
  schedule,
  lumpSums,
  baseTotalInterest,
  withLumpsTotalInterest,
  basePayoffDate,
  withLumpsPayoffDate,
  onAdd,
  onRemove,
  onUpdate,
  label = 'Planned Extra Payments',
  liquidCash,
}: {
  schedule: { date: string; startBalance: number }[];
  lumpSums: LumpSumPayment[];
  baseTotalInterest: number;
  withLumpsTotalInterest: number;
  basePayoffDate: string;
  withLumpsPayoffDate: string;
  onAdd: (entries: LumpSumPayment[]) => void;
  onRemove: (id: string) => void;
  onUpdate: (ls: LumpSumPayment) => void;
  label?: string;
  liquidCash?: number;
}) {
  const [modal, setModal] = useState<null | { mode: 'add' } | { mode: 'edit'; id: string; date: string; amount: string }>(null);

  const getBalanceBefore = (dateStr: string) => {
    const month = dateStr.substring(0, 7);
    return schedule.find(r => r.date.substring(0, 7) === month)?.startBalance ?? null;
  };

  const baseD = new Date(basePayoffDate + 'T00:00:00');
  const newD = new Date(withLumpsPayoffDate + 'T00:00:00');
  const monthsSaved = (baseD.getFullYear() - newD.getFullYear()) * 12 + (baseD.getMonth() - newD.getMonth());
  const interestSaved = Math.max(0, Math.round((baseTotalInterest - withLumpsTotalInterest) * 100) / 100);
  const hasLumps = lumpSums.length > 0;

  return (
    <div className="space-y-2 border-t border-border/30 pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
        <button onClick={() => setModal({ mode: 'add' })} className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80">
          <Plus size={10} /> Add
        </button>
      </div>

      {!hasLumps && (
        <p className="text-[10px] text-muted-foreground">No extra payments planned. Add one to see how it shortens your payoff.</p>
      )}

      {hasLumps && (
        <div className="space-y-1">
          {[...lumpSums].sort((a, b) => a.date.localeCompare(b.date)).map(ls => {
            const bal = getBalanceBefore(ls.date);
            const dateLabel = new Date(ls.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            return (
              <div key={ls.id} className="flex items-center justify-between py-1 px-2 bg-secondary/20 border border-border/30" style={{ borderRadius: 'var(--radius)' }}>
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="text-[10px] font-medium shrink-0">{dateLabel}</span>
                  <span className="text-[10px] text-primary font-semibold shrink-0">{formatCurrency(ls.amount, false)}</span>
                  {bal !== null && <span className="text-[10px] text-muted-foreground">Balance before: {formatCurrency(bal, false)}</span>}
                </div>
                <div className="flex items-center gap-1 ml-2 shrink-0">
                  <button onClick={() => setModal({ mode: 'edit', id: ls.id, date: ls.date, amount: String(ls.amount) })} className="text-muted-foreground hover:text-foreground"><Edit2 size={11} /></button>
                  <button onClick={() => onRemove(ls.id)} className="text-muted-foreground hover:text-destructive"><X size={11} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasLumps && (monthsSaved > 0 || interestSaved > 0) && (
        <div className="p-2 bg-success/5 border border-success/20 text-[10px] space-y-0.5" style={{ borderRadius: 'var(--radius)' }}>
          <p className="text-success font-semibold">Impact of extra payments:</p>
          <div className="flex flex-wrap gap-3">
            <span>Payoff: {new Date(withLumpsPayoffDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              {monthsSaved > 0 && <span className="text-muted-foreground"> ({monthsSaved} mo earlier)</span>}
            </span>
            {interestSaved > 0 && <span className="text-success">saves {formatCurrency(interestSaved, false)} interest</span>}
          </div>
        </div>
      )}

      {modal && (
        <LumpSumModal
          key={modal.mode === 'edit' ? modal.id : 'add'}
          mode={modal.mode}
          initialDate={modal.mode === 'edit' ? modal.date : ''}
          initialAmount={modal.mode === 'edit' ? modal.amount : ''}
          schedule={schedule}
          liquidCash={liquidCash}
          onSave={(entries) => {
            if (modal.mode === 'add') {
              onAdd(entries.map(e => ({ id: crypto.randomUUID(), date: e.date, amount: e.amount })));
            } else {
              onUpdate({ id: modal.id, date: entries[0].date, amount: entries[0].amount });
            }
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function estimateSavingCompletion(downGoal: number, saved: number, monthly: number, plannedDate: string | null | undefined): string {
  if (plannedDate) return fmtDate(plannedDate) ?? 'Set';
  const rem = downGoal - saved;
  if (rem <= 0) return 'Reached';
  if (monthly <= 0) return 'Set contribution';
  const months = Math.ceil(rem / monthly);
  const dt = new Date();
  dt.setMonth(dt.getMonth() + months);
  return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function SavingCard({ cf, onEdit, onDelete, onBuyIt, deleteConfirm, linkedAccountName, monthlyContrib, onSaveLumpSums, liquidCash, availableAboveFloor, computedMonthlyNeeded }:
  { cf: CarFund; onEdit: () => void; onDelete: () => void; onBuyIt: () => void; deleteConfirm: boolean;
    linkedAccountName?: string | null; monthlyContrib?: number; onSaveLumpSums: (lumps: LumpSumPayment[]) => void; liquidCash?: number; availableAboveFloor?: number; computedMonthlyNeeded?: number }) {
  const gift = Number(cf.gift_contribution) || 0;
  const personalGoal = Math.max(0, cf.down_payment_goal - gift);
  // simMonthlyContrib is used for completion-date estimation only.
  const simMonthlyContrib = (() => {
    if (cf.linked_account) return 0;
    const rem = Math.max(0, personalGoal - cf.current_saved);
    if (rem <= 0) return 0;
    let monthsToGoal = 12;
    if (cf.planned_purchase_date) {
      const parts = cf.planned_purchase_date.split('-').map(Number);
      const pd = new Date(parts[0], parts[1] - 1, parts[2]);
      const now = new Date();
      const diff = (pd.getFullYear() - now.getFullYear()) * 12 + (pd.getMonth() - now.getMonth());
      monthsToGoal = Math.max(1, diff);
    }
    return Math.min(rem / monthsToGoal, rem);
  })();
  // For linked-account cars, live balance is the truth — don't layer checking surplus on top.
  // For non-linked cars, add availableAboveFloor (end-of-month surplus projection) or simMonthlyContrib.
  const simulatedSaved = linkedAccountName
    ? Math.min(personalGoal, cf.current_saved)
    : Math.min(personalGoal, cf.current_saved + (availableAboveFloor ?? simMonthlyContrib));
  const pct = personalGoal > 0 ? Math.min((simulatedSaved / personalGoal) * 100, 100) : 100;
  const monthlyEst = calculateMonthlyPayment(
    cf.target_price + cf.tax_fees - cf.down_payment_goal,
    cf.expected_apr,
    cf.loan_term_months,
  );
  const monthly = monthlyContrib ?? 0;
  // When no transfer rule is linked, show the computed amount needed per month to hit the goal.
  const displayMonthly = monthly > 0 ? monthly : (computedMonthlyNeeded ?? 0);
  const completionLabel = estimateSavingCompletion(personalGoal, cf.current_saved, displayMonthly, cf.planned_purchase_date);

  const lumpSums: LumpSumPayment[] = Array.isArray(cf.lump_sum_payments) ? cf.lump_sum_payments : [];

  // Project the future loan so lump sums can be planned against it
  const projectedBase = useMemo(() => {
    if (!cf.planned_purchase_date) return null;
    const loanAmt = Math.max(0, cf.target_price + cf.tax_fees - cf.down_payment_goal);
    if (loanAmt <= 0 || cf.loan_term_months <= 0) return null;
    const payStart = addMonthsStr(cf.planned_purchase_date, 1);
    return buildAmortizationSchedule({
      loanAmount: loanAmt, apr: cf.expected_apr, termMonths: cf.loan_term_months,
      loanStartDate: cf.planned_purchase_date, paymentStartDate: payStart, interestStartDate: payStart,
      actualMonthlyPayment: 0,
    });
  }, [cf]);

  const projectedWithLumps = useMemo(() => {
    if (!projectedBase || lumpSums.length === 0) return projectedBase;
    const loanAmt = Math.max(0, cf.target_price + cf.tax_fees - cf.down_payment_goal);
    const payStart = addMonthsStr(cf.planned_purchase_date!, 1);
    return buildAmortizationSchedule({
      loanAmount: loanAmt, apr: cf.expected_apr, termMonths: cf.loan_term_months,
      loanStartDate: cf.planned_purchase_date!, paymentStartDate: payStart, interestStartDate: payStart,
      actualMonthlyPayment: 0, lumpSumPayments: lumpSums,
    });
  }, [projectedBase, lumpSums, cf]);

  const handleAddLump = (entries: LumpSumPayment[]) => onSaveLumpSums([...lumpSums, ...entries]);
  const handleRemoveLump = (id: string) => onSaveLumpSums(lumpSums.filter(l => l.id !== id));
  const handleUpdateLump = (ls: LumpSumPayment) => onSaveLumpSums(lumpSums.map(l => l.id === ls.id ? ls : l));
  return (
    <div className="card-forged p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Car size={16} className="text-primary shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{cf.vehicle_name}</h3>
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-xs text-muted-foreground">Saving for down payment</p>
              {linkedAccountName && (
                <span className="text-[9px] px-1.5 py-0.5 bg-primary/10 border border-primary/20 text-primary flex items-center gap-1" style={{ borderRadius: 'var(--radius)' }}>
                  <Link2 size={8} /> {linkedAccountName}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <button onClick={onEdit} className="icon-btn text-muted-foreground hover:text-foreground"><Edit2 size={14} /></button>
          <button onClick={onDelete} className={`icon-btn ${deleteConfirm ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}><Trash2 size={14} /></button>
        </div>
      </div>

      {cf.planned_purchase_date && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-primary/5 border border-primary/15 text-xs" style={{ borderRadius: 'var(--radius)' }}>
          <CalendarClock size={12} className="text-primary shrink-0" />
          <span className="text-primary/90 font-medium">Planned purchase: {fmtDate(cf.planned_purchase_date)}</span>
        </div>
      )}

      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">Down payment progress</span>
          <span className="font-medium">
            {formatCurrency(simulatedSaved, false)} / {formatCurrency(personalGoal, false)}
            {gift > 0 && <span className="text-muted-foreground"> · {formatCurrency(cf.down_payment_goal, false)} total</span>}
          </span>
        </div>
        <ProgressBar value={pct} max={100} />
        {gift > 0 && (
          <div className="flex items-center gap-1 mt-1">
            <span className="text-[10px] px-1.5 py-0.5 bg-success/10 border border-success/20 text-success font-medium" style={{ borderRadius: 'var(--radius)' }}>
              Gift/contribution: {formatCurrency(gift, false)} covered
            </span>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-1">
          {Math.round(pct)}%{' '}
          {cf.planned_purchase_date
            ? `· Planned: ${fmtDate(cf.planned_purchase_date)}`
            : displayMonthly > 0
              ? `· Est. ready ${completionLabel}`
              : linkedAccountName ? '· Balance auto-synced from account' : '· Set a transfer rule to estimate completion'}
        </p>
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

      {projectedBase && (
        <div className="flex items-center justify-between px-2 py-1.5 bg-secondary/40 text-xs" style={{ borderRadius: 'var(--radius)' }}>
          <span className="text-muted-foreground">Est. Loan Payoff</span>
          <span className="font-semibold">
            {new Date((projectedWithLumps?.payoffDate ?? projectedBase.payoffDate) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
          </span>
        </div>
      )}

      {displayMonthly > 0 && (
        <p className="text-[10px] text-primary/70 text-center">
          {formatCurrency(displayMonthly, false)}/mo
          {monthly > 0
            ? (linkedAccountName ? ' · via transfer rule' : ' · contribution')
            : ' · suggested to hit goal'}
        </p>
      )}

      {/* projectedBase needs a planned purchase date + computable loan amount/term — when not yet
          set, the panel below still works (list + add), it just can't show payoff-date/interest-
          saved impact figures yet. Without the fallbacks here, the whole panel (including "Add")
          used to disappear entirely until those fields were filled in. */}
      <LumpSumPanel
        schedule={projectedWithLumps?.schedule ?? projectedBase?.schedule ?? []}
        lumpSums={lumpSums}
        baseTotalInterest={projectedBase?.totalInterest ?? 0}
        withLumpsTotalInterest={projectedWithLumps?.totalInterest ?? projectedBase?.totalInterest ?? 0}
        basePayoffDate={projectedBase?.payoffDate ?? ''}
        withLumpsPayoffDate={projectedWithLumps?.payoffDate ?? projectedBase?.payoffDate ?? ''}
        onAdd={handleAddLump}
        onRemove={handleRemoveLump}
        onUpdate={handleUpdateLump}
        label="Projected Extra Payments"
        liquidCash={liquidCash}
      />

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

function LoanCard({ cf, onEdit, onDelete, onUndo, deleteConfirm, undoConfirm, onSaveLumpSums, liquidCash }:
  { cf: CarFund; onEdit: () => void; onDelete: () => void; onUndo: () => void; deleteConfirm: boolean; undoConfirm: boolean; onSaveLumpSums: (lumps: LumpSumPayment[]) => void; liquidCash?: number }) {
  const lumpSums: LumpSumPayment[] = Array.isArray(cf.lump_sum_payments) ? cf.lump_sum_payments : [];

  const baseInput = useMemo(() => {
    if (!cf.payment_start_date || !cf.loan_start_date) return null;
    return {
      loanAmount: cf.loan_amount, apr: cf.expected_apr, termMonths: cf.loan_term_months,
      loanStartDate: cf.loan_start_date, paymentStartDate: cf.payment_start_date,
      interestStartDate: cf.interest_start_date ?? cf.payment_start_date,
      actualMonthlyPayment: cf.actual_monthly_payment,
    };
  }, [cf]);

  const proj = useMemo(() => baseInput ? buildAmortizationSchedule(baseInput) : null, [baseInput]);

  const projWithLumps = useMemo(() => {
    if (!baseInput || lumpSums.length === 0) return proj;
    return buildAmortizationSchedule({ ...baseInput, lumpSumPayments: lumpSums });
  }, [baseInput, lumpSums, proj]);

  const [showSchedule, setShowSchedule] = useState(false);

  const handleAddLump = (entries: LumpSumPayment[]) => onSaveLumpSums([...lumpSums, ...entries]);
  const handleRemoveLump = (id: string) => onSaveLumpSums(lumpSums.filter(l => l.id !== id));
  const handleUpdateLump = (ls: LumpSumPayment) => onSaveLumpSums(lumpSums.map(l => l.id === ls.id ? ls : l));

  if (!proj) return null;

  const pct = cf.loan_amount > 0 ? ((cf.loan_amount - proj.remainingBalance) / cf.loan_amount) * 100 : 0;

  const chartData = proj.schedule
    .filter((_, i) => i % 3 === 0 || i === proj.schedule.length - 1)
    .map(r => ({ month: r.month, balance: r.endBalance }));

  const payoffDateFmt = new Date((projWithLumps?.payoffDate ?? proj.payoffDate) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

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
          <button
            onClick={onUndo}
            className={`icon-btn text-xs flex items-center gap-1 px-1.5 ${undoConfirm ? 'text-amber-400' : 'text-muted-foreground hover:text-amber-400'}`}
            title={undoConfirm ? 'Click again to confirm undo' : 'Undo purchase — revert to saving phase'}
          >
            <Undo2 size={13} />
            {undoConfirm && <span className="text-[10px] font-medium">Confirm?</span>}
          </button>
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
            <YAxis tick={{ fontSize: 10, fill: 'hsl(240,4%,46%)' }} axisLine={false} tickLine={false} tickFormatter={formatYAxisTick} />
            <Tooltip contentStyle={{ background: 'hsl(0,0%,8%)', border: '1px solid hsl(0,0%,15%)', borderRadius: 'var(--radius)', fontSize: 11 }} formatter={(v: number) => [formatCurrency(v, false), 'Remaining']} />
            <Line dataKey="balance" stroke="hsl(43,56%,52%)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}

      <LumpSumPanel
        schedule={projWithLumps?.schedule ?? proj.schedule}
        lumpSums={lumpSums}
        baseTotalInterest={proj.totalInterest}
        withLumpsTotalInterest={projWithLumps?.totalInterest ?? proj.totalInterest}
        basePayoffDate={proj.payoffDate}
        withLumpsPayoffDate={projWithLumps?.payoffDate ?? proj.payoffDate}
        onAdd={handleAddLump}
        onRemove={handleRemoveLump}
        onUpdate={handleUpdateLump}
        liquidCash={liquidCash}
      />

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

function BuyItDialog({ cf, accountOptions, onConfirm, onClose }:
  { cf: CarFund; accountOptions: { value: string; label: string }[]; onConfirm: (fields: Partial<CarFund>) => void; onClose: () => void }) {
  const today = new Date().toISOString().split('T')[0];
  const nextMonth = new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().split('T')[0];
  // getLoanPrincipal — same formula the saving-phase projection uses (Forecast.tsx/
  // useCardProjection.ts), so accepting this default with no edits doesn't change the payment.
  const loanAmountDefault = getLoanPrincipal(cf);
  const [form, setForm] = useState({
    loan_amount: String(loanAmountDefault),
    expected_apr: String(cf.expected_apr),
    loan_term_months: String(cf.loan_term_months),
    loan_start_date: cf.loan_start_date ?? cf.planned_purchase_date ?? today,
    payment_start_date: cf.payment_start_date ?? nextMonth,
    interest_start_date: cf.payment_start_date ?? nextMonth,
    actual_monthly_payment: '',
    loan_payment_account: cf.loan_payment_account ?? '',
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
    if (!loan_amount) return;
    if (!form.payment_start_date) {
      toast.error('First Payment Date is required.');
      return;
    }
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
      loan_payment_account: form.loan_payment_account || null,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4"
      style={{ touchAction: 'none', background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <div
        className="card-forged w-full sm:max-w-sm flex flex-col rounded-t-[var(--radius)] rounded-b-none sm:rounded-b-[var(--radius)]"
        style={{ maxHeight: 'calc(88dvh - env(safe-area-inset-bottom))', paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-3 shrink-0 space-y-1">
          <h2 className="text-sm font-semibold">Start Loan Tracking — {cf.vehicle_name}</h2>
          <p className="text-xs text-muted-foreground">Enter your actual loan details. Payments will flow into Forecast and Debt Payoff.</p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 space-y-4 pb-2 popup-scroll" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
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
              Monthly Payment Account <span className="text-muted-foreground/60">(defaults to general cash if unset)</span>
            </label>
            <select
              value={form.loan_payment_account}
              onChange={e => setForm(prev => ({ ...prev, loan_payment_account: e.target.value }))}
              className="w-full bg-secondary border border-border px-3 py-1.5 text-xs"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {accountOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>

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
        </div>

        <div className="flex gap-2 px-4 sm:px-6 pt-3 pb-5 sm:pb-6 shrink-0 border-t border-border mt-1">
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
  const { data: rules } = useRecurringRules();
  const { data: transactions } = useTransactions();
  const { data: profile } = useProfile();
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
  const [undoConfirm, setUndoConfirm] = useState<string | null>(null);

  const savingVehicles = useMemo(() => carFunds.filter((c: any) => (c.phase ?? 'saving') === 'saving'), [carFunds]);
  const loanVehicles = useMemo(() => carFunds.filter((c: any) => c.phase === 'loan'), [carFunds]);

  const activeLoans = useMemo(() => getActiveCarLoanPayments(carFunds as unknown as CarFund[]), [carFunds]);
  const totalMonthlyLoanPayments = activeLoans.reduce((s, l) => s + l.payment, 0);

  const liquidCash = useMemo(() =>
    (accounts as any[])
      .filter((a: any) => a.active && ['checking', 'business_checking', 'cash'].includes(a.account_type))
      .reduce((s: number, a: any) => s + Number(a.balance), 0),
    [accounts]
  );

  const cashFloor = useMemo(() => { const v = Number((profile as any)?.cash_floor); return isNaN(v) ? 1000 : v; }, [profile]);

  const allMonthTransactions = useMemo(() =>
    mergeWithGeneratedTransactions(transactions || [], rules, accounts),
    [transactions, rules, accounts],
  );

  const remainingTxIncome = useMemo(() => getRemainingTransactionIncomeThisMonth(allMonthTransactions), [allMonthTransactions]);
  const remainingTxExpenses = useMemo(() => getRemainingTransactionExpensesThisMonth(allMonthTransactions, true), [allMonthTransactions]);
  const remainingTxDebt = useMemo(() => getRemainingTransactionDebtPaymentsThisMonth(allMonthTransactions), [allMonthTransactions]);

  // Available cash above floor today→EOM — mirrors Forecast month 0 surplus.
  const availableAboveFloor = useMemo(() =>
    Math.max(0, liquidCash + remainingTxIncome - remainingTxExpenses - remainingTxDebt - cashFloor),
    [liquidCash, remainingTxIncome, remainingTxExpenses, remainingTxDebt, cashFloor],
  );

  const accountMap = useMemo(() => {
    const map: Record<string, any> = {};
    (accounts as any[]).forEach((a: any) => { map[a.id] = a; });
    return map;
  }, [accounts]);

  const accountOptions = useMemo(() => [
    { value: '', label: 'None (Manual)' },
    ...(accounts as any[]).filter((a: any) => a.active).map((a: any) => ({
      value: a.id,
      label: `${a.name} (${a.account_type.replace(/_/g, ' ')})`,
    })),
  ], [accounts]);

  const transferRuleOptions = useMemo(() => [
    { value: '', label: 'None (manual)' },
    ...(rules as any[])
      .filter((r: any) => (r.rule_type === 'transfer' || r.rule_type === 'investment') && r.active)
      .map((r: any) => ({ value: r.id, label: `${r.name} — ${formatCurrency(r.amount, false)}/${r.frequency}` })),
  ], [rules]);

  const savingFormFields = useMemo(() => {
    const fields: any[] = [
      { key: 'vehicle_name', label: 'Vehicle Name', type: 'text', placeholder: 'e.g., 2025 Honda Civic' },
      { key: 'target_price', label: 'Target Price', type: 'number', placeholder: '28000', step: '0.01' },
      { key: 'tax_fees', label: 'Tax & Fees', type: 'number', placeholder: '2000', step: '0.01' },
      { key: 'down_payment_goal', label: 'Down Payment Goal (total to dealer)', type: 'number', placeholder: '5600', step: '0.01' },
      { key: 'gift_contribution', label: 'Gift / External Contribution (optional)', type: 'number', placeholder: '0', step: '0.01' },
      { key: 'planned_purchase_date', label: 'Planned Purchase Date', type: 'date' },
      { key: 'payment_start_date', label: 'Planned First Payment Date', type: 'date' },
      { key: 'linked_account', label: 'Linked Account (auto-pull balance)', type: 'select', options: accountOptions },
      { key: 'linked_rule_id', label: 'Transfer Rule (auto-sync contribution)', type: 'select', options: transferRuleOptions },
    ];
    if (!savingForm.linked_account) {
      fields.push({ key: 'current_saved', label: 'Current Saved', type: 'number', placeholder: '0', step: '0.01' });
    }
    fields.push(
      { key: 'monthly_insurance', label: 'Monthly Insurance Est.', type: 'number', placeholder: '180', step: '0.01' },
      { key: 'expected_apr', label: 'Expected Loan APR %', type: 'number', placeholder: '5.9', step: '0.01' },
      { key: 'loan_term_months', label: 'Loan Term (months)', type: 'number', placeholder: '60' },
    );
    return fields;
  }, [savingForm.linked_account, accountOptions, transferRuleOptions]);

  const openAddSaving = () => { setSavingForm(emptySavingForm); setEditId(null); setShowSavingForm(true); };
  const openAddLoan = () => { setLoanForm(emptyLoanForm); setEditId(null); setShowLoanForm(true); };

  const openEditSaving = (cf: CarFund) => {
    setSavingForm({
      vehicle_name: cf.vehicle_name,
      target_price: String(cf.target_price),
      tax_fees: String(cf.tax_fees),
      down_payment_goal: String(cf.down_payment_goal),
      gift_contribution: cf.gift_contribution ? String(cf.gift_contribution) : '',
      current_saved: String(cf.current_saved),
      monthly_insurance: String(cf.monthly_insurance),
      expected_apr: String(cf.expected_apr),
      loan_term_months: String(cf.loan_term_months),
      linked_account: cf.linked_account ?? '',
      linked_rule_id: cf.linked_rule_id ?? '',
      planned_purchase_date: cf.planned_purchase_date ?? '',
      payment_start_date: cf.payment_start_date ?? '',
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
      loan_payment_account: cf.loan_payment_account ?? '',
    });
    setEditId(cf.id); setShowLoanForm(true);
  };

  const handleSaveSaving = () => {
    if (!savingForm.vehicle_name) return;
    if (!savingForm.planned_purchase_date) {
      toast.error('Planned Purchase Date is required.');
      return;
    }
    if (!savingForm.payment_start_date) {
      toast.error('Planned First Payment Date is required.');
      return;
    }
    const { clean: cleanVehicleName, flagged: vNameFlagged } = filterProfanity(savingForm.vehicle_name.trim().slice(0, LIMITS.vehicleName));
    if (vNameFlagged) toast.warning('Vehicle name contained inappropriate language and was cleaned.');
    const linkedAccount = savingForm.linked_account || null;
    const linkedRule = savingForm.linked_rule_id
      ? (rules as any[]).find((r: any) => r.id === savingForm.linked_rule_id)
      : null;
    const effectiveSaved = linkedAccount && accountMap[linkedAccount]
      ? Number(accountMap[linkedAccount].balance)
      : parseFloat(savingForm.current_saved) || 0;
    const payload = {
      vehicle_name: cleanVehicleName,
      target_price: parseFloat(savingForm.target_price) || 0,
      tax_fees: parseFloat(savingForm.tax_fees) || 0,
      down_payment_goal: parseFloat(savingForm.down_payment_goal) || 0,
      gift_contribution: parseFloat(savingForm.gift_contribution) || 0,
      current_saved: effectiveSaved,
      monthly_insurance: parseFloat(savingForm.monthly_insurance) || 0,
      expected_apr: parseFloat(savingForm.expected_apr) || 0,
      loan_term_months: parseInt(savingForm.loan_term_months) || 60,
      linked_account: linkedAccount,
      linked_rule_id: linkedRule?.id ?? null,
      planned_purchase_date: savingForm.planned_purchase_date || null,
      phase: 'saving' as const,
      // Pre-planned, ahead of activation — BuyItDialog prefills payment_start_date from this
      // instead of always defaulting to next-month. loan_start_date is intentionally left null
      // here — planned_purchase_date IS the loan's start date while saving (no separate field;
      // they're the same real-world date), and BuyItDialog/generateCarLoanTransactions both fall
      // back to planned_purchase_date when loan_start_date isn't set. Populating payment_start_date
      // here has no effect until the user actually hits "I bought it" — every loan-payment/
      // insurance calculation gates on phase === 'loan' first.
      loan_amount: 0, loan_start_date: null,
      payment_start_date: savingForm.payment_start_date || null,
      interest_start_date: null, actual_monthly_payment: 0,
    };
    if (editId) update.mutate({ id: editId, ...payload });
    else add.mutate(payload);
    setShowSavingForm(false);
  };

  const handleSaveLoan = () => {
    if (!loanForm.vehicle_name) return;
    if (!loanForm.loan_start_date) {
      toast.error('Loan Start Date is required.');
      return;
    }
    if (!loanForm.payment_start_date) {
      toast.error('First Payment Date is required.');
      return;
    }
    const { clean: cleanLoanVehicleName } = filterProfanity(loanForm.vehicle_name.trim().slice(0, LIMITS.vehicleName));
    const payload: any = {
      vehicle_name: cleanLoanVehicleName,
      loan_amount: parseFloat(loanForm.loan_amount) || 0,
      expected_apr: parseFloat(loanForm.expected_apr) || 0,
      loan_term_months: parseInt(loanForm.loan_term_months) || 60,
      loan_start_date: loanForm.loan_start_date || null,
      payment_start_date: loanForm.payment_start_date || null,
      interest_start_date: loanForm.interest_start_date || loanForm.payment_start_date || null,
      actual_monthly_payment: parseFloat(loanForm.actual_monthly_payment) || 0,
      monthly_insurance: parseFloat(loanForm.monthly_insurance) || 0,
      loan_payment_account: loanForm.loan_payment_account || null,
      phase: 'loan' as const,
    };
    // Only zero out saving-phase identity fields when creating a brand-new direct loan (no
    // saving-phase history exists to preserve). Editing an EXISTING loan — even just to tweak the
    // APR or term — must NOT touch these: this record may have come from a saving-phase car fund,
    // and overwriting them here destroyed that history permanently (Undo had no way to recover
    // it, since it assumes these fields were never touched). Supabase's .update() is a partial
    // PATCH, so omitting them on edit preserves whatever is already there.
    if (!editId) {
      payload.target_price = 0; payload.tax_fees = 0; payload.down_payment_goal = 0; payload.current_saved = 0;
      payload.linked_account = null; payload.linked_rule_id = null; payload.planned_purchase_date = null;
    }
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

  const handleUndo = (cf: CarFund) => {
    if (undoConfirm === cf.id) {
      update.mutate({
        id: cf.id,
        phase: 'saving',
        loan_amount: 0,
        loan_start_date: null,
        // payment_start_date is preserved, not nulled — it's a required saving-phase field now
        // (planned first-payment date), and the user already had a real planned value here.
        // Nulling it lost their plan on every undo and violated the "always required" invariant.
        interest_start_date: null,
        actual_monthly_payment: 0,
        // restore original saving-phase fields
        target_price: cf.target_price,
        tax_fees: cf.tax_fees,
        down_payment_goal: cf.down_payment_goal,
        current_saved: cf.current_saved,
        monthly_insurance: cf.monthly_insurance,
        expected_apr: cf.expected_apr,
        loan_term_months: cf.loan_term_months,
      });
      setUndoConfirm(null);
      setActiveTab('saving');
      toast.success('Reverted to saving phase');
    } else {
      setUndoConfirm(cf.id);
      setTimeout(() => setUndoConfirm(null), 3000);
    }
  };

  if (loading) return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto space-y-5 overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-32 bg-muted/50" />
          <Skeleton className="h-3 w-52 bg-muted/50" />
        </div>
        <Skeleton className="h-8 w-36 bg-muted/50" />
      </div>
      {/* Tab strip */}
      <div className="flex gap-2">
        <Skeleton className="h-8 w-28 bg-muted/50" />
        <Skeleton className="h-8 w-24 bg-muted/50" />
      </div>
      {/* Vehicle cards */}
      {[0, 1].map(i => (
        <div key={i} className="card-forged p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-40 bg-muted/50" />
              <Skeleton className="h-3 w-24 bg-muted/50" />
            </div>
            <Skeleton className="h-6 w-16 bg-muted/50" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map(j => (
              <div key={j} className="space-y-1">
                <Skeleton className="h-2.5 w-16 bg-muted/50" />
                <Skeleton className="h-4 w-20 bg-muted/50" />
              </div>
            ))}
          </div>
          <Skeleton className="h-2 w-full bg-muted/50 rounded-full" />
          <div className="flex gap-2 justify-end">
            <Skeleton className="h-7 w-16 bg-muted/50" />
            <Skeleton className="h-7 w-20 bg-muted/50" />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto space-y-5 overflow-x-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Vehicles</h1>
            <InstructionsModal pageTitle="Vehicles Guide" sections={[
              { title: 'Two phases', body: 'Saving phase: track your down payment goal and preview loan costs. Set a planned purchase date to anchor the Forecast transition. Loan phase: enter your actual loan terms and track full amortization to payoff.' },
              { title: 'Planned Purchase Date', body: 'Set the month you plan to buy. In the Forecast, saving contributions stop that month, the down payment is shown as an outflow, and the projected loan payment starts the following month. Estimated values are used until you hit "I bought it."' },
              { title: 'Linked Account', body: 'Link your savings account to auto-pull the current balance as your down payment progress. When linked, "Current Saved" in the form is skipped — the live balance is used instead.' },
              { title: 'Transfer Rule', body: 'Link a recurring transfer rule to auto-sync the monthly contribution amount for the estimated completion date.' },
              { title: 'I bought it', body: 'Hit "I bought it" to enter your real loan amount, APR, start date, first payment date, and interest start date. If you clicked by accident, use the undo button on the loan card.' },
              { title: 'Undo Purchase', body: 'The undo button (↩) on a loan card reverts back to saving phase. Click once to see "Confirm?", click again to revert. Your saving-phase details are preserved.' },
              { title: 'Connects to Forecast', body: 'Active loan payments appear as "Car Loan Payments" in the Forecast drawer. Projected loans for saving-phase vehicles appear as "Est. Car Loan (projected)" starting the month after the planned purchase date.' },
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
              <p className="text-xs text-muted-foreground mt-0.5">Jordan has a planned purchase date set for the Civic — the Forecast shows the down payment outflow that month and projected loan payments starting the following month.</p>
            </div>
          </div>
          <div className="mt-2 flex justify-end">
            <Link to="/auth" className="text-xs font-semibold text-primary hover:underline">Use with your own data →</Link>
          </div>
        </div>
      )}

      <PremiumGate
        isPremium={isPremium || isDemo}
        title="Vehicle Tracker — Premium Feature"
        features={[
          'Track down payment savings with auto account balance sync',
          'Full loan amortization from purchase to payoff',
          'Set a planned purchase date and see it wired into the 36-month Forecast',
          'Gift/contribution tracking reduces your personal savings target',
        ]}
      >

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
          {savingVehicles.map((cf: any) => {
            const linkedAccount = cf.linked_account ? accountMap[cf.linked_account] : null;
            const linkedRule = cf.linked_rule_id
              ? (rules as any[]).find((r: any) => r.id === cf.linked_rule_id)
              : null;
            const displayCf: CarFund = linkedAccount
              ? { ...cf, current_saved: Number(linkedAccount.balance) }
              : cf;
            const monthlyContrib = linkedRule
              ? toMonthly(Number(linkedRule.amount), linkedRule.frequency)
              : 0;
            // Compute monthly needed when no transfer rule is linked
            const computedMonthlyNeeded = (() => {
              if (monthlyContrib > 0) return 0; // rule handles it
              const gift = Number(cf.gift_contribution) || 0;
              const personalGoal = Math.max(0, cf.down_payment_goal - gift);
              const effectiveSaved = linkedAccount ? Number(linkedAccount.balance) : Number(cf.current_saved);
              const rem = Math.max(0, personalGoal - effectiveSaved);
              if (rem <= 0) return 0;
              const now = new Date();
              let savingMonths = 13; // default: this month + 12 future
              if (cf.planned_purchase_date) {
                const parts = (cf.planned_purchase_date as string).split('-').map(Number);
                const pd = new Date(parts[0], parts[1] - 1, parts[2]);
                const diff = (pd.getFullYear() - now.getFullYear()) * 12 + (pd.getMonth() - now.getMonth());
                savingMonths = Math.max(1, diff + 1); // include the purchase month
              }
              return Math.min(rem / savingMonths, rem);
            })();
            return (
              <SavingCard
                key={cf.id}
                cf={displayCf}
                onEdit={() => openEditSaving(cf)}
                onDelete={() => handleDelete(cf.id)}
                onBuyIt={() => setBuyItFor(cf)}
                deleteConfirm={deleteConfirm === cf.id}
                linkedAccountName={linkedAccount?.name ?? null}
                monthlyContrib={monthlyContrib}
                computedMonthlyNeeded={computedMonthlyNeeded}
                onSaveLumpSums={(lumps) => update.mutate({ id: cf.id, lump_sum_payments: lumps })}
                liquidCash={liquidCash}
                availableAboveFloor={availableAboveFloor}
              />
            );
          })}
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
              onUndo={() => handleUndo(cf)}
              deleteConfirm={deleteConfirm === cf.id}
              undoConfirm={undoConfirm === cf.id}
              onSaveLumpSums={(lumps) => update.mutate({ id: cf.id, lump_sum_payments: lumps })}
              liquidCash={liquidCash}
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

      </PremiumGate>

      {buyItFor && (
        <BuyItDialog cf={buyItFor} accountOptions={accountOptions} onConfirm={handleBuyIt} onClose={() => setBuyItFor(null)} />
      )}

      {showSavingForm && (
        <FormModal
          title={editId ? 'Edit Vehicle Goal' : 'Add Vehicle Goal'}
          fields={savingFormFields}
          values={savingForm}
          onChange={(k, v) => setSavingForm(prev => {
            const next = { ...prev, [k]: v };
            // Auto-suggest a first-payment date one month after purchase — matches the
            // purchaseMonthIdx + 1 relationship the saving-phase projection already assumes.
            // Only fills it in if it's not already set, so it never overwrites a manual edit.
            if (k === 'planned_purchase_date' && v && !prev.payment_start_date) {
              next.payment_start_date = addMonthsStr(v, 1);
            }
            return next;
          })}
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
            { key: 'loan_payment_account', label: 'Monthly Payment Account', type: 'select', options: accountOptions },
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
