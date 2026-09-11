/**
 * The App Store / Play Store reviewer account, in ONE place.
 *
 * ⚠️ WHY THIS FILE EXISTS. This constant used to live inline in AuthContext.tsx. On
 * 2026-04-27 the Forgenta rebrand (`e4f16170`) ran a find-and-replace across the tree
 * and rewrote it from `reviewer@treforged.com` to `reviewer@getforgenta.com`. The
 * auth user was created 2026-04-18 and was never renamed, so from that commit the
 * sign-in comparison `session.user.email === REVIEWER_EMAIL` was false for the only
 * reviewer account that exists — and the reviewer-account reset silently stopped
 * running for 136 days.
 *
 * It raised nothing. The branch simply resolved to `Promise.resolve()` and the app
 * navigated on, so every store reviewer since April signed into an account that was
 * already onboarded and never saw first-run. A wrong constant fails toward doing
 * NOTHING, which is why no gate, no test and no error log ever mentioned it.
 *
 * Two defences, and neither is a comment:
 *  1. One definition. A future brand rename touches this file, not five call sites.
 *  2. `scripts/reset-reviewer-account.mjs` RESOLVES this address against auth.users
 *     and exits non-zero when it matches no row — so the drift becomes a loud
 *     failure the next time anyone runs a reset, instead of a quiet no-op.
 */
export const REVIEWER_EMAIL = 'reviewer@treforged.com';

/**
 * The columns that define "first-run state" for the reviewer, and the values they
 * must hold afterwards. The reset writes these and then reads them back; the walk
 * is only meaningful if both are false.
 */
export const REVIEWER_FIRST_RUN_PROFILE = {
  founder_note_seen: false,
  onboarding_completed: false,
} as const;
