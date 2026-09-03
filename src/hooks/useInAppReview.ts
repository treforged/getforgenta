import { Capacitor } from '@capacitor/core';
import { InAppReview } from '@capacitor-community/in-app-review';
import {
  decideReviewPrompt, recordEvent, recordPrompt, parseReviewState,
} from '@/lib/review-moment';
import type { ValueEvent } from '@/lib/review-moment';

/**
 * The native review prompt, fired at a VALUE MOMENT rather than on an action count.
 *
 * WHAT THIS USED TO DO: count "positive actions" in `localStorage` and fire on the third one of
 * any kind. Its two call sites were "user created a budget rule" and "user created a savings
 * goal" — both of which are the user doing work FOR the app. It asked for a rating at the moment
 * of highest effort and lowest payoff, and because both stores silently rate-limit the prompt,
 * the one ask most users will ever see was being spent there.
 *
 * WHAT IT DOES NOW: callers report a fact — a goal reached, a debt cleared, a month that ended
 * above the floor, a first positive projection — and `review-moment.ts` decides. Which event was
 * chosen and why is decided by a pure function so it can be tested; this file only owns storage
 * and the platform call.
 *
 * Native only, and NEVER a homegrown modal. A custom "do you like the app?" sheet in front of the
 * real prompt is a dark pattern, is against both stores' guidelines, and is not needed: the
 * native dialog already handles the user who wants to say no.
 */

export const REVIEW_STATE_KEY = 'tre:review:state';

/** The pre-2026-09 keys. Read once, on migration, then never again. */
const LEGACY_DONE_KEY = 'tre:review:requested';
const LEGACY_COUNT_KEY = 'tre:review:actionCount';

function read() {
  try {
    const raw = localStorage.getItem(REVIEW_STATE_KEY);
    if (raw) return parseReviewState(JSON.parse(raw));
    // MIGRATION: a user who was already prompted under the old counter must not be prompted
    // again. Their store quota was spent even though this app's key has changed shape.
    const legacyDone = localStorage.getItem(LEGACY_DONE_KEY) === 'true';
    return parseReviewState(
      legacyDone ? { promptedAt: new Date(0).toISOString(), seenEvents: [] } : null,
    );
  } catch {
    return parseReviewState(null);
  }
}

function write(state: ReturnType<typeof read>): void {
  try {
    localStorage.setItem(REVIEW_STATE_KEY, JSON.stringify(state));
    // The old counter is dead weight the moment the new state exists.
    localStorage.removeItem(LEGACY_COUNT_KEY);
  } catch { /* a review prompt must never be the thing that breaks a page */ }
}

/**
 * Report every value moment that is true right now, and prompt on the loudest one if this is the
 * right time to ask.
 *
 * Takes the whole list rather than one at a time on purpose: two calls racing over the same
 * `localStorage` key could each read "not prompted yet" and both fire, spending two of the
 * store's small quota on one render.
 *
 * Safe to call on any render pass that can observe the facts — an event already recorded is never
 * news again.
 */
export async function reportValueEvents(events: readonly ValueEvent[]): Promise<void> {
  if (!Capacitor.isNativePlatform() || events.length === 0) return;

  const state = read();
  const decision = decideReviewPrompt(events, state, new Date());

  // Every reported fact is recorded whether or not it won, so none of them can be re-offered
  // later as if it were new.
  const seen = events.reduce(recordEvent, state);

  if (!decision.shouldPrompt) {
    write(seen);
    return;
  }

  // Written BEFORE the platform call, not after. If `requestReview` throws or the process dies
  // mid-dialog, the quota may already have been spent — and a second attempt would be invisible
  // anyway. Recording first is the honest assumption.
  write(recordPrompt(seen, new Date()));
  try {
    await InAppReview.requestReview();
  } catch {
    // Best-effort by design. The store decides whether anything is actually shown.
  }
}
