import { useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Fingerprint, KeyRound, X, Delete, CheckCircle2 } from 'lucide-react';
import { useAppLock } from '@/hooks/useAppLock';
import { toast } from 'sonner';

type Step = 'intro' | 'pin-entry' | 'pin-confirm' | 'bio-pin-entry' | 'bio-pin-confirm' | 'done';

const PIN_LENGTH = 6;
const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
const isIos = Capacitor.getPlatform() === 'ios';

function PinDots({ pin, error }: { pin: string; error: boolean }) {
  return (
    <div className="flex gap-3 justify-center">
      {Array.from({ length: PIN_LENGTH }).map((_, i) => (
        <div
          key={i}
          className={`w-3 h-3 rounded-full border-2 transition-all duration-150 ${
            i < pin.length
              ? error ? 'bg-destructive border-destructive' : 'bg-primary border-primary'
              : 'border-muted-foreground/40'
          }`}
        />
      ))}
    </div>
  );
}

function Numpad({ onDigit, disabled }: { onDigit: (d: string) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-3 w-64">
      {DIGITS.map((d, i) => (
        <button
          key={i}
          disabled={disabled || d === ''}
          onClick={() => onDigit(d)}
          className={`h-16 flex items-center justify-center text-xl font-medium transition-colors btn-press disabled:opacity-30 ${
            d === '' ? 'invisible' :
            d === '⌫' ? 'text-muted-foreground hover:text-foreground' :
            'bg-secondary border border-border hover:border-primary/40 hover:text-primary'
          }`}
          style={{ borderRadius: 'var(--radius)' }}
        >
          {d === '⌫' ? <Delete size={18} /> : d}
        </button>
      ))}
    </div>
  );
}

export default function AppLockSetupModal() {
  const { showSetupModal, biometricAvailable, setupPin, setupBiometricWithPin, dismissSetupModal } = useAppLock();

  const [step, setStep] = useState<Step>('intro');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flow, setFlow] = useState<'pin' | 'biometric'>('pin');

  const handleConfirmDigit = useCallback(async (d: string) => {
    if (d === '⌫') { setConfirmPin(p => p.slice(0, -1)); setError(false); return; }
    if (d === '' || confirmPin.length >= PIN_LENGTH) return;
    const next = confirmPin + d;
    setConfirmPin(next);

    if (next.length < PIN_LENGTH) return;

    if (next !== pin) {
      setError(true);
      setTimeout(() => {
        setConfirmPin('');
        setPin('');
        setError(false);
        setStep(flow === 'biometric' ? 'bio-pin-entry' : 'pin-entry');
      }, 700);
      return;
    }

    setBusy(true);
    try {
      if (flow === 'biometric') {
        const ok = await setupBiometricWithPin(next);
        if (!ok) { toast.error('Biometric setup failed — try again'); setStep('intro'); }
        else setStep('done');
      } else {
        await setupPin(next);
        setStep('done');
      }
    } finally {
      setBusy(false);
    }
  }, [confirmPin, pin, flow, setupPin, setupBiometricWithPin]);

  if (!showSetupModal) return null;

  const handleDismiss = () => {
    setStep('intro');
    setPin('');
    setConfirmPin('');
    setError(false);
    dismissSetupModal();
  };

  const handlePinDigit = (d: string) => {
    if (d === '⌫') { setPin(p => p.slice(0, -1)); setError(false); return; }
    if (d === '' || pin.length >= PIN_LENGTH) return;
    const next = pin + d;
    setPin(next);
    if (next.length === PIN_LENGTH) {
      setStep(flow === 'biometric' ? 'bio-pin-confirm' : 'pin-confirm');
      setConfirmPin('');
    }
  };

  return (
    <div className="fixed inset-0 z-[9998] bg-background/80 backdrop-blur-sm flex items-center justify-center px-6">
      <div className="w-full max-w-sm bg-background border border-border shadow-xl flex flex-col items-center gap-6 p-6 relative" style={{ borderRadius: 'var(--radius)' }}>

        {/* Dismiss (always available) */}
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
        >
          <X size={16} />
        </button>

        {/* ── Intro ────────────────────────────────────── */}
        {step === 'intro' && (
          <>
            <div className="text-center space-y-1.5">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <KeyRound size={22} className="text-primary" />
              </div>
              <p className="font-semibold text-sm">A PIN is required</p>
              <p className="text-xs text-muted-foreground">
                {isIos && biometricAvailable
                  ? 'Set up Face ID or a PIN to protect your account when the app is closed or your screen turns off.'
                  : 'Set a PIN to protect your account when the app is closed or your screen turns off.'}
              </p>
            </div>

            <div className="w-full space-y-2">
              {isIos && biometricAvailable && (
                <button
                  onClick={() => { setFlow('biometric'); setStep('bio-pin-entry'); setPin(''); }}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm font-medium bg-primary text-primary-foreground btn-press"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  <Fingerprint size={16} /> Enable Face ID
                </button>
              )}
              <button
                onClick={() => { setFlow('pin'); setStep('pin-entry'); setPin(''); }}
                className={`w-full flex items-center justify-center gap-2 py-3 text-sm font-medium btn-press ${
                  isIos && biometricAvailable
                    ? 'bg-secondary border border-border hover:border-primary/40'
                    : 'bg-primary text-primary-foreground'
                }`}
                style={{ borderRadius: 'var(--radius)' }}
              >
                <KeyRound size={16} /> Set a PIN
              </button>
              <button
                onClick={handleDismiss}
                className="w-full py-2.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Skip for now
              </button>
            </div>
          </>
        )}

        {/* ── PIN entry ─────────────────────────────────── */}
        {(step === 'pin-entry' || step === 'bio-pin-entry') && (
          <>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">
                {step === 'bio-pin-entry' ? 'Create a PIN fallback' : 'Create a PIN'}
              </p>
              <p className="text-xs text-muted-foreground">
                {step === 'bio-pin-entry'
                  ? 'Used when Face ID is unavailable'
                  : 'Enter a 6-digit PIN'}
              </p>
            </div>
            <PinDots pin={pin} error={false} />
            <Numpad onDigit={handlePinDigit} />
          </>
        )}

        {/* ── PIN confirm ───────────────────────────────── */}
        {(step === 'pin-confirm' || step === 'bio-pin-confirm') && (
          <>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">Confirm your PIN</p>
              <p className="text-xs text-muted-foreground">Enter your PIN again to confirm</p>
            </div>
            {error && (
              <p className="text-xs text-destructive -mb-2">PINs don't match — try again</p>
            )}
            <PinDots pin={confirmPin} error={error} />
            <Numpad onDigit={handleConfirmDigit} disabled={busy} />
          </>
        )}

        {/* ── Done ─────────────────────────────────────── */}
        {step === 'done' && (
          <>
            <div className="flex flex-col items-center gap-3 text-center">
              <CheckCircle2 size={40} className="text-primary" />
              <p className="text-sm font-medium">
                {flow === 'biometric' ? 'Face ID lock enabled' : 'PIN lock enabled'}
              </p>
              <p className="text-xs text-muted-foreground">
                Your account locks when the app is closed or your screen turns off.
                You can manage this in Settings.
              </p>
            </div>
            <button
              onClick={handleDismiss}
              className="w-full py-3 text-sm font-medium bg-primary text-primary-foreground btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
