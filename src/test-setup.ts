// Unmount what the tests mount. Registered as vitest `setupFiles`.
//
// WHY THIS EXISTS. React Testing Library auto-registers its own `afterEach(cleanup)` ONLY when a
// global `afterEach` is present — i.e. when vitest runs with `globals: true`. This repo does not,
// so nothing ever unmounted anything: every component and hook mounted by `render`/`renderHook`
// stayed mounted for the rest of the file.
//
// That is not merely untidy. React's scheduler queues work with `setImmediate`, and
// `performWorkUntilDeadline` can fire AFTER vitest has torn down the jsdom environment for that
// file — at which point `window` no longer exists and the run dies with
//
//   ReferenceError: window is not defined
//     ❯ node_modules/react-dom/cjs/react-dom-client.development.js
//     ❯ Immediate.performWorkUntilDeadline node_modules/scheduler/cjs/scheduler.development.js
//
// as an UNHANDLED error, which fails the whole run while every individual test still reports
// passing. It landed on CI run 33785823643 in `useSupabaseData.partnerView.test.tsx` and not on
// the run before it, on identical test code — because whether the callback beats the teardown is
// a race, decided by machine speed and file ordering.
//
// `vite.config.ts` already records the lesson this is the second instance of: "an intermittently
// red suite is worse than a slow one: it trains everybody to read a failure as 'probably the
// flaky one', and that is how a real failure gets waved through." A flake that only appears under
// CI load is the same trap wearing different clothes.

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// ── Uint8Array.prototype.toHex / fromHex ────────────────────────────────────────────────────
// WHY THIS IS HERE, because it looks like a hack and is not one.
//
// `pdfjs-dist` ships separate node and browser builds. Vite resolves the BROWSER build, which is
// the one PRODUCTION loads, and it calls `Uint8Array.prototype.toHex` while computing a document
// fingerprint. That is a real, shipped browser API - and node has neither `toHex` nor `fromHex`.
// MEASURED 2026-09-15 as `undefined` on Node 22.21.1 AND Node 24.14.0, so this is a browser API
// missing from node, NOT a Node-version problem and NOT a pdf.js bug.
//
// Without it, every pdf.js parse under vitest dies with `hashOriginal.toHex is not a function`,
// which is why `extractPdfText` had zero automated coverage (ask 0d9f8fae). The previous
// diagnosis blamed the Node version and concluded no harness could run either build; both halves
// are refuted - plain node runs the main build fine on 22 and 24, and with this polyfill vitest
// runs it in BOTH the jsdom and node environments.
//
// It is defined only when absent, so a real browser (and any future node that ships it) keeps its
// own implementation and this never shadows the real thing.
for (const [target, key, impl] of [
  [Uint8Array.prototype, 'toHex', function (this: Uint8Array) {
    return Array.from(this, b => b.toString(16).padStart(2, '0')).join('');
  }],
  [Uint8Array, 'fromHex', function (hex: string) {
    return new Uint8Array((hex.match(/../g) ?? []).map(h => parseInt(h, 16)));
  }],
] as const) {
  if (!(key in target)) {
    Object.defineProperty(target, key, { value: impl, writable: true, configurable: true });
  }
}

// -- pdf.js worker: pinned to the real module file under test ---------------------------------
// `pdf-text.ts` sets `GlobalWorkerOptions.workerSrc` from
// `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`. That is a VITE BUILD-TIME
// REWRITE: in a real build Vite emits the worker as a local asset and rewrites the URL to it.
// Vitest does NOT perform that rewrite, so the URL resolves literally, next to the SOURCE file
// (`src/lib/pdfjs-dist/build/...`), which does not exist - and every parse dies as the generic
// "That file could not be read as a PDF." Leaving it EMPTY does not work either: pdf.js v6
// refuses with `No "GlobalWorkerOptions.workerSrc" specified`.
//
// So the harness pins it to the real file in node_modules - the same artefact the bundler would
// have emitted - and ignores the module's own write.
//
// WHAT THIS COSTS, said plainly: the worker LINE is then not exercised by any test here. That it
// resolves to a LOCAL asset, and not to a third party - which is the privacy promise this feature
// makes - is a BUNDLING fact that only a real build can show. Nothing in this suite is evidence
// about the worker.
{
  const { pathToFileURL } = await import('node:url');
  const { resolve } = await import('node:path');
  const pinned = pathToFileURL(
    resolve(process.cwd(), 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs'),
  ).href;
  const pdfjs = await import('pdfjs-dist');
  Object.defineProperty(pdfjs.GlobalWorkerOptions, 'workerSrc', {
    get: () => pinned,
    set: () => {},
    configurable: true,
  });
}

// ── NO TEST REACHES THE PRODUCTION DATABASE ─────────────────────────────────────────────────
// Measured 2026-10-02: every `test:tz` run inserted a burst of real `signup_funnel_events` rows
// (env 'dev', ~50 ms apart), 1,355 on 2026-10-01 alone, because tests render Auth with the real
// Supabase client and `.env.local` points it at production. That started on 2026-09-30, the same
// days the project's Disk IO budget climbed from ~0% to 84%.
// supabase-js captures `fetch` when the client is created, which happens at import time in the test
// file - after this setup file runs - so wrapping it here covers every client. A refused request
// behaves like an offline network: callers that swallow errors (the funnel tracker) do nothing.
// `blockedSupabaseRequests` lets a test assert that a path tried to call out.
const realFetch = globalThis.fetch;
const blockedHosts = /\.supabase\.(co|in)$/i;
export const blockedSupabaseRequests: string[] = [];
if (typeof realFetch === 'function') {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let host = '';
    try { host = new URL(raw).hostname; } catch { /* relative URL: not Supabase */ }
    if (blockedHosts.test(host)) {
      blockedSupabaseRequests.push(`${init?.method ?? 'GET'} ${new URL(raw).pathname}`);
      return Promise.reject(new TypeError('Network request to Supabase blocked in tests (test-setup.ts)'));
    }
    return realFetch(input, init);
  }) as typeof fetch;
}
