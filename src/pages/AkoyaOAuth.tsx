/**
 * AkoyaOAuth
 *
 * Callback landing page for the Akoya consent flow. Akoya redirects here with
 * `code` and `state` in the query string.
 *
 * The code is handed straight to an edge function and exchanged server-side.
 * Akoya's guidance is explicit on this: never exchange in the browser and never
 * transport a token back through a URL.
 *
 * The authorization code expires five minutes after issue, so this runs
 * immediately on mount and reports clearly when it's too late.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { AKOYA_PENDING_INSTITUTION_KEY } from '@/components/shared/AkoyaConnectButton';

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export default function AkoyaOAuth() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  // StrictMode double-invokes effects in dev; the state is single-use, so a
  // second exchange would fail and show a spurious error.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    async function completeConnection() {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');
        const providerError = params.get('error');

        if (providerError) {
          throw new Error(
            params.get('error_description') ??
              'The connection was declined or cancelled.',
          );
        }
        if (!code || !state) {
          throw new Error('This connection link is incomplete. Please try again.');
        }

        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error('Not authenticated');

        const institutionName = sessionStorage.getItem(AKOYA_PENDING_INSTITUTION_KEY);
        sessionStorage.removeItem(AKOYA_PENDING_INSTITUTION_KEY);

        const exchangeRes = await fetch(`${FN_BASE}/akoya-exchange-token`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code,
            state,
            ...(institutionName ? { institution_name: institutionName } : {}),
          }),
        });
        const exchangeBody = await exchangeRes.json();
        if (!exchangeRes.ok) {
          throw new Error(exchangeBody.error ?? 'Could not complete the connection');
        }

        if (cancelled) return;

        const name = exchangeBody.institution_name ?? 'Your account';
        toast.success(`${name} linked successfully`);

        // Pull balances for the new connection right away.
        await fetch(`${FN_BASE}/financial-sync`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            connection_id: exchangeBody.connection_id,
            force: true,
          }),
        }).catch(err => {
          // A failed first sync isn't fatal — the connection exists and the
          // next scheduled sync will pick it up.
          console.warn('Initial Akoya sync failed:', err);
        });

        navigate('/accounts');
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.');
        setStatus('error');
      }
    }

    completeConnection();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (status === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <AlertCircle size={32} className="text-destructive" />
        <p className="text-sm text-muted-foreground max-w-xs">{errorMsg}</p>
        <button
          onClick={() => navigate('/accounts')}
          className="text-xs text-primary underline underline-offset-2"
        >
          Back to Accounts
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3">
      <Loader2 size={24} className="animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Completing your connection…</p>
    </div>
  );
}
