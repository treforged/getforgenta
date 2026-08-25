import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';

/**
 * The read lens: WHOSE data every read query renders (docs/partner-linking-design.md §2).
 *
 * `viewedUserId` defaults to the signed-in user's own id and only ever differs after an
 * explicit `switchTo(partnerUserId)` — the partner-view lens a premium user with an active
 * `partner_links` row can flip on. Reads key and filter on it; MUTATIONS NEVER TOUCH IT.
 * Every write in the app stays pinned to `user.id` and refuses outright while
 * `isPartnerView` is true (see useSupabaseData's guards), so the lens is read-only by
 * construction on the client and by RLS on the server (partner policies are SELECT-only).
 *
 * ⚠️ SESSION-SCOPED ON PURPOSE — plain React state, no localStorage, no sessionStorage, no
 * usePersistedState. Reopening the app must always show YOUR OWN money first (design §2).
 * A test greps this file to keep persistence out.
 *
 * ⚠️ FAILS CLOSED. The default context value (used when no provider is mounted, e.g. in
 * unit tests of unrelated components) reports `viewedUserId: undefined, isPartnerView:
 * false`, and every consumer falls back to `user.id` — so a missing provider can only ever
 * show a user their own data, never someone else's.
 */
type ViewedProfileContextType = {
  /** Whose data reads should render. `undefined` until signed in; own id by default. */
  viewedUserId: string | undefined;
  /** True only while the lens points at the partner. Every mutation guard checks this. */
  isPartnerView: boolean;
  /** Point the lens at the partner. No-op in demo, and for self/empty ids. */
  switchTo: (partnerUserId: string) => void;
  /** Point the lens back at the signed-in user's own data. */
  switchBack: () => void;
};

const ViewedProfileContext = createContext<ViewedProfileContextType>({
  viewedUserId: undefined,
  isPartnerView: false,
  switchTo: () => {},
  switchBack: () => {},
});

export function ViewedProfileProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  // The lens carries the id of the OWNER it was set for. A lens whose owner is not the
  // current user is inert — so sign-out, sign-in, or an account switch structurally
  // resets the view to self, with no effect and no window where a stale lens applies.
  const [lens, setLens] = useState<{ ownerId: string; partnerId: string } | null>(null);

  const userId = user?.id;

  const switchTo = useCallback((id: string) => {
    // Demo renders fixtures and a static partner teaser — the lens has nothing to point at.
    if (isDemo || !userId) return;
    // Switching to yourself (or to nothing) is switching back.
    if (!id || id === userId) {
      setLens(null);
      return;
    }
    setLens({ ownerId: userId, partnerId: id });
  }, [isDemo, userId]);

  const switchBack = useCallback(() => setLens(null), []);

  const activePartnerId = lens !== null && lens.ownerId === userId ? lens.partnerId : null;
  const isPartnerView = !isDemo && !!userId && activePartnerId !== null;
  const viewedUserId = isPartnerView ? (activePartnerId as string) : userId;

  const value = useMemo(
    () => ({ viewedUserId, isPartnerView, switchTo, switchBack }),
    [viewedUserId, isPartnerView, switchTo, switchBack],
  );

  return (
    <ViewedProfileContext.Provider value={value}>
      {children}
    </ViewedProfileContext.Provider>
  );
}

export function useViewedProfile(): ViewedProfileContextType {
  return useContext(ViewedProfileContext);
}
