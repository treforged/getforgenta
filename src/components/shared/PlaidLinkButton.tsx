/**
 * PlaidLinkButton
 *
 * Loads the Plaid Link JS script on demand, creates a link token via the
 * plaid-create-link-token edge function, and opens the Plaid Link UI.
 * On success it calls plaid-exchange-token, then triggers onSuccess() so
 * the parent can refresh account/plaid-items data.
 *
 * No npm dependency — the Plaid Link SDK is loaded from Plaid's CDN.
 */

import { useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Link2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { classifyPlaidExit } from '@/lib/providers/connection-errors';

const PLAID_SCRIPT_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const LINK_TOKEN_KEY = 'forged:plaid_link_token';
// Only set once the URI is whitelisted in the Plaid dashboard (Team Settings → API → Allowed redirect URIs).
// Set VITE_PLAID_OAUTH_REDIRECT_URI in Vercel env vars to enable OAuth banks (Chase, BoA, etc.).
const OAUTH_REDIRECT_URI: string | null = import.meta.env.VITE_PLAID_OAUTH_REDIRECT_URI ?? null;

async function loadPlaidScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.Plaid) return;
  return new Promise((resolve, reject) => {
    if (document.getElementById('plaid-link-js')) { resolve(); return; }
    const script = document.createElement('script');
    script.id  = 'plaid-link-js';
    script.src = PLAID_SCRIPT_SRC;
    script.onload  = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Plaid script'));
    document.head.appendChild(script);
  });
}

async function getAuthHeader(): Promise<string> {
  // Refresh the session to ensure the token isn't close to expiry before calling edge functions
  const { data: refreshData } = await supabase.auth.refreshSession();
  const token = refreshData.session?.access_token;
  if (!token) {
    // Fallback: try current session
    const { data } = await supabase.auth.getSession();
    const fallback = data.session?.access_token;
    if (!fallback) throw new Error('Not authenticated. Please sign in again.');
    return `Bearer ${fallback}`;
  }
  return `Bearer ${token}`;
}

export interface PlaidSyncedAccount {
  name: string;
  balance: number;
  type: string;
  plaid_account_id?: string;
  apr?: number | null;
  credit_limit?: number | null;
  min_payment?: number | null;
  liability_synced?: boolean;
}

interface PlaidLinkButtonProps {
  onSuccess: (accounts: PlaidSyncedAccount[], institutionName?: string) => void;
  onProcessing?: (processing: boolean) => void;
  disabled?: boolean;
  /** When set, opens Plaid in update mode to add liabilities product to an existing item. No token exchange — just a force sync. */
  relinkItemId?: string;
  /** Label override for re-link mode */
  label?: string;
  /**
   * Fired when Plaid exits because it could not reach the institution, so the
   * caller can offer a fallback aggregator. Receives the institution name Plaid
   * reported, which may be null if the user never got that far.
   */
  onInstitutionUnavailable?: (institutionName: string | null) => void;
}

export default function PlaidLinkButton({ onSuccess, onProcessing, disabled, relinkItemId, label, onInstitutionUnavailable }: PlaidLinkButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    setLoading(true);
    try {
      await loadPlaidScript();

      const authHeader = await getAuthHeader();

      const tokenRes = await fetch(`${FN_BASE}/plaid-create-link-token`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(OAUTH_REDIRECT_URI ? { redirect_uri: OAUTH_REDIRECT_URI } : {}),
          ...(relinkItemId ? { plaid_item_id: relinkItemId } : {}),
        }),
      });
      const tokenBody = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenBody.error ?? tokenBody.message ?? 'Failed to create link token');

      const { link_token } = tokenBody;
      localStorage.setItem(LINK_TOKEN_KEY, link_token);

      if (!window.Plaid) throw new Error('Plaid script failed to load');
      const handler = window.Plaid.create({
        token: link_token,
        onSuccess: async (public_token, metadata) => {
          onProcessing?.(true);
          try {
            localStorage.removeItem(LINK_TOKEN_KEY);
            const freshAuth = await getAuthHeader();

            if (relinkItemId) {
              // Update mode — no token exchange, just force sync to pull liabilities data
              const syncRes = await fetch(`${FN_BASE}/plaid-sync`, {
                method: 'POST',
                headers: { Authorization: freshAuth, 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_id: relinkItemId, force: true }),
              });
              const syncBody = syncRes.ok ? await syncRes.json() : { accounts: [] };
              onSuccess(syncBody.accounts ?? []);
            } else {
              // New link — exchange token then sync
              const institution = metadata?.institution ?? {};
              const exchangeRes = await fetch(`${FN_BASE}/plaid-exchange-token`, {
                method: 'POST',
                headers: { Authorization: freshAuth, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  public_token,
                  institution_id:   institution.institution_id ?? null,
                  institution_name: institution.name           ?? null,
                }),
              });
              const exchangeBody = await exchangeRes.json();
              if (!exchangeRes.ok) throw new Error(exchangeBody.error ?? exchangeBody.message ?? 'Exchange failed');

              const institutionName = exchangeBody.institution_name ?? 'Your bank';
              const syncRes = await fetch(`${FN_BASE}/plaid-sync`, {
                method: 'POST',
                headers: { Authorization: freshAuth, 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_id: exchangeBody.plaid_item_id, force: true }),
              });
              const syncBody = syncRes.ok ? await syncRes.json() : { accounts: [] };
              onSuccess(syncBody.accounts ?? [], institutionName);
            }
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Link failed');
          } finally {
            onProcessing?.(false);
          }
        },
        onExit: (err, metadata) => {
          localStorage.removeItem(LINK_TOKEN_KEY);
          if (err) console.warn('Plaid Link exited with error:', err);
          setLoading(false);

          // Connectivity failures are the whole reason the Akoya fallback
          // exists. Hand the institution up so the caller can offer it.
          if (classifyPlaidExit(err) === 'institution_unavailable') {
            onInstitutionUnavailable?.(metadata?.institution?.name ?? null);
          }
        },
        onEvent: () => {},
      });

      setLoading(false);
      handler.open();
    } catch (err) {
      setLoading(false);
      toast.error(err instanceof Error ? err.message : 'Failed to open bank link');
    }
  }, [onSuccess, onProcessing, relinkItemId, onInstitutionUnavailable]);

  const defaultLabel = relinkItemId ? 'Re-link Account' : 'Link Bank Account';

  return (
    <button
      onClick={handleClick}
      disabled={disabled || loading}
      className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold btn-press disabled:opacity-50"
      style={{ borderRadius: 'var(--radius)' }}
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
      {loading ? 'Connecting…' : (label ?? defaultLabel)}
    </button>
  );
}
