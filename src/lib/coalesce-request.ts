/** Module-level map of keys to their currently pending promise. */
const inFlightMap: Map<string, Promise<unknown>> = new Map();

/**
 * Coalesce CONCURRENT async requests that share a key.
 *
 * While a request is still pending, another call with the same key gets the SAME promise instead
 * of starting a second round trip. The entry is dropped the moment the promise settles.
 *
 * ⚠️ THIS IS NOT A CACHE, AND THE DISTINCTION IS LOAD-BEARING. It never returns a value produced
 * by an already-settled request, so a later call always re-fetches. One of its callers is
 * `isDeviceTrusted` — a security check — where serving a remembered answer would mean a revoked
 * device staying trusted. Coalescing removes duplicate work; it must never remove freshness.
 *
 * DO NOT COALESCE A READ THAT CAN HANG WITHOUT SETTLING. The entry clears on settle, so a
 * request that never settles pins the key for the life of the page and every later caller gets
 * that same dead promise - the read can never succeed again. MEASURED 2026-09-12: wiring this
 * into `fetchOnboardingCompleted` broke its own "resolves null instead of hanging" test, because
 * that read is known to hang and carries its own `Promise.race` timeout. Coalescing FIGHTS a
 * per-call timeout - each caller still times out, but no caller ever gets a fresh attempt. That
 * helper is deliberately NOT coalesced. Use this only where a request reliably settles, errors
 * included: a 504 settles, a black hole does not.
 *
 * @param key identifies the request
 * @param factory creates the promise; called only when nothing is pending for `key`
 * @returns a promise resolving or rejecting exactly as `factory`'s did
 */
export function coalesce<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const pending = inFlightMap.get(key);
  // Safe cast: only the matching factory's promise is ever stored under this key.
  if (pending) return pending as Promise<T>;

  let result: Promise<T>;
  try {
    result = factory();
  } catch (err) {
    // A synchronous throw becomes a rejection and must not leave the key occupied.
    return Promise.reject(err);
  }

  inFlightMap.set(key, result as Promise<unknown>);

  // ⚠️ THE `.catch()` HERE IS NOT REDUNDANT. `result.finally()` returns a NEW promise that
  // rejects whenever `result` does. Left floating, a rejected request raises an unhandled
  // rejection — a crash report for an error the real caller is already handling correctly.
  // This branch exists only to clear the map, so it swallows; callers still see the rejection
  // through the promise returned below.
  void result
    .finally(() => {
      inFlightMap.delete(key);
    })
    .catch(() => {
      /* handled by the caller's own copy of `result` */
    });

  return result;
}

/** How many keys have a request in flight right now. For tests and diagnostics. */
export function inFlightCount(): number {
  return inFlightMap.size;
}

/** Clear all entries. Test isolation only; it does not cancel anything already pending. */
export function resetCoalescer(): void {
  inFlightMap.clear();
}
