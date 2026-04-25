import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  profile: any;
  accounts: any[];
  debts: any[];
  goals: any[];
  plaidItems: any[];
}

interface ChecklistItem {
  label: string;
  description: string;
  path: string;
  done: boolean;
}

export default function OnboardingChecklist({ profile, accounts, debts, goals, plaidItems }: Props) {
  const { user } = useAuth();
  const [visible, setVisible] = useState(true);
  const markedRef = useRef(false);

  const items: ChecklistItem[] = [
    {
      label: 'Connect a bank account',
      description: 'Link via Plaid or add an account manually',
      path: '/accounts',
      done: plaidItems.length > 0 || accounts.length > 0,
    },
    {
      label: 'Set your income',
      description: 'Gross pay, deductions, and paycheck frequency',
      path: '/budget',
      done: Number((profile as any)?.gross_income) > 0,
    },
    {
      label: 'Add a debt',
      description: 'Credit cards and loans for the payoff engine',
      path: '/debt',
      done: debts.length > 0,
    },
    {
      label: 'Create a savings goal',
      description: 'Emergency fund, vacation, down payment, and more',
      path: '/savings',
      done: goals.length > 0,
    },
  ];

  const doneCount = items.filter(i => i.done).length;
  const allDone = doneCount === items.length;

  // When all items are checked, mark onboarding complete then fade out.
  useEffect(() => {
    if (!allDone || markedRef.current || !user) return;
    markedRef.current = true;
    supabase
      .from('profiles')
      .update({ onboarding_completed: true } as any)
      .eq('user_id', user.id)
      .then(() => {
        setTimeout(() => setVisible(false), 1200);
      });
  }, [allDone, user]);

  if (!visible) return null;

  return (
    <div
      className={`card-forged p-4 border-primary/20 space-y-3 transition-opacity duration-700 ${allDone ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-5 bg-primary rounded-full shrink-0" />
          <p className="text-xs font-semibold">Set up your financial profile</p>
        </div>
        <p className="text-[10px] text-muted-foreground tabular-nums">{doneCount}/{items.length} done</p>
      </div>

      {/* Mini progress bar */}
      <div className="h-0.5 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${(doneCount / items.length) * 100}%` }}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map(item => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex items-start gap-3 p-3 border transition-colors btn-press ${
              item.done
                ? 'border-success/30 bg-success/5 opacity-60 pointer-events-none'
                : 'border-border hover:border-primary/30 hover:bg-primary/5'
            }`}
            style={{ borderRadius: 'var(--radius)' }}
          >
            <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
              item.done ? 'bg-success border-success' : 'border-muted-foreground'
            }`}>
              {item.done && <Check size={9} className="text-white" />}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium leading-snug">{item.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{item.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
