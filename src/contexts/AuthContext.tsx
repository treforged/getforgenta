import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { resetActivityTabForSignIn } from '@/lib/activity-tab';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { initRevenueCat, logOutRevenueCat } from '@/lib/purchases';
import { identifyMonitoringUser } from '@/lib/monitoring';
import { maybeTrackOAuthSignUp } from '@/lib/analytics';
import { useDemo } from '@/contexts/DemoContext';
import { clearAllFormDrafts } from '@/hooks/useFormDraft';
import { isDeviceTrusted } from '@/lib/trusted-device';
import { toLocalDateStr } from '@/lib/scheduling';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;    // 10 minutes
const IDLE_WARNING_MS =  8 * 60 * 1000;    // warn at 8 minutes
// On a device the user has explicitly trusted (the same grant that skips 2FA, verified against
// `profiles.trusted_devices`), the leash is 12 hours instead of 10 minutes. The 10-minute default
// is a shared-computer defense; on the user's own machine it signed Tre out three times in one
// working day (2026-08-13). Untrusted devices are unchanged.
const TRUSTED_IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const TRUSTED_IDLE_WARNING_MS = TRUSTED_IDLE_TIMEOUT_MS - 2 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 30 * 1000;  // check every 30 seconds
const LAST_ACTIVITY_KEY = 'forged:last_activity';
const REVIEWER_EMAIL = 'reviewer@getforgenta.com';

