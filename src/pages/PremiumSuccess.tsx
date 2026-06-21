import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, Loader2 } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/integrations/supabase/client';
import { tracedInvoke } from '@/lib/tracer';
import { premiumSuccessParamsSchema } from '@/lib/schemas';
import AppTour from '@/components/shared/AppTour';

export default function PremiumSuccess() {
  const { refetch } = useSubscription();
  const [searchParams] = useSearchParams();
  const [polling, setPolling] = useState(true);
  const [verified, setVerified] = useState(false);

  const rawSessionId = searchParams.get('session_id');
  const sessionIdResult = premiumSuccessParamsSchema.safeParse({ session_id: rawSessionId });
  const sessionId = sessionIdResult.success ? sessionIdResult.data.session_id : null;

  useEffect(() => {
    if (!sessionId) {
      setPolling(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      // Primary path: call verify-checkout to activate immediately from the
      // redirect URL, bypassing the webhook entirely. This is the fix for
      // mobile Safari users who leave before the webhook fires.
      const { data, error } = await tracedInvoke<{
        activated: boolean;
        plan?: string;
        subscription_status?: string;
      }>(supabase, 'verify-checkout', {
        method: 'POST',
        body: { session_id: sessionId },
      });

      if (cancelled) return;

      if (!error && data?.activated) {
        setVerified(true);
        setPolling(false);
        return;
      }

      // Fallback: edge function unavailable or session already activated — poll
      // the DB until the subscription record reflects the active state.
      let attempts = 0;
      const MAX_ATTEMPTS = 7;

      const poll = async () => {
        if (cancelled) return;
        const result = await refetch();
        const sub = result.data as { plan?: string; subscription_status?: string } | null;
        if (
          sub?.plan === 'premium' &&
          ['active', 'trialing'].includes(sub?.subscription_status || '')
        ) {
          if (!cancelled) {
            setVerified(true);
            setPolling(false);
          }
          return;
        }
        attempts++;
        if (attempts >= MAX_ATTEMPTS) {
          if (!cancelled) setPolling(false);
          return;
        }
        setTimeout(poll, 1500);
      };

      setTimeout(poll, 500);
    };

    run();

    return () => { cancelled = true; };
    // Intentionally mount-only: this verifies/polls a single Stripe checkout
    // redirect exactly once per page load. Re-running on sessionId/refetch
    // reference changes would restart the verification poll unexpectedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (polling) {
    return (
      <div className="p-4 lg:p-6 max-w-md mx-auto text-center space-y-4 mt-12">
        <Loader2 className="mx-auto animate-spin text-primary" size={32} />
        <p className="text-sm font-medium">Activating your subscription…</p>
        <p className="text-xs text-muted-foreground">This usually takes a few seconds.</p>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-md mx-auto text-center space-y-6 mt-12">
      <AppTour variant="premium" />
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
        <CheckCircle className="text-primary" size={32} />
      </div>
      <h1 className="font-display font-bold text-xl tracking-tight">Welcome to Premium!</h1>
      {verified ? (
        <p className="text-sm text-muted-foreground">
          Your subscription is confirmed and active. All premium features are unlocked.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Your payment was received. Premium access may take a moment to activate — if the
          dashboard still shows a paywall, wait a few seconds and refresh.
        </p>
      )}
      <Link
        to="/dashboard"
        className="inline-block bg-primary text-primary-foreground px-6 py-2 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors"
        style={{ borderRadius: 'var(--radius)' }}
      >
        Go to Dashboard
      </Link>
    </div>
  );
}
