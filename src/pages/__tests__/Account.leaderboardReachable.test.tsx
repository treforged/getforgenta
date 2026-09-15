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
//
// ⚠️ UPDATED 2026-09-15, AND THE INTENT IS UNCHANGED. Tre asked for the leaderboard to become its
// own SECTION inside this tab, switched by the bar the app already uses. That does put it one press
// away rather than in the first screenful, so the guard is restated rather than relaxed: the
// SEGMENT must be on screen from the first paint (a section nobody can see the door to is the same
// invisibility, one level up), and pressing it must show the board WITH NO FRIENDS. Deleting these
// two assertions because the markup moved would have thrown away the only thing standing between
// this tab and the bug it was built to fix.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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

/** Open the Leaderboard section the way a user does: by pressing its segment. */
const openLeaderboard = () => fireEvent.click(screen.getByRole('tab', { name: /Leaderboard/i }));

afterEach(() => {
  cleanup();
  mocks.friends = [];
  // The section is remembered per device, so a test that left it on Leaderboard would hand the
  // next test a page it did not set up - and the "first paint" assertion below would be green
  // for the wrong reason.
  try { localStorage.removeItem('account-section'); } catch { /* ignore */ }
});

describe('the Account tab', () => {
  it('signposts the leaderboard from the first paint, before anything is pressed', () => {
    // A section reached by a door nobody can see is the same invisibility Tre reported, one
    // level up. The segment is what makes "one press away" true rather than "findable".
    renderAccount();
    expect(screen.getByRole('tab', { name: /Leaderboard/i })).toBeTruthy();
  });

  it('shows the leaderboard even with NO friends — the regression this exists to stop', () => {
    renderAccount();
    openLeaderboard();
    expect(screen.getByTestId('leaderboard')).toBeTruthy();
    expect(screen.getByText(/Nobody is sharing yet/i)).toBeTruthy();
  });

  it('passes the real friends list through once there are some', () => {
    mocks.friends = [{ userId: 'f1', label: 'Alex', linkId: 'l1' }];
    renderAccount();
    openLeaderboard();
    expect(screen.getByText('1 sharing')).toBeTruthy();
  });

  it('the two sections are genuinely different views, not one view behind two buttons', () => {
    // forged-glass shipped a tab whose two handlers set the same view: it threw nothing, so every
    // smoke test passed it and the pane was unreachable for every user. Asserting a CHANGE is the
    // only thing that catches that shape.
    renderAccount();
    expect(screen.queryByTestId('leaderboard')).toBeNull();
    expect(screen.getByText('Partner Link')).toBeTruthy();
    openLeaderboard();
    expect(screen.getByTestId('leaderboard')).toBeTruthy();
    expect(screen.queryByText('Partner Link')).toBeNull();
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
