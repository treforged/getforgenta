import { Suspense, lazy } from 'react';
import SurfaceGuide from '@/components/shared/SurfaceGuide';
import { ViewModeSwitch } from '@/components/shared/ViewModeSwitch';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import { useViewMode } from '@/hooks/useViewMode';

const BudgetControl = lazy(() => import('@/pages/BudgetControl'));

/**
 * PLAN, AS ITS OWN BOTTOM-BAR DESTINATION — Tre, 2026-10-06 (decision c5e29d9e, ask 6cdc485c):
 * Plan takes Garage's slot. Competitors give budgeting a bottom-bar slot; ours sat as the first
 * panel inside Transactions.
 *
 * The header mirrors Transactions (title, guide, view switch) and `BudgetControl` renders
 * `embedded`, exactly as it did inside that page, so the rules screen itself is unchanged.
 * The guide is the 'plan' surface, which reads the same 'transactions:budget' copy as before.
 */
export default function Plan() {
  const { mode: viewMode, setMode: setViewMode } = useViewMode();
  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto stack-section overflow-x-hidden">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Plan</h1>
          <div className="ml-auto">
            <SurfaceGuide surface="plan" />
          </div>
        </div>
        <div className="flex justify-center sm:justify-end">
          <ViewModeSwitch mode={viewMode} onChange={setViewMode} />
        </div>
      </div>
      <Suspense fallback={<div className="h-64" />}>
        <ErrorBoundary variant="widget" label="Plan">
          <BudgetControl embedded simple={viewMode === 'simple'} />
        </ErrorBoundary>
      </Suspense>
    </div>
  );
}
