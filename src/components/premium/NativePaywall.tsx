import { useState, useEffect } from 'react';
import { Crown, Check, RotateCcw, Loader2, AlertCircle, Tag, ExternalLink, CheckCircle2 } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import type { PurchasesOfferings, PurchasesPackage } from '@revenuecat/purchases-capacitor';
import {
  getOfferings,
  purchasePackage,
  restorePurchases,
  presentCodeRedemptionSheet,
  openAndroidOfferRedemption,
} from '@/lib/purchases';
import { useSubscription } from '@/hooks/useSubscription';
import { AI_ADVISOR_ENABLED } from '@/lib/feature-flags';

const FEATURE_LIST = [
  'Advanced dashboard',
  'Export to CSV/PDF',
  'Unlimited savings goals & debts',
  'Custom rule categories',
  // Only advertised while the feature is actually reachable.
  ...(AI_ADVISOR_ENABLED ? ['AI Advisor'] : []),
  'Priority support',
];

const isAndroid = Capacitor.getPlatform() === 'android';

type RedeemPhase = 'idle' | 'instructions' | 'returning' | 'manual-restore';

export default function NativePaywall() {
  const { isPremium, refetch } = useSubscription();
  const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
  const [selectedPkg, setSelectedPkg] = useState<PurchasesPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redeemPhase, setRedeemPhase] = useState<RedeemPhase>('idle');

  useEffect(() => {
    let cancelled = false;
    getOfferings()
      .then((o) => {
        if (cancelled) return;
        setOfferings(o);
        const pkgs = o?.current?.availablePackages ?? [];
        const annual = pkgs.find(
          (p) => p.packageType === 'ANNUAL' || p.identifier === '$rc_annual',
        );
        setSelectedPkg(annual ?? pkgs[0] ?? null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load subscription options');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Polls Supabase waiting for the RevenueCat webhook to land.
  // Returns true if premium is confirmed, false if the window expires.
  const pollUntilPremium = async (attempts = 10, intervalMs = 2000): Promise<boolean> => {
    for (let i = 0; i < attempts; i++) {
      const result = await refetch();
      const sub = result.data;
      if (sub?.plan === 'premium' && ['active', 'trialing'].includes(sub?.subscription_status ?? '')) return true;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
  };

  const handlePurchase = async () => {
    if (!selectedPkg) return;
    setPurchasing(true);
    try {
      const info = await purchasePackage(selectedPkg);
      if (info) {
        await pollUntilPremium();
        toast.success('Welcome to Forgenta Premium!');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('PURCHASE_CANCELLED')) {
        toast.error(msg || 'Purchase failed. Please try again.');
      }
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const info = await restorePurchases();
      if (info) {
        const activated = await pollUntilPremium();
        if (activated) {
          toast.success('Welcome to Forgenta Premium!');
        } else {
          toast.success('Purchases restored! If Premium isn\'t active, please restart the app.');
        }
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Restore failed. Please try again.');
    } finally {
      setRestoring(false);
    }
  };

  const handleOpenPlayStoreRedeem = async () => {
    try {
      const { App } = await import('@capacitor/app');
      let hasLeftApp = false;
      const listener = await App.addListener('appStateChange', async ({ isActive }) => {
        if (!isActive) { hasLeftApp = true; return; }
        if (isActive && hasLeftApp) {
          await listener.remove();
          setRedeemPhase('returning');
          setRestoring(true);
          try {
            const info = await restorePurchases();
            if (info) {
              // Give the RevenueCat → webhook → Supabase chain up to 20s
              const activated = await pollUntilPremium(10, 2000);
              if (activated) {
                setRedeemPhase('idle');
                toast.success('Welcome to Forgenta Premium!');
              } else {
                setRedeemPhase('manual-restore');
              }
            } else {
              setRedeemPhase('manual-restore');
            }
          } catch {
            setRedeemPhase('manual-restore');
          } finally {
            setRestoring(false);
          }
        }
      });
      await openAndroidOfferRedemption();
    } catch (e: unknown) {
      setRedeemPhase('idle');
      toast.error(e instanceof Error ? e.message : 'Could not open Play Store redemption.');
    }
  };

  const handleRedeemCode = async () => {
    if (isAndroid) {
      setRedeemPhase('instructions');
    } else {
      try {
        await presentCodeRedemptionSheet();
        setRestoring(true);
        const activated = await pollUntilPremium();
        if (activated) {
          toast.success('Welcome to Forgenta Premium!');
        } else {
          toast.info('Subscription syncing — tap Restore purchases if Premium isn\'t active in a moment.');
        }
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Could not open code redemption.');
      } finally {
        setRestoring(false);
      }
    }
  };

  // ── Already premium ───────────────────────────────────────────────────────────
  if (isPremium) {
    return (
      <div className="p-4 max-w-sm mx-auto space-y-6 pt-8">
        <div className="text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-gold/15 flex items-center justify-center mx-auto">
            <Crown size={26} className="text-gold" />
          </div>
          <h1 className="font-display font-bold text-xl tracking-tight">You're Premium</h1>
          <p className="text-sm text-muted-foreground">Full access to every feature is active.</p>
        </div>
        <ul className="space-y-2.5">
          {FEATURE_LIST.map((f) => (
            <li key={f} className="flex items-center gap-3 text-sm">
              <Check size={14} className="text-gold shrink-0" />
              {f}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground text-center">
          {isAndroid
            ? 'Manage your subscription in Google Play settings.'
            : 'Manage your subscription in the App Store settings.'}
        </p>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <Loader2 className="mx-auto animate-spin text-primary" size={26} />
          <p className="text-sm text-muted-foreground">Loading plans…</p>
        </div>
      </div>
    );
  }

  // ── Error / no offerings ──────────────────────────────────────────────────────
  if (error || !offerings?.current) {
    return (
      <div className="p-4 max-w-sm mx-auto pt-8 text-center space-y-4">
        <AlertCircle size={32} className="mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {error ?? 'No plans available. Check your store connection and try again.'}
        </p>
        <button
          onClick={() => { setError(null); setLoading(true); }}
          className="text-xs text-primary underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const packages = offerings.current.availablePackages;

  return (
    <div className="p-4 pb-4 max-w-sm mx-auto space-y-4">
      {/* Header */}
      <div className="text-center space-y-2 pt-2">
        <div className="w-12 h-12 rounded-full bg-gold/15 flex items-center justify-center mx-auto">
          <Crown size={22} className="text-gold" />
        </div>
        <h1 className="font-display font-bold text-xl tracking-tight">Upgrade to Premium</h1>
        <p className="text-xs text-muted-foreground">Unlock your full financial picture.</p>
      </div>

      {/* Feature list */}
      <ul className="space-y-2.5">
        {FEATURE_LIST.map((f) => (
          <li key={f} className="flex items-center gap-3 text-sm">
            <Check size={14} className="text-gold shrink-0" />
            {f}
          </li>
        ))}
      </ul>

      {/* Package selector */}
      <div className="space-y-2">
        {packages.map((pkg) => {
          const isSelected = selectedPkg?.identifier === pkg.identifier;
          const isAnnual =
            pkg.packageType === 'ANNUAL' || pkg.identifier === '$rc_annual';
          return (
            <button
              key={pkg.identifier}
              onClick={() => setSelectedPkg(pkg)}
              className={`w-full text-left p-4 border transition-all ${
                isSelected
                  ? 'border-gold bg-gold/5'
                  : 'border-border bg-card hover:border-gold/40'
              }`}
              style={{ borderRadius: 'var(--radius)' }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">
                    {isAnnual ? 'Yearly' : 'Monthly'}
                    {isAnnual && (
                      <span className="ml-2 text-[10px] font-bold bg-gold/15 text-gold px-2 py-0.5 rounded-full uppercase">
                        Best value
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {pkg.product.priceString}
                    {isAnnual ? '/year' : '/month'}
                  </p>
                </div>
                <div
                  className={`w-4 h-4 rounded-full border-2 transition-all ${
                    isSelected ? 'border-gold bg-gold' : 'border-border'
                  }`}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Purchase CTA */}
      <button
        onClick={handlePurchase}
        disabled={purchasing || !selectedPkg}
        className="w-full bg-primary text-primary-foreground py-3.5 text-sm font-semibold btn-press flex items-center justify-center gap-2 disabled:opacity-60"
        style={{ borderRadius: 'var(--radius)' }}
      >
        {purchasing ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <>
            <Crown size={15} className="text-primary-foreground/80" />
            {selectedPkg
              ? `Get Premium — ${selectedPkg.product.priceString}`
              : 'Get Premium'}
          </>
        )}
      </button>

      {/* Android: instruction panel / returning state / manual-restore prompt */}
      {isAndroid && redeemPhase === 'instructions' && (
        <div className="border border-border rounded-lg p-4 space-y-3 bg-card">
          <p className="text-xs font-semibold">How to redeem your promo code</p>
          <ol className="space-y-2">
            {[
              'Tap "Open Google Play" below — you\'ll be taken to the Play Store redemption page.',
              'Enter your promo code and tap Redeem.',
              'Return to this app — your Premium access will activate automatically.',
              'If it doesn\'t activate within 30 seconds, tap "Restore purchases."',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs text-muted-foreground">
                <span className="shrink-0 w-4 h-4 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleOpenPlayStoreRedeem}
              className="flex-1 bg-primary text-primary-foreground py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Open Google Play <ExternalLink size={12} />
            </button>
            <button
              onClick={() => setRedeemPhase('idle')}
              className="px-3 py-2.5 text-xs text-muted-foreground border border-border hover:text-foreground transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isAndroid && redeemPhase === 'returning' && (
        <div className="border border-border rounded-lg p-4 flex items-center gap-3 bg-card">
          <Loader2 size={16} className="animate-spin text-primary shrink-0" />
          <div>
            <p className="text-xs font-semibold">Activating your subscription…</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">This can take up to 30 seconds.</p>
          </div>
        </div>
      )}

      {isAndroid && redeemPhase === 'manual-restore' && (
        <div className="border border-amber-500/30 rounded-lg p-4 space-y-2.5 bg-amber-500/5">
          <p className="text-xs font-semibold">Almost there — one more step</p>
          <p className="text-[11px] text-muted-foreground">
            Your Play Store redemption was successful but Premium hasn't synced yet. Tap below to pull in your subscription.
          </p>
          <button
            onClick={async () => {
              setRestoring(true);
              try {
                const info = await restorePurchases();
                if (info) {
                  const activated = await pollUntilPremium(6, 3000);
                  if (activated) {
                    setRedeemPhase('idle');
                    toast.success('Welcome to Forgenta Premium!');
                  } else {
                    toast.info('Still syncing. Wait a moment and tap Restore again, or contact support.');
                  }
                }
              } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Restore failed. Please try again.');
              } finally {
                setRestoring(false);
              }
            }}
            disabled={restoring}
            className="w-full bg-primary text-primary-foreground py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {restoring ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Restore purchases
          </button>
        </div>
      )}

      {/* Redeem code — all platforms (hidden while Android instruction panels are active) */}
      {!(isAndroid && redeemPhase !== 'idle') && (
        <div className="text-center">
          <button
            onClick={handleRedeemCode}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
          >
            <Tag size={14} />
            {isAndroid ? 'Redeem promo code' : 'Redeem code'}
          </button>
        </div>
      )}

      {/* Restore purchases + legal — grouped to stay above fold */}
      <div className="flex flex-col items-center gap-1.5">
        {redeemPhase === 'idle' && (
          <button
            onClick={handleRestore}
            disabled={restoring}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
          >
            {restoring ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RotateCcw size={12} />
            )}
            Restore purchases
          </button>
        )}
        <p className="text-[10px] text-muted-foreground text-center px-4">
          {isAndroid
            ? 'Auto-renews. Cancel anytime in Google Play settings.'
            : 'Auto-renews. Cancel anytime in App Store settings.'}
        </p>
        <div className="flex items-center justify-center gap-3 pt-1">
          <a
            href="https://getforgenta.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-muted-foreground hover:text-foreground underline"
          >
            Privacy Policy
          </a>
          <span className="text-muted-foreground/30 text-[10px]">·</span>
          <a
            href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-muted-foreground hover:text-foreground underline"
          >
            Terms of Use
          </a>
        </div>
      </div>
    </div>
  );
}
