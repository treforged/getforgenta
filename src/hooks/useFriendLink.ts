/**
 * useFriendLink — the client side of friend links
 * (docs/friends-leaderboard-plan.md §2, §4 Phase 1; server:
 * supabase/functions/friend-link).
 *
 * Mirrors usePartnerLink with one deliberate, load-bearing difference:
 *
 * ⚠️ A FRIEND IS NOT A PARTNER. There is no viewing lens, so nothing here
 * imports ViewedProfileContext, and nothing here reads through `viewedUserId` —
 * every query is the OWN user's, always (a source-lock test asserts this). A
 * friend can see one coarse weekly bucket about you if you opted that metric
 * in, and that read happens through RLS on `leaderboard_snapshots`, never here.
 *
 * The division of labour is the same asymmetric one:
 *
 *  - INVITE and ACCEPT go through the `friend-link` Edge Function, because both
 *    consents are only ever written server-side from a verified JWT — the client
 *    has no INSERT grant on `friend_links` at all.
 *  - REVOKE is a direct, RLS-scoped, column-granted UPDATE from here. Never the
 *    function: LEAVING MUST WORK WHEN FUNCTIONS ARE DOWN (plan §2). On success
 *    every cached query under the ex-friend's id is removed, so nothing of
 *    theirs survives on this device.
 *
 * ⚠️ The function may simply not be deployed yet. That is a first-class state
 * here: every invoke is raced against a timeout and every failure settles the
 * mutation with a clear message — nothing hangs, and nothing reports success it
 * did not achieve.
 *
 * ⚠️ Reads select EXPLICIT COLUMNS, never `*`: the `authenticated` role holds a
 * column-scoped SELECT grant that excludes `invite_code_hash`, so a `select('*')`
 * would be refused outright.
 */

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { tracedInvoke } from '@/lib/tracer';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import type { Tables } from '@/integrations/supabase/types';

export const FRIEND_LINKS_QUERY_KEY = 'friend_links';

/** The columns the client is actually granted. `invite_code_hash` has no client path. */
export type FriendLinkRow = Pick<
  Tables<'friend_links'>,
  'id' | 'inviter_id' | 'invitee_email' | 'expires_at' | 'accepted_by' | 'accepted_at' | 'revoked_at' | 'created_at'
>;

const FRIEND_LINK_COLUMNS =
  'id, inviter_id, invitee_email, expires_at, accepted_by, accepted_at, revoked_at, created_at';

const FUNCTION_TIMEOUT_MS = 15_000;
const FUNCTION_UNAVAILABLE =
  'The friends service is unavailable right now. Please try again in a few minutes.';

/** What a friend is called when no name could be resolved for them. Matches the function's. */
const GENERIC_FRIEND_NAME = 'A Forgenta member';

interface InviteResponse {
  ok?: boolean;
  message?: string;
  expires_at?: string;
}

interface AcceptResponse {
  ok?: boolean;
  link_id?: string;
  friend?: { user_id: string; display_name: string | null };
}

/** The `status` action's shape. Only the names are used here — the rows come from the table. */
interface StatusResponse {
  friends?: { link_id: string; user_id: string; display_name: string }[];
  pending?: { link_id: string; invitee_email: string; expires_at: string }[];
}

/**
 * Invoke the friend-link Edge Function with a hard ceiling on how long the caller can
 * be left waiting. A non-2xx response carries the function's own JSON `error` (shown
 * verbatim — the server's words are the honest ones); anything without that shape — a
 * gateway 404 for an undeployed function, a network failure, a timeout — collapses to
 * one clear "service unavailable" message.
 */
