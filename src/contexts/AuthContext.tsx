import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { initRevenueCat, logOutRevenueCat } from '@/lib/purchases';
import { identifyMonitoringUser } from '@/lib/monitoring';
import { maybeTrackOAuthSignUp } from '@/lib/analytics';
import { useDemo } from '@/contexts/DemoContext';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;    // 10 minutes
const IDLE_WARNING_MS =  8 * 60 * 1000;    // warn at 8 minutes
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
      .from('plaid_items')
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
      return d.toISOString().split('T')[0];
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
          reviewerResetPromise
            .then(() => supabase.auth.mfa.getAuthenticatorAssuranceLevel())
            .then(({ data: aal }) => {
              if (aal && aal.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
                return; // MFA pending — Auth.tsx handles challenge
              }
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

  const signOutWithBroadcast = useCallback(async () => {
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    if (user?.email === REVIEWER_EMAIL && user?.id) {
      await resetReviewerAccount(user.id);
    }
    broadcastSignOut();
    await supabase.auth.signOut();
    setIsDemo(false);
  }, [broadcastSignOut, user, resetReviewerAccount, setIsDemo]);

  // ── Idle session timeout ─────────────────────────────────────────────────
  // Last activity is stored in localStorage so it survives tab close/reopen.
  // On visibilitychange (user returns to the app) we check immediately — this
  // is how we enforce the timeout even when the app was backgrounded or closed.
  const warnedRef = useRef(false);

  const resetActivity = useCallback(() => {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    warnedRef.current = false;
  }, []);

  const getIdleMs = useCallback(() => {
    const stored = localStorage.getItem(LAST_ACTIVITY_KEY);
    return Date.now() - (stored ? parseInt(stored, 10) : Date.now());
  }, []);

  useEffect(() => {
    // Native apps use PIN/biometric lock for security — no idle timeout needed.
    if (!user || isDemo || Capacitor.isNativePlatform()) return;

    // Seed the key if not yet set so the timer starts from login
    if (!localStorage.getItem(LAST_ACTIVITY_KEY)) {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    }

    const checkIdle = () => {
      const idleMs = getIdleMs();
      if (idleMs >= IDLE_TIMEOUT_MS) {
        toast.info('You were signed out due to 10 minutes of inactivity.');
        localStorage.removeItem(LAST_ACTIVITY_KEY);
        signOutWithBroadcast();
      } else if (idleMs >= IDLE_WARNING_MS && !warnedRef.current) {
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

    return () => {
      events.forEach(e => window.removeEventListener(e, resetActivity));
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      clearInterval(interval);
    };
  }, [user, isDemo, resetActivity, getIdleMs, signOutWithBroadcast]);

  return (
    <AuthContext.Provider value={{ user, loading, signOut: signOutWithBroadcast }}>
      {children}
    </AuthContext.Provider>
  );
}
