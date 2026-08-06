/**
 * AkoyaConnectButton
 *
 * Starts the Akoya OAuth flow. Unlike Plaid there is no drop-in widget: the
 * backend mints an authorization URL (and a single-use CSRF state), and we send
 * the browser to it. The user comes back to /akoya-oauth with a code.
 *
 * Full-page navigation rather than a popup, deliberately: the native app runs
 * the site inside a webview pointed at getforgenta.com, so a same-tab redirect
 * returns to the app naturally on both web and mobile. Popups are blocked or
 * orphaned in webviews.
 */

import { useCallback, useState } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { AkoyaInstitution } from '@/config/akoya-institutions';

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/** Lets the callback page tell the user which institution they were linking. */
const PENDING_KEY = 'forged:akoya_pending_institution';

async function getAuthHeader(): Promise<string> {
  const { data: refreshData } = await supabase.auth.refreshSession();
  const token = refreshData.session?.access_token;
  if (!token) {
    const { data } = await supabase.auth.getSession();
    const fallback = data.session?.access_token;
    if (!fallback) throw new Error('Not authenticated. Please sign in again.');
    return `Bearer ${fallback}`;
  }
  return `Bearer ${token}`;
}

interface AkoyaConnectButtonProps {
  institution: AkoyaInstitution;
  disabled?: boolean;
  label?: string;
}

export default function AkoyaConnectButton({
  institution,
  disabled,
  label,
}: AkoyaConnectButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    setLoading(true);
    try {
      const authHeader = await getAuthHeader();

      const res = await fetch(`${FN_BASE}/akoya-auth-url`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ institution: institution.key }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? 'Could not start the connection');
      }

      sessionStorage.setItem(
        PENDING_KEY,
        body.institution_name ?? institution.displayName,
      );

      // Leaves the app. The callback lands on /akoya-oauth.
      window.location.assign(body.auth_url);
    } catch (err) {
      setLoading(false);
      toast.error(err instanceof Error ? err.message : 'Failed to start connection');
    }
  }, [institution]);

  return (
    <button
      onClick={handleClick}
      disabled={disabled || loading}
      className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold btn-press disabled:opacity-50 shrink-0"
      style={{ borderRadius: 'var(--radius)' }}
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
      {loading ? 'Connecting…' : (label ?? `Connect using Akoya`)}
    </button>
  );
}

export { PENDING_KEY as AKOYA_PENDING_INSTITUTION_KEY };