async function invokeFriendLink<T>(body: Record<string, unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(FUNCTION_UNAVAILABLE)), FUNCTION_TIMEOUT_MS);
  });
  try {
    const { data, error } = await Promise.race([
      tracedInvoke<T>(supabase, 'friend-link', { body }),
      timeout,
    ]);
    if (error) {
      // FunctionsHttpError carries a .context Response at runtime; its type doesn't
      // expose it — same narrowing as usePartnerLink's.
      const withCtx = error as unknown as { context?: { json?: () => Promise<unknown> } };
      let serverMessage: string | null = null;
      try {
        const ctx = await withCtx.context?.json?.() as { error?: string } | undefined;
        if (ctx?.error) serverMessage = ctx.error;
      } catch { /* not JSON — undeployed function or network-level failure */ }
      throw new Error(serverMessage ?? FUNCTION_UNAVAILABLE);
    }
    if (data == null) throw new Error(FUNCTION_UNAVAILABLE);
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One friend, as the UI shows them: the link to revoke, who they are, what to call them. */
export interface FriendSummary {
  linkId: string;
  userId: string;
  label: string;
}

export interface FriendLinkStatus {
  links: FriendLinkRow[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  /** Every live friendship: accepted and not revoked. */
  friends: FriendSummary[];
  /** This user's own outstanding, unexpired invites (inviter side only sees these). */
  pendingInvites: FriendLinkRow[];
  /**
   * True when the display names could not be fetched, so every label fell back.
   * Surfaced rather than swallowed: a card showing fallback labels should be able
   * to say why (a name we could not read is not a name we may invent).
   */
  namesUnavailable: boolean;
}

/**
 * Read-only view of the caller's friend rows. Split from the mutations the same way
 * `usePartnerLinkStatus` is, so a future leaderboard can read the friend list without
 * pulling in the write handlers. Same query key, so react-query serves every consumer
 * from one fetch.
 *
 * Two reads, and the split is deliberate: the TABLE is the source of truth for which
 * links exist (RLS-scoped, and the only thing revoke needs), while the FUNCTION is the
 * only path to a friend's `profiles.display_name` — `profiles` has no friend-facing
 * grant and never will (plan §2). If the name read fails, labels fall back instead of
 * the card failing.
 */
export function useFriendLinkStatus(): FriendLinkStatus {
  const { user } = useAuth();
  const { isDemo } = useDemo();

  const query = useQuery({
    queryKey: [FRIEND_LINKS_QUERY_KEY, isDemo ? 'demo' : user?.id],
    enabled: !isDemo && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<FriendLinkRow[]> => {
      if (!user) return [];
      // RLS already restricts SELECT to rows the caller is a member of; the filter is
      // stated anyway, matching every other read in the app.
      const { data, error } = await supabase
        .from('friend_links')
        .select(FRIEND_LINK_COLUMNS)
        .or(`inviter_id.eq.${user.id},accepted_by.eq.${user.id}`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const links = useMemo(() => query.data ?? [], [query.data]);
  const userId = user?.id;

  const activeLinks = useMemo(
    () => links.filter(l => l.accepted_at !== null && l.revoked_at === null),
    [links],
  );

  const namesQuery = useQuery({
    queryKey: [FRIEND_LINKS_QUERY_KEY, 'names', isDemo ? 'demo' : user?.id],
    // Nothing to name until there is a friendship, so an empty list costs no invoke.
    enabled: !isDemo && !!user && activeLinks.length > 0,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<Record<string, string>> => {
      const res = await invokeFriendLink<StatusResponse>({ action: 'status' });
      return Object.fromEntries((res.friends ?? []).map(f => [f.link_id, f.display_name]));
    },
  });

  const nameByLinkId = namesQuery.data;
  const friends = useMemo<FriendSummary[]>(() => {
    const names = nameByLinkId ?? {};
    return activeLinks.flatMap((link) => {
      const iInvited = link.inviter_id === userId;
      const friendId = iInvited ? link.accepted_by : link.inviter_id;
      if (!friendId) return [];
      // The server's name first. Its fallback is a masked address; ours is the
      // full address, but ONLY the one this user typed themselves — in the other
      // direction `invitee_email` is this user's own mailbox, and showing it
      // would label the friend with the viewer's address.
      const label = names[link.id] ??
        (iInvited ? link.invitee_email : GENERIC_FRIEND_NAME);
      return [{ linkId: link.id, userId: friendId, label }];
    });
  }, [activeLinks, nameByLinkId, userId]);

  const pendingInvites = useMemo(() => {
    // Expiry is a 7-day threshold — a render straddling it only delays the empty state
    // by one render, so a render-time clock read is harmless here.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    return links.filter(l =>
      l.inviter_id === userId &&
      l.accepted_at === null &&
      l.revoked_at === null &&
      Date.parse(l.expires_at) > now,
    );
  }, [links, userId]);

  return {
    links,
    loading: query.isLoading,
    error: query.error,
    refetch: () => { void query.refetch(); },
    friends,
    pendingInvites,
    namesUnavailable: activeLinks.length > 0 && namesQuery.isError,
  };
}

export interface RevokeVars {
  /** The friend_links row to revoke. */
  id: string;
  /** The other user on the link, when it was active — whose cache must be purged. */
  exFriendUserId: string | null;
  /** Wording only: cancelling your own invite vs ending a friendship. */
  kind: 'invite' | 'link';
}

export function useFriendLink() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const status = useFriendLinkStatus();

  const invite = useMutation({
    mutationFn: async (email: string): Promise<InviteResponse> => {
      if (isDemo || !user) throw new Error('Demo mode');
      return invokeFriendLink<InviteResponse>({ action: 'invite', email: email.trim() });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: [FRIEND_LINKS_QUERY_KEY] });
      toast.success(res.message ?? 'Invite sent. It expires in 7 days.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const accept = useMutation({
    mutationFn: async (code: string): Promise<AcceptResponse> => {
      if (isDemo || !user) throw new Error('Demo mode');
      return invokeFriendLink<AcceptResponse>({ action: 'accept', code: code.trim() });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: [FRIEND_LINKS_QUERY_KEY] });
      toast.success(
        res.friend?.display_name
          ? `You're now friends with ${res.friend.display_name}`
          : 'Friend added',
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Direct RLS-scoped UPDATE — never the Edge Function. The column grant on
  // (revoked_at, revoked_by) is the entire write surface the client holds.
  const revoke = useMutation({
    mutationFn: async ({ id }: RevokeVars) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const { data, error } = await supabase
        .from('friend_links')
        .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
        .eq('id', id)
        .select('id');
      if (error) throw error;
      // A zero-row update means RLS refused or the row is gone. Reporting that as
      // "removed" would be the silent failure this house keeps getting bitten by.
      if (!data || data.length === 0) {
        throw new Error('Could not remove that friend. Please refresh and try again.');
      }
    },
    onSuccess: (_data, vars) => {
      // Nothing of theirs survives on this device. There is no lens to reset — a
      // friend never had one — but a leaderboard bucket cached under their id is
      // still theirs, and the RLS policy stops serving it on the next statement.
      // Keys are user-scoped throughout the app, so matching on the id is targeted.
      if (vars.exFriendUserId) {
        const exId = vars.exFriendUserId;
        qc.removeQueries({ predicate: q => q.queryKey.includes(exId) });
      }
      qc.invalidateQueries({ queryKey: [FRIEND_LINKS_QUERY_KEY] });
      toast.success(vars.kind === 'invite' ? 'Invite canceled' : 'Friend removed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { ...status, invite, accept, revoke };
}
