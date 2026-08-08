/**
 * useAutoEndReconcile — 97.3's re-stamping for the two trigger sites that are not the goal form.
 *
 * The goal form owns the toggle and calls `planAutoEndWrites` directly (it is the only site
 * allowed to CLEAR a stamp). But the stamped `recurring_rules.end_date` is derived from inputs
 * the goal form does not own — the linked rule's amount/frequency/start date, and the linked
 * account's balance. When one of those moves, the stamp goes stale, and the stale-EARLY
 * direction is a real defect: the stamp is a genuine end_date that forecast-engine.ts:785
 * hard-skips past, while goal-linkage.ts (4b) can only ever stop a rule EARLIER, never resume
 * one. A stamp left too early therefore starves the goal in the forecast with no backstop.
 *
 * Two callers:
 *  - `reconcile(rulesOverride?)` — imperative, for Budget Control's rule save.
 *  - `useAutoEndSyncReconcile()` — the balance-sync landing.
 *
 * ## Why the sync landing is handled here and not in the sync edge function
 *
 * Balances land server-side (`_shared/sync-handler.ts`), driven by the `plaid-daily-sync` cron
 * job with no client present. Re-stamping there would mean porting `savings-growth` +
 * `goal-linkage` into Deno — a second copy of the compounding projection, which is precisely
 * the drift class this feature was built to avoid (see goal-auto-end.ts's header). It is also
 * unnecessary: nothing server-side READS the stamp. It is consumed only by the forecast engine
 * and the Budget Control rule list, both client-side, so a stamp refreshed when the app next
 * opens is indistinguishable from one refreshed at cron time. A stale stamp is unobservable
 * while the app is closed.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { useAccounts, useRecurringRules, useSavingsGoals } from '@/hooks/useSupabaseData';
import {
  planAutoEndReconcile,
  type AutoEndRuleLike,
  type AutoEndGoalRow,
} from '@/lib/goal-auto-end';

export function useAutoEndReconcile() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const { data: accounts, loading: accountsLoading } = useAccounts();
  const { data: rules, loading: rulesLoading } = useRecurringRules();
  const { data: savingsGoals, loading: goalsLoading } = useSavingsGoals();

  // A reconcile issues writes that invalidate the very queries it reads, so without this the
  // refetch could re-enter before the first pass has landed.
  const inFlight = useRef(false);

  const ready = !isDemo && !!user && !accountsLoading && !rulesLoading && !goalsLoading;

  /**
   * Re-plan every enabled goal and issue whatever moved. Returns the number of rules re-stamped.
   * A no-op at steady state — `planAutoEndReconcile` is idempotent, which is what makes it safe
   * to call from an effect.
   */
  const reconcile = useCallback(
    async (rulesOverride?: AutoEndRuleLike[]): Promise<number> => {
      if (!ready || !user || inFlight.current) return 0;

      const plan = planAutoEndReconcile({
        goals: (savingsGoals ?? []) as AutoEndGoalRow[],
        rules: (rulesOverride ?? rules ?? []) as AutoEndRuleLike[],
        accounts: accounts ?? [],
      });
      if (plan.ruleWrites.length === 0 && plan.goalWrites.length === 0) return 0;

      inFlight.current = true;
      try {
        // Rules first: the stamp map we persist onto the goal must never claim a date that
        // failed to land on the rule.
        for (const w of plan.ruleWrites) {
          const { error } = await supabase
            .from('recurring_rules')
            .update({ end_date: w.end_date })
            .eq('id', w.id)
            .eq('user_id', user.id);
          if (error) throw error;
        }
        for (const w of plan.goalWrites) {
          const { error } = await supabase
            .from('savings_goals')
            .update({ auto_end_stamped_rules: w.auto_end_stamped_rules as unknown as Json })
            .eq('id', w.id)
            .eq('user_id', user.id);
          if (error) throw error;
        }
      } catch (err) {
        // Never surface a raw DB error for a background pass the user did not ask for. The next
        // reconcile re-plans from scratch, so a failed pass costs nothing but a delay.
        console.error('auto-end reconcile failed:', err);
        return 0;
      } finally {
        inFlight.current = false;
        qc.invalidateQueries({ queryKey: ['recurring_rules'] });
        qc.invalidateQueries({ queryKey: ['savings_goals'] });
      }

      if (plan.conflicts.length > 0) {
        const names = plan.conflicts
          .map((c) => rules?.find((r) => r.id === c.ruleId)?.name ?? 'A rule')
          .join(', ');
        toast.warning(`${names} already has an end date you set — left unchanged.`);
      }
      return plan.ruleWrites.length;
    },
    [ready, user, savingsGoals, rules, accounts, qc],
  );

  return { reconcile, ready };
}

/**
 * The balance-sync landing. Runs whenever loaded account balances differ from what the current
 * stamps were derived from — which in practice means the first render after a cron sync's
 * balances arrive. Safe in an effect because a steady-state plan is empty, so this settles after
 * exactly one pass and then issues nothing.
 *
 * Mounted once, in DashboardLayout, so it covers every authenticated route rather than only the
 * pages that happen to show goals.
 */
export function useAutoEndSyncReconcile(): void {
  const { reconcile, ready } = useAutoEndReconcile();

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void reconcile().then((restamped) => {
      // This writes to the user's budget rules without them asking, so say so once when it
      // actually changed something. Silence would be worse than a toast here.
      if (!cancelled && restamped > 0) {
        toast.info(
          `Updated the stop date on ${restamped} contribution${restamped === 1 ? '' : 's'} after a balance sync.`,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, reconcile]);
}
