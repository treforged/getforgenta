import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { supabase } from '@/lib/supabase';

export type LockType = 'pin' | 'biometric';

const P = {
  enabled:       'forged:lock_enabled',
  type:          'forged:lock_type',
  pinHash:       'forged:lock_pin_hash',
  setupPrompted: 'forged:lock_setup_prompted',
} as const;

// Non-sensitive keys kept in localStorage for synchronous reads
const LS_UNLOCKED_AT = 'forged:lock_unlocked_at';
const LS_FAILED      = 'forged:lock_failed';

const INIT_GRACE_MS      = 3_000;           // prevents locking on React re-mounts right after unlock
const BG_LOCK_AFTER_MS   = 30_000;          // lock after 30s in background (not on brief switches)
const INACTIVITY_LOCK_MS = 5 * 60 * 1_000; // lock after 5 min of no user interaction
export const MAX_FAILED_ATTEMPTS = 5;

// Synchronous DOM cover — shown/hidden directly so iOS captures it in the app snapshot
// before React's setState batch can update the VDOM. Module-level so it persists across renders.
let _coverEl: HTMLDivElement | null = null;

function showCoverDOM() {
  if (!_coverEl) {
    _coverEl = document.createElement('div');
    _coverEl.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background-color:hsl(240,10%,3.9%)', // zinc-950 — matches dark bg-background
    ].join(';');
    const img = document.createElement('img');
    img.src = '/logo.png';
    img.style.cssText = 'width:80px;height:80px;object-fit:contain;';
    _coverEl.appendChild(img);
    document.body.appendChild(_coverEl);
  } else {
    _coverEl.style.display = 'flex';
  }
}

function hideCoverDOM() {
  if (_coverEl) _coverEl.style.display = 'none';
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Storage helpers: Preferences on native (iOS Keychain / Android EncryptedSharedPrefs),
// localStorage on web. Dynamic import so missing package doesn't break web dev server.
async function pGet(key: string): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key });
      return value;
    } catch {
      return localStorage.getItem(key);
    }
  }
  return localStorage.getItem(key);
}

async function pSet(key: string, value: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key, value });
      return;
    } catch { /* fall through to localStorage */ }
  }
  localStorage.setItem(key, value);
}

async function pDel(key: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key });
      return;
    } catch { /* fall through to localStorage */ }
  }
  localStorage.removeItem(key);
}

interface AppLockContextType {
  ready: boolean;
  isLocked: boolean;
  isCovering: boolean;
  lockEnabled: boolean;
  lockType: LockType;
  biometricAvailable: boolean;
  showSetupModal: boolean;
  failedAttempts: number;
  unlockWithPin: (pin: string) => Promise<boolean>;
  unlockWithBiometric: () => Promise<boolean>;
  setupPin: (pin: string) => Promise<void>;
  setupBiometricWithPin: (pin: string) => Promise<boolean>;
  changePin: (newPin: string) => Promise<void>;
  enableBiometric: () => Promise<boolean>;
  disableBiometric: () => Promise<void>;
  disableLock: () => Promise<void>;
  dismissSetupModal: () => void;
  lockNow: () => void;
}

const AppLockContext = createContext<AppLockContextType>({
  ready: false,
  isLocked: false,
  isCovering: false,
  lockEnabled: false,
  lockType: 'pin',
  biometricAvailable: false,
  showSetupModal: false,
  failedAttempts: 0,
  unlockWithPin: async () => false,
  unlockWithBiometric: async () => false,
  setupPin: async () => {},
  setupBiometricWithPin: async () => false,
  changePin: async () => {},
  enableBiometric: async () => false,
  disableBiometric: async () => {},
  disableLock: async () => {},
  dismissSetupModal: () => {},
  lockNow: () => {},
});

