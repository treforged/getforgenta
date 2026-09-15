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
import Account from '../Account';

const FRIEND = { userId: 'f1', label: 'Alex', linkId: 'l1' };

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'owner@example.com' } }),
}));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({ data: { display_name: 'Owner' } }),
}));
vi.mock('@/hooks/useFriendLink', () => ({
  useFriendLink: () => ({
    loading: false, error: null, refetch: vi.fn(),
    friends: [FRIEND], pendingInvites: [], namesUnavailable: false,
    invite: { mutate: vi.fn(), isPending: false },
    inviteByUsername: { mutate: vi.fn(), isPending: false },
    accept: { mutate: vi.fn(), isPending: false },
    revoke: { mutate: vi.fn(), isPending: false },
  }),
}));
// Everything EXCEPT FriendLink is stubbed. FriendLink is the component under suspicion, so it is
// the one thing that must be real.
vi.mock('@/components/settings/PartnerLink', () => ({ PartnerLink: () => <div>Partner Link</div> }));
vi.mock('@/components/settings/LeaderboardShareToggles', () => ({ LeaderboardShareToggles: () => null }));
vi.mock('@/components/settings/UsernameClaim', () => ({ UsernameClaim: () => null }));
vi.mock('@/components/settings/FriendsLeaderboard', () => ({
  FriendsLeaderboard: () => <div data-testid="leaderboard">the board</div>,
}));

const renderAccount = () => render(<MemoryRouter><Account /></MemoryRouter>);
const openLeaderboard = () => fireEvent.click(screen.getByRole('tab', { name: /Leaderboard/i }));

afterEach(() => {
  cleanup();
  try { localStorage.removeItem('account-section'); } catch { /* ignore */ }
});

describe('the leaderboard has one home on the Account tab', () => {
  it('does not render the board in the Profile section, even with a friend', () => {
    renderAccount();
    // The real FriendLink is mounted here — proven by its own copy being on screen — so a null
    // board is a fact about the mount and not about the card failing to render.
    expect(screen.getByText(/Add friends to cheer each other on/i)).toBeTruthy();
    expect(screen.queryAllByTestId('leaderboard')).toHaveLength(0);
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
