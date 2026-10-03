import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { useViewedProfile } from '@/contexts/ViewedProfileContext';
import { toLocalDateStr } from '@/lib/scheduling';
import type { CardPaymentTxn } from '@/lib/card-pay-behavior';

/** Matches card-pay-behavior's WINDOW_DAYS, so the helper sees every payment it would count. */
const HISTORY_DAYS = 120;

/**
 * Settled payments TO the given card accounts over the last 120 days, grouped by account id, for
 * inferCardPayBehavior (ask ec48da25). A payment to a card is a NEGATIVE amount on the card's own
 * account (checked on real rows 2026-10-03: "DIRECTPAY MINIMUM PAYMENT" -198.17), so only
 * amount < 0 is fetched - a few rows per card, never the purchase history.
 *
 * Demo mode returns nothing: there is no bank behind demo data, so there is no history to read.
 * Per-user RLS: reads only the viewed user's own rows, so it survives the data-layer change.
 */
export function useCardPayHistory(cardIds: string[]) {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const { viewedUserId } = useViewedProfile();
  const ids = [...cardIds].sort();
  return useQuery({
    queryKey: ['card_pay_history', isDemo ? 'demo' : (viewedUserId ?? user?.id), ids.join(',')],
    enabled: (isDemo || !!user) && ids.length > 0,
    queryFn: async (): Promise<Record<string, CardPaymentTxn[]>> => {
      if (isDemo || !user) return {};
      const from = new Date();
      from.setDate(from.getDate() - HISTORY_DAYS);
      const { data, error } = await supabase
        .from('synced_transactions')
        .select('account_id, amount, date, pending, name')
        .eq('user_id', viewedUserId ?? user.id)
        .eq('pending', false)
        .in('account_id', ids)
        .lt('amount', 0)
        .gte('date', toLocalDateStr(from));
      if (error) throw error;
      const byCard: Record<string, CardPaymentTxn[]> = {};
      for (const r of data ?? []) {
        if (!r.account_id) continue;
        const txn: CardPaymentTxn = { date: r.date, amount: Number(r.amount), name: r.name ?? '', pending: r.pending };
        byCard[r.account_id] = [...(byCard[r.account_id] ?? []), txn];
      }
      return byCard;
    },
  });
}
