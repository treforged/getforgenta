import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { supabase } from '@/lib/supabase';
import { debugLog } from '@/lib/debugLog';

export type LockType = 'pin' | 'biometric';

const P = {
  enabled:       'forged:lock_enabled',
  type:          'forged:lock_type',
  pinHash:       'forged:lock_pin_hash',
  setupPrompted: 'forged:lock_setup_prompted',
  /** '1' once a PIN user has been offered biometric unlock (ask 2e42290d), whichever answer. */
  bioOffered:    'forged:lock_bio_offered',
} as const;

const LS_UNLOCKED_AT = 'forged:lock_unlocked_at';
const LS_FAILED      = 'forged:lock_failed';
/**
 * '1' from the moment the lock screen goes up until it is cleared (ask e34975a1, 2026-09-29).
 * A `bg_reload` skips the fresh-launch lock check, and AppDelegate also reloads with that flag when
 * the native cover's deadline fires - which can happen on a COLD launch while the user is still
 * looking at the lock. Without this marker that reload came up UNLOCKED: Tre, build 1112, "it just
 * loads straight into the app without it sometime".
 */
export const LOCK_PENDING = 'forged:lock_pending';

const INIT_GRACE_MS = 3_000;
/**
 * A return within this long after the app went to the background reopens WITHOUT a prompt; a later
 * return keeps the lock (ask e34975a1). Short app switches stay frictionless, the common
 * "Require Face ID after 1 minute" setting in banking apps.
 */
export const RESUME_GRACE_MS = 60_000;
export const MAX_FAILED_ATTEMPTS = 5;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ONE shared import. Init reads several keys in parallel, and each read used to start its own
// dynamic import; sharing the promise costs nothing on a device and gives every read the same module.
let preferencesPromise: Promise<typeof import('@capacitor/preferences')> | null = null;
const preferencesModule = () => (preferencesPromise ??= import('@capacitor/preferences'));

async function pGet(key: string): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Preferences } = await preferencesModule();
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
      const { Preferences } = await preferencesModule();
      await Preferences.set({ key, value });
      return;
    } catch { /* fall through */ }
  }
  localStorage.setItem(key, value);
}

async function pDel(key: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Preferences } = await preferencesModule();
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
  /** One-time offer of Face ID to a user who already unlocks with a PIN (ask 2e42290d). */
  showBiometricOffer: boolean;
  acceptBiometricOffer: () => Promise<boolean>;
  dismissBiometricOffer: () => Promise<void>;
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
  /**
   * Open the PIN setup sheet ON PURPOSE, from Settings.
   *
   * ⚠️ WHY THIS EXISTS. Until now the ONLY route to enabling the lock was the
   * automatic prompt in the SIGNED_IN effect, and it is a one-shot: dismissing it
   * writes `setupPrompted`, which is cleared only by signing out. So a user who
   * dismissed the sheet once could never turn a PIN on again. Worse, the prompt
   * fires on `SIGNED_IN` and NOT on `INITIAL_SESSION` — the event a returning user
   * actually gets — so somebody who simply stays signed in may never have been
   * offered it at all. Deliberately does NOT consult `setupPrompted`: the whole
   * point is to reach the sheet after that flag is set.
   */
  openSetupModal: () => void;
  lockNow: () => void;
}

/**
 * `getSession` can refresh an expired token over the network, and the lock's cover (AppLockScreen)
 * stays up until init finishes. So bound the wait, and on timeout answer "there is a session":
 * that FAILS CLOSED (the lock screen shows, and it offers PIN and sign-in), never open.
 */
