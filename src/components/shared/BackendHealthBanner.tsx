import { useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, WifiOff, X } from 'lucide-react';
import { getBackendHealthStore, type BackendHealthSnapshot } from '@/lib/backend-health-store';

const NOOP_SUBSCRIBE = () => () => {};
const NO_STORE: BackendHealthSnapshot | null = null;

/**
 * The app-wide "we can't reach our back end, and here is why" notice. See
 * `src/lib/backend-health.ts` for the rules that decide what it says.
 *
 * ⚠️ MOUNTED ONCE, OUTSIDE THE ROUTES. The outage that prompted it (2026-10-04) hung the auth
 * request itself, so the user was stuck on `/auth` or the "Authenticating…" gate — the screens a
 * route-level notice would never reach. It floats over whatever is on screen instead.
 *
 * ⚠️ IT DOES NOT REPLACE `ConnectionNotice`. That one answers "this PAGE is taking too long"
 * inside a route; this one answers "the BACK END is not answering, and the cause is X" across
 * the whole app. They can both be true and they say different things.
 *
 * ⚠️ "TRY AGAIN" RE-CHECKS, IT DOES NOT RELOAD — same reasoning as ConnectionNotice: a reload
 * throws away the page to solve a problem outside it. It re-reads the status pages, sends one
 * probe to Supabase, and refetches the active queries; whichever of those gets an answer clears
 * the notice.
 *
 * ⚠️ IT CAN BE DISMISSED, because it floats over the top of the page — where the header's own
 * buttons live — and the Plaid notice in particular sits over an app that otherwise WORKS.
 * Dismissing hides THIS diagnosis only: a different cause, or the same one returning after a
 * recovery, shows again. Hiding it for good would be the quiet failure this exists to end.
 */
export default function BackendHealthBanner() {
  const store = getBackendHealthStore();
  const queryClient = useQueryClient();
  const snap = useSyncExternalStore(
    store?.subscribe ?? NOOP_SUBSCRIBE,
    () => store?.getSnapshot() ?? NO_STORE,
    () => NO_STORE,
  );
  const current = snap?.diagnosis ?? null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  // A recovery forgets the dismissal, so the next outage is announced even if it reads the same.
  // Adjusted DURING render (React's documented pattern for state derived from a changing input),
  // not in an effect: an effect would paint one frame with the stale dismissal first.
  if (!current && dismissed !== null) setDismissed(null);
  const diagnosis = current && current.headline !== dismissed ? current : null;

  // The live region is ALWAYS mounted, empty when healthy: a screen reader only announces a
  // change inside a region that already existed, so mounting it with the text would be silent.
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="backend-health-banner"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-3"
      style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}
    >
      {diagnosis && (
        // p-3 + a 1px border is a 13px gap against the 12px --radius: the corners do not share
        // space, so the button's own radius is free (corner-concentricity.md, gap >= r_outer).
        <div className="pointer-events-auto flex w-full max-w-xl items-start gap-3 border border-border bg-card p-3 text-foreground shadow-lg rounded-lg">
          {diagnosis.kind === 'offline'
            ? <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            : <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${diagnosis.kind === 'plaid' ? 'text-muted-foreground' : 'text-destructive-text'}`} aria-hidden="true" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium" data-testid="backend-health-headline">{diagnosis.headline}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{diagnosis.detail}</p>
          </div>
          {/* No retry while the DEVICE says it is offline: there is nothing to retry until it is
              back, and the 'online' event re-checks by itself. Offline inferred from every status
              host failing still gets one, because that inference can be wrong. */}
          {snap?.online && (
            <button
              type="button"
              disabled={snap?.checking}
              onClick={() => {
                void store?.recheck();
                void queryClient.refetchQueries({ type: 'active' });
              }}
              className="shrink-0 inline-flex items-center gap-1.5 bg-secondary border border-border px-3 py-1.5 text-xs font-medium btn-press hover:border-primary/40 hover:text-primary transition-colors rounded-md disabled:opacity-60"
            >
              {snap?.checking && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
              Try again
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setDismissed(diagnosis.headline)}
            className="shrink-0 -m-1 p-1 text-muted-foreground hover:text-foreground transition-colors rounded-md"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
