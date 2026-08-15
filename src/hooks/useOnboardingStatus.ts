/**
 * The route gate's read of "has this user finished setting up".
 *
 * `ProtectedRoute` used to answer this with a synchronous `localStorage` read, which is why a user
 * who onboarded on their laptop was handed the wizard again on their phone. The answer now comes
 * from `profiles.onboarding_completed` (see `src/lib/onboarding-state.ts`), with the local key
 * bridging the gap before the query resolves — a device that already knows never waits.
 *
 * Four states, deliberately: `unknown` is not `needs-onboarding`. If the profile read fails we let
 * the user through and let the Dashboard checklist nudge them, because re-running someone through a
 * wizard they already finished is the worse of the two failures.
 */

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import {
  applyOnboardingResolution,
  fetchOnboardingCompleted,
  readOnboardingCache,
  resolveOnboardingState,
  type OnboardingSource,
} from '@/lib/onboarding-state';

export type OnboardingGateStatus = 'pending' | 'onboarded' | 'needs-onboarding' | 'unknown';

export const onboardingQueryKey = (userId: string) => ['onboarding-completed', userId] as const;

export interface OnboardingStatus {
  status: OnboardingGateStatus;
  source: OnboardingSource;
}

export function useOnboardingStatus(): OnboardingStatus {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const userId = user?.id;

  const cacheDone = useMemo(() => (userId ? readOnboardingCache(userId) : false), [userId]);

  const query = useQuery({
    queryKey: onboardingQueryKey(userId ?? 'anonymous'),
    enabled: !!userId && !isDemo,
    queryFn: () => fetchOnboardingCompleted(userId!),
  });

  const settled = !!userId && !isDemo && !query.isPending;
  const resolution = resolveOnboardingState(settled ? query.data : undefined, cacheDone);

  // Migration and cache back-fill. Runs after the render that already used the resolution, so a
  // failed write cannot change what the user was shown.
  useEffect(() => {
    if (!userId || !settled) return;
    applyOnboardingResolution(userId, resolution);
  }, [userId, settled, resolution.writeCache, resolution.writeProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Demo mode never onboards: it is a canned account, and gating it would break the sales surface.
  if (isDemo || !userId) return { status: 'onboarded', source: 'profile' };
  if (!settled) return cacheDone ? { status: 'onboarded', source: 'cache' } : { status: 'pending', source: 'unknown' };
  if (resolution.gate) return { status: 'needs-onboarding', source: resolution.source };
  if (resolution.completed) return { status: 'onboarded', source: resolution.source };
  return { status: 'unknown', source: 'unknown' };
}
