import { useState } from 'react';
import { Crown, X, AlertTriangle, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/integrations/supabase/client';
import { tracedInvoke } from '@/lib/tracer';

const PREMIUM_FEATURES = [
  'Advanced dashboard & analytics',
  'Export to CSV / PDF',
  'Unlimited savings goals & debt trackers',
  'Custom rule categories',
  'AI Advisor',
  'Plaid bank account syncing',
  'Priority support',
];

export default function SubscriptionExpiryBanner() {
  const { subscription } = useSubscription();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!subscription?.cancel_at_period_end || dismissed) return null;
  if (!subscription.current_period_end) return null;

  const daysLeft = Math.max(
    0,
    Math.ceil(
      (new Date(subscription.current_period_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    ),
  );

  const isNative = Capacitor.isNativePlatform();
  const isStripe =
    subscription.purchase_provider === 'stripe' || subscription.purchase_provider == null;

  const handleResubscribe = async () => {
    setShowModal(false);
    if (isNative || !isStripe) {
      navigate('/premium');
      return;
    }
    // Stripe web: billing portal has a "Resume subscription" button for cancel_at_period_end subs
    setLoading(true);
    try {
      const { data, error } = await tracedInvoke<{ url: string }>(supabase, 'create-portal-session', {
        body: { return_url: window.location.href },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to open billing portal');
    } finally {
      setLoading(false);
    }
  };

  const urgent = daysLeft <= 3;
  const bannerCls = urgent
    ? 'border-destructive/40 bg-destructive/5'
    : 'border-amber-500/30 bg-amber-500/5';
  const iconCls = urgent ? 'text-destructive' : 'text-amber-500';

  const expiryLabel =
    daysLeft === 0
      ? 'Premium expires today'
      : `Premium expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;

  const ctaLabel = !isNative && isStripe ? 'Resume' : 'Resubscribe';

  return (
    <>
      <div
        className={`flex items-center justify-between gap-3 border px-4 py-3 ${bannerCls}`}
        style={{ borderRadius: 'var(--radius)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <AlertTriangle size={15} className={`${iconCls} shrink-0`} />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">{expiryLabel}</p>
            <button
              onClick={() => setShowModal(true)}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
            >
              See what you'll lose access to
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleResubscribe}
            disabled={loading}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold btn-press disabled:opacity-60"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Crown size={12} />}
            {ctaLabel}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {showModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80"
          onClick={() => setShowModal(false)}
        >
          <div
            className="card-forged p-5 w-full max-w-sm space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Crown size={16} className="text-gold" />
                <h2 className="font-display font-semibold text-sm text-gold">Premium Features</h2>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              When your subscription ends
              {daysLeft > 0 ? ` in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : ' today'},
              you'll lose access to:
            </p>

            <ul className="space-y-2">
              {PREMIUM_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-xs text-foreground">
                  <span className="text-destructive font-bold text-sm leading-none">−</span>
                  {f}
                </li>
              ))}
            </ul>

            <button
              onClick={handleResubscribe}
              disabled={loading}
              className="w-full bg-primary text-primary-foreground py-2.5 text-xs font-semibold btn-press flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <Crown size={13} />}
              {!isNative && isStripe ? 'Resume Subscription' : 'Resubscribe to Premium'}
            </button>

            <button
              onClick={() => setShowModal(false)}
              className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Maybe later
            </button>
          </div>
        </div>
      )}
    </>
  );
}
