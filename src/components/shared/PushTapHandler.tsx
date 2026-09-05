import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Capacitor } from '@capacitor/core';
import { routeForNotificationKey } from '@/lib/notification-routes';

/**
 * MAKES TAPPING A NOTIFICATION GO SOMEWHERE.
 *
 * ⚠️ THIS DID NOT EXIST, AND THAT WAS THE WHOLE BUG. The first real APNs delivery in this app's
 * history landed on Tre's phone on 2026-09-05 — correct copy, correct icon — and tapping it just
 * foregrounded the app where he had left it. `grep pushNotificationActionPerformed src/` returned
 * ZERO matches: the payload had always carried `key`, and nothing was listening for the tap that
 * would have consumed it.
 *
 * It is not a routing bug and it was not `DeepLinkHandler` dropping an unrecognised link — that
 * handler serves `appUrlOpen` (universal links), which a push tap does not raise. Three different
 * causes produce this identical symptom, which is why it was diagnosed before anything was changed.
 *
 * ── COLD START IS A DIFFERENT PATH FROM WARM START ──────────────────────────
 * ⚠️ Tapping from a KILLED app and from a BACKGROUNDED app take different routes on iOS, and the
 * warm one working is not evidence for the cold one. On a cold start this component mounts inside
 * a React tree that may not have a router ready at the instant Capacitor replays the event, so the
 * destination is stashed and consumed on the next tick rather than navigated to synchronously.
 * `sessionStorage` — not `localStorage` — because a pending tap must not survive the app being
 * closed and reopened days later and teleport somebody out of what they were doing.
 */

/** Where a tap that arrived before the router was ready is parked. */
const PENDING_KEY = 'forgenta:pending_push_route';

function stashPending(path: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, path);
  } catch {
    // A device refusing storage still gets the warm-start path below; nothing here may throw.
  }
}

function takePending(): string | null {
  try {
    const v = sessionStorage.getItem(PENDING_KEY);
    if (v) sessionStorage.removeItem(PENDING_KEY);
    return v;
  } catch {
    return null;
  }
}

export default function PushTapHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    // A pending route from a cold start, consumed once the router exists.
    const pending = takePending();
    if (pending) navigate(pending);

    if (!Capacitor.isNativePlatform()) return;

    let disposed = false;
    let remove: (() => void) | null = null;

    void (async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const handle = await PushNotifications.addListener(
          'pushNotificationActionPerformed',
          (action) => {
            // The key sits beside `aps` on iOS and inside `data` on Android; `data` is where
            // Capacitor surfaces both.
            const data = (action?.notification?.data ?? {}) as Record<string, unknown>;
            const key = typeof data.key === 'string' ? data.key : null;
            const route = routeForNotificationKey(key);

            if (!route.recognised) {
              // ⚠️ NOT SILENT. A kind added to the sender without a route here shows up as a line
              // rather than as a tap that appears to do nothing — the failure `plaid-complete`
              // already cost this codebase once.
              console.warn('[push] unrecognised notification key, opening dashboard:', key);
            }

            if (disposed) {
              stashPending(route.path);
              return;
            }
            navigate(route.path);
          },
        );
        if (disposed) void handle.remove();
        else remove = () => void handle.remove();
      } catch {
        // The plugin missing is not a reason to break the app; it only means taps do nothing,
        // which is the behaviour that existed before this component.
      }
    })();

    return () => { disposed = true; remove?.(); };
  }, [navigate]);

  return null;
}