export const useAppLock = () => useContext(AppLockContext);

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const isNative = Capacitor.isNativePlatform();

  const [ready, setReady] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [isCovering, setIsCovering] = useState(false);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [lockType, setLockTypeState] = useState<LockType>('pin');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);

  const bgAt              = useRef<number | null>(null);
  const lastActivityAt    = useRef<number>(Date.now());
  const isLockedRef       = useRef(false);
  const lockEnabledRef    = useRef(false);
  const skipNextBgLock    = useRef(false);
  const coverTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { isLockedRef.current    = isLocked;     }, [isLocked]);
  useEffect(() => { lockEnabledRef.current = lockEnabled;  }, [lockEnabled]);

  // Initialize from persistent storage on mount
  useEffect(() => {
    if (!isNative) { setReady(true); return; }

    async function init() {
      const [enabled, type] = await Promise.all([
        pGet(P.enabled),
        pGet(P.type),
      ]);

      const lockIsEnabled = enabled === '1';
      const lockTypeVal = (type ?? 'pin') as LockType;
      setLockEnabled(lockIsEnabled);
      setLockTypeState(lockTypeVal);

      if (lockIsEnabled) {
        const ts = localStorage.getItem(LS_UNLOCKED_AT);
        // Short grace window prevents locking on component re-mounts during sign-in flow
        const withinGrace = !!ts && (Date.now() - parseInt(ts)) < INIT_GRACE_MS;
        if (!withinGrace) {
          // Only lock if the user has an active session — don't block the sign-in screen
          const { data: { session } } = await supabase.auth.getSession();
          setIsLocked(!!session);
        }
      }

      const fails = parseInt(localStorage.getItem(LS_FAILED) ?? '0', 10);
      setFailedAttempts(fails);

      try {
        const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
        const info = await BiometricAuth.checkBiometry();
        setBiometricAvailable(info.isAvailable);
      } catch {
        setBiometricAvailable(false);
      }

      setReady(true);
    }

    init();
  }, [isNative]);

  // Background → foreground: lock after threshold
  useEffect(() => {
    if (!isNative || !ready) return;

    let listenerHandle: { remove: () => void } | null = null;

    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        bgAt.current = Date.now();
        showCoverDOM(); // synchronous — DOM updated before iOS takes the app snapshot
        setIsCovering(true);
        return;
      }
      // App came to foreground
      const backgroundedAt = bgAt.current;
      bgAt.current = null;
      lastActivityAt.current = Date.now(); // reset inactivity on resume
      if (backgroundedAt === null) { hideCoverDOM(); setIsCovering(false); return; }

      const duration = Date.now() - backgroundedAt;
      if (duration < BG_LOCK_AFTER_MS) {
        // Brief switch — hold cover until WebView repaints, then dismiss both layers
        if (coverTimerRef.current) clearTimeout(coverTimerRef.current);
        coverTimerRef.current = setTimeout(() => { hideCoverDOM(); setIsCovering(false); }, 800);
        return;
      }

      if (skipNextBgLock.current) { skipNextBgLock.current = false; hideCoverDOM(); setIsCovering(false); return; }
      if (!lockEnabledRef.current || isLockedRef.current) { hideCoverDOM(); setIsCovering(false); return; }
      // Lock needed — keep DOM cover up until React lock screen has painted, then remove
      setIsLocked(true);
      requestAnimationFrame(() => requestAnimationFrame(() => { hideCoverDOM(); setIsCovering(false); }));
    }).then(h => {
      listenerHandle = h;
    });

    return () => { listenerHandle?.remove(); };
  }, [isNative, ready]);

  // Auth state: unlock on fresh sign-in, clear on sign-out, show setup modal once
  useEffect(() => {
    if (!isNative) return;

    let setupTimer: ReturnType<typeof setTimeout>;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_IN') {
        bgAt.current = null;           // cancel any background re-lock from OAuth browser return
        skipNextBgLock.current = true; // suppress next background lock check
        setTimeout(() => { skipNextBgLock.current = false; }, 2000);
        // Fresh Supabase auth clears the local lock
        setIsLocked(false);
        lastActivityAt.current = Date.now();
        localStorage.setItem(LS_UNLOCKED_AT, String(Date.now()));
        // Delay so the modal appears after navigation to dashboard, not on auth page
        const prompted = await pGet(P.setupPrompted);
        if (!prompted) {
          setupTimer = setTimeout(() => setShowSetupModal(true), 800);
        }
      } else if (event === 'SIGNED_OUT') {
        setIsLocked(false);
        setShowSetupModal(false);
        clearTimeout(setupTimer);
      }
    });

    return () => { subscription.unsubscribe(); clearTimeout(setupTimer); };
  }, [isNative]);

  // Inactivity lock — reset on any user touch/click; check every 30 s
  useEffect(() => {
    if (!isNative || !lockEnabled) return;

    const resetActivity = () => { lastActivityAt.current = Date.now(); };
    const events = ['touchstart', 'touchmove', 'click'] as const;
    events.forEach(e => window.addEventListener(e, resetActivity, { passive: true }));

    const interval = setInterval(async () => {
      if (isLockedRef.current) return;
      const idle = Date.now() - lastActivityAt.current;
      if (idle < INACTIVITY_LOCK_MS) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (session) setIsLocked(true);
    }, 30_000);

    return () => {
      events.forEach(e => window.removeEventListener(e, resetActivity));
      clearInterval(interval);
    };
  }, [isNative, lockEnabled]);

  const markUnlocked = useCallback(() => {
    const now = Date.now();
    localStorage.setItem(LS_UNLOCKED_AT, String(now));
    localStorage.setItem(LS_FAILED, '0');
    lastActivityAt.current = now;
    setFailedAttempts(0);
  }, []);

  const unlockWithPin = useCallback(async (pin: string): Promise<boolean> => {
    const stored = await pGet(P.pinHash);
    if (!stored) return false;
    const hash = await sha256(pin);
    if (hash !== stored) {
      const next = failedAttempts + 1;
      localStorage.setItem(LS_FAILED, String(next));
      setFailedAttempts(next);
      return false;
    }
    markUnlocked();
    setIsLocked(false);
    return true;
  }, [failedAttempts, markUnlocked]);

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    if (!isNative) return false;
    try {
      const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
      await BiometricAuth.authenticate({ reason: 'Unlock Forgenta' });
      markUnlocked();
      setIsLocked(false);
      return true;
    } catch {
      return false;
    }
  }, [isNative, markUnlocked]);

  // PIN-only setup
  const setupPin = useCallback(async (pin: string): Promise<void> => {
    const hash = await sha256(pin);
    await Promise.all([
      pSet(P.pinHash, hash),
      pSet(P.type, 'pin'),
      pSet(P.enabled, '1'),
    ]);
    setLockEnabled(true);
    setLockTypeState('pin');
    markUnlocked();
  }, [markUnlocked]);

  // Biometric setup: verify bio first, then store PIN as mandatory fallback
  const setupBiometricWithPin = useCallback(async (pin: string): Promise<boolean> => {
    if (!biometricAvailable) return false;
    try {
      const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
      await BiometricAuth.authenticate({ reason: 'Confirm your identity to enable Face ID lock' });
    } catch {
      return false;
    }
    const hash = await sha256(pin);
    await Promise.all([
      pSet(P.pinHash, hash),
      pSet(P.type, 'biometric'),
      pSet(P.enabled, '1'),
    ]);
    setLockEnabled(true);
    setLockTypeState('biometric');
    markUnlocked();
    return true;
  }, [biometricAvailable, markUnlocked]);

  // Enable biometric for an existing PIN-locked account (requires PIN already set as fallback)
  const enableBiometric = useCallback(async (): Promise<boolean> => {
    if (!biometricAvailable) return false;
    try {
      const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
      await BiometricAuth.authenticate({ reason: 'Enable Face ID for Forgenta' });
    } catch {
      return false;
    }
    await pSet(P.type, 'biometric');
    setLockTypeState('biometric');
    return true;
  }, [biometricAvailable]);

  // Downgrade biometric lock to PIN-only (PIN fallback already stored)
  const disableBiometric = useCallback(async (): Promise<void> => {
    await pSet(P.type, 'pin');
    setLockTypeState('pin');
  }, []);

  const changePin = useCallback(async (newPin: string): Promise<void> => {
    const hash = await sha256(newPin);
    await pSet(P.pinHash, hash);
    markUnlocked();
  }, [markUnlocked]);

  const disableLock = useCallback(async (): Promise<void> => {
    await Promise.all([
      pDel(P.enabled),
      pDel(P.type),
      pDel(P.pinHash),
    ]);
    localStorage.removeItem(LS_UNLOCKED_AT);
    localStorage.removeItem(LS_FAILED);
    setLockEnabled(false);
    setIsLocked(false);
    setFailedAttempts(0);
  }, []);

  const dismissSetupModal = useCallback(() => {
    setShowSetupModal(false);
    pSet(P.setupPrompted, '1');
  }, []);

  const lockNow = useCallback(() => {
    if (lockEnabled) setIsLocked(true);
  }, [lockEnabled]);

  return (
    <AppLockContext.Provider value={{
      ready,
      isLocked,
      isCovering,
      lockEnabled,
      lockType,
      biometricAvailable,
      showSetupModal,
      failedAttempts,
      unlockWithPin,
      unlockWithBiometric,
      setupPin,
      setupBiometricWithPin,
      changePin,
      enableBiometric,
      disableBiometric,
      disableLock,
      dismissSetupModal,
      lockNow,
    }}>
      {children}
    </AppLockContext.Provider>
  );
}
