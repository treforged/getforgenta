/**
 * The live half of backend health: one store that hears every Supabase request's outcome, reads
 * the providers' status pages when something fails, and hands the banner a diagnosis.
 *
 * The rules themselves are in `backend-health.ts` and are pure; this file only wires them to the
 * browser — `window.fetch`, `navigator.onLine`, timers — and is built as a factory so a test can
 * drive it with fakes instead of the real network.
 *
 * ⚠️ THE STORE NEVER INVENTS A FAILURE. It changes only on a real request outcome, a real
 * online/offline event, or a status read finishing. A status page on its own cannot raise the
 * banner (see `diagnose`).
 */
import {
  createHealthFetch, diagnose, parseStatusSummary, STATUS_SOURCES,
  type Diagnosis, type ProviderId, type ProviderStatuses, type RequestOutcome, type StatusRead,
} from '@/lib/backend-health';

/** A status read is reused for this long. Status pages update on the order of minutes. */
export const STATUS_CACHE_MS = 60_000;
/** One status page gets this long before it counts as unread. Five seconds is generous for a CDN JSON. */
export const STATUS_TIMEOUT_MS = 5_000;

export interface BackendHealthSnapshot {
  online: boolean;
  failure: { supabase: boolean; bank: boolean };
  statuses: ProviderStatuses;
  /** True while a status read or a user-pressed re-check is in flight. */
  checking: boolean;
  diagnosis: Diagnosis | null;
}

export interface BackendHealthStore {
  report: (o: RequestOutcome) => void;
  setOnline: (online: boolean) => void;
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => BackendHealthSnapshot;
  /** "Try again": re-read every status page (ignoring the cache) and send one probe request. */
  recheck: () => Promise<void>;
}

/**
 * Read one status page with its own timeout. ANY failure — network, timeout, non-200, bad JSON,
 * wrong shape — is `{ ok: false }`, which `diagnose` treats as "unknown", never as an incident.
 * No credentials and no referrer go to the status host: it learns nothing about the user.
 */
export async function readStatusPage(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number = STATUS_TIMEOUT_MS,
): Promise<StatusRead> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    if (!res.ok) return { ok: false };
    return parseStatusSummary(await res.json());
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

export function createBackendHealthStore(deps: {
  readStatus: (url: string) => Promise<StatusRead>;
  /** The probe "Try again" sends to Supabase. Its outcome arrives through `report` like any other. */
  probeRequest?: () => Promise<unknown>;
  initialOnline?: boolean;
  now?: () => number;
  cacheMs?: number;
}): BackendHealthStore {
  const { readStatus, probeRequest, now = Date.now, cacheMs = STATUS_CACHE_MS } = deps;
  const listeners = new Set<() => void>();
  let online = deps.initialOnline ?? true;
  let failure = { supabase: false, bank: false };
  let statuses: ProviderStatuses = {};
  let readAt = -Infinity;
  let reading: Promise<void> | null = null;
  let rechecking = false;

  const build = (): BackendHealthSnapshot => ({
    online, failure, statuses, checking: reading !== null || rechecking,
    diagnosis: diagnose({ online, statuses, failure }),
  });
  // ⚠️ ONE OBJECT PER CHANGE. `useSyncExternalStore` compares snapshots by identity, so building
  // a fresh object on every `getSnapshot` call would re-render for ever.
  let snapshot = build();
  const emit = () => { snapshot = build(); listeners.forEach(fn => fn()); };

  const readStatuses = (force: boolean): Promise<void> => {
    if (reading) return reading;
    if (!force && now() - readAt < cacheMs) return Promise.resolve();
    const ids = Object.keys(STATUS_SOURCES) as ProviderId[];
    reading = Promise.all(ids.map(async id => [id, await readStatus(STATUS_SOURCES[id].url)] as const))
      .then(entries => {
        statuses = Object.fromEntries(entries) as ProviderStatuses;
        readAt = now();
      })
      .catch(() => {
        // readStatus never rejects by contract; if an injected one does, the honest state is
        // "unread", not a stale reading presented as current.
        statuses = {};
      })
      .finally(() => { reading = null; emit(); });
    emit();
    return reading;
  };

  return {
    report(o) {
      const was = failure[o.target];
      if (o.ok) {
        // Any answer from Supabase — a bank function included — proves the back end is reachable.
        const next = o.target === 'bank' ? { supabase: false, bank: false } : { ...failure, supabase: false };
        if (next.supabase === failure.supabase && next.bank === failure.bank) return;
        failure = next;
        emit();
        return;
      }
      if (was) return;
      failure = { ...failure, [o.target]: true };
      emit();
      void readStatuses(false);
    },
    setOnline(next) {
      if (next === online) return;
      online = next;
      emit();
      // Coming back online is the moment to look again, not to assume the back end is fine.
      if (next && (failure.supabase || failure.bank)) void readStatuses(true);
    },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => snapshot,
    async recheck() {
      rechecking = true;
      emit();
      try {
        await Promise.all([readStatuses(true), probeRequest?.().catch(() => undefined)]);
      } finally {
        rechecking = false;
        emit();
      }
    },
  };
}

// ── The app's single instance ─────────────────────────────────────────────────────────────

let appStore: BackendHealthStore | null = null;

/** The store the banner reads. Null until `installBackendHealth` has run (i.e. in unit tests). */
export function getBackendHealthStore(): BackendHealthStore | null {
  return appStore;
}

/**
 * Wire backend health into the running app. Called ONCE from main.tsx, before the first render,
 * so the very first auth request is already observed. Idempotent.
 *
 * ⚠️ THE STATUS READS USE THE ORIGINAL `fetch`, captured before the wrap. They would pass through
 * the wrapper untouched anyway (different origin), but reading status through the thing being
 * diagnosed is the dependency this feature exists to avoid.
 */
export function installBackendHealth(supabaseUrl: string, publishableKey: string): BackendHealthStore {
  if (appStore) return appStore;
  const baseFetch = window.fetch.bind(window);
  const origin = new URL(supabaseUrl).origin;
  const store = createBackendHealthStore({
    readStatus: url => readStatusPage(url, baseFetch),
    // GoTrue's health endpoint: tiny, unauthenticated beyond the publishable key, and on the same
    // gateway as sign-in. It goes through the WRAPPED fetch so its answer clears (or confirms)
    // the notice exactly like an app request would.
    probeRequest: () => window.fetch(`${supabaseUrl}/auth/v1/health`, { headers: { apikey: publishableKey } }),
    initialOnline: navigator.onLine !== false,
  });
  window.fetch = createHealthFetch({ baseFetch, origin, report: store.report });
  window.addEventListener('online', () => store.setOnline(true));
  window.addEventListener('offline', () => store.setOnline(false));
  appStore = store;
  return store;
}
