/**
 * usePlaidItems — fetches the user's linked Plaid institutions.
 *
 * IMPORTANT: this hook explicitly selects only non-sensitive columns.
 * access_token is never queried from the frontend — only edge functions
 * using the service role key access it.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

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

export interface PlaidItem {
  id: string;
  plaid_item_id: string;
  institution_id: string | null;
  institution_name: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export function usePlaidItems() {
  const { user, isDemo } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['plaid_items', user?.id],
    enabled: !isDemo && !!user,
    queryFn: async (): Promise<PlaidItem[]> => {
      if (!user) return [];
      // Explicitly omit access_token — never select it on the client
      const { data, error } = await (supabase as any)
        .from('plaid_items')
        .select('id, plaid_item_id, institution_id, institution_name, last_synced_at, created_at')
        .eq('user_id', user.id)
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as PlaidItem[];
    },
    staleTime: 60_000, // 1 min — sync button drives freshness
  });

  const remove = async (plaidItemId: string) => {
    if (!user) return;
    try {
      const authHeader = await getAuthHeader();
      const res = await fetch(`${FN_BASE}/plaid-sync`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delink', plaid_item_id: plaidItemId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error('Plaid delink failed:', body);
        toast.error('Failed to remove bank connection. Please try again.');
      } else {
        toast.success('Bank connection removed. Accounts kept with last known balance.');
      }
    } catch (err) {
      console.error('Plaid delink error:', err);
      toast.error('Failed to remove bank connection. Please try again.');
    }
    qc.invalidateQueries({ queryKey: ['plaid_items'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['plaid_items'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
  };

  return {
    items: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
    remove,
    invalidate,
  };
}
