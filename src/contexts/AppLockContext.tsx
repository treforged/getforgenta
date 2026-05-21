import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import { debugLog } from '@/lib/debugLog';

export type LockType = 'pin' | 'biometric';

const P = {
  enabled:       'forged:lock_enabled',
  type:          'forged:lock_type',
  pinHash:       'forged:lock_pin_hash',
  setupPrompted: 'forged:lock_setup_prompted',
} as const;

const LS_UNLOCKED_AT = 'forged:lock_unlocked_at';
const LS_FAILED      = 'forged:lock_failed';

const INIT_GRACE_MS = 3_000;
const INACTIVITY_LOGOUT_MS = 10 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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
    } catch { /* fall through */ }
  }
  localStorage.setItem(key, value);
}

async function pDel(key: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key });
      return;
    } catch { /* fall through */ }
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

  const isLockedRef            = useRef(false);
  const lockEnabledRef         = useRef(false);
  const skipLockClearOnSignIn  = useRef(false);
  const inactivityTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { isLockedRef.current    = isLocked;    }, [isLocked]);
  useEffect(() => { lockEnabledRef.current = lockEnabled; }, [lockEnabled]);

  // Lock on app kill + reopen: runs on every fresh JS load (process start).
  // Background → foreground does not re-run this effect.
  useEffect(() => {
    if (!isNative) { setReady(true); return; }

    async function init() {
      debugLog('INIT_START');
      skipLockClearOnSignIn.current = true;

      // AppDelegate sets this flag before reloading the WebView to fix backing
      // store reclamation on a normal background/foreground cycle. We skip the
      // full lock check so the user isn't prompted on every app switch.
      const bgReload = await pGet('forged:bg_reload');
      await pDel('forged:bg_reload'); // always clear regardless of value
      if (bgReload === '1') {
        debugLog('INIT_BGRELOAD');
        const { data: { session } } = await supabase.auth.getSession();
        // Keep skipLockClearOnSignIn=true only if there's an active session so
        // that the SIGNED_IN session-restore event is absorbed. If no session,
        // allow a fresh sign-in to proceed normally through the handler.
        if (!session) skipLockClearOnSignIn.current = false;
        const fails = parseInt(localStorage.getItem(LS_FAILED) ?? '0', 10);
        setFailedAttempts(fails);
        try {
          const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
          const info = await BiometricAuth.checkBiometry();
          setBiometricAvailable(info.isAvailable);
        } catch { setBiometricAvailable(false); }
        setReady(true);
        debugLog('INIT_DONE');
        return;
      }

      const [enabled, type] = await Promise.all([pGet(P.enabled), pGet(P.type)]);

      const lockIsEnabled = enabled === '1';
      setLockEnabled(lockIsEnabled);
      setLockTypeState((type ?? 'pin') as LockType);
      debugLog(`INIT_LOCK:${lockIsEnabled ? 1 : 0}`);

      if (!lockIsEnabled) {
        skipLockClearOnSignIn.current = false;
        // Check for existing session so the inactivity timer starts on app reopen,
        // not just on fresh sign-in (SIGNED_IN fires with skip=true on session restore).
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        if (existingSession) {
          if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
          inactivityTimerRef.current = setTimeout(async () => {
            debugLog('INACTIVITY_LOGOUT');
            await supabase.auth.signOut();
          }, INACTIVITY_LOGOUT_MS);
        }
      } else {
        const ts = localStorage.getItem(LS_UNLOCKED_AT);
        const withinGrace = !!ts && (Date.now() - parseInt(ts)) < INIT_GRACE_MS;
        debugLog(`INIT_GRACE:${withinGrace ? 'yes' : 'no'}`);
        if (!withinGrace) {
          const { data: { session } } = await supabase.auth.getSession();
          debugLog(`INIT_SESSION:${session ? 'yes' : 'no'}`);
          if (!session) skipLockClearOnSignIn.current = false;
          setIsLocked(!!session);
          debugLog(`INIT_LOCKED:${!!session}`);
        } else {
          skipLockClearOnSignIn.current = false;
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
      debugLog('INIT_DONE');
    }

    init();
  }, [isNative]);

  // Auth state: unlock on fresh sign-in, wipe lock data on sign-out
  useEffect(() => {
    if (!isNative) return;

    let setupTimer: ReturnType<typeof setTimeout>;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_IN') {
        debugLog(`AUTH_SIGNED_IN skip=${skipLockClearOnSignIn.current} locked=${isLockedRef.current}`);
        if (skipLockClearOnSignIn.current) {
          skipLockClearOnSignIn.current = false;
          return;
        }
        if (isLockedRef.current) return;
        setIsLocked(false);
        localStorage.setItem(LS_UNLOCKED_AT, String(Date.now()));
        const prompted = await pGet(P.setupPrompted);
        if (!prompted && !lockEnabledRef.current) {
          setupTimer = setTimeout(() => setShowSetupModal(true), 800);
        }
        // Start inactivity logout timer for users who haven't set up a lock.
        if (!lockEnabledRef.current) {
          if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
          inactivityTimerRef.current = setTimeout(async () => {
            debugLog('INACTIVITY_LOGOUT');
            await supabase.auth.signOut();
          }, INACTIVITY_LOGOUT_MS);
        }
      } else if (event === 'SIGNED_OUT') {
        debugLog('AUTH_SIGNED_OUT');
        skipLockClearOnSignIn.current = false;
        if (inactivityTimerRef.current) {
          clearTimeout(inactivityTimerRef.current);
          inactivityTimerRef.current = null;
        }
        // Preserve lock credentials (PIN hash, type, enabled) so the user does
        // not lose their lock configuration after a session expiry or sign-out.
        // Only clear the prompted flag so the setup modal can re-evaluate.
        await pDel(P.setupPrompted);
        localStorage.removeItem(LS_UNLOCKED_AT);
        localStorage.removeItem(LS_FAILED);
        setIsLocked(false);
        setFailedAttempts(0);
        setShowSetupModal(false);
        clearTimeout(setupTimer);
      }
    });

    return () => { subscription.unsubscribe(); clearTimeout(setupTimer); };
  }, [isNative]);

  // Reset the inactivity timer on any touch (only when timer is running).
  useEffect(() => {
    if (!isNative) return;
    const handler = () => {
      if (inactivityTimerRef.current === null) return;
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = setTimeout(async () => {
        debugLog('INACTIVITY_LOGOUT');
        await supabase.auth.signOut();
      }, INACTIVITY_LOGOUT_MS);
    };
    document.addEventListener('touchstart', handler, { passive: true });
    return () => document.removeEventListener('touchstart', handler);
  }, [isNative]);

  // Cancel the inactivity timer the moment the user sets up a lock.
  useEffect(() => {
    if (lockEnabled && inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, [lockEnabled]);

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

  const setupPin = useCallback(async (pin: string): Promise<void> => {
    const hash = await sha256(pin);
    await Promise.all([pSet(P.pinHash, hash), pSet(P.type, 'pin'), pSet(P.enabled, '1')]);
    setLockEnabled(true);
    setLockTypeState('pin');
    markUnlocked();
  }, [markUnlocked]);

  const setupBiometricWithPin = useCallback(async (pin: string): Promise<boolean> => {
    if (!biometricAvailable) return false;
    try {
      const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
      await BiometricAuth.authenticate({ reason: 'Confirm your identity to enable Face ID lock' });
    } catch {
      return false;
    }
    const hash = await sha256(pin);
    await Promise.all([pSet(P.pinHash, hash), pSet(P.type, 'biometric'), pSet(P.enabled, '1')]);
    setLockEnabled(true);
    setLockTypeState('biometric');
    markUnlocked();
    return true;
  }, [biometricAvailable, markUnlocked]);

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
    await Promise.all([pDel(P.enabled), pDel(P.type), pDel(P.pinHash)]);
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
