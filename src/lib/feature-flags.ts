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
