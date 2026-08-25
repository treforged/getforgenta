/**
 * usePartnerLink — the client side of partner account linking
 * (docs/partner-linking-design.md §1, §5; server: supabase/functions/partner-link).
 *
 * The division of labour is deliberate and asymmetric:
 *
 *  - INVITE and ACCEPT go through the `partner-link` Edge Function, because both
 *    consents are only ever written server-side from a verified JWT — the client has
 *    no INSERT grant on `partner_links` at all.
 *  - REVOKE is a direct, RLS-scoped, column-granted UPDATE from here. Never the
 *    function: LEAVING MUST WORK WHEN FUNCTIONS ARE DOWN (design §1). On success the
 *    lens resets to self and every cached query under the ex-partner's id is removed,
 *    so nothing of theirs survives on this device (design §5).
 *
 * ⚠️ The function may simply not be deployed yet. That is a first-class state here:
 * every invoke is raced against a timeout and every failure settles the mutation with
 * a clear message — nothing hangs, and nothing reports success it did not achieve.
 *
 * ⚠️ Reads select EXPLICIT COLUMNS, never `*`: the `authenticated` role holds a
 * column-scoped SELECT grant that excludes `invite_code_hash`, so a `select('*')`
 * would be refused outright.
 *
 * ⚠️ The link list itself is always the OWN user's — it is never lensed through
 * `viewedUserId` (a source-lock test asserts this).
 */

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { tracedInvoke } from '@/lib/tracer';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { useViewedProfile } from '@/contexts/ViewedProfileContext';
import type { Tables } from '@/integrations/supabase/types';

export const PARTNER_LINKS_QUERY_KEY = 'partner_links';

/** The columns the client is actually granted. `invite_code_hash` has no client path. */
export type PartnerLinkRow = Pick<
  Tables<'partner_links'>,
  'id' | 'inviter_id' | 'invitee_email' | 'expires_at' | 'accepted_by' | 'accepted_at' | 'revoked_at' | 'created_at'
>;

const PARTNER_LINK_COLUMNS =
  'id, inviter_id, invitee_email, expires_at, accepted_by, accepted_at, revoked_at, created_at';

const FUNCTION_TIMEOUT_MS = 15_000;
const FUNCTION_UNAVAILABLE =
  'The partner linking service is unavailable right now. Please try again in a few minutes.';

interface InviteResponse {
  ok?: boolean;
  message?: string;
  expires_at?: string;
}

interface AcceptResponse {
  ok?: boolean;
  link_id?: string;
  partner?: { user_id: string; display_name: string | null };
}

/**
 * Invoke the partner-link Edge Function with a hard ceiling on how long the caller can
 * be left waiting. A non-2xx response carries the function's own JSON `error` (shown
 * verbatim — the server's words are the honest ones); anything without that shape — a
 * gateway 404 for an undeployed function, a network failure, a timeout — collapses to
 * one clear "service unavailable" message.
 */
