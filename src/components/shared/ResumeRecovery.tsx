import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { supabase } from '@/lib/supabase';
import { debugLog } from '@/lib/debugLog';
import { useAuth } from '@/contexts/AuthContext';
import { recoverSession, type ResumeOutcome } from '@/lib/app-resume';

/**
 * Puts the app back together when it is brought back after being away.
 *
 * ⚠️ WHAT THIS PROTECTS. Tre, 2026-08-24: "if a user leaves the app running in the background for
 * too long, the app stays stuck on the cover screen. it should auto refresh." Two separate things
 * go wrong over a long background and they are fixed at two different layers. The cover itself is
 * native and cannot be lifted from here at all if the web side has stopped answering, and that half
 * lives in `AppDelegate.swift`'s cover deadline. This half is the other one: nothing in the app ever
 * reacted to coming back, so a session whose token expired while the WebView was suspended stayed
 * expired, and every screen kept rendering against it.
 *
 * ⚠️ THE NATIVE AND WEB SIGNALS ARE NOT THE SAME SIGNAL, on purpose. On web, supabase-js already
 * owns `visibilitychange` and restarts its own ticker from it, so the only thing added here is the
 * explicit re-resolve for a tab that was hidden long enough to have gone stale. On native that
 * listener cannot be trusted to fire, so `appStateChange` drives the recovery and the refresh ticker
 * is restarted by hand.
 */
export default function ResumeRecovery() {
  // Read through a ref: the listener is registered once and would otherwise close over whoever was
  // signed in at mount, which on native is nobody.
  const { user } = useAuth();
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  useEffect(() => {
    const isNative = Capacitor.isNativePlatform();
    let awaySince: number | null = null;
    // One recovery at a time. Both signals can land together on native, and a second probe would
    // race the first one's refresh.
    let running = false;
    let cancelled = false;

    const onAway = () => {
      // First one wins: two "hidden" events without a return in between are still one absence, and
      // overwriting the timestamp would under-report how long the app was actually gone.
      if (awaySince === null) awaySince = Date.now();
    };

    const onBack = async () => {
      const awayMs = awaySince === null ? 0 : Date.now() - awaySince;
      awaySince = null;
      if (running || cancelled) return;
      running = true;
      try {
        // ⚠️ START ONLY, NEVER STOP. The documented Capacitor pairing also calls `stopAutoRefresh()`
        // on the way out, and that is the half that can leave the app with refresh switched off for
        // good if the resume event is ever missed, which is the exact failure being fixed. Starting
        // is idempotent (it clears the old ticker first) and runs one tick immediately, which is the
        // refresh a suspended WebView never got round to.
        await supabase.auth.startAutoRefresh();
      } catch (err) {
        // Not fatal on its own: the probe below still re-resolves the session by hand.
        console.error('Restarting the Supabase refresh ticker on resume failed:', err);
      }

      let outcome: ResumeOutcome;
      try {
        outcome = await recoverSession(supabase.auth, awayMs);
      } catch (err) {
        console.error('Resume session probe threw:', err);
        outcome = 'unreachable';
      }

      await report(outcome, awayMs);

      // ⚠️ ONLY IF THE APP THOUGHT IT WAS SIGNED IN. "No session" is also the normal state of a
      // visitor reading the landing page, and bouncing them to `/auth` because they left the tab
      // open over lunch would be the app hijacking a public page. There is only something to
      // recover from when the app is still rendering signed-in screens against a session that has
      // gone. Demo mode is covered by the same test: it never holds a user.
      if (outcome === 'signed-out' && userRef.current && !cancelled) {
        // Nothing has told the app yet. The tokens are gone from storage, but `AuthContext` is still
        // holding the user it read on mount, so every protected route carries on rendering against a
        // session that no longer exists. A local sign-out emits SIGNED_OUT, and that is what moves
        // the app to `/auth`, the honest end state when a session cannot be recovered.
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch (err) {
          console.error('Local sign-out after an unrecoverable resume failed:', err);
        }
      }

      running = false;
    };

    if (isNative) {
      let handle: { remove: () => void } | null = null;
      CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) onBack(); else onAway();
      }).then((h) => {
        if (cancelled) h.remove(); else handle = h;
      }).catch((err) => {
        console.error('Subscribing to appStateChange for resume recovery failed:', err);
      });

      return () => { cancelled = true; handle?.remove(); };
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') onBack(); else onAway();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}

/**
 * Leaves a record of anything that was not a clean resume.
 *
 * `unreachable` is the one that matters: the app carries on showing what it had, the token may now
 * be stale, and a resume that quietly did nothing is indistinguishable from one that worked unless
 * somebody wrote it down. `debugLog` is the native debug panel (`BlackScreenDebug`), which is where
 * this class of bug has been chased from before.
 */
async function report(outcome: ResumeOutcome, awayMs: number): Promise<void> {
  if (outcome === 'skipped' || outcome === 'active') return;
  const away = Math.round(awayMs / 1000);
  await debugLog(`RESUME:${outcome} away=${away}s`);
  if (outcome === 'unreachable') {
    console.error(
      `Resume recovery could not reach Supabase after ${away}s away. The session was left as it was.`,
    );
  }
}
