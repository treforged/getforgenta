/**
 * PlaidLinkButton
 *
 * Creates a link token via the plaid-create-link-token edge function, opens the
 * Plaid Link UI, then calls plaid-exchange-token and triggers onSuccess() so the
 * parent can refresh account/plaid-items data.
 *
 * TWO SURFACES, DELIBERATELY DIFFERENT:
 *
 * - **Web** loads Plaid's Link SDK from their CDN and opens the widget inline.
 *   No npm dependency.
 * - **Native** uses Plaid **Hosted Link** in an SFSafariViewController / Custom
 *   Tab instead. The widget renders as an iframe inside our own document, and on
 *   iOS that document is full-bleed (`viewport-fit=cover`), so Plaid's header
 *   painted at y=0 collided with the status bar — its close and back buttons were
 *   unusable. We cannot fix that from CSS: Plaid ships a stylesheet whose selector
 *   carries eight `#plaid-link-temporary-id` IDs and pins
 *   `top: 0 !important; height: 100% !important; border: 0 !important`, and it is
 *   served from an unversioned `/stable/` URL that changes with no deploy of ours.
 *   A system browser sheet is inset correctly by the OS by construction, so the
 *   problem stops existing rather than being fought.
 *
 * Both paths converge on completeLink(), so "an item was added" has one
 * implementation.
 */

import { useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App as CapApp } from '@capacitor/app';
import { Link2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { classifyPlaidExit } from '@/lib/providers/connection-errors';

const PLAID_SCRIPT_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
/** Must match HOSTED_COMPLETION_URI in the plaid-create-link-token edge function. */
const HOSTED_COMPLETE_URL = 'com.treforged.forged://plaid-complete';
/**
 * Plaid records the session server-side a moment after it redirects us back, so
 * the first read can legitimately be `pending`. A short retry beats making the
 * user press the button again.
 */
const RESULT_POLL_ATTEMPTS = 6;
const RESULT_POLL_DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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

  /**
   * Everything that happens once Plaid has handed us a public_token — or, in
   * re-link/update mode, once the session has finished and there is nothing to
   * exchange. Shared by the web widget and the native hosted flow.
   */
  const completeLink = useCallback(async (
    publicToken: string | null,
    institutionId: string | null,
    institutionName: string | null,
  ) => {
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
        return;
      }

      if (!publicToken) throw new Error('Link finished without returning a token');

      // New link — exchange token then sync
      const exchangeRes = await fetch(`${FN_BASE}/plaid-exchange-token`, {
        method: 'POST',
        headers: { Authorization: freshAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          public_token: publicToken,
          institution_id:   institutionId   ?? null,
          institution_name: institutionName ?? null,
        }),
      });
      const exchangeBody = await exchangeRes.json();
      if (!exchangeRes.ok) throw new Error(exchangeBody.error ?? exchangeBody.message ?? 'Exchange failed');

      const resolvedName = exchangeBody.institution_name ?? 'Your bank';
      const syncRes = await fetch(`${FN_BASE}/plaid-sync`, {
        method: 'POST',
        headers: { Authorization: freshAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: exchangeBody.plaid_item_id, force: true }),
      });
      const syncBody = syncRes.ok ? await syncRes.json() : { accounts: [] };
      onSuccess(syncBody.accounts ?? [], resolvedName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Link failed');
    } finally {
      onProcessing?.(false);
    }
  }, [onSuccess, onProcessing, relinkItemId]);

  /**
   * Native: Plaid hosts the flow, we open it in a system browser sheet and wait
   * for the custom-scheme redirect. Because the sheet is a separate context there
   * is no onSuccess callback — the result is fetched from Plaid server-side by
   * plaid-hosted-link-result once the session closes.
   */
  const runHostedLink = useCallback(async () => {
    const authHeader = await getAuthHeader();

    const tokenRes = await fetch(`${FN_BASE}/plaid-create-link-token`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hosted: true,
        ...(relinkItemId ? { plaid_item_id: relinkItemId } : {}),
      }),
    });
    const tokenBody = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenBody.error ?? tokenBody.message ?? 'Failed to create link token');

    const { link_token, hosted_link_url } = tokenBody;
    if (!hosted_link_url) throw new Error('Plaid did not return a hosted link URL');
    localStorage.setItem(LINK_TOKEN_KEY, link_token);

    // Resolves when Plaid redirects back to our scheme, or when the user dismisses
    // the sheet themselves. Mirrors the proven OAuth pattern in src/pages/Auth.tsx.
    const redirected = await new Promise<boolean>((resolve) => {
      let urlHandle: { remove: () => void } | null = null;
      let finishedHandle: { remove: () => void } | null = null;
      let settled = false;

      const cleanup = () => { urlHandle?.remove(); finishedHandle?.remove(); };

      const setup = async () => {
        urlHandle = await CapApp.addListener('appUrlOpen', ({ url }) => {
          if (!url.startsWith(HOSTED_COMPLETE_URL)) return;
          settled = true;
          cleanup();
          Browser.close().catch(() => {});
          resolve(true);
        });

        // Fires when the user closes the sheet by hand. Delayed so a successful
        // redirect wins if both fire.
        finishedHandle = await Browser.addListener('browserFinished', () => {
          setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(false);
          }, 300);
        });

        await Browser.open({ url: hosted_link_url });
      };

      setup().catch(() => { cleanup(); resolve(false); });
    });

    // Re-link mode never produces a public_token — finishing the session is the
    // whole result, so sync straight away.
    if (relinkItemId) {
      if (redirected) await completeLink(null, null, null);
      else setLoading(false);
      return;
    }

    const freshAuth = await getAuthHeader();
    for (let attempt = 0; attempt < RESULT_POLL_ATTEMPTS; attempt++) {
      const res = await fetch(`${FN_BASE}/plaid-hosted-link-result`, {
        method: 'POST',
        headers: { Authorization: freshAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_token }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not read the link result');

      if (body.status === 'completed') {
        setLoading(false);
        await completeLink(body.public_token, body.institution_id, body.institution_name);
        return;
      }
      if (body.status === 'exited' && !redirected) break;
      await sleep(RESULT_POLL_DELAY_MS);
    }

    // Dismissed without linking, or Plaid never recorded a completed session.
    localStorage.removeItem(LINK_TOKEN_KEY);
    setLoading(false);
  }, [relinkItemId, completeLink]);

  const handleClick = useCallback(async () => {
    setLoading(true);
    try {
      if (Capacitor.isNativePlatform()) {
        await runHostedLink();
        return;
      }

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
          const institution = metadata?.institution ?? {};
          await completeLink(
            public_token,
            institution.institution_id ?? null,
            institution.name ?? null,
          );
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
  }, [completeLink, runHostedLink, relinkItemId, onInstitutionUnavailable]);

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
