import { useState, useEffect } from 'react';
import { Crown, Check, RotateCcw, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { PurchasesOfferings, PurchasesPackage } from '@revenuecat/purchases-capacitor';
import {
  getOfferings,
  purchasePackage,
  restorePurchases,
} from '@/lib/purchases';
import { useSubscription } from '@/hooks/useSubscription';

const FEATURE_LIST = [
  'Advanced dashboard',
  'Export to CSV/PDF',
  'Unlimited savings goals & debts',
  'Car Fund Tracker',
  'Custom rule categories',
  'AI Advisor',
  'Priority support',
];

export default function IosPaywall() {
  const { isPremium, refetch } = useSubscription();
  const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
  const [selectedPkg, setSelectedPkg] = useState<PurchasesPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handlePurchase = async () => {
    if (!selectedPkg) return;
    setPurchasing(true);
    try {
      const info = await purchasePackage(selectedPkg);
      if (info) {
        await refetch();
        toast.success('Welcome to Forged Premium!');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // RevenueCat surfaces user-cancelled as a specific code — don't show an error toast for it
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
        await refetch();
        toast.success('Purchases restored successfully!');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Restore failed. Please try again.');
    } finally {
      setRestoring(false);
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
          Manage your subscription in the App Store settings.
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
          {error ?? 'No plans available. Check your App Store connection and try again.'}
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
    <div className="p-4 pb-12 max-w-sm mx-auto space-y-6">
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

      <p className="text-[10px] text-muted-foreground text-center px-4">
        Subscription auto-renews. Cancel anytime in App Store settings.
        Payment charged to your Apple ID at confirmation of purchase.
      </p>

      {/* Restore purchases — required by App Store guidelines */}
      <div className="text-center">
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
      </div>
    </div>
  );
}
