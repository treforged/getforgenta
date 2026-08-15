// @vitest-environment jsdom
/**
 * The route gate, per user class. These are the four people the onboarding consolidation had to get
 * right, and the two that mattered most are the ones who had ALREADY finished setup on one of the
 * two old surfaces — showing them a wizard again is the bug this slice exists to remove.
 *
 * The real `onboarding-state` module runs here; only supabase and the two contexts are faked, so a
 * change to the precedence rules shows up as a change in what the gate does.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Every test gets its own user id: the migration write is deliberately fire-and-forget, so a write
// belonging to one test could otherwise land during the next one and be read as that test's.
let USER_ID = 'user-0';
let testIndex = 0;

let profileRow: { onboarding_completed: boolean | null } | null = null;
let profileError: { message: string } | null = null;
const updateSpy = vi.fn();
let isDemo = false;

/** Profile updates recorded per user, so an assertion only ever sees its own test's write. */
const updatesFor = (userId: string) =>
  updateSpy.mock.calls.filter(([, id]) => id === userId).map(([payload]) => payload);

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profileRow, error: profileError }) }) }),
      update: (payload: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => { updateSpy(payload, id); return { error: null }; },
      }),
    }),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: USER_ID }, loading: false }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo }) }));

import { useOnboardingStatus } from '../useOnboardingStatus';
import { onboardingCacheKey, readOnboardingCache } from '@/lib/onboarding-state';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  localStorage.clear();
  USER_ID = `user-${++testIndex}`;
  profileRow = null;
  profileError = null;
  isDemo = false;
  updateSpy.mockReset();
});

describe('useOnboardingStatus — who gets sent to /onboarding', () => {
  it('a brand-new user is gated', async () => {
    profileRow = { onboarding_completed: false };
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('needs-onboarding'));
  });

  it('a user who finished the OLD MODAL wizard is not gated, and this device is taught the answer', async () => {
    // Their completion only ever existed in the profile — no localStorage key anywhere.
    profileRow = { onboarding_completed: true };
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('onboarded'));
    expect(result.current.source).toBe('profile');
    await waitFor(() => expect(readOnboardingCache(USER_ID)).toBe(true));
  });

  it('a user who finished the OLD ROUTE wizard is not gated, and gets migrated up to the profile', async () => {
    // The localStorage-only case: the route wizard never wrote the profile flag.
    localStorage.setItem(onboardingCacheKey(USER_ID), '1');
    profileRow = { onboarding_completed: false };
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });
    expect(result.current.status).toBe('onboarded'); // immediately — no wait, no flash of the wizard
    await waitFor(() => expect(updatesFor(USER_ID)).toContainEqual({ onboarding_completed: true }));
  });

  it('never gates when the profile could not be read', async () => {
    profileError = { message: 'network' };
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('unknown'));
    expect(updatesFor(USER_ID)).toEqual([]);
  });

  it('demo mode is never gated and never queried', async () => {
    isDemo = true;
    profileRow = { onboarding_completed: false };
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });
    expect(result.current.status).toBe('onboarded');
    expect(updatesFor(USER_ID)).toEqual([]);
  });
});
