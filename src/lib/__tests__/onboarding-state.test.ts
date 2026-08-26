// @vitest-environment jsdom
/**
 * Onboarding used to have TWO completion stores: `localStorage['forged:onboarding_done_<uid>']`
 * (the /onboarding route's gate) and `profiles.onboarding_completed` (the modal wizard's).
 * Finishing one surface left the other convinced the user had not started, so people who
 * completed setup were shown a second setup. These tests pin the merge:
 *
 *   - the profile is truth, the local key is a cache and a MIGRATION source
 *   - a legacy local "done" beats a profile `false` (and gets written up)
 *   - a profile we could not READ never gates anyone back into the wizard
 *
 * The last one is the honesty rule: an unreadable profile is missing evidence, not evidence
 * of "not done", and re-running a finished user through onboarding is the worse failure.
 */

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';

const updateEq = vi.fn();
const selectMaybeSingle = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      update: () => ({ eq: updateEq }),
      select: () => ({ eq: () => ({ maybeSingle: selectMaybeSingle }) }),
    }),
  },
}));

import {
  onboardingCacheKey,
  readOnboardingCache,
  writeOnboardingCache,
  clearOnboardingCache,
  resolveOnboardingState,
  fetchOnboardingCompleted,
  markOnboardingComplete,
  ONBOARDING_FETCH_TIMEOUT_MS,
} from '../onboarding-state';

const USER = 'user-abc';

beforeEach(() => {
  localStorage.clear();
  updateEq.mockReset();
  selectMaybeSingle.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the local cache key', () => {
  it('keeps the spelling App.tsx already gates on', () => {
    // Renaming this would orphan every existing user's flag and re-run their onboarding.
    expect(onboardingCacheKey(USER)).toBe('forged:onboarding_done_user-abc');
  });

  it('round-trips per user and never leaks between users', () => {
    writeOnboardingCache(USER);
    expect(readOnboardingCache(USER)).toBe(true);
    expect(readOnboardingCache('someone-else')).toBe(false);
    clearOnboardingCache(USER);
    expect(readOnboardingCache(USER)).toBe(false);
  });

  it('reads false rather than throwing when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readOnboardingCache(USER)).toBe(false);
  });
});

describe('resolveOnboardingState — precedence', () => {
  it('trusts a profile flag of true and back-fills the cache', () => {
    const r = resolveOnboardingState(true, false);
    expect(r).toMatchObject({ completed: true, gate: false, source: 'profile', writeCache: true, writeProfile: false });
  });

  it('does not rewrite a cache that already agrees', () => {
    expect(resolveOnboardingState(true, true)).toMatchObject({ completed: true, writeCache: false, writeProfile: false });
  });

  it('MIGRATES a legacy local done over a profile false, and writes the profile up', () => {
    // The route wizard only ever wrote localStorage. Those users are finished.
    const r = resolveOnboardingState(false, true);
    expect(r).toMatchObject({ completed: true, gate: false, source: 'cache', writeProfile: true, writeCache: false });
  });

  it('gates only when BOTH stores say not done', () => {
    const r = resolveOnboardingState(false, false);
    expect(r).toMatchObject({ completed: false, gate: true, source: 'profile', writeProfile: false, writeCache: false });
  });
});

describe('resolveOnboardingState — failure fallback', () => {
  it('falls back to the cache when the profile could not be read', () => {
    const r = resolveOnboardingState(null, true);
    expect(r).toMatchObject({ completed: true, gate: false, source: 'cache' });
    // Nothing is written up: we do not know what the profile says.
    expect(r.writeProfile).toBe(false);
    expect(r.writeCache).toBe(false);
  });

  it('never gates on an unreadable profile, even with no cache', () => {
    const r = resolveOnboardingState(null, false);
    expect(r.gate).toBe(false);
    // ...and it does not claim completion either. Missing evidence is its own state.
    expect(r.completed).toBe(false);
    expect(r.source).toBe('unknown');
  });

  it('treats undefined (still loading) the same as unreadable', () => {
    expect(resolveOnboardingState(undefined, false)).toMatchObject({ gate: false, completed: false, source: 'unknown' });
  });
});

describe('fetchOnboardingCompleted', () => {
  it('returns the stored flag', async () => {
    selectMaybeSingle.mockResolvedValue({ data: { onboarding_completed: true }, error: null });
    await expect(fetchOnboardingCompleted(USER)).resolves.toBe(true);
  });

  it('reads a missing profile row as "not onboarded", not as unknown', async () => {
    // No row can only mean a brand-new account; it must still see the wizard.
    selectMaybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(fetchOnboardingCompleted(USER)).resolves.toBe(false);
  });

  it('reads a null column as "not onboarded"', async () => {
    selectMaybeSingle.mockResolvedValue({ data: { onboarding_completed: null }, error: null });
    await expect(fetchOnboardingCompleted(USER)).resolves.toBe(false);
  });

  it('returns null — unknown — when the query errors', async () => {
    // supabase-js RETURNS errors, so this is the branch an unchecked call would silently
    // turn into "false" and re-gate a finished user.
    selectMaybeSingle.mockResolvedValue({ data: null, error: { message: 'network' } });
    await expect(fetchOnboardingCompleted(USER)).resolves.toBeNull();
  });

  it('returns null when the client throws', async () => {
    selectMaybeSingle.mockRejectedValue(new Error('offline'));
    await expect(fetchOnboardingCompleted(USER)).resolves.toBeNull();
  });

  it('resolves null — unknown — instead of hanging when the read never settles', async () => {
    // A request that neither responds nor errors used to leave the route gate pending forever.
    // The bound resolves it to "could not read", which never gates and never claims completion.
    vi.useFakeTimers();
    try {
      selectMaybeSingle.mockReturnValue(new Promise(() => {}));
      const result = fetchOnboardingCompleted(USER);
      await vi.advanceTimersByTimeAsync(ONBOARDING_FETCH_TIMEOUT_MS + 1);
      await expect(result).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not time out a read that answers in time', async () => {
    vi.useFakeTimers();
    try {
      selectMaybeSingle.mockResolvedValue({ data: { onboarding_completed: true }, error: null });
      await expect(fetchOnboardingCompleted(USER)).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('markOnboardingComplete', () => {
  it('writes the profile and the cache together', async () => {
    updateEq.mockResolvedValue({ error: null });
    await expect(markOnboardingComplete(USER)).resolves.toEqual({ ok: true });
    expect(readOnboardingCache(USER)).toBe(true);
  });

  it('does NOT cache completion when the profile write fails', async () => {
    // A failed save must not look like a finished setup on this device.
    updateEq.mockResolvedValue({ error: { message: 'permission denied' } });
    const result = await markOnboardingComplete(USER);
    expect(result.ok).toBe(false);
    expect(readOnboardingCache(USER)).toBe(false);
  });

  it('reports a thrown client error as a failure', async () => {
    updateEq.mockRejectedValue(new Error('offline'));
    await expect(markOnboardingComplete(USER)).resolves.toMatchObject({ ok: false });
    expect(readOnboardingCache(USER)).toBe(false);
  });
});
