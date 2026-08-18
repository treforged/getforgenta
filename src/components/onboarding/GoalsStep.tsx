// The wizard's goals step, including the Car Fund fields. Lifted out of Onboarding.tsx unchanged
// when that file absorbed the modal wizard's bank/upsell steps.

import { Car, Target } from 'lucide-react';
import { Input, Select } from './fields';
import { emptyGoal, GOAL_TYPES, type GoalEntry } from './types';

const MAX_GOALS = 3;

export default function GoalsStep({
  goals,
  onChange,
  hint,
}: {
  goals: GoalEntry[];
  onChange: (next: GoalEntry[]) => void;
  hint?: React.ReactNode;
}) {
  const updateGoal = (i: number, field: keyof GoalEntry, val: string) => {
    onChange(goals.map((g, j) => {
      if (j !== i) return g;
      const next = { ...g, [field]: val };
      if (field === 'goalType' && val !== 'Custom') {
        next.name = val;
      }
      return next;
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Target size={15} className="text-primary" />
        <h2 className="font-display font-semibold text-sm">Financial Goals</h2>
      </div>
      {hint}
      <p className="text-[10px] text-muted-foreground">What are you saving for? Add up to {MAX_GOALS} goals. Skip if none yet.</p>
      {goals.map((g, i) => {
        const isCarFund = g.goalType === 'Car Fund';
        return (
          <div key={i} className="space-y-3 p-3 bg-secondary/40 border border-border" style={{ borderRadius: 'var(--radius)' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {isCarFund ? <Car size={12} className="text-primary" /> : <Target size={12} className="text-primary" />}
                <span className="text-[10px] font-medium text-muted-foreground uppercase">Goal {i + 1}</span>
              </div>
              <button onClick={() => onChange(goals.filter((_, j) => j !== i))}
                className="text-[10px] text-destructive hover:underline">Remove</button>
            </div>

            <div className="space-y-1">
              <span className="text-[9px] text-muted-foreground uppercase">Goal type</span>
              <Select
                value={g.goalType}
                onChange={v => updateGoal(i, 'goalType', v)}
                options={GOAL_TYPES.map(t => ({ value: t, label: t }))}
              />
            </div>

            <div className="space-y-1">
              <span className="text-[9px] text-muted-foreground uppercase">{isCarFund ? 'Vehicle name' : 'Goal name'}</span>
              <Input
                value={g.name}
                onChange={v => updateGoal(i, 'name', v)}
                placeholder={isCarFund ? 'e.g. Porsche Cayman, Honda Civic' : 'e.g. Emergency Fund, Europe Trip'}
              />
            </div>

            {isCarFund ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-[9px] text-muted-foreground uppercase">Vehicle price</span>
                  <Input value={g.targetPrice} onChange={v => updateGoal(i, 'targetPrice', v)} placeholder="30000" type="number" prefix="$" />
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] text-muted-foreground uppercase">Tax & fees</span>
                  <Input value={g.taxFees} onChange={v => updateGoal(i, 'taxFees', v)} placeholder="3000" type="number" prefix="$" />
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] text-muted-foreground uppercase">Down payment goal</span>
                  <Input value={g.targetAmount} onChange={v => updateGoal(i, 'targetAmount', v)} placeholder="5000" type="number" prefix="$" />
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] text-muted-foreground uppercase">Monthly insurance</span>
                  <Input value={g.monthlyInsurance} onChange={v => updateGoal(i, 'monthlyInsurance', v)} placeholder="200" type="number" prefix="$" />
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] text-muted-foreground uppercase">Expected loan APR %</span>
                  <Input value={g.expectedApr} onChange={v => updateGoal(i, 'expectedApr', v)} placeholder="5.9" type="number" />
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] text-muted-foreground uppercase">Loan term (months)</span>
                  <Input value={g.loanTermMonths} onChange={v => updateGoal(i, 'loanTermMonths', v)} placeholder="60" type="number" />
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <span className="text-[9px] text-muted-foreground uppercase">Target amount</span>
                <Input value={g.targetAmount} onChange={v => updateGoal(i, 'targetAmount', v)} placeholder="0" type="number" prefix="$" />
              </div>
            )}
          </div>
        );
      })}
      {goals.length < MAX_GOALS && (
        <button
          onClick={() => onChange([...goals, emptyGoal()])}
          className="w-full py-2.5 text-xs font-medium border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          + Add a goal
        </button>
      )}
    </div>
  );
}
