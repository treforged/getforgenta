/**
 * Account visibility handling.
 *
 * The safe fallback is **private** – this is used while the visibility is loading,
 * when any network error occurs, or when the profile row does not exist.
 * A private account means a follow request must be approved by the owner.
 * A public account means anyone can follow the user immediately without approval.
 *
 * This default protects users' sensitive financial data by never exposing an
 * account as public unless we have positively confirmed that setting.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { writeBlockedError } from '@/lib/write-guard';

export const ACCOUNT_VISIBILITY_QUERY_KEY = 'account_visibility';
export type AccountVisibility = 'private' | 'public';

export function useAccountVisibility() {
  const { user } = useAuth(); // user?.id
  const { isDemo } = useDemo();
  const queryClient = useQueryClient();

  const queryKey = [
    ACCOUNT_VISIBILITY_QUERY_KEY,
    isDemo ? 'demo' : user?.id,
  ] as const;

  const {
    data: visibilityData,
    isLoading,
  } = useQuery({
    queryKey,
    enabled: !isDemo && !!user,
    async queryFn() {
      // Guarded by `enabled` – `user` is defined here.
      const { data, error } = await supabase
        .from('profiles')
        .select('visibility')
        .eq('user_id', user!.id)
        .maybeSingle();

      if (error) {
        // Propagate to onError handling of useQuery.
        throw error;
      }

      // `data` may be null if the row does not exist – treat as undefined.
      return data?.visibility as AccountVisibility | undefined;
    },
  });

  // Fallback to 'private' in every uncertain circumstance.
  const visibility: AccountVisibility = visibilityData ?? 'private';
  const isPublic = visibility === 'public';

  const mutation = useMutation({
    async mutationFn(newVisibility: AccountVisibility) {
      // Named by CAUSE, never by mode: a signed-out user being told "Demo mode" is the
      // exact defect Tre reported on iOS 866. See src/lib/write-guard.ts.
      if (isDemo || !user) throw writeBlockedError({ isDemo, user });

      const { error } = await supabase
        .from('profiles')
        .update({ visibility: newVisibility })
        .eq('user_id', user.id);

      if (error) {
        throw error;
      }

      return newVisibility;
    },
    onSuccess(newVisibility) {
      // Invalidate the visibility query so fresh data is fetched.
      queryClient.invalidateQueries({
        queryKey: [ACCOUNT_VISIBILITY_QUERY_KEY, isDemo ? 'demo' : user?.id],
      });

      const message =
        newVisibility === 'public'
          ? 'Your account is public. Anyone can follow you without approval.'
          : 'Your account is private. New followers need your approval.';
      toast.success(message);
    },
    onError(error: unknown) {
      // Server‑provided error messages are shown directly.
      const message =
        error instanceof Error ? error.message : 'An unexpected error occurred';
      toast.error(message);
    },
  });

  return {
    visibility,
    isLoading,
    isPublic,
    setVisibility: mutation.mutate,
    isUpdating: mutation.isPending,
  };
}
