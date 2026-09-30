// One-time offer of biometric unlock to users who already use a PIN (ask 2e42290d)
import { useAppLock } from '@/hooks/useAppLock';
import { Capacitor } from '@capacitor/core';
import { Fingerprint, X } from 'lucide-react';
import { toast } from 'sonner';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';
import { useState } from 'react';

export default function BiometricOfferModal() {
  const { showBiometricOffer, acceptBiometricOffer, dismissBiometricOffer } = useAppLock();
  const [busy, setBusy] = useState(false);

  useEscapeToClose(() => {
    if (!busy) void dismissBiometricOffer();
  }, showBiometricOffer);

  if (!showBiometricOffer) return null;

  const isIos = Capacitor.getPlatform() === 'ios';
  const name = isIos ? 'Face ID' : 'fingerprint unlock';

  const handleAccept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await acceptBiometricOffer();
      setBusy(false);
      if (ok) toast.success(`${name} is on`);
      else toast.error(`${name} was not turned on. Your PIN still works.`);
    } catch {
      setBusy(false);
      toast.error('Failed to enable biometric unlock');
    }
  };

  const handleDismiss = () => {
    if (busy) return;
    void dismissBiometricOffer();
  };

  return (
    <div className="modal-overlay z-9998 bg-background/80 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Use ${name}`}
        className="w-full max-w-sm bg-background border border-border shadow-xl flex flex-col items-center gap-6 p-6 relative"
        style={{ borderRadius: 'var(--radius)' }}
      >
        <button
          type="button"
          aria-label="Close"
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
          onClick={handleDismiss}
        >
          <X size={16} />
        </button>
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Fingerprint size={22} className="text-primary" />
        </div>
        <p className="font-semibold text-sm">{`Unlock with ${name}?`}</p>
        <p className="text-xs text-muted-foreground">
          Skip typing your PIN. Your PIN still works as a backup, and you can turn this off in Settings.
        </p>
        <button
          type="button"
          className="w-full flex items-center justify-center gap-2 py-3 text-sm font-medium bg-primary text-primary-foreground btn-press disabled:opacity-50"
          style={{ borderRadius: 'var(--radius)' }}
          onClick={handleAccept}
          disabled={busy}
        >
          <Fingerprint size={16} />
          {`Use ${name}`}
        </button>
        <button
          type="button"
          className="w-full py-3 text-sm font-medium bg-secondary border border-border hover:border-primary/40 btn-press"
          style={{ borderRadius: 'var(--radius)' }}
          onClick={handleDismiss}
          disabled={busy}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
