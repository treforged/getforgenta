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

const CHECKLIST_KEYS = ['accounts', 'budget', 'debt', 'goals'] as const;
type ChecklistKey = typeof CHECKLIST_KEYS[number];

function getTourFlags(profile: any): Record<string, boolean> {
  return ((profile as any)?.tour_flags as Record<string, boolean>) ?? {};
}

async function markChecklistDone(userId: string, key: ChecklistKey, existing: Record<string, boolean>) {
  await supabase
    .from('profiles')
    .update({ tour_flags: { ...existing, [`checklist_${key}`]: true } })
    .eq('user_id', userId);
}

export default function OnboardingChecklist({ profile, accounts, debts, goals, plaidItems }: Props) {
  const { user } = useAuth();
  const [visible, setVisible] = useState(true);
  const markedRef = useRef(false);
  const [overrides, setOverrides] = useState<Record<ChecklistKey, boolean>>({
    accounts: false, budget: false, debt: false, goals: false,
  });

  // Load manual overrides from tour_flags on mount / profile change
  useEffect(() => {
    const flags = getTourFlags(profile);
    setOverrides({
      accounts: !!flags['checklist_accounts'],
      budget:   !!flags['checklist_budget'],
      debt:     !!flags['checklist_debt'],
      goals:    !!flags['checklist_goals'],
    });
  }, [profile]);

  const items: { key: ChecklistKey; label: string; description: string; path: string; autoDone: boolean }[] = [
    {
      key: 'accounts',
      label: 'Connect a bank account',
      description: 'Link via Plaid or add an account manually',
      path: '/accounts',
      autoDone: plaidItems.length > 0 || accounts.length > 0,
    },
    {
      key: 'budget',
      label: 'Set your income',
      description: 'Gross pay, deductions, and paycheck frequency',
      path: '/budget',
      autoDone: Number((profile as any)?.gross_income) > 0,
    },
    {
      key: 'debt',
      label: 'Add a debt',
      description: 'Credit cards and loans for the payoff engine',
      path: '/debt',
      autoDone: debts.length > 0,
    },
    {
      key: 'goals',
      label: 'Create a savings goal',
      description: 'Emergency fund, vacation, down payment, and more',
      path: '/goals',
      autoDone: goals.length > 0,
    },
  ];

  const itemsWithDone = items.map(i => ({ ...i, done: i.autoDone || overrides[i.key] }));
  const doneCount = itemsWithDone.filter(i => i.done).length;
  const allDone = doneCount === itemsWithDone.length;

  const handleMarkDone = async (e: React.MouseEvent, key: ChecklistKey) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return;
    const flags = getTourFlags(profile);
    setOverrides(prev => ({ ...prev, [key]: true }));
    await markChecklistDone(user.id, key, flags);
  };

  // When all items are checked, mark onboarding complete then fade out
  useEffect(() => {
    if (!allDone || markedRef.current || !user) return;
    markedRef.current = true;
    supabase
      .from('profiles')
      .update({ onboarding_completed: true })
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
        <p className="text-[10px] text-muted-foreground tabular-nums">{doneCount}/{itemsWithDone.length} done</p>
      </div>

      <div className="h-0.5 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${(doneCount / itemsWithDone.length) * 100}%` }}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {itemsWithDone.map(item => (
          <div key={item.key} className="relative">
            <Link
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
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium leading-snug">{item.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{item.description}</p>
              </div>
            </Link>
            {!item.done && (
              <button
                onClick={e => handleMarkDone(e, item.key)}
                className="absolute top-2 right-2 text-[10px] text-muted-foreground hover:text-success px-1.5 py-0.5 rounded border border-transparent hover:border-success/30 transition-colors"
              >
                Mark done
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
