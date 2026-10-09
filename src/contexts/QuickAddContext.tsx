import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Capacitor } from '@capacitor/core';
import { useSubscription } from '@/hooks/useSubscription';
import { useDemo } from '@/contexts/DemoContext';
import { canAddTransactions } from '@/lib/manual-entry-gate';
import { wantsQuickAdd, withoutQuickAdd } from '@/lib/quick-add-link';

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
 * ⚠️ FREE ON WEB, GATED IN THE NATIVE APP (Tre, 2026-10-09, relayed by Sam: "make quick add free on
 * web?" - "yes"; the full Add Transaction form followed the same day). The rule lives in
 * `canAddTransactions` so this door and the Transactions page's button cannot disagree: a web free
 * user gets the sheet, a native free user is sent to /premium.
 */
export function QuickAddProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { isPremium } = useSubscription();
  const { isDemo } = useDemo();
  const canQuickAdd = canAddTransactions({ isPremium, isDemo, isNative: Capacitor.isNativePlatform() });
  const [open, setOpen] = useState(() => canQuickAdd && wantsQuickAdd(search));

  const openQuickAdd = useCallback(() => {
    if (canQuickAdd) setOpen(true);
    else navigate('/premium');
  }, [canQuickAdd, navigate]);

  // `?quickadd=1` (the email link, quick-add-link.ts): the sheet starts open (see useState above),
  // and the param leaves the URL so a reload or Back does not reopen it.
  useEffect(() => {
    if (wantsQuickAdd(search)) navigate(`${pathname}${withoutQuickAdd(search)}`, { replace: true });
  }, [pathname, search, navigate]);

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
