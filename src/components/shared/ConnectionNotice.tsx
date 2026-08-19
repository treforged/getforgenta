import { Loader2, WifiOff } from 'lucide-react';

/**
 * What a page shows when it has been waiting too long, or is offline.
 *
 * ⚠️ WHY THIS EXISTS AT ALL, and it is not "nicer loading". Tre, on 5G from TestFlight: *"app
 * refreshed randomly"*. It had. `ErrorBoundary` auto-reloads once on a chunk-load error, because a
 * new deploy replaces the hashed chunks and the old ones 404 — sound reasoning on a desktop that
 * deploys while you sit there. On a phone with a weak signal the SAME error means something else
 * entirely: the chunk did not fail to exist, it failed to ARRIVE. And the app answered a dropped
 * connection by silently restarting itself, which from the outside is the app randomly refreshing.
 *
 * A skeleton cannot say this. A skeleton means "the shape of your data is coming"; it is a promise,
 * and after fifteen seconds on a dead connection it is a promise the app is not keeping. So the
 * wait changes its mind out loud: shape first, then — only once waiting has stopped being normal —
 * an honest "we cannot reach the server", a spinner that says something is still being attempted,
 * and a way to retry by hand.
 *
 * ⚠️ THE SPINNER IS HERE AND NOT IN THE SKELETON, deliberately. A spinner is a poor loading state
 * for content — it holds no shape and tells you nothing about what is arriving — but it is the
 * right indicator for a RETRY, where there is no shape to promise and the only fact is that work
 * is still in progress. The two are different states and they get different pictures.
 */
export default function ConnectionNotice({
  offline,
  onRetry,
}: {
  /** `true` when the device itself reports no network — a different sentence from a slow server. */
  offline: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="relative flex h-12 w-12 items-center justify-center">
        {/* Both marks at once: the spinner says an attempt is in flight, the icon says what is
            wrong. Either alone leaves the other question unanswered. */}
        <Loader2 className="absolute h-12 w-12 animate-spin text-primary/40" strokeWidth={1.5} />
        <WifiOff className="h-5 w-5 text-muted-foreground" />
      </div>

      <p className="text-sm font-medium text-foreground">
        {offline ? 'No internet connection' : 'Still trying to reach Forgenta'}
      </p>
      <p className="max-w-xs text-xs text-muted-foreground">
        {offline
          ? 'Your device is offline. This will pick up on its own as soon as the connection is back.'
          : 'The connection is slow or the server is not answering. Nothing has been lost — this keeps retrying.'}
      </p>

      {/* ⚠️ RETRY, NOT RELOAD. Reloading is what caused the complaint: it throws away every
          unsaved thing on the page to solve a problem that is usually outside the page. */}
      <button
        onClick={onRetry}
        className="mt-1 bg-secondary border border-border px-3 py-1.5 text-xs font-medium btn-press hover:border-primary/40 hover:text-primary transition-colors"
        style={{ borderRadius: 'var(--radius)' }}
      >
        Try again
      </button>
    </div>
  );
}
