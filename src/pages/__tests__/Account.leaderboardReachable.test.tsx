// @vitest-environment jsdom
//
// THE LEADERBOARD IS REACHABLE WITH NO FRIENDS — which is the entire reason this tab exists.
//
// Tre asked for the leaderboard to be "created ASAP". It already existed: `FriendsLeaderboard`,
// three hooks, three libs and its own tests, rendering from `FriendLink.tsx` behind
// `friends.length > 0`, inside the Connections card, inside the Settings Account panel. So a user
// who wanted to SEE a leaderboard had no path to one, and a user with NO friends saw no hint it
// existed at all. The symptom was real; "create it" was the wrong inference, and building a second
// one would have been the expensive answer.
//
// ⚠️ SO THE TEST THAT MATTERS IS THE EMPTY ONE. With friends it would render either way. The
// regression this guards is the gate coming back — the board hidden until you already have the
// thing the board is for.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import Account from '../Account';

const mocks = vi.hoisted(() => ({ friends: [] as { userId: string; label: string; linkId: string }[] }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'owner@example.com' } }),
}));
vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({ data: { display_name: 'Owner' } }),
}));
vi.mock('@/hooks/useFriendLink', () => ({
  useFriendLink: () => ({ friends: mocks.friends, pendingInvites: [], loading: false }),
}));
// The two link cards own their own data and are covered by their own suites; this file is about
// whether the BOARD is reachable, so they are stubbed to keep the question single.
vi.mock('@/components/settings/PartnerLink', () => ({ PartnerLink: () => <div>Partner Link</div> }));
vi.mock('@/components/settings/FriendLink', () => ({ FriendLink: () => <div>Friends</div> }));
vi.mock('@/components/settings/FriendsLeaderboard', () => ({
  FriendsLeaderboard: ({ friends }: { friends: readonly unknown[] }) => (
    <div data-testid="leaderboard">
      {friends.length === 0 ? 'Nobody is sharing yet' : `${friends.length} sharing`}
    </div>
  ),
}));

const renderAccount = () => render(<MemoryRouter><Account /></MemoryRouter>);

afterEach(() => { cleanup(); mocks.friends = []; });

describe('the Account tab', () => {
  it('shows the leaderboard even with NO friends — the regression this exists to stop', () => {
    renderAccount();
    expect(screen.getByTestId('leaderboard')).toBeTruthy();
    expect(screen.getByText(/Nobody is sharing yet/i)).toBeTruthy();
  });

  it('passes the real friends list through once there are some', () => {
    mocks.friends = [{ userId: 'f1', label: 'Alex', linkId: 'l1' }];
    renderAccount();
    expect(screen.getByText('1 sharing')).toBeTruthy();
  });

  it('gathers the three things he named: profile, partner linking, friends', () => {
    renderAccount();
    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.getByText('Partner Link')).toBeTruthy();
    expect(screen.getByText('Friends')).toBeTruthy();
  });

  it('sends editing to Settings rather than growing a second copy of every control', () => {
    // Two screens that both edit the same thing are two screens that start disagreeing.
    renderAccount();
    expect(screen.getByRole('link', { name: /Settings/i }).getAttribute('href')).toBe('/settings');
  });
});
