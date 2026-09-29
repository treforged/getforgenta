// The in-bundle half of the boot guard in index.html (2026-09-29, ask 76d3f608).
//
// index.html shows "Couldn't load Forgenta" when the bundle never mounts, and writes the reason to
// localStorage under BOOT_FAILURE_KEY. This file does the two things only running code can do:
//   1. A LAZY route chunk that fails to load (a deploy replaced its hash while the page was open,
//      or the network dropped) fires Vite's `vite:preloadError`. The first time, reload once, which
//      fetches the new index.html. If it fails again in the same tab session, stop reloading and
//      hand the guard a loud failure instead of leaving a blank Suspense.
//   2. On the next GOOD boot, report any recorded failure through reportError, so it reaches the
//      monitoring the desk reads, then clear it. The guard cannot report by itself: the code that
//      reports is the code that failed to load.

export const BOOT_FAILURE_KEY = 'forgenta.bootFailure.v1';
export const CHUNK_RELOAD_KEY = 'forgenta.chunkReloaded.v1';

export interface BootFailureRecord {
  reason: string;
  at: string;
  path: string;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Read and clear a failure the guard recorded. Malformed or absent -> null. Never throws. */
export function takeBootFailure(store: Store): BootFailureRecord | null {
  let raw: string | null;
  try {
    raw = store.getItem(BOOT_FAILURE_KEY);
    if (raw != null) store.removeItem(BOOT_FAILURE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<BootFailureRecord>;
    if (typeof v.reason !== 'string' || typeof v.at !== 'string') return null;
    return { reason: v.reason.slice(0, 200), at: v.at, path: typeof v.path === 'string' ? v.path : '' };
  } catch {
    return null;
  }
}

/**
 * What to do when a lazy chunk fails: reload once per tab session, then fail loud.
 * Returns the action taken so a test can assert it.
 */
export function handleChunkLoadFailure(
  session: Store,
  reload: () => void,
  failLoud: (reason: string) => void,
  detail: string,
): 'reloaded' | 'failed' {
  let already: boolean;
  try {
    already = session.getItem(CHUNK_RELOAD_KEY) === '1';
    if (!already) session.setItem(CHUNK_RELOAD_KEY, '1');
  } catch {
    already = true; // no session storage: a reload could loop, so fail loud instead
  }
  if (already) {
    failLoud('chunk ' + detail);
    return 'failed';
  }
  reload();
  return 'reloaded';
}

/**
 * Chunk half. Must run BEFORE the first render: the first route's own lazy chunk
 * (DashboardLayout) loads immediately, so an idle-time listener would miss it.
 */
export function installChunkFailureHandling(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', (event: Event) => {
    event.preventDefault(); // we handle it; do not also throw into a blank Suspense
    const payload = (event as Event & { payload?: unknown }).payload;
    const detail = payload instanceof Error ? payload.message : String(payload ?? '');
    handleChunkLoadFailure(
      window.sessionStorage,
      () => window.location.reload(),
      reason => window.dispatchEvent(new CustomEvent('forgenta:boot-failed', { detail: reason })),
      detail.slice(0, 160),
    );
  });
  // The reload budget is deliberately never reset on boot. The reload is itself a good boot, so
  // resetting there would turn a chunk that keeps failing into an endless reload loop. One
  // automatic reload per tab session; after that the user sees the screen and taps retry.
}

/**
 * Report half. Takes the record the guard left and hands it to `send`. Runs after monitoring is
 * up. `send` resolving false (no session, insert refused) PUTS THE RECORD BACK so it is not lost.
 */
export async function reportPriorBootFailure(
  store: Store,
  send: (rec: BootFailureRecord) => Promise<boolean>,
): Promise<'none' | 'sent' | 'kept'> {
  const rec = takeBootFailure(store);
  if (!rec) return 'none';
  let ok: boolean;
  try { ok = await send(rec); } catch { ok = false; }
  if (!ok) {
    try { store.setItem(BOOT_FAILURE_KEY, JSON.stringify(rec)); } catch { /* nothing more to do */ }
    return 'kept';
  }
  return 'sent';
}
