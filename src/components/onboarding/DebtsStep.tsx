// The wizard's debts step. Lifted out of Onboarding.tsx unchanged when that file absorbed the modal
// wizard's bank/upsell steps — the page was already at its size limit, and this was the second
// largest block in it.

import { CreditCard } from 'lucide-react';
import { Input } from './fields';
import { emptyDebt, totalDebtOf, type DebtEntry } from './types';

export default function DebtsStep({
  debts,
  onChange,
  hint,
}: {
  debts: DebtEntry[];
  onChange: (next: DebtEntry[]) => void;
  hint?: React.ReactNode;
}) {
  const totalDebt = totalDebtOf(debts);

  const updateDebt = (i: number, field: keyof DebtEntry, val: string) => {
    onChange(debts.map((d, j) => j === i ? { ...d, [field]: val } : d));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CreditCard size={15} className="text-primary" />
        <h2 className="font-display font-semibold text-sm">Credit Cards & Loans</h2>
      </div>
      {hint}
      <p className="text-[10px] text-muted-foreground">Add any debts you're paying down. Skip if none.</p>
      {debts.map((d, i) => (
        <div key={i} className="space-y-3 p-3 bg-secondary/40 border border-border" style={{ borderRadius: 'var(--radius)' }}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground uppercase">Debt {i + 1}</span>
            <button onClick={() => onChange(debts.filter((_, j) => j !== i))}
              className="text-[10px] text-destructive hover:underline">Remove</button>
          </div>
          <div className="space-y-1">
            <span className="text-[9px] text-muted-foreground uppercase">Card / loan name</span>
            <Input value={d.name} onChange={v => updateDebt(i, 'name', v)} placeholder="e.g. Chase Sapphire, Student Loan" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <span className="text-[9px] text-muted-foreground uppercase">Current balance</span>
              <Input value={d.balance} onChange={v => updateDebt(i, 'balance', v)} placeholder="0" type="number" prefix="$" />
            </div>
            <div className="space-y-1">
              <span className="text-[9px] text-muted-foreground uppercase">APR %</span>
              <Input value={d.apr} onChange={v => updateDebt(i, 'apr', v)} placeholder="0.0" type="number" />
            </div>
            <div className="space-y-1">
              <span className="text-[9px] text-muted-foreground uppercase">Min. payment</span>
              <Input value={d.minPayment} onChange={v => updateDebt(i, 'minPayment', v)} placeholder="0" type="number" prefix="$" />
            </div>
            <div className="space-y-1">
              <span className="text-[9px] text-muted-foreground uppercase">Credit limit</span>
              <Input value={d.creditLimit} onChange={v => updateDebt(i, 'creditLimit', v)} placeholder="0" type="number" prefix="$" />
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-[9px] text-muted-foreground uppercase">Payment due date (day of month)</span>
            <Input value={d.dueDate} onChange={v => updateDebt(i, 'dueDate', v)} placeholder="e.g. 15" type="number" />
            <p className="text-[9px] text-muted-foreground">You can link this to an account in Accounts for payment reminders.</p>
          </div>
        </div>
      ))}
      <button
        onClick={() => onChange([...debts, emptyDebt()])}
        className="w-full py-2.5 text-xs font-medium border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
        style={{ borderRadius: 'var(--radius)' }}
      >
        + Add a debt
      </button>
      {totalDebt > 0 && (
        <div className="bg-secondary/40 px-3 py-2 text-xs flex justify-between" style={{ borderRadius: 'var(--radius)' }}>
          <span className="text-muted-foreground">Total debt</span>
          <span className="font-semibold text-destructive">${totalDebt.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