type AuthContextType = {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { isDemo, setIsDemo } = useDemo();
  const initialized = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  // Use a ref for location to avoid stale closure issues in onAuthStateChange
  const locationRef = useRef(location.pathname);
  useEffect(() => { locationRef.current = location.pathname; }, [location.pathname]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setIsDemo(false);
  }, [setIsDemo]);

  const resetReviewerAccount = useCallback(async (userId: string) => {
    await supabase
      .from('profiles')
      .update({ founder_note_seen: false, onboarding_completed: false })
      .eq('user_id', userId);
    await supabase
      .from('financial_connections')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('user_id', userId);

    // ── Cash floor: unwind this month's CC payments until balance is restored ──
    const { data: profile } = await supabase
      .from('profiles')
      .select('cash_floor, default_deposit_account')
      .eq('user_id', userId)
      .single();
    const floor = profile?.cash_floor != null ? Number(profile.cash_floor) : 0;
    if (floor > 0) {
      let fundingId: string | null = profile?.default_deposit_account ?? null;
      if (!fundingId) {
        const { data: allAccounts } = await supabase
          .from('accounts')
          .select('id, account_type')
          .eq('user_id', userId)
          .eq('active', true)
          .order('created_at');
        fundingId = allAccounts?.find((a) => a.account_type === 'checking')?.id ?? null;
      }
      if (fundingId) {
        const { data: acct } = await supabase
          .from('accounts')
          .select('balance')
          .eq('id', fundingId)
          .eq('user_id', userId)
          .single();
        const balance = acct != null ? Number(acct.balance) : 0;
        if (balance < floor) {
          const now = new Date();
          const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const { data: debtTxns } = await supabase
            .from('transactions')
            .select('id, amount')
            .eq('user_id', userId)
            .eq('type', 'expense')
            .eq('category', 'Debt Payments')
            .like('date', `${monthStr}%`)
            .order('date', { ascending: false });
          // Delete newest debt payments one by one until balance clears the floor
          let running = balance;
          const toDelete: string[] = [];
          for (const txn of debtTxns ?? []) {
            if (running >= floor) break;
            running += Number(txn.amount);
            toDelete.push(txn.id);
          }
          if (toDelete.length > 0) {
            await Promise.all([
              supabase
                .from('transactions')
                .delete()
                .in('id', toDelete)
                .eq('user_id', userId),
              supabase
                .from('accounts')
                .update({ balance: running })
                .eq('id', fundingId)
                .eq('user_id', userId),
            ]);
          }
        }
      }
    }

    // ── Seed lump sum payments on car funds and savings goals ──────────────
    const now = new Date();
    const pastDate = (monthsBack: number) => {
      const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 15);
      return toLocalDateStr(d);
    };
    const [carRes, goalRes] = await Promise.all([
      supabase.from('car_funds').select('id').eq('user_id', userId),
      supabase.from('savings_goals').select('id').eq('user_id', userId),
    ]);
    const carLumpSets: { id: string; date: string; amount: number; label: string }[][] = [
      [
        { id: 'rv-car0-lump-1', date: pastDate(3), amount: 500,  label: 'Tax refund'     },
        { id: 'rv-car0-lump-2', date: pastDate(1), amount: 250,  label: 'Bonus allocation' },
      ],
      [
        { id: 'rv-car1-lump-1', date: pastDate(2), amount: 300,  label: 'Side income'    },
      ],
    ];
    const goalLumpSets: { id: string; date: string; amount: number }[][] = [
      [
        { id: 'rv-goal0-lump-1', date: pastDate(4), amount: 300 },
        { id: 'rv-goal0-lump-2', date: pastDate(2), amount: 200 },
      ],
      [
        { id: 'rv-goal1-lump-1', date: pastDate(3), amount: 150 },
      ],
    ];
    await Promise.all([
      ...(carRes.data ?? []).map((fund, i: number) =>
        supabase
          .from('car_funds')
          .update({ lump_sum_payments: carLumpSets[i] ?? carLumpSets[0] })
          .eq('id', fund.id)
          .eq('user_id', userId),
      ),
      ...(goalRes.data ?? []).map((goal, i: number) =>
        supabase
          .from('savings_goals')
          .update({ lump_sum_payments: goalLumpSets[i] ?? goalLumpSets[0] })
          .eq('id', goal.id)
          .eq('user_id', userId),
      ),
    ]);

    localStorage.removeItem(`forged:onboarding_done_${userId}`);
    localStorage.removeItem('forged:tour_done_new_user');
    localStorage.removeItem('forged:tour_done_premium');
    sessionStorage.removeItem('forged:founder_note_seen');
    sessionStorage.removeItem('forged:onboarding_wizard_dismissed');
    sessionStorage.removeItem('forged:onboarding_step');
    qc.removeQueries({ queryKey: ['profile'] });
    // The route gate caches its own read of onboarding_completed (useOnboardingStatus). Without
    // this the reviewer's freshly-reset account would still be waved past /onboarding on the cached
    // `true` from before the reset.
    qc.removeQueries({ queryKey: ['onboarding-completed'] });
  }, [qc]);

  // ── Auth state listener ──────────────────────────────────────────────────
  useEffect(() => {
    // Handle email confirmation token in URL hash
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = hashParams.get('access_token');
    const type = hashParams.get('type');
    if (type === 'signup' && accessToken) {
      toast.success('Email confirmed! Please sign in with your credentials.');
      window.history.replaceState({}, document.title, '/auth');
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
      initialized.current = true;

      // ⚠️ RevenueCat MUST be configured on a RESTORED session too, not only on a fresh
      // sign-in. Supabase fires INITIAL_SESSION when it rehydrates a session from storage,
      // which is what happens on almost every launch of the mobile app — a person who stays
      // signed in never sees SIGNED_IN again. Configuring only there left the SDK unconfigured
      // for exactly those users, so getOfferings, purchasePackage and restorePurchases all
      // returned null and the paywall and Restore Purchases silently did nothing.
      //
      // This is the same event that was missed once before, in the Google OAuth popup hang
      // (7108311a). It is the easy one to forget because it never fires in a fresh-login test.
      //
      // Deliberately outside the branch chain below: this must happen on a restored session
      // whatever else that branch decides about navigation.
      if (session?.user?.id && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        initRevenueCat(session.user.id).catch(() => {/* native no-op on web */});
      }

      if (event === 'SIGNED_IN') {
        // Password recovery: Supabase fires SIGNED_IN when it establishes the
        // recovery session from the hash tokens, before the user sets a new
        // password. Skip the auto-navigate so Auth.tsx can show the form.
        if (sessionStorage.getItem('forgenta:recovery_pending')) {
          sessionStorage.removeItem('forgenta:recovery_pending');
          return;
        }
        setIsDemo(false);
        if (session?.user?.id) {
          initRevenueCat(session.user.id).catch(() => {/* native no-op on web */});
          identifyMonitoringUser(session.user.id, session.user.email);
          maybeTrackOAuthSignUp(session.user);
        }
        // Await reviewer reset before navigating so Dashboard's profile SELECT
        // always reads the updated founder_note_seen / onboarding_completed values.
        const reviewerResetPromise = session?.user?.email === REVIEWER_EMAIL && session?.user?.id
          ? resetReviewerAccount(session.user.id)
          : Promise.resolve();
        if (locationRef.current === '/auth') {
          // ⚠️ INSIDE the `/auth` branch on purpose. Signing in begins a new session and should
          // open on the rules (Tre, 2026-08-18); a restored session or a re-fired SIGNED_IN is NOT
          // a sign-in and must leave the panel the user last chose exactly where it was.
          resetActivityTabForSignIn();
          reviewerResetPromise
            .then(() => supabase.auth.mfa.getAuthenticatorAssuranceLevel())
            .then(({ data: aal }) => {
              if (aal && aal.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
                return; // MFA pending — Auth.tsx handles challenge
              }
              navigate('/dashboard');
            })
            .catch((err) => {
              // The user IS signed in at this point; parking them on /auth
              // because a pre-navigation step failed is worse than landing on
              // the dashboard without it (reviewer reset and the MFA probe
              // both fail toward the common no-MFA case).
              console.error('Post-sign-in navigation chain failed:', err);
              navigate('/dashboard');
            });
        }
      } else if (event === 'PASSWORD_RECOVERY') {
        // Belt-and-suspenders: set flag here too in case Auth.tsx hasn't read
        // the hash yet when this event fires.
        sessionStorage.setItem('forgenta:recovery_pending', '1');
      } else if (event === 'SIGNED_OUT') {
        logOutRevenueCat().catch(() => {/* native no-op on web */});
        navigate('/auth');
      } else if (event === 'USER_UPDATED') {
        // Sync the updated email to Stripe so dunning/receipt emails stay current.
        // Fire-and-forget — a failure here is non-critical.
        if (session?.user?.email) {
          supabase.functions.invoke('sync-stripe-email').catch(() => {});
        }
      } else if (event === 'TOKEN_REFRESHED') {
        // Session refreshed silently — no action needed
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!initialized.current) {
        setUser(session?.user ?? null);
        setLoading(false);
        initialized.current = true;
      }
    });

    const timeout = setTimeout(() => {
      if (!initialized.current) {
        setLoading(false);
        initialized.current = true;
      }
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate, resetReviewerAccount, setIsDemo]);

  // ── Cross-tab sign-out via BroadcastChannel ──────────────────────────────
  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel('forged_auth');
    channel.onmessage = (e) => {
      if (e.data === 'SIGN_OUT') {
        // Another tab signed out — sign out this tab too
        supabase.auth.signOut();
      }
    };
    return () => channel.close();
  }, []);

  const broadcastSignOut = useCallback(() => {
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel('forged_auth');
    channel.postMessage('SIGN_OUT');
    channel.close();
  }, []);

  /**
   * Signs this device out, and reports whether it actually happened.
   *
   * ⚠️ SUPABASE CAN REFUSE, AND USED TO DO SO SILENTLY. `auth.signOut()` calls `/logout` first and,
   * when nothing answers, returns the error WITHOUT clearing the local session
   * (`GoTrueClient._signOut` returns before `_removeSession`). Nothing emits SIGNED_OUT, so the app
   * carries on exactly as it was — while the activity stamp had already been deleted, which handed
   * the session a fresh ten minutes and left the user told they were signed out when they were not.
   * That was survivable while this only ran from a button on a desktop. It is not now that the idle
   * timeout runs on native, where "offline" is a tunnel rather than an outage. So: the stamp goes
   * back, the caller is told, and the next idle check tries again.
   */
  const signOutWithBroadcast = useCallback(async (): Promise<boolean> => {
    const lastActivity = localStorage.getItem(LAST_ACTIVITY_KEY);
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    // Half-typed balances are that person's data. On a shared device they must
    // not be waiting in a form for whoever signs in next.
    clearAllFormDrafts();
    if (user?.email === REVIEWER_EMAIL && user?.id) {
      await resetReviewerAccount(user.id);
    }
    broadcastSignOut();
    const { error } = await supabase.auth.signOut();
    if (error) {
      if (lastActivity !== null) localStorage.setItem(LAST_ACTIVITY_KEY, lastActivity);
      console.error('Sign-out was refused; this device is still signed in:', error);
      return false;
    }
    setIsDemo(false);
    return true;
  }, [broadcastSignOut, user, resetReviewerAccount, setIsDemo]);

  /**
   * What the UI's Sign Out button calls. The boolean above is for the idle timeout, which words its
   * own message; somebody who pressed a button and is still signed in has to be told here rather
   * than left looking at a screen that did not change.
   */
  const signOutFromUi = useCallback(async () => {
    const signedOut = await signOutWithBroadcast();
    if (!signedOut) {
      toast.error('We could not sign you out. Check your connection and try again.');
    }
  }, [signOutWithBroadcast]);

  // ── Idle session timeout ─────────────────────────────────────────────────
  // Last activity is stored in localStorage so it survives tab close/reopen.
  // On visibilitychange (user returns to the app) we check immediately — this
  // is how we enforce the timeout even when the app was backgrounded or closed.
  const warnedRef = useRef(false);
  // Whether the last idle sign-out was refused. Stops a phone that is out of signal repeating the
  // same message every 30 seconds while the retry loop quietly keeps trying.
  const idleSignOutFailedRef = useRef(false);

  const resetActivity = useCallback(() => {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    warnedRef.current = false;
    idleSignOutFailedRef.current = false;
  }, []);

  const getIdleMs = useCallback(() => {
    const stored = localStorage.getItem(LAST_ACTIVITY_KEY);
    return Date.now() - (stored ? parseInt(stored, 10) : Date.now());
  }, []);

  // Whether THIS device carries the user's trust grant. Starts false, so an untrusted device
  // never sees the long leash even for the moment the check is in flight — failing closed is the
  // whole point of the default.
  const trustedRef = useRef(false);

  useEffect(() => {
    trustedRef.current = false;
    if (!user || isDemo) return;
    let cancelled = false;
    isDeviceTrusted(user.id).then(trusted => {
      if (!cancelled) trustedRef.current = trusted;
    });
    return () => { cancelled = true; };
  }, [user, isDemo]);

  useEffect(() => {
    // ⚠️ NATIVE IS NO LONGER EXEMPT (Tre, 2026-08-25). This used to read `|| Capacitor
    // .isNativePlatform()`, on the stated grounds that "native apps use PIN/biometric lock for
    // security". They do not. `AppLockProvider` and `AppLockScreen` are exported and mounted by
    // nothing — `App.tsx` renders neither branch of them — so the exemption was not a trade of one
    // control for another, it was the phone having no idle protection at all while the browser
    // signed people out after ten minutes. Mounting the lock is a separate decision; until it is
    // taken, native runs the same leash as web.
    if (!user || isDemo) return;

    // Seed the key if not yet set so the timer starts from login
    if (!localStorage.getItem(LAST_ACTIVITY_KEY)) {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    }

    const checkIdle = () => {
      // Resolved per check rather than captured once: trust can finish resolving, or be revoked
      // in Settings, while this interval is already running.
      const trusted = trustedRef.current;
      const timeoutMs = trusted ? TRUSTED_IDLE_TIMEOUT_MS : IDLE_TIMEOUT_MS;
      const warningMs = trusted ? TRUSTED_IDLE_WARNING_MS : IDLE_WARNING_MS;
      const idleMs = getIdleMs();
      if (idleMs >= timeoutMs) {
        // ⚠️ NO `removeItem` HERE ANY MORE, and no message yet. `signOutWithBroadcast` clears the
        // stamp synchronously before its first await — which is still what stops a second signal
        // arriving in the same turn from firing a second sign-out — but it also needs the old value
        // in hand to put back if Supabase refuses. Clearing it here would take that away, and the
        // timeout would silently give up on an offline device.
        // Said once per idle episode, not once every 30 seconds while the retry loop keeps trying.
        const reportRefusal = () => {
          if (idleSignOutFailedRef.current) return;
          idleSignOutFailedRef.current = true;
          toast.error('Your session timed out but we could not sign you out. Check your connection.');
        };
        signOutWithBroadcast()
          .then((signedOut) => {
            if (!signedOut) return reportRefusal();
            toast.info(trusted
              ? 'You were signed out after 12 hours of inactivity.'
              : 'You were signed out due to 10 minutes of inactivity.');
          })
          .catch((err) => {
            console.error('The idle sign-out threw:', err);
            reportRefusal();
          });
      } else if (idleMs >= warningMs && !warnedRef.current) {
        warnedRef.current = true;
        toast.warning('Your session will expire in 2 minutes due to inactivity.');
      }
    };

    // Check immediately when the user returns to the tab / app
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') checkIdle();
    };

    const events = ['mousemove', 'keydown', 'touchstart', 'click', 'scroll'] as const;
    const opts: AddEventListenerOptions = { passive: true };
    events.forEach(e => window.addEventListener(e, resetActivity, opts));
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    const interval = setInterval(checkIdle, IDLE_CHECK_INTERVAL_MS);

    // ⚠️ NATIVE CANNOT LEAN ON EITHER OF THE ABOVE. iOS suspends the web content process while the
    // app is backgrounded, so the 30-second interval does not tick while the phone is in a pocket,
    // and `visibilitychange` is not a signal that can be relied on to arrive on the way back — the
    // same reasoning `app-resume.ts` is built on. `appStateChange` is, so the check that matters
    // most, the one at the moment the app is picked up again, is driven from there. Nothing is lost
    // while the timer is frozen because the leash is a wall-clock stamp rather than a countdown, so
    // the time away is read back in full on resume. The web listeners stay registered on native as
    // well: they are harmless (the first check to fire clears the stamp, so a second one in the same
    // turn reads zero idle) and they are the fallback if the plugin subscription ever fails.
    let appStateHandle: { remove: () => void } | null = null;
    let unsubscribed = false;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) checkIdle();
      }).then((handle) => {
        if (unsubscribed) handle.remove(); else appStateHandle = handle;
      }).catch((err) => {
        // Not silent: without this listener the timeout still runs, but only from the interval once
        // the WebView wakes up, so a resume can be up to 30 seconds late.
        console.error('Subscribing to appStateChange for the idle timeout failed:', err);
      });
    }

    return () => {
      events.forEach(e => window.removeEventListener(e, resetActivity));
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      clearInterval(interval);
      unsubscribed = true;
      appStateHandle?.remove();
    };
  }, [user, isDemo, resetActivity, getIdleMs, signOutWithBroadcast]);

  return (
    <AuthContext.Provider value={{ user, loading, signOut: signOutFromUi }}>
      {children}
    </AuthContext.Provider>
  );
}
