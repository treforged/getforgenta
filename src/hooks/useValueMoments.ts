import { useEffect, useRef } from 'react';
import { reportValueEvents } from '@/hooks/useInAppReview';
import type { ValueEvent } from '@/lib/review-moment';

/**
 * Watches the dashboard's own figures for a moment worth asking about, and reports it once.
 *
 * WHY IT LIVES HERE rather than at each page that owns the fact: the dashboard is the one surface
 * that already holds goals, debts and the projection together, so it can see all four value
 * events without three pages each learning about reviews. It is the same reasoning as
 * `useNotificationCheck` beside it, and deliberately the same shape — assemble what is true,
 * hand it over, keep no judgement here.
 *
 * ⚠️ EVERY EVENT BELOW IS PAST TENSE OR PRESENTLY TRUE. Nothing here fires on a forecast of good
 * news, and nothing fires on bad news at all. The old counter would ask for a rating right after
 * a user finished typing in a form; the point of this file is that we only ask right after the
 * app has given them something.
 */

export interface ValueMomentInputs {
  /**
   * Savings goals and debts, as the dashboard holds them — which is as PARTIAL rows, because the
   * page's queries select subsets. The fields are optional here for that reason, and every read
   * below treats a missing figure as "not a value event" rather than as zero.
   */
  goals: readonly { current_amount?: number | string | null; target_amount?: number | string | null }[];
  debts: readonly { balance?: number | string | null }[];
  /** True once at least one account is linked — without it there is no picture to be positive about. */
  hasLinkedAccounts: boolean;
  /** Projected cash for month 0, or null while there is no projection. */
  projectedCash: number | null;
  /** The effective floor for month 0. */
  cashFloor: number;
  /** False in demo, in partner view, or while the figures are still loading. */
  enabled: boolean;
}

/**
 * Which value events are true right now. Exported and PURE so the mapping can be tested without
 * a React tree — the mapping is where a wrong comparison becomes a prompt spent on nothing.
 */
export function detectValueEvents(inputs: ValueMomentInputs): ValueEvent[] {
  const events: ValueEvent[] = [];

  // A goal that has REACHED its target. A target of zero is not a goal — without that guard
  // every empty row would be a celebration.
  const reached = inputs.goals.some(goal => {
    const target = Number(goal.target_amount ?? NaN);
    const current = Number(goal.current_amount ?? NaN);
    // NaN fails every comparison, which is the wanted behaviour: an unreadable figure is not a
    // celebration. `>=` because an over-funded goal is still reached.
    return target > 0 && current >= target;
  });
  if (reached) events.push('goal_reached');

  // A debt at zero. Only counts if there IS a debt row: a user with no debts has not cleared one.
  const cleared = inputs.debts.length > 0 && inputs.debts.some(debt =>
    debt.balance !== undefined && debt.balance !== null && Number(debt.balance) === 0);
  if (cleared) events.push('debt_cleared');

  // The complete positive picture: linked accounts, a real projection, and it clears the floor.
  // `projectedCash === null` is "no projection", never zero — a zero here would read as broke.
  if (inputs.hasLinkedAccounts && inputs.projectedCash !== null && inputs.projectedCash >= inputs.cashFloor) {
    events.push('first_positive_projection');
  }

  return events;
}

export function useValueMoments(inputs: ValueMomentInputs): void {
  const ranRef = useRef(false);
  useEffect(() => {
    if (!inputs.enabled || ranRef.current) return;
    ranRef.current = true;
    const events = detectValueEvents(inputs);
    if (events.length === 0) return;
    // ONE call with all of them. `review-moment.ts` owns which wins and whether the single
    // available prompt is spent at all; reporting them one at a time would race over the same
    // stored state and could spend two of the store's quota on one render.
    void reportValueEvents(events);
    // Keyed on `enabled` alone, like useNotificationCheck: re-running as the figures settle would
    // ask the same question with a half-loaded dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs.enabled]);
}
