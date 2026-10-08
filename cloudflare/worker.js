/**
 * The web app's only Worker code (ask 8a5268d9). It exists for ONE reason: a missing chunk must be
 * a 404, never index.html.
 *
 * ⚠️ MEASURED 2026-10-08 under `wrangler dev`: with `not_found_handling: single-page-application`
 * and NO Worker script, a module request for /assets/nope-c2.js answered 200 text/html - the exact
 * shape of the 2026-09-24 blank-screen incident (vite.config.ts, the `-c2` suffix comment).
 *
 * How it stays free: a request that MATCHES a file is served from assets without invoking this.
 * A NAVIGATION miss (Sec-Fetch-Mode: navigate, compatibility_date >= 2025-04-01) gets index.html
 * without invoking this. Only a non-navigation MISS reaches here, and it gets a 404.
 */
export default {
  async fetch() {
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  },
};
