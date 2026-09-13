import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import { Fingerprint, Delete, AlertTriangle } from 'lucide-react';
import { useAppLock, MAX_FAILED_ATTEMPTS } from '@/hooks/useAppLock';
import { supabase } from '@/lib/supabase';
import { tapFeedback } from '@/lib/haptics';
import { toast } from 'sonner';

const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
const PIN_LENGTH = 6;
/**
 * How long a key stays visibly lit after it is pressed.
 *
 * ⚠️ THIS IS WHY `btn-press` ALONE WAS NOT ENOUGH, and the reason is worth keeping. `btn-press`
 * is `active:scale-[0.98]` — a 2% shrink that lasts only while the finger is DOWN. On a 64px
 * key that is a 1.3px movement for the duration of a tap, which is why Tre reported the pad as
 * having no effect at all (2026-09-12) even though every key already carried the class.
 * A latched state is also the only thing that can light a key for a PHYSICAL KEYBOARD press,
 * where `:active` never fires because nothing was ever touched.
 */
const KEY_FLASH_MS = 140;

export default function AppLockScreen() {
  const {
    ready, isLocked, lockType, failedAttempts,
    unlockWithPin, unlockWithBiometric,
  } = useAppLock();
  const navigate = useNavigate();

  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showPinFallback, setShowPinFallback] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const activeType = showPinFallback ? 'pin' : lockType;
  const tooManyAttempts = failedAttempts >= MAX_FAILED_ATTEMPTS;

  const triggerBio = useCallback(async () => {
    if (lockType !== 'biometric') return;
    const ok = await unlockWithBiometric();
    if (!ok) toast.error('Biometric authentication failed — use your PIN instead');
  }, [lockType, unlockWithBiometric]);

  // Auto-trigger biometric on mount / when lock screen appears
  useEffect(() => {
    if (!isLocked) return;
    if (lockType === 'biometric' && !showPinFallback) {
      const t = setTimeout(triggerBio, 400);
      return () => clearTimeout(t);
    }
  }, [isLocked, lockType, showPinFallback, triggerBio]);

  // The key currently lit, and the timer that clears it. The ref lets a fast repeat press
  // restart the flash instead of the first press's timer cutting the second one short.
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  /** Light the key and fire a light haptic. Never throws — see lib/haptics.ts. */
  const flashKey = useCallback((d: string) => {
    setPressedKey(d);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setPressedKey(null), KEY_FLASH_MS);
    void tapFeedback();
  }, []);

  const handleDigit = useCallback(async (d: string) => {
    if (tooManyAttempts || checking) return;
    if (d === '') return;
    flashKey(d);
    if (d === '⌫') { setPin(p => p.slice(0, -1)); setError(false); return; }

    const next = pin + d;
    setPin(next);

    if (next.length >= PIN_LENGTH) {
      setChecking(true);
      const ok = await unlockWithPin(next);
      setChecking(false);
      if (!ok) {
        setError(true);
        setTimeout(() => { setPin(''); setError(false); }, 600);
      }
    }
  }, [pin, checking, tooManyAttempts, unlockWithPin, flashKey]);

  // Keyboard support (web / physical keyboard on device)
  useEffect(() => {
    if (!isLocked || activeType !== 'pin') return;
    const handler = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) handleDigit(e.key);
      if (e.key === 'Backspace') handleDigit('⌫');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isLocked, activeType, handleDigit]);

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
  };

  const handleGoToSignIn = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    navigate('/auth', { replace: true });
  };

  if (!ready || !isLocked) return null;

  return (
    <div className="fixed inset-0 z-9999 bg-background flex flex-col items-center justify-center gap-8 px-8" style={{ paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' }}>
      {/* Branding */}
      <div className="text-center space-y-1">
        <p className="font-display font-bold text-xl tracking-tight">Forgenta</p>
        <p className="text-xs text-muted-foreground">Verify it's you to continue</p>
      </div>

      {activeType === 'pin' ? (
        <>
          {tooManyAttempts ? (
            /* Too many failed attempts */
            <div className="flex flex-col items-center gap-4 text-center max-w-xs">
              <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle size={24} className="text-destructive" />
              </div>
              <p className="text-sm font-medium">Too many failed attempts</p>
              <p className="text-xs text-muted-foreground">
                Sign out and sign back in with your email and password to regain access.
              </p>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="w-full py-2.5 text-xs font-medium bg-destructive text-destructive-foreground btn-press disabled:opacity-50"
                style={{ borderRadius: 'var(--radius)' }}
              >
                {signingOut ? 'Signing out…' : 'Sign out and reset'}
              </button>
            </div>
          ) : (
            <>
              {/* PIN dots */}
              <div className="flex gap-3">
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

              {failedAttempts > 0 && (
                <p className="text-xs text-destructive -mt-4">
                  Incorrect PIN — {MAX_FAILED_ATTEMPTS - failedAttempts} attempt{MAX_FAILED_ATTEMPTS - failedAttempts !== 1 ? 's' : ''} remaining
                </p>
              )}

              {/* Numpad */}
              <div className={`grid grid-cols-3 gap-3 w-64 transition-transform duration-150 ${error ? 'animate-[shake_0.3s_ease]' : ''}`}>
                {DIGITS.map((d, i) => {
                  const isPressed = d !== '' && pressedKey === d;
                  return (
                    <button
                      key={i}
                      disabled={checking || d === ''}
                      onClick={() => handleDigit(d)}
                      data-pressed={isPressed ? 'true' : undefined}
                      className={`h-16 flex items-center justify-center text-xl font-medium transition-all duration-75 btn-press disabled:opacity-30 ${
                        d === '' ? 'invisible' :
                        d === '⌫' ? 'text-muted-foreground hover:text-foreground' :
                        'bg-secondary border border-border hover:border-primary/40 hover:text-primary'
                      } ${
                        isPressed
                          ? (d === '⌫'
                              ? 'text-primary scale-95'
                              : 'bg-primary/20 border-primary text-primary scale-95')
                          : ''
                      }`}
                      style={{ borderRadius: 'var(--radius)' }}
                    >
                      {d === '⌫' ? <Delete size={18} /> : d}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </>
      ) : (
        /* Biometric prompt */
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={triggerBio}
            className="w-20 h-20 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center hover:bg-primary/20 transition-colors btn-press"
          >
            <Fingerprint size={32} className="text-primary" />
          </button>
          <p className="text-xs text-muted-foreground">Tap to use Face ID / Touch ID</p>
        </div>
      )}

      {/* Fallback links */}
      <div className="flex flex-col items-center gap-2">
        {lockType === 'biometric' && !showPinFallback && (
          <button
            onClick={() => setShowPinFallback(true)}
            className="text-[11px] text-muted-foreground hover:text-foreground underline"
          >
            Use PIN instead
          </button>
        )}
        {showPinFallback && lockType === 'biometric' && (
          <button
            onClick={() => { setShowPinFallback(false); setPin(''); setError(false); }}
            className="text-[11px] text-muted-foreground hover:text-foreground underline"
          >
            Use Face ID instead
          </button>
        )}
      </div>

      {/* Footer: sign-in escape, legal links, copyright */}
      <div
        className="absolute left-0 right-0 flex flex-col items-center gap-2"
        style={{ bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))' }}
      >
        <button
          onClick={handleGoToSignIn}
          disabled={signingOut}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          {signingOut ? 'Signing out…' : 'Sign in with a different account'}
        </button>
        <div className="flex items-center justify-center gap-2">
          <Link
            to="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 text-xs text-muted-foreground border border-border hover:text-foreground hover:bg-secondary/40 transition-colors"
            style={{ borderRadius: 'var(--radius)' }}
          >
            Privacy Policy
          </Link>
          <Link
            to="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 text-xs text-muted-foreground border border-border hover:text-foreground hover:bg-secondary/40 transition-colors"
            style={{ borderRadius: 'var(--radius)' }}
          >
            Terms of Service
          </Link>
        </div>
        <p className="text-[10px] text-muted-foreground text-center">
          &copy; {new Date().getFullYear()} Forgenta&#8482; by TRE Forged LLC. All rights reserved.
        </p>
      </div>
    </div>
  );
}
