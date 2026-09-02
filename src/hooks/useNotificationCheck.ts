import { useEffect, useRef } from 'react';
import { runNotificationCheck } from '@/lib/notification-service';
import type { NotificationSignals } from '@/lib/notification-policy';

/**
 * The caller that makes the notification feature exist.
 *
 * The policy (`notification-policy.ts`) decides and the service
 * (`notification-service.ts`) schedules, but until this hook shipped NOTHING invoked either, so
 * all of it was inert. This is deliberately the thinnest possible layer: it assembles signals from
 * data the dashboard already has and hands them over. No judgement lives here.
 *
 * ONCE PER MOUNT, not per render and not on a timer. The policy's own gates (quiet hours, three a
 * week, twenty hours apart) decide whether anything is actually sent, so a user who opens the
 * dashboard six times in a morning is silent after the first. A timer here would duplicate a
 * decision the policy already owns.
 */

/** What the dashboard can supply truthfully. Anything it cannot source is absent, never guessed. */
export interface NotificationCheckInputs {
  /** `getAugmentedMinSafeCash` output for month 0 — the EFFECTIVE floor, not the raw setting. */
  monthMinSafe: number;
  /** Fixed obligations for the month, as the floor already itemises them. */
  floorItems: readonly { name: string; amount: number; dueDay: number }[];
  /**
   * `month0.chain.cashPreDebt` — cash before debt payments, which is the figure the dashboard
   * already compares against the floor. Pass `null` when there is no projection rather than
   * substituting month-end cash: they answer different questions, and a bill warning built on the
   * wrong one is a false alarm about money.
   */
  cashPreDebt: number | null;
  netWorth: number | null;
  monthEndCash: number | null;
  /** `plaid_items.last_synced_at` for the funding account, ISO, or null when never synced. */
  lastAccountSyncAt: string | null;
  /** False in demo, partner view, or while the figures are still loading. */
  enabled: boolean;
}

/** `YYYY-MM-DD` for a day-of-month in the month `now` falls in, clamped to that month's length. */
function dueDateThisMonth(now: Date, dueDay: number): string {
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = Math.min(Math.max(dueDay, 1), lastDay);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Assemble the signals. Exported and PURE so the mapping can be tested without a React tree —
 * the mapping is where a wrong field silently becomes a wrong notification.
 *
 * ⚠️ `nextMonthProjectedEndingCash`, `nextMonthFloor` and `newMilestones` are deliberately absent.
 * The dashboard does not hold the forecast rows they need, and the policy treats missing signals
 * as "that candidate does not apply" rather than as zero. So the floor-risk and milestone
 * notifications simply do not fire from here yet; they need a caller that has the projection.
 * Passing zeros to light them up would invent warnings out of absent data.
 */
export function buildNotificationSignals(
  inputs: NotificationCheckInputs,
  now: Date,
): NotificationSignals {
  return {
    now,
    upcomingBills: inputs.floorItems.map(it => ({
      name: it.name,
      amount: it.amount,
      dueDate: dueDateThisMonth(now, it.dueDay),
    })),
    // Infinity, not 0, when there is no projection: it means "cannot be short", so the bill
    // warning stays silent instead of firing on absent data. A 0 here would claim he is broke.
    projectedCashAtNextBill: inputs.cashPreDebt ?? Number.POSITIVE_INFINITY,
    cashFloor: inputs.monthMinSafe,
    nextMonthProjectedEndingCash: null,
    nextMonthFloor: null,
    newMilestones: [],
    lastAccountSyncAt: inputs.lastAccountSyncAt,
    netWorth: inputs.netWorth,
    monthEndCash: inputs.monthEndCash,
  };
}

export function useNotificationCheck(inputs: NotificationCheckInputs): void {
  const ranRef = useRef(false);
  useEffect(() => {
    if (!inputs.enabled || ranRef.current) return;
    ranRef.current = true;
    // Fire and forget. `runNotificationCheck` swallows its own failures and returns null, so
    // nothing here can reach the screen that mounted it.
    void runNotificationCheck(buildNotificationSignals(inputs, new Date()));
    // Intentionally keyed on `enabled` alone: this runs once per mount, and re-running as the
    // figures settle would ask the policy the same question with a half-loaded dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs.enabled]);
}
