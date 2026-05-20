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

const BG_LOCK_AFTER_MS = 30_000; // lock after 30 s in background
export const MAX_FAILED_ATTEMPTS = 5;

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
  const [lockEnabled, setLockEnabled] = useState(false);
  const [lockType, setLockTypeState] = useState<LockType>('pin');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);

  const bgAt = useRef<number | null>(null);

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
        const withinGrace = !!ts && (Date.now() - parseInt(ts)) < BG_LOCK_AFTER_MS;
        setIsLocked(!withinGrace);
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

    CapApp.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive) {
        bgAt.current = Date.now();
        return;
      }
      // App came to foreground
      const backgroundedAt = bgAt.current;
      bgAt.current = null;
      if (backgroundedAt === null) return;

      const duration = Date.now() - backgroundedAt;
      if (duration < BG_LOCK_AFTER_MS) return;

      const enabled = await pGet(P.enabled);
      if (enabled === '1') setIsLocked(true);
    }).then(h => {
      listenerHandle = h;
    });

    return () => { listenerHandle?.remove(); };
  }, [isNative, ready]);

  // Show setup modal on first sign-in (native only)
  useEffect(() => {
    if (!isNative) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      if (event !== 'SIGNED_IN') return;
      const prompted = await pGet(P.setupPrompted);
      if (!prompted) setShowSetupModal(true);
    });

    return () => subscription.unsubscribe();
  }, [isNative]);

  const markUnlocked = useCallback(() => {
    localStorage.setItem(LS_UNLOCKED_AT, String(Date.now()));
    localStorage.setItem(LS_FAILED, '0');
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
