/**
 * Hook for managing follow relationships.
 *
 * The `follows` table does not allow direct INSERTs because there is no RLS
 * policy for that operation – the only way to create a row is via the
 * `request_follow` RPC.  Declining a request or unfollowing simply removes the
 * row, which is why `removeFollow` performs a DELETE for both cases.
 */
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { writeBlockedError } from '@/lib/write-guard';

export const FOLLOWS_QUERY_KEY = 'follows';

export interface FollowRow {
  id: string;
  follower_id: string;
  followee_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
  responded_at: string | null;
}

export interface FoundProfile {
  user_id: string;
  username: string;
  display_name: string | null;
  visibility: 'public' | 'private';
}

/**
 * Returns follow data and actions for the current user.
 * All hooks are called unconditionally to satisfy React's rules of hooks.
 */
export function useFollows() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const queryClient = useQueryClient();

  // ------------------------------------------------------------
  // Query: fetch all rows that involve the current user.
  // ------------------------------------------------------------
  const followsQuery = useQuery({
    queryKey: [FOLLOWS_QUERY_KEY, isDemo ? 'demo' : user?.id],
    queryFn: async () => {
      const me = user!.id;
      const { data, error } = await supabase
        .from('follows')
        .select('id,follower_id,followee_id,status,created_at,responded_at')
        .or(`follower_id.eq.${me},followee_id.eq.${me}`);

      if (error) throw error;
      // Supabase returns typed rows matching the select list.
      return data as FollowRow[];
    },
    // Do not run when unauthenticated or in demo mode.
    enabled: !isDemo && !!user,
  });

  // ------------------------------------------------------------
  // Derive the four collections from the single query result.
  // ------------------------------------------------------------
  const {
    following,
    followers,
    incomingRequests,
    outgoingRequests,
  } = useMemo(() => {
    // ⚠️ DERIVED INSIDE THE MEMO ON PURPOSE. Written as a `const allFollows = data ?? []`
    // above, the `?? []` builds a NEW array identity on every render where the query has no
    // data, so the dependency list changes every render and the memo never holds.
    const allFollows = followsQuery.data ?? [];
    const me = user?.id ?? '';
    const following: FollowRow[] = [];
    const followers: FollowRow[] = [];
    const incomingRequests: FollowRow[] = [];
    const outgoingRequests: FollowRow[] = [];

    for (const row of allFollows) {
      const isFollower = row.follower_id === me;
      const isFollowee = row.followee_id === me;

      if (row.status === 'accepted') {
        if (isFollower) following.push(row);
        if (isFollowee) followers.push(row);
      } else {
        // pending
        if (isFollowee) incomingRequests.push(row);
        if (isFollower) outgoingRequests.push(row);
      }
    }

    return { following, followers, incomingRequests, outgoingRequests };
  }, [followsQuery.data, user?.id]);

  // ------------------------------------------------------------
  // Mutations
  // ------------------------------------------------------------

  // Helper to invalidate the follows cache after any successful change.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [FOLLOWS_QUERY_KEY, isDemo ? 'demo' : user?.id] });
  };

  const requestFollowMutation = useMutation({
    mutationFn: async (followeeId: string) => {
      if (isDemo || !user) throw writeBlockedError({ isDemo, user });
      const { data, error } = await supabase.rpc('request_follow', { p_followee: followeeId });
      if (error) throw error;
      // RPC returns a status string; we trust the type after narrowing.
      return data as 'accepted' | 'pending';
    },
    onSuccess: (status) => {
      // Show a toast based on the authoritative RPC result.
      if (status === 'accepted') {
        toast.success('You are now following them');
      } else {
        toast.success('Request sent');
      }
      invalidate();
    },
    onError: (err: Error) => {
      // The server's own words are the honest ones; only fall back when there are none.
      toast.error(err.message || 'Something went wrong. Please try again.');
    },
  });

  const approveRequestMutation = useMutation({
    mutationFn: async (rowId: string) => {
      if (isDemo || !user) throw writeBlockedError({ isDemo, user });
      const { error } = await supabase
        .from('follows')
        .update({
          status: 'accepted',
          responded_at: new Date().toISOString(),
        })
        .eq('id', rowId)
        .eq('status', 'pending');
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Follow request accepted');
      invalidate();
    },
    onError: (err: Error) => {
      // The server's own words are the honest ones; only fall back when there are none.
      toast.error(err.message || 'Something went wrong. Please try again.');
    },
  });

  const removeFollowMutation = useMutation({
    mutationFn: async (rowId: string) => {
      if (isDemo || !user) throw writeBlockedError({ isDemo, user });
      const { error } = await supabase.from('follows').delete().eq('id', rowId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Follow removed');
      invalidate();
    },
    onError: (err: Error) => {
      // The server's own words are the honest ones; only fall back when there are none.
      toast.error(err.message || 'Something went wrong. Please try again.');
    },
  });

  // ------------------------------------------------------------
  // Helper: find a profile by username.
  // ------------------------------------------------------------
  const findByUsername = async (username: string): Promise<FoundProfile | null> => {
    // Guarded like every mutation above: without this, demo mode still reaches the network.
    if (isDemo || !user) throw writeBlockedError({ isDemo, user });
    const normalised = username.trim().replace(/^@/, '');
    const { data, error } = await supabase.rpc('find_profile_by_username', {
      p_username: normalised,
    });
    if (error) throw error;
    // RPC returns an array; we expect 0 or 1 rows.
    if (!Array.isArray(data) || data.length === 0) return null;

    // Cast the first element to the expected shape.
    const row = data[0] as {
      user_id: string;
      username: string;
      display_name: string | null;
      visibility: 'public' | 'private';
    };
    return {
      user_id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      visibility: row.visibility,
    };
  };

  // ------------------------------------------------------------
  // Exported API
  // ------------------------------------------------------------
  return {
    following,
    followers,
    incomingRequests,
    outgoingRequests,
    isLoading: followsQuery.isLoading,
    requestFollow: requestFollowMutation.mutate,
    approveRequest: approveRequestMutation.mutate,
    removeFollow: removeFollowMutation.mutate,
    findByUsername,
  };
}
