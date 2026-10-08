import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useSubscription } from '@/hooks/useSubscription';
import { useDemo } from '@/contexts/DemoContext';

// LAZY: the sheet is only paid for by someone who presses `+`.
const QuickAddSheet = lazy(() => import('@/components/shared/QuickAddSheet'));

interface QuickAddValue {
  /** Opens the quick-add sheet, or sends a user without manual entry to /premium. */
  openQuickAdd: () => void;
  /** Whether pressing it adds (true) or upsells (false). Doors show a crown when false. */
  canQuickAdd: boolean;
}

const QuickAddContext = createContext<QuickAddValue>({ openQuickAdd: () => {}, canQuickAdd: false });

/**
 * One sheet for every door into it (the bottom bar's `+`, Home's Add button), mounted once in
 * `DashboardLayout`.
 *
 * ⚠️ THE GATE IS THE EXISTING ONE, NOT A NEW PRICING DECISION. Manual entry is `isPremium || isDemo`
 * on the Transactions page (its Add Transaction button is a crowned /premium link otherwise), and
 * this reads the same two flags. Whether quick add should be free is Tre's call (handoff R-NOW39).
 */
export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { isPremium } = useSubscription();
  const { isDemo } = useDemo();
  const canQuickAdd = isPremium || isDemo;

  const openQuickAdd = useCallback(() => {
    if (canQuickAdd) setOpen(true);
    else navigate('/premium');
  }, [canQuickAdd, navigate]);

  const value = useMemo(() => ({ openQuickAdd, canQuickAdd }), [openQuickAdd, canQuickAdd]);

  return (
    <QuickAddContext.Provider value={value}>
      {children}
      {open && (
        <Suspense fallback={null}>
          <QuickAddSheet onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </QuickAddContext.Provider>
  );
}

export function useQuickAdd() {
  return useContext(QuickAddContext);
}
