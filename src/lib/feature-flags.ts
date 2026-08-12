/**
 * Build-time feature flags.
 *
 * These are deliberately plain constants rather than env vars: flipping one is a
 * reviewable, committed change, which is what we want for a gate that exists for
 * policy/compliance reasons rather than for experimentation.
 */

/**
 * Forgenta AI (the AI advisor) is switched OFF while the user-data-sharing
 * policy and account-level accessibility controls are being finished.
 *
 * While this is `false`, `/ai` renders the "in development" screen and the
 * `AiAdvisor` page is never mounted. That matters: mounting it would read the
 * user's transactions, debts, goals, accounts and car funds and forward them to
 * the `ai-advisor` edge function. Gating at the route keeps that data in place
 * instead of merely hiding the result.
 *
 * To re-enable: flip this to `true`. Nothing else needs to change — the nav
 * entries and the route both read this flag.
 */
export const AI_ADVISOR_ENABLED = false;

/**
 * `/__error-test` — a route that crashes on purpose, for proving the error
 * tracking + session replay pipeline reaches the dashboard.
 *
 * It lives here rather than beside the component so that App.tsx can read the
 * flag WITHOUT statically importing the component: importing it there would
 * defeat the `lazy()` and pull the debug page into the main bundle for every
 * user, which is the opposite of what a dev-only route should do.
 *
 * Off in production unless `VITE_ENABLE_ERROR_TEST=1`. Set it on a preview
 * deploy to prove the production path (minified bundle resolved through source
 * maps), then unset it — a route that deliberately breaks the app should not be
 * reachable by a real user who mistypes a URL.
 */
export const ERROR_TEST_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_ERROR_TEST === '1';
