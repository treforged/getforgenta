import { useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { useAccounts, useAssets, useCarFunds, useLiabilities, useNetWorthSnapshots } from '@/hooks/useSupabaseData';
import { aggregateNetWorth } from '@/lib/net-worth';
import { getActiveCarLoanPayments } from '@/lib/vehicle-loan-engine';
import { hasRecordableData, shouldRecordSnapshot } from '@/lib/net-worth-snapshot';

/**
 * Records a net-worth snapshot at most once every seven days.
 *
 * This lived inside `src/pages/NetWorth.tsx` until that page was replaced by a
 * redirect to `/accounts`, at which point it stopped running and snapshot
 * recording silently died (last row written 2026-05-22). It now hangs off the
 * Accounts page, which is where the history chart is actually read.
 *
 * Writes are fire-and-forget: no toast, no UI. Demo sessions never persist.
 */
export function useNetWorthSnapshotRecorder(): void {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const { data: accounts } = useAccounts();
  const { data: manualAssets } = useAssets();
  const { data: manualLiabilities } = useLiabilities();
  const { data: carFunds } = useCarFunds();
  const { data: snapshots, loading: snapshotsLoading, upsert } = useNetWorthSnapshots();

  const vehicleLoans = useMemo(() => getActiveCarLoanPayments(carFunds ?? []), [carFunds]);

  const totals = useMemo(
    () => aggregateNetWorth(accounts, manualAssets, manualLiabilities, vehicleLoans),
    [accounts, manualAssets, manualLiabilities, vehicleLoans],
  );

  // One attempt per mount, mirroring the original page behavior.
  const attempted = useRef(false);

  useEffect(() => {
    if (isDemo || !user || attempted.current) return;
    // Without the loaded history we cannot tell whether one is already due.
    if (snapshotsLoading) return;
    if (!hasRecordableData(totals)) return;
    if (!shouldRecordSnapshot(snapshots)) return;

    attempted.current = true;
    upsert.mutate(
      {
        snapshot_date: new Date().toISOString().split('T')[0],
        total_assets: totals.totalAssets,
        total_liabilities: totals.totalLiabilities,
        net_worth: totals.netWorth,
      },
      {
        onError: (error: unknown) => {
          // Let a later mount retry rather than staying stuck on a transient failure.
          attempted.current = false;
          console.error(
            'Net worth snapshot save failed:',
            error instanceof Error ? error.message : error,
          );
        },
      },
    );
  }, [isDemo, user, snapshots, snapshotsLoading, totals, upsert]);
}
