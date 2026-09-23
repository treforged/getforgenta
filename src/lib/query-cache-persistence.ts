/**
 * KEEP THE LAST-KNOWN DATA ON THE PHONE, SO A COLD LAUNCH IS NOT SEVEN SECONDS OF SKELETONS.
 *
 * Tre, 2026-09-23, on iOS build 1011: "the pages load pretty slow on mobile". Measured in the edge
 * logs the same minute: his first screen fired ~25 queries at 03:38:18Z and EVERY one took 6.3-7.0 s
 * at the origin, finishing together, while the same queries seconds later took ~60 ms - and 47
 * minutes of the previous 24 h show the same stall. That is the free instance stalling
 * (docs/load-times-measurement-2026-09-11.md); staying on free compute is Tre's decision
 * (d9e5961c), so the fix belongs on the client: nothing survived a launch, so every screen waited
 * on the slowest of 25 round trips.
 *
 * Restored queries carry their ORIGINAL `dataUpdatedAt`, so they are stale on arrival and React
 * Query refetches them on mount - the last-known numbers show at once and are replaced as soon as
 * the server answers. Native only (the caller checks), because on the web a shared computer would
 * keep someone's finances in localStorage; the app sandbox on a phone does not have that problem.
 *
 * ⚠️ PRIVACY BOUNDARY: only queries whose key contains the SIGNED-IN user's own id are written -
 * never a partner's shared view, never demo data - and sign-out deletes the whole entry.
 */
import { dehydrate, hydrate, type QueryClient, type DehydratedState } from '@tanstack/react-query';

export const PERSIST_KEY = 'forgenta:query-cache:v1';
export const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The key that decides ROUTING into onboarding. A stale copy could send someone past the wizard,
 * and ProtectedRoute already keeps its own device cache for that decision. `profile` IS persisted:
 * the Dashboard withholds every card until it loads (`essentialLoading`), so leaving it out left
 * the whole cold-launch skeleton in place - measured in a browser with 38 KB restored.
 */
const NEVER_PERSIST = new Set(['onboarding-completed']);

/**
 * Restores a saved cache into `qc`. Returns the number of queries restored (0 when nothing was restored).
 */
export function restorePersistedQueries(
  qc: QueryClient,
  userId: string | null | undefined,
  now: number = Date.now(),
  storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage
): number {
  if (!userId) return 0;

  try {
    const item = storage.getItem(PERSIST_KEY);
    if (!item) return 0;

    let payload: { userId: string; savedAt: number; state: DehydratedState };
    try {
      payload = JSON.parse(item);
    } catch {
      clearPersistedQueries(storage);
      return 0;
    }

    if (
      !payload.userId ||
      !payload.savedAt ||
      !payload.state ||
      !Array.isArray(payload.state.queries) ||
      payload.userId !== userId ||
      now - payload.savedAt < 0 ||
      now - payload.savedAt > PERSIST_MAX_AGE_MS
    ) {
      try {
        storage.removeItem(PERSIST_KEY);
      } catch {
        // Ignore removal error
      }
      return 0;
    }

    hydrate(qc, payload.state);
    return payload.state.queries.length;
  } catch {
    return 0;
  }
}

/**
 * Starts writing the cache (throttled). Returns an unsubscribe function.
 */
export function startQueryPersistence(
  qc: QueryClient,
  userId: string,
  opts?: { throttleMs?: number; storage?: Pick<Storage, 'setItem'>; now?: () => number }
): () => void {
  const throttleMs = opts?.throttleMs ?? 1000;
  const storage = opts?.storage ?? localStorage;
  const nowFn = opts?.now ?? Date.now;

  let timer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = qc.getQueryCache().subscribe(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      write();
    }, throttleMs);
  });

  function write(): void {
    try {
      const state = dehydrate(qc, {
        shouldDehydrateQuery: (q) =>
          q.state.status === 'success'
          && q.queryKey.includes(userId)
          && !NEVER_PERSIST.has(String(q.queryKey[0]))
      });
      storage.setItem(
        PERSIST_KEY,
        JSON.stringify({ userId, savedAt: nowFn(), state })
      );
    } catch {
      // Ignore storage errors
    }
  }

  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    unsubscribe();
  };
}

/**
 * Deletes the saved cache. Never throws.
 */
export function clearPersistedQueries(
  storage: Pick<Storage, 'removeItem'> = localStorage
): void {
  try {
    storage.removeItem(PERSIST_KEY);
  } catch {
    // Ignore removal error
  }
}