export const LOCK_SESSION_TIMEOUT_MS = 4_000;
export async function hasSessionForLock(
  getSession: () => Promise<{ data: { session: unknown } }>,
  timeoutMs = LOCK_SESSION_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), timeoutMs); });
  const read = getSession().then(r => !!r.data.session, () => true);
  try {
    return await Promise.race([read, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const AppLockContext = createContext<AppLockContextType>({
  ready: false,
  isLocked: false,
  lockEnabled: false,
  lockType: 'pin',
  biometricAvailable: false,
  showSetupModal: false,
  showBiometricOffer: false,
  acceptBiometricOffer: async () => false,
  dismissBiometricOffer: async () => {},
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
  openSetupModal: () => {},
  lockNow: () => {},
});

export const useAppLock = () => useContext(AppLockContext);

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const isNative = Capacitor.isNativePlatform();

  // Web is ready immediately — there is no lock to restore, and `isNative` is
  // fixed for the lifetime of the process. Seeding it here rather than calling
  // setReady(true) from the init effect saves the web path a wasted render.
  const [ready, setReady] = useState(!isNative);
  const [isLocked, setIsLocked] = useState(false);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [lockType, setLockTypeState] = useState<LockType>('pin');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showBiometricOffer, setShowBiometricOffer] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);

  const isLockedRef            = useRef(false);
  const lockEnabledRef         = useRef(false);
  const skipLockClearOnSignIn  = useRef(false);

  useEffect(() => { isLockedRef.current    = isLocked;    }, [isLocked]);
  useEffect(() => { lockEnabledRef.current = lockEnabled; }, [lockEnabled]);

  // Lock on app kill + reopen: runs on every fresh JS load (process start).
  // Background → foreground does not re-run this effect.
  useEffect(() => {
    if (!isNative) return; // `ready` already seeded true for web

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
        const session = await hasSessionForLock(() => supabase.auth.getSession());
        // Keep skipLockClearOnSignIn=true only if there's an active session so
        // that the SIGNED_IN session-restore event is absorbed. If no session,
        // allow a fresh sign-in to proceed normally through the handler.
        if (!session) skipLockClearOnSignIn.current = false;
        // The reload skips the fresh-launch check, NOT the lock itself: restore the settings
        // (this path used to leave lockEnabled false, so Settings and lockNow saw no lock), and
        // stay locked when the reload interrupted a lock that had not been cleared yet.
        const [bgEnabled, bgType, pending] = await Promise.all([pGet(P.enabled), pGet(P.type), pGet(LOCK_PENDING)]);
        const bgLockOn = bgEnabled === '1';
        setLockEnabled(bgLockOn);
        setLockTypeState((bgType ?? 'pin') as LockType);
        if (bgLockOn && pending === '1' && session) {
          setIsLocked(true);
          debugLog('INIT_BGRELOAD_STILL_LOCKED');
        } else if (pending === '1') {
          await pDel(LOCK_PENDING);
        }
        const fails = parseInt((await pGet(LS_FAILED)) ?? '0', 10);
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
      } else {
        const ts = localStorage.getItem(LS_UNLOCKED_AT);
        const withinGrace = !!ts && (Date.now() - parseInt(ts)) < INIT_GRACE_MS;
        debugLog(`INIT_GRACE:${withinGrace ? 'yes' : 'no'}`);
        if (!withinGrace) {
          const session = await hasSessionForLock(() => supabase.auth.getSession());
          debugLog(`INIT_SESSION:${session ? 'yes' : 'no'}`);
          if (!session) skipLockClearOnSignIn.current = false;
          if (session) await pSet(LOCK_PENDING, '1');
          setIsLocked(!!session);
          debugLog(`INIT_LOCKED:${!!session}`);
        } else {
          skipLockClearOnSignIn.current = false;
        }
      }

      const fails = parseInt((await pGet(LS_FAILED)) ?? '0', 10);
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
          setupTimer = setTimeout(() => setShowSetupModal(true), 3000);
        }
      } else if (event === 'SIGNED_OUT') {
        debugLog('AUTH_SIGNED_OUT');
        skipLockClearOnSignIn.current = false;
        await Promise.all([pDel(P.enabled), pDel(P.type), pDel(P.pinHash), pDel(P.setupPrompted), pDel(LOCK_PENDING), pDel(P.bioOffered)]);
        localStorage.removeItem(LS_UNLOCKED_AT);
        await pDel(LS_FAILED);
        setLockEnabled(false);
        setLockTypeState('pin');
        setIsLocked(false);
        setFailedAttempts(0);
        setShowSetupModal(false);
        setShowBiometricOffer(false);
        clearTimeout(setupTimer);
      }
    });

    return () => { subscription.unsubscribe(); clearTimeout(setupTimer); };
  }, [isNative]);

  const markUnlocked = useCallback(async () => {
    localStorage.setItem(LS_UNLOCKED_AT, String(Date.now()));
    await pDel(LOCK_PENDING);
    await pSet(LS_FAILED, '0');
    setFailedAttempts(0);
  }, []);

  const unlockWithPin = useCallback(async (pin: string): Promise<boolean> => {
    const stored = await pGet(P.pinHash);
    if (!stored) return false;
    const hash = await sha256(pin);
    if (hash !== stored) {
      const next = failedAttempts + 1;
      await pSet(LS_FAILED, String(next));
      setFailedAttempts(next);
      return false;
    }
    await markUnlocked();
    setIsLocked(false);
    // Tre, build 1112: "people who have pin enabled already need to be prompted for face id."
    // Right after a PIN unlock the person is present and has just used the lock: offer it once.
    if (lockType === 'pin' && biometricAvailable && (await pGet(P.bioOffered)) !== '1') {
      setShowBiometricOffer(true);
    }
    return true;
  }, [failedAttempts, markUnlocked, lockType, biometricAvailable]);

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    if (!isNative) return false;
    try {
      const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
      await BiometricAuth.authenticate({ reason: 'Unlock Forgenta' });
      await markUnlocked();
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
    await markUnlocked();
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
    await markUnlocked();
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
    await markUnlocked();
  }, [markUnlocked]);

  const disableLock = useCallback(async (): Promise<void> => {
    await Promise.all([pDel(P.enabled), pDel(P.type), pDel(P.pinHash), pDel(LS_FAILED), pDel(LOCK_PENDING), pDel(P.bioOffered)]);
    localStorage.removeItem(LS_UNLOCKED_AT);
    setLockEnabled(false);
    setIsLocked(false);
    setFailedAttempts(0);
  }, []);

  // Either answer records the offer, so it is asked exactly once. A failed Face ID confirmation
  // also records it: the user tried, and Settings remains the way to try again.
  const acceptBiometricOffer = useCallback(async (): Promise<boolean> => {
    const ok = await enableBiometric();
    await pSet(P.bioOffered, '1');
    setShowBiometricOffer(false);
    return ok;
  }, [enableBiometric]);

  const dismissBiometricOffer = useCallback(async (): Promise<void> => {
    await pSet(P.bioOffered, '1');
    setShowBiometricOffer(false);
  }, []);

  const dismissSetupModal = useCallback(() => {
    setShowSetupModal(false);
    pSet(P.setupPrompted, '1');
  }, []);

  const openSetupModal = useCallback(() => {
    setShowSetupModal(true);
  }, []);

  const lockNow = useCallback(() => {
    if (!lockEnabled) return;
    void pSet(LOCK_PENDING, '1');
    setIsLocked(true);
  }, [lockEnabled]);

  // ⚠️ LOCK ON THE WAY OUT, NOT ON THE WAY BACK (ask e34975a1, Tre build 1112: "it just loads
  // straight into the app without it sometime"). The init above runs only on a PROCESS START, so a
  // warm reopen - the app still in memory, even hours later - went straight to the user's money with
  // no lock at all. That was the "sometime": killed overnight it locked, kept warm it did not.
  // Locking on `pause` means the lock screen is already rendered behind the native cover before the
  // app is ever shown again; locking on `resume` would race the cover coming off. A return inside
  // RESUME_GRACE_MS lifts that provisional lock with no prompt.
  useEffect(() => {
    if (!isNative) return;
    let provisionalSince: number | null = null;
    let unsubscribed = false;
    const handles: { remove: () => void }[] = [];
    // Two calls rather than one helper over a union: addListener's overloads are per event name.
    const keep = (event: string, p: Promise<{ remove: () => void }>) => {
      p.then((h) => { if (unsubscribed) h.remove(); else handles.push(h); })
        .catch((err) => { console.error(`App lock: subscribing to ${event} failed:`, err); });
    };
    keep('pause', CapApp.addListener('pause', () => {
      if (!lockEnabledRef.current || isLockedRef.current) return;
      provisionalSince = Date.now();
      isLockedRef.current = true;
      setIsLocked(true);
      void pSet(LOCK_PENDING, '1');
      debugLog('LOCK_ON_PAUSE');
    }));
    keep('resume', CapApp.addListener('resume', () => {
      if (provisionalSince === null) return;
      const away = Date.now() - provisionalSince;
      provisionalSince = null;
      if (away < RESUME_GRACE_MS) {
        isLockedRef.current = false;
        setIsLocked(false);
        void pDel(LOCK_PENDING);
        debugLog(`LOCK_RESUME_GRACE away=${away}`);
      } else {
        debugLog(`LOCK_RESUME_KEPT away=${away}`);
      }
    }));
    return () => { unsubscribed = true; handles.forEach(h => h.remove()); };
  }, [isNative]);

  return (
    <AppLockContext.Provider value={{
      ready,
      isLocked,
      lockEnabled,
      lockType,
      biometricAvailable,
      showSetupModal,
      showBiometricOffer,
      acceptBiometricOffer,
      dismissBiometricOffer,
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
      openSetupModal,
      lockNow,
    }}>
      {children}
    </AppLockContext.Provider>
  );
}
