import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { formatCurrency, calculateMonthlyPayment } from '@/lib/calculations';
import { getLoanPrincipal } from '@/lib/vehicle-loan-engine';
import type { CarFund } from '@/lib/types';
import { toLocalDateStr } from '@/lib/scheduling';

/**
 * "I bought it" — the dialog that turns a saving-phase plan into a real loan.
 *
 * Lifted VERBATIM out of `Vehicles.tsx` on 2026-08-27 when the vehicle-money panels moved to
 * /debt's Auto Loans tab.
 */

export default function BuyItDialog({ cf, accountOptions, autoLoanAccountOptions, onConfirm, onClose }:
  {
    cf: CarFund; accountOptions: { value: string; label: string }[];
    autoLoanAccountOptions: { value: string; label: string }[];
    onConfirm: (fields: Partial<CarFund>) => void; onClose: () => void;
  }) {
  const today = toLocalDateStr(new Date());
  const nextMonth = toLocalDateStr(new Date(new Date().setMonth(new Date().getMonth() + 1)));
  // getLoanPrincipal - same formula the saving-phase projection uses (Forecast.tsx/
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
    insurance_start_date: cf.insurance_start_date ?? '',
    linked_loan_account_id: cf.linked_loan_account_id ?? '',
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
      insurance_start_date: form.insurance_start_date || null,
      linked_loan_account_id: form.linked_loan_account_id || null,
    });
  };

  return (
    <div
      className="modal-overlay z-60"
      style={{ touchAction: 'none', background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <div
        className="card-forged w-full sm:max-w-sm flex flex-col rounded-(--radius)"
        style={{ maxHeight: '100%', paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-3 shrink-0 space-y-1">
          <h2 className="text-sm font-semibold">Start Loan Tracking - {cf.vehicle_name}</h2>
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
            { k: 'insurance_start_date', label: 'Insurance Start Date (if different from loan start)', type: 'date' },
          ].map(field => (
            <div key={field.k}>
              <label className="text-xs font-medium text-muted-foreground block mb-1">{field.label}</label>
              <input
                type={field.type}
                value={form[field.k as keyof typeof form]}
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
              Linked Loan Account <span className="text-muted-foreground/60">(same loan tracked as an account? link it so net worth doesn't count it twice)</span>
            </label>
            <select
              value={form.linked_loan_account_id}
              onChange={e => setForm(prev => ({ ...prev, linked_loan_account_id: e.target.value }))}
              className="w-full bg-secondary border border-border px-3 py-1.5 text-xs"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {autoLoanAccountOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
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
