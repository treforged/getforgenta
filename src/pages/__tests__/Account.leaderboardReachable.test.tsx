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

const mocks = vi.hoisted(() => ({ mutuals: [] as { userId: string; label: string }[] }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'owner@example.com' } }),
}));
vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({ data: { display_name: 'Owner' } }),
}));
// `useFriendLink` was mocked here until 2026-09-17. The hook and its component are deleted,
// and mocking a module that no longer resolves fails at import - which empties a whole test
// file rather than failing one assertion.
// ⚠️ THE BOARD'S DATA SOURCE MOVED, 2026-09-17. It used to read `friends` from `useFriendLink`
// (an accepted friend-LINK). It now reads `mutuals` from `useFollows` — people you follow who
// follow you back. That is the whole point of the consolidation Tre asked for, and it is a
// SECURITY property as much as an IA one: a one-directional follow must never put somebody on
// your board, or a public account shows its buckets to any stranger who presses Follow. So this
// file drives `mutuals`, and a mock that returned one-directional follows here would quietly
// un-test the thing that matters.
vi.mock('@/hooks/useFollows', () => ({
  useFollows: () => ({
    mutuals: mocks.mutuals,
    following: [], followers: [], incomingRequests: [], outgoingRequests: [],
    isLoading: false,
    labelFor: (id: string) => id,
    requestFollow: vi.fn(), approveRequest: vi.fn(), removeFollow: vi.fn(),
    findByUsername: vi.fn(),
  }),
}));
// The two link cards own their own data and are covered by their own suites; this file is about
// whether the BOARD is reachable, so they are stubbed to keep the question single.
vi.mock('@/components/settings/PartnerLink', () => ({ PartnerLink: () => <div>Partner Link</div> }));
vi.mock('@/components/settings/FriendLink', () => ({ FriendLink: () => <div>Friends</div> }));
// The Followers section owns finding, following, approving and the public/private switch, and has
// its own suite plus `npm run check:followers`. Stubbed here so this file stays about REACHABILITY.
vi.mock('@/components/settings/FollowersPanel', () => ({
  FollowersPanel: () => <div data-testid="followers-panel">Followers</div>,
}));
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
  mocks.mutuals = [];
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

  it('passes the real MUTUALS list through once there are some', () => {
    mocks.mutuals = [{ userId: 'f1', label: 'Alex' }];
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

  /**
   * ⚠️ RESTATED AGAIN 2026-09-17 23:44, AND THE SECTION COUNT WENT DOWN RATHER THAN THE
   * ASSERTION GOING AWAY. Tre: "the friend section shouldn't exist anymore. Move it back up. The
   * following tab and profile tab can be combined now put what's on the followers tab below
   * what's the partner linking that's on the profile tab. Keep the username in change section at
   * the top."
   *
   * So there is no Followers SEGMENT any more, and the three things he originally named are now
   * STACKED in one Profile section. Dropping the assertion because the segment went would have
   * left nothing checking that any of them arrived - and "it is not a tab any more" is satisfied
   * perfectly by the whole surface being deleted.
   *
   * ⚠️ THE ORDER IS PART OF THE ASK, so it is asserted as an ORDER and not as three presences.
   * Username first, then partner linking, then the followers surface. Three `getByText` calls
   * would pass just as happily with the stack upside down.
   */
  it('stacks the three things he named in his order, in one Profile section', () => {
    renderAccount();
    expect(screen.getByText('Owner')).toBeTruthy();

    const body = document.body.textContent ?? '';
    const iUsername = body.indexOf('Username');
    const iPartner = body.indexOf('Partner Link');
    const iFollowers = body.indexOf('Followers');

    expect(iUsername, 'the Username section is missing').toBeGreaterThan(-1);
    expect(iPartner, 'Partner Link is missing').toBeGreaterThan(-1);
    expect(iFollowers, 'the Followers surface is missing').toBeGreaterThan(-1);

    expect(iUsername, 'username must be at the top').toBeLessThan(iPartner);
    expect(iPartner, 'the followers surface goes BELOW partner linking').toBeLessThan(iFollowers);
  });

  it('no longer offers a separate Followers segment', () => {
    // The other half of "move it back up": it is not a tab, it is a block on the Profile section.
    renderAccount();
    expect(screen.queryByRole('tab', { name: /^Followers$/i })).toBeNull();
    // POSITIVE CONTROL: the bar still exists and still has its other segments, so this is not
    // passing because the whole PanelBar vanished.
    expect(screen.getByRole('tab', { name: /Profile/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Leaderboard/i })).toBeTruthy();
  });

  it('sends editing to Settings rather than growing a second copy of every control', () => {
    // Two screens that both edit the same thing are two screens that start disagreeing.
    renderAccount();
    expect(screen.getByRole('link', { name: /Settings/i }).getAttribute('href')).toBe('/settings');
  });
});
