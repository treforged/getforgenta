/**
 * useFinancialConnections — the user's linked institutions across every
 * aggregator (Plaid today, Akoya as a fallback).
 *
 * IMPORTANT: this hook selects only non-sensitive columns. Tokens are not
 * merely unqueried here — after the financial_connections migration the token
 * columns are not granted to the `authenticated` role at all, so only edge
 * functions holding the service role can read them.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export const CONNECTIONS_QUERY_KEY = 'financial_connections';

export type ProviderId = 'plaid' | 'akoya';

export type ConnectionStatus = 'active' | 'reauth_required' | 'revoked' | 'error';

export interface FinancialConnection {
  id: string;
  provider: ProviderId;
  provider_item_id: string;
  institution_id: string | null;
  institution_name: string | null;
  connection_status: ConnectionStatus;
  last_synced_at: string | null;
  created_at: string;
}

async function getAuthHeader(): Promise<string> {
  const { data: refreshData } = await supabase.auth.refreshSession();
  const token = refreshData.session?.access_token;
  if (!token) {
    const { data } = await supabase.auth.getSession();
    const fallback = data.session?.access_token;
    if (!fallback) throw new Error('Not authenticated');
    return `Bearer ${fallback}`;
  }
  return `Bearer ${token}`;
}

export function useFinancialConnections() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const query = useQuery({
    queryKey: [CONNECTIONS_QUERY_KEY, user?.id],
    enabled: !isDemo && !!user,
    queryFn: async (): Promise<FinancialConnection[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('financial_connections')
        .select(
          'id, provider, provider_item_id, institution_id, institution_name, connection_status, last_synced_at, created_at',
        )
        .eq('user_id', user.id)
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as FinancialConnection[];
    },
    staleTime: 60_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [CONNECTIONS_QUERY_KEY] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
  };

  /** Revokes at the provider and drops the connection. Accounts are kept. */
  const remove = async (connectionId: string) => {
    if (!user) return;
    try {
      const authHeader = await getAuthHeader();
      const res = await fetch(`${FN_BASE}/financial-sync`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delink', connection_id: connectionId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error('Delink failed:', body);
        toast.error('Failed to remove bank connection. Please try again.');
      } else {
        toast.success('Bank connection removed. Accounts kept with last known balance.');
      }
    } catch (err) {
      console.error('Delink error:', err);
      toast.error('Failed to remove bank connection. Please try again.');
    }
    invalidate();
  };

  /**
   * Triggers a fresh balance sync across every provider.
   * force=true bypasses the 23.5h per-connection cooldown — use it for explicit
   * user-initiated refreshes only.
   */
  const syncNow = async (force = false) => {
    if (!user || syncing) return;
    setSyncing(true);
    try {
      const authHeader = await getAuthHeader();
      const res = await fetch(`${FN_BASE}/financial-sync`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Sync failed');
      }
      const body = await res.json();
      toast.success(
        `Balances updated — ${body.synced ?? 0} account${body.synced === 1 ? '' : 's'} synced.`,
      );
      invalidate();
    } catch (err) {
      console.error('syncNow error:', err);
      toast.error(err instanceof Error ? err.message : 'Sync failed. Please try again.');
    } finally {
      setSyncing(false);
    }
  };

  const allConnections = query.data ?? [];

  return {
    /**
     * The connections the user actually HAS. Revoked ones are excluded.
     *
     * ⚠️ WHY THIS FILTER IS THE WHOLE FIX FOR THE DUPLICATE-BANK BUG (2026-09-05, live).
     * Tre re-linked Robinhood on his phone and then saw THREE Robinhood rows in Linked
     * Banks. Every layer underneath had done its job: `planSupersededConnections` marked
     * both older items `revoked`, their accounts were deactivated one second before the
     * new rows were written, and no balance was double-counted. The only thing wrong was
     * this hook handing the UI every row it could find, including the two the backend had
     * already retired. So the bug was never in the dedupe and never in his data — it was
     * a missing filter, and no cleanup of live financial rows is needed to fix it.
     *
     * A revoked connection is not a connection. `plaid-sync-all` already skips it, it can
     * never sync again, and the only thing listing it achieves is telling the user to
     * re-link a bank they just linked.
     */
    connections: allConnections.filter(c => c.connection_status !== 'revoked'),
    /**
     * Every row, revoked included — the audit view.
     *
     * Kept because supersession deliberately never DELETES a connection: `active = false`
     * and a `revoked` status preserve the row, its id and its history, and one flag undoes
     * the whole thing. Anything that needs to explain what happened to an old link reads
     * this; anything that renders "your banks" reads `connections`.
     */
    allConnections,
    loading: query.isLoading,
    error: query.error,
    syncing,
    remove,
    syncNow,
    invalidate,
  };
}
