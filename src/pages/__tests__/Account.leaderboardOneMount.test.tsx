// @vitest-environment jsdom
//
// THE LEADERBOARD IS MOUNTED EXACTLY ONCE ON THIS TAB — both directions, in one file.
//
// Tre, 2026-09-15 (ask `a0328857`): the leaderboard content was ALSO appearing in the Account
// section. `4b217aea` gave the board its own section and MOVED nothing: `FriendLink` kept its own
// `friends.length > 0` mount, and `FriendLink` renders inside the Profile section of this very
// tab. So a user with a friend saw the board twice on one screen.
//
// ⚠️ WHY THE EXISTING REACHABILITY SUITE COULD NOT CATCH IT. `Account.leaderboardReachable.test.tsx`
// STUBS `FriendLink` out entirely, because its question is whether the board is reachable. The
// duplicate lived INSIDE the real `FriendLink`, so no assertion in that file could ever see it.
// This file renders the REAL card for exactly that reason.
//
// ⚠️ THE ABSENCE ASSERTION IS PAIRED WITH A POSITIVE CONTROL, in the same file and against the same
// marker: "the board is not in Profile" and "this test cannot find the board anywhere" are the same
// green otherwise. The control presses through to the Leaderboard section and requires it there.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Account from '../Account';

const FRIEND = { userId: 'f1', label: 'Alex', linkId: 'l1' };

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'owner@example.com' } }),
}));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({ data: { display_name: 'Owner' } }),
}));
// `useFriendLink` was mocked here until 2026-09-17. The hook and its component are deleted,
// and mocking a module that no longer resolves fails at import - which empties a whole test
// file rather than failing one assertion.
// Everything EXCEPT FriendLink is stubbed. FriendLink is the component under suspicion, so it is
// the one thing that must be real.
// ⚠️ ADDED 2026-09-17. The Followers section brought a react-query subtree onto this page
// (`useFollows`, and `useAccountVisibility` inside the still-real `FriendLink`). Without these
// the page throws "No QueryClient set" before a single assertion can speak — a harness fault,
// not an information-architecture disagreement, and the two must not be confused.
vi.mock('@/hooks/useFollows', () => ({
  useFollows: () => ({
    mutuals: [], following: [], followers: [], incomingRequests: [], outgoingRequests: [],
    isLoading: false,
    labelFor: (id: string) => id,
    requestFollow: vi.fn(), approveRequest: vi.fn(), removeFollow: vi.fn(),
    findByUsername: vi.fn(),
  }),
}));
vi.mock('@/hooks/useAccountVisibility', () => ({
  useAccountVisibility: () => ({
    visibility: 'private', isLoading: false, isPublic: false,
    setVisibility: vi.fn(), isUpdating: false,
  }),
}));
vi.mock('@/components/settings/PartnerLink', () => ({ PartnerLink: () => <div>Partner Link</div> }));
vi.mock('@/components/settings/LeaderboardShareToggles', () => ({ LeaderboardShareToggles: () => null }));
vi.mock('@/components/settings/UsernameClaim', () => ({ UsernameClaim: () => null }));
vi.mock('@/components/settings/FriendsLeaderboard', () => ({
  FriendsLeaderboard: () => <div data-testid="leaderboard">the board</div>,
}));

// A QueryClientProvider is required, not decorative: the Find-someone field mounts
// `UsernameSuggestions`, which calls `useQuery`. Without a provider React Query throws
// "No QueryClient set" and every arm below - including the positive control - fails for a reason
// that has nothing to do with the leaderboard. The real app has one provider at the root.
const renderAccount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><Account /></MemoryRouter>
    </QueryClientProvider>,
  );
const openLeaderboard = () => fireEvent.click(screen.getByRole('tab', { name: /Leaderboard/i }));

afterEach(() => {
  cleanup();
  try { localStorage.removeItem('account-section'); } catch { /* ignore */ }
});

describe('the leaderboard has one home on the Account tab', () => {
  /**
   * ⚠️ RESTATED 2026-09-17, AND THE CONTROL MOVED WITH THE CARD. Tre: "friends should be
   * followers and following just like instagram. it should only be on that tab." `FriendLink`
   * now renders inside the FOLLOWERS section, not Profile — so the old positive control looked
   * for its copy on a section that no longer holds it.
   *
   * The control is kept, not dropped: without it a null board is indistinguishable from
   * `FriendLink` failing to render at all, and the defect this file exists to catch is a SECOND
   * board mounted inside that card. So both sections are checked, and the section that owns the
   * card proves the card is live.
   */
  it('does not render the board in the Profile section, even with a friend', () => {
    renderAccount();
    expect(screen.queryAllByTestId('leaderboard'), 'a board rendered in Profile').toHaveLength(0);

    // ⚠️ THE CONTROL MOVED WITH THE CARD, AGAIN. It used to look for FriendLink's own copy; that
    // card was removed on 2026-09-17 as a duplicate of "Find someone". The control is NOT dropped,
    // because without one a null board is indistinguishable from the Profile section failing to
    // render at all - which is the reading that would send somebody hunting in the wrong file.
    // The real FollowersPanel is mounted here (only its children are stubbed), so its own heading
    // is the honest proof that this section painted.
    expect(screen.getByText(/Find someone/i), 'the Profile section did not render at all').toBeTruthy();
    expect(screen.queryAllByTestId('leaderboard'), 'a board rendered inside the followers surface').toHaveLength(0);
  });

  it('POSITIVE CONTROL: the same marker IS found in the Leaderboard section', () => {
    renderAccount();
    openLeaderboard();
    expect(screen.getAllByTestId('leaderboard')).toHaveLength(1);
  });

  it('never renders it twice at once, whichever section is open', () => {
    renderAccount();
    expect(screen.queryAllByTestId('leaderboard').length).toBeLessThanOrEqual(1);
    openLeaderboard();
    expect(screen.queryAllByTestId('leaderboard')).toHaveLength(1);
  });
});
