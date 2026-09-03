// @vitest-environment jsdom
//
// The review prompt actually FIRED, not just decided.
//
// `review-moment.test.ts` covers the decision. This file covers the side effects, because the
// decision being right is worthless if the platform call never happens, happens twice, or happens
// for a user whose quota was already spent under the old counter. None of those are visible in
// production: the stores show nothing and report nothing when a prompt is refused.
//
// Would-fail checks: remove the native guard and "silent on the web" fails; write the state after
// the platform call instead of before and "records the spend even when the platform throws"
// fails; drop the legacy migration and "a user already prompted under the old counter is not
// asked again" fails — which is the case that would burn a real user's quota twice.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ isNative: true, throwOnRequest: false }));
const requestReview = vi.hoisted(() => vi.fn());

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => state.isNative },
}));

vi.mock('@capacitor-community/in-app-review', () => ({
  InAppReview: {
    requestReview: async () => {
      requestReview();
      if (state.throwOnRequest) throw new Error('store said no');
    },
  },
}));

import { reportValueEvents, REVIEW_STATE_KEY } from '@/hooks/useInAppReview';
import { parseReviewState } from '@/lib/review-moment';

const stored = () => parseReviewState(JSON.parse(localStorage.getItem(REVIEW_STATE_KEY) ?? 'null'));

beforeEach(() => {
  localStorage.clear();
  state.isNative = true;
  state.throwOnRequest = false;
  requestReview.mockClear();
});

describe('reportValueEvents', () => {
  it('fires the native prompt at a value moment, once', async () => {
    await reportValueEvents(['debt_cleared']);
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(stored().promptedAt).not.toBeNull();
    expect(stored().seenEvents).toContain('debt_cleared');
  });

  it('does not fire again on a later value moment — the quota is spent', async () => {
    await reportValueEvents(['debt_cleared']);
    await reportValueEvents(['goal_reached']);
    expect(requestReview).toHaveBeenCalledTimes(1);
    // The second fact is still recorded, so it can never be re-offered as if it were new.
    expect(stored().seenEvents).toEqual(expect.arrayContaining(['debt_cleared', 'goal_reached']));
  });

  it('records EVERY reported fact, not only the one that won', async () => {
    await reportValueEvents(['goal_reached', 'debt_cleared', 'first_positive_projection']);
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(stored().seenEvents).toEqual(
      expect.arrayContaining(['goal_reached', 'debt_cleared', 'first_positive_projection']),
    );
  });

  it('records the spend even when the platform call throws', async () => {
    state.throwOnRequest = true;
    await expect(reportValueEvents(['goal_reached'])).resolves.toBeUndefined();
    // The quota may already be gone; assuming it is not would ask again into a silent refusal.
    expect(stored().promptedAt).not.toBeNull();
  });

  it('is silent on the web, where there is no store to ask', async () => {
    state.isNative = false;
    await reportValueEvents(['debt_cleared']);
    expect(requestReview).not.toHaveBeenCalled();
    expect(localStorage.getItem(REVIEW_STATE_KEY)).toBeNull();
  });

  it('does nothing when nothing happened', async () => {
    await reportValueEvents([]);
    expect(requestReview).not.toHaveBeenCalled();
  });

  it('does NOT re-ask a user already prompted under the old action counter', async () => {
    // The pre-2026-09 keys, as they exist on a real device today.
    localStorage.setItem('tre:review:requested', 'true');
    localStorage.setItem('tre:review:actionCount', '3');

    await reportValueEvents(['goal_reached']);

    expect(requestReview).not.toHaveBeenCalled();
    expect(stored().promptedAt).not.toBeNull();
    // And the dead counter is cleared once the new state exists.
    expect(localStorage.getItem('tre:review:actionCount')).toBeNull();
  });

  it('still asks a user who had the counter but was never prompted', async () => {
    localStorage.setItem('tre:review:actionCount', '2');
    await reportValueEvents(['goal_reached']);
    expect(requestReview).toHaveBeenCalledTimes(1);
  });
});