async function invokePartnerLink<T>(body: Record<string, unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(FUNCTION_UNAVAILABLE)), FUNCTION_TIMEOUT_MS);
  });
  try {
    const { data, error } = await Promise.race([
      tracedInvoke<T>(supabase, 'partner-link', { body }),
      timeout,
    ]);
    if (error) {
      // FunctionsHttpError carries a .context Response at runtime; its type doesn't
      // expose it — same narrowing as AiAdvisor's handler.
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

export interface PartnerLinkStatus {
  links: PartnerLinkRow[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  /** The one link that is live right now: accepted and not revoked. */
  activeLink: PartnerLinkRow | null;
  /** This user's own outstanding, unexpired invite (inviter side only sees these). */
  pendingInvite: PartnerLinkRow | null;
  /** The other human on the active link — what the switcher points the lens at. */
  partnerUserId: string | null;
  /** Best available name for the partner: their email when we invited them, else null. */
  partnerLabel: string | null;
}

/**
 * Read-only view of the caller's link rows. Split from the mutations for the same
 * reason `useSyncedTransactionReviewsQuery` is: the sidebar and the banner render
 * app-wide and need the status, never the write handlers. Same query key, so
 * react-query serves every consumer from one fetch.
 */
export function usePartnerLinkStatus(): PartnerLinkStatus {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const query = useQuery({
    queryKey: [PARTNER_LINKS_QUERY_KEY, isDemo ? 'demo' : user?.id],
    enabled: !isDemo && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<PartnerLinkRow[]> => {
      if (!user) return [];
      // RLS already restricts SELECT to rows the caller is a member of; the filter is
      // stated anyway, matching every other read in the app.
      const { data, error } = await supabase
        .from('partner_links')
        .select(PARTNER_LINK_COLUMNS)
        .or(`inviter_id.eq.${user.id},accepted_by.eq.${user.id}`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const links = useMemo(() => query.data ?? [], [query.data]);
  const userId = user?.id;

  const derived = useMemo(() => {
    const activeLink = links.find(l => l.accepted_at !== null && l.revoked_at === null) ?? null;
    // Expiry is a 7-day threshold — a render straddling it only delays the empty state
    // by one render, so a render-time clock read is harmless here.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const pendingInvite = activeLink
      ? null
      : links.find(l =>
          l.inviter_id === userId &&
          l.accepted_at === null &&
          l.revoked_at === null &&
          Date.parse(l.expires_at) > now,
        ) ?? null;
    const partnerUserId = activeLink
      ? (activeLink.inviter_id === userId ? activeLink.accepted_by : activeLink.inviter_id)
      : null;
    const partnerLabel = activeLink && activeLink.inviter_id === userId
      ? activeLink.invitee_email
      : null;
    return { activeLink, pendingInvite, partnerUserId, partnerLabel };
  }, [links, userId]);

  return {
    links,
    loading: query.isLoading,
    error: query.error,
    refetch: () => { void query.refetch(); },
    ...derived,
  };
}

export interface RevokeVars {
  /** The partner_links row to revoke. */
  id: string;
  /** The other user on the link, when it was active — whose cache must be purged. */
  exPartnerUserId: string | null;
  /** Wording only: cancelling your own invite vs severing an active link. */
  kind: 'invite' | 'link';
}

export function usePartnerLink() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const { switchBack } = useViewedProfile();
  const qc = useQueryClient();
  const status = usePartnerLinkStatus();

  const invite = useMutation({
    mutationFn: async (email: string): Promise<InviteResponse> => {
      if (isDemo || !user) throw new Error('Demo mode');
      return invokePartnerLink<InviteResponse>({ action: 'invite', email: email.trim() });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: [PARTNER_LINKS_QUERY_KEY] });
      toast.success(res.message ?? 'Invite sent. It expires in 7 days.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const accept = useMutation({
    mutationFn: async (code: string): Promise<AcceptResponse> => {
      if (isDemo || !user) throw new Error('Demo mode');
      return invokePartnerLink<AcceptResponse>({ action: 'accept', code: code.trim() });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: [PARTNER_LINKS_QUERY_KEY] });
      toast.success(
        res.partner?.display_name
          ? `Linked with ${res.partner.display_name}`
          : 'Partner link active',
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
        .from('partner_links')
        .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
        .eq('id', id)
        .select('id');
      if (error) throw error;
      // A zero-row update means RLS refused or the row is gone. Reporting that as
      // "unlinked" would be the silent failure this house keeps getting bitten by.
      if (!data || data.length === 0) {
        throw new Error('Could not unlink. Please refresh and try again.');
      }
    },
    onSuccess: (_data, vars) => {
      // Design §5: on revoke, the ex-partner keeps seeing nothing AND we keep seeing
      // nothing of theirs — lens back to self, their cached queries removed. Keys are
      // user-scoped throughout the app, so matching on the id is targeted.
      switchBack();
      if (vars.exPartnerUserId) {
        const exId = vars.exPartnerUserId;
        qc.removeQueries({ predicate: q => q.queryKey.includes(exId) });
      }
      qc.invalidateQueries({ queryKey: [PARTNER_LINKS_QUERY_KEY] });
      toast.success(vars.kind === 'invite' ? 'Invite canceled' : 'Partner unlinked');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { ...status, invite, accept, revoke };
}
