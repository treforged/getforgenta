import { useMemo } from 'react';
import { Edit2, Trash2, Car, Link2, CalendarClock } from 'lucide-react';
import ProgressBar from '@/components/shared/ProgressBar';
import { formatCurrency, calculateMonthlyPayment } from '@/lib/calculations';
import { buildAmortizationSchedule, type LumpSumPayment } from '@/lib/vehicle-loan-engine';
import type { CarFund } from '@/lib/types';
import LumpSumPanel from './LumpSumPanel';
import { addMonthsStr, fmtDate } from './vehicle-format';

/**
 * The saving-phase card: down-payment progress, what the loan would cost, and the extra payments
 * already planned against it.
 *
 * Lifted VERBATIM out of `Vehicles.tsx` on 2026-08-27 when the vehicle-money panels moved to
 * /debt's Auto Loans tab (Tre: "it makes more since there"). Same figures, same copy.
 */

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

export default function SavingCard({ cf, onEdit, onDelete, onBuyIt, deleteConfirm, linkedAccountName, monthlyContrib, onSaveLumpSums, liquidCash, availableAboveFloor, computedMonthlyNeeded }:
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
  // For linked-account cars, live balance is the truth - don't layer checking surplus on top.
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

  const lumpSums: LumpSumPayment[] = useMemo(
    () => Array.isArray(cf.lump_sum_payments) ? cf.lump_sum_payments : [],
    [cf.lump_sum_payments]
  );

  // Project the future loan so lump sums can be planned against it.
  // Use the stored payment_start_date when available so the projected schedule matches
  // Forecast/useCardProjection - falls back to purchase_date + 1 month for existing records.
  const projectedBase = useMemo(() => {
    if (!cf.planned_purchase_date) return null;
    const loanAmt = Math.max(0, cf.target_price + cf.tax_fees - cf.down_payment_goal);
    if (loanAmt <= 0 || cf.loan_term_months <= 0) return null;
    const payStart = cf.payment_start_date || addMonthsStr(cf.planned_purchase_date, 1);
    return buildAmortizationSchedule({
      loanAmount: loanAmt, apr: cf.expected_apr, termMonths: cf.loan_term_months,
      loanStartDate: cf.planned_purchase_date, paymentStartDate: payStart, interestStartDate: payStart,
      actualMonthlyPayment: 0,
    });
  }, [cf]);

  const projectedWithLumps = useMemo(() => {
    if (!projectedBase || lumpSums.length === 0) return projectedBase;
    const loanAmt = Math.max(0, cf.target_price + cf.tax_fees - cf.down_payment_goal);
    const payStart = cf.payment_start_date || addMonthsStr(cf.planned_purchase_date!, 1);
    return buildAmortizationSchedule({
      loanAmount: loanAmt, apr: cf.expected_apr, termMonths: cf.loan_term_months,
      loanStartDate: cf.planned_purchase_date!, paymentStartDate: payStart, interestStartDate: payStart,
      actualMonthlyPayment: 0, lumpSumPayments: lumpSums,
    });
  }, [projectedBase, lumpSums, cf]);

  const handleAddLump = (entries: LumpSumPayment[]) => onSaveLumpSums([...lumpSums, ...entries]);
  const handleRemoveLump = (ids: string[]) => onSaveLumpSums(lumpSums.filter(l => !ids.includes(l.id)));
  const handleReplaceLumps = (oldIds: string[], entries: { date: string; amount: number }[]) =>
    onSaveLumpSums([
      ...lumpSums.filter(l => !oldIds.includes(l.id)),
      ...entries.map(e => ({ id: crypto.randomUUID(), date: e.date, amount: e.amount })),
    ]);
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

      {/* projectedBase needs a planned purchase date + computable loan amount/term - when not yet
          set, the panel below still works (list + add), it just can't show payoff-date/interest-
          saved impact figures yet. Without the fallbacks here, the whole panel (including "Add")
          used to disappear entirely until those fields were filled in. */}
      <LumpSumPanel
        autoExtraOn={cf.auto_extra === true}
        schedule={projectedWithLumps?.schedule ?? projectedBase?.schedule ?? []}
        lumpSums={lumpSums}
        baseTotalInterest={projectedBase?.totalInterest ?? 0}
        withLumpsTotalInterest={projectedWithLumps?.totalInterest ?? projectedBase?.totalInterest ?? 0}
        basePayoffDate={projectedBase?.payoffDate ?? ''}
        withLumpsPayoffDate={projectedWithLumps?.payoffDate ?? projectedBase?.payoffDate ?? ''}
        onAdd={handleAddLump}
        onRemove={handleRemoveLump}
        onReplace={handleReplaceLumps}
        label="Projected Extra Payments"
        liquidCash={liquidCash}
      />

      <button
        onClick={onBuyIt}
        className="w-full flex items-center justify-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 text-xs font-medium btn-press"
        style={{ borderRadius: 'var(--radius)' }}
      >
        <Car size={12} /> I bought it - start loan tracking
      </button>
    </div>
  );
}
