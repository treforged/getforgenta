import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { tracedInvoke } from '@/lib/tracer';
import type { Plan } from '@/lib/intro-offer';

/**
 * May this user see the first-year intro offer on the WEB paywall? (ask a6375f1c)
 *
 * The SERVER decides - `create-checkout` with `action: 'offer'` - because eligibility needs the
 * Stripe history, which only the server can read. The paywall never decides on its own.
 *
 * ⚠️ EVERY FAILURE READS AS "NO OFFER". A failed call, an old deployed function that refuses the
 * `action` field, or a missing coupon all show the regular price. Showing a $1 offer that checkout
 * then refuses would be worse than not showing it.
 */

export type IntroOfferAvailability = Readonly<Record<Plan, boolean>>;

const NONE: IntroOfferAvailability = { monthly: false, yearly: false };

export const INTRO_OFFER_QUERY_KEY = 'intro-offer';

export function useIntroOffer(enabled: boolean): IntroOfferAvailability {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: [INTRO_OFFER_QUERY_KEY, user?.id],
    enabled: enabled && !!user,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<IntroOfferAvailability> => {
      try {
        const { data, error } = await tracedInvoke<{ eligible?: unknown; monthly?: unknown; yearly?: unknown }>(
          supabase, 'create-checkout', { body: { action: 'offer' } },
        );
        if (error || !data) return NONE;
        return { monthly: data.monthly === true, yearly: data.yearly === true };
      } catch {
        return NONE;
      }
    },
  });
  return enabled ? (query.data ?? NONE) : NONE;
}
