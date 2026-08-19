/**
 * Slice 6 — the crowd's merchant→category map, and the one way to add to it.
 *
 * ⚠️ THERE IS NO TABLE TO SELECT FROM HERE, DELIBERATELY. Both calls are RPCs into SECURITY DEFINER
 * functions, because the tables behind them live in a `crowd` schema that `anon` and
 * `authenticated` have no USAGE on and no grants to, with RLS on and no policies. This project's
 * default ACLs grant ALL to anon on every new table in `public` (verified 2026-08-19), so a table
 * put there would have been world-writable the moment it existed — the 2026-06-15 enumeration
 * lesson in the same database. The functions are the whole API.
 *
 * ⚠️ THE READ FUNCTION APPLIES A DISTINCT-VOTER FLOOR OF 3 AND THE CLIENT CANNOT LOWER IT. Nothing
 * here should try: a merchant key is not always a business — this account's own memory holds
 * "Zelle payment from ARIA…" — so a map returned at a floor of 1 would be one user's private
 * counterparties handed to everybody else.
 */
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import type { CrowdCategory } from '@/lib/crowd-category';

interface CrowdRow { merchant_key: string; category: string; voters: number }

/**
 * The map, keyed by normalized merchant.
 *
 * ⚠️ EMPTY IS THE HONEST FAILURE MODE, and it is why this swallows its error. The crowd is a
 * suggestion of last resort behind the user's own memory; if the call fails, the right outcome is
 * that the app makes no crowd suggestion, not that a categorisation screen shows an error about a
 * feature the user never asked for. A silent absence here removes a hint. It never shows a wrong one.
 */
export function useCrowdCategories() {
  const { user } = useAuth();
  const { isDemo } = useDemo();

  const query = useQuery({
    queryKey: ['crowd_merchant_categories', isDemo ? 'demo' : user?.id],
    // Demo serves nothing: the crowd map is real cross-user data, and a fixture standing in for it
    // would be inventing a claim about what other people said.
    enabled: !isDemo && !!user,
    // The crowd moves slowly and nothing on screen depends on it being fresh.
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<Record<string, CrowdCategory>> => {
      const { data, error } = await supabase.rpc('crowd_merchant_categories');
      if (error) return {};
      const out: Record<string, CrowdCategory> = {};
      for (const row of (data ?? []) as CrowdRow[]) {
        if (!row?.merchant_key || !row?.category) continue;
        out[row.merchant_key] = { category: row.category, voters: Number(row.voters) || 0 };
      }
      return out;
    },
  });

  return { crowd: query.data ?? {}, isLoading: query.isLoading };
}

/**
 * Records the user's own answer for a merchant into the shared map.
 *
 * ⚠️ IT TAKES NO USER ID AND CANNOT BE GIVEN ONE. The identity comes from the JWT inside the
 * function, so a caller cannot vote as somebody else, and no user id is ever transmitted.
 *
 * ⚠️ FIRE AND FORGET, AND FAILURE IS SILENT ON PURPOSE. This runs alongside the user's real action
 * — labelling their own charge — which has already succeeded by the time it is called. A toast
 * about a failed background vote would report a problem the user has no stake in and cannot act on.
 */
export function useRecordCrowdVote() {
  const { user } = useAuth();
  const { isDemo } = useDemo();

  return useCallback(async (merchantKey: string | null | undefined, category: string | null | undefined) => {
    // Demo writes nothing anywhere, and it must not be able to put fixture merchants into real
    // shared data.
    if (isDemo || !user || !merchantKey || !category) return;
    try {
      await supabase.rpc('record_merchant_category_vote', {
        p_merchant_key: merchantKey,
        p_category: category,
      });
    } catch {
      // See above: the user's own categorisation already landed. This is the optional half.
    }
  }, [isDemo, user]);
}
