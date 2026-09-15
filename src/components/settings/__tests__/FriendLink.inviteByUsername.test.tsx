// @vitest-environment jsdom
//
// ADDING A FRIEND BY HANDLE — the press, and the one thing this file must NOT do.
//
// Tre, 2026-09-13: "maybe we should do usernames instead or or make that an option to add people by
// usernames."
//
// ⚠️ THE IMPORTANT ASSERTION IS THE LAST ONE: this screen must never look a handle up on its own.
// `profiles` SELECT is own-row only (verified against the live policies on 2026-09-13), so the edge
// function's service-role lookup is the ONLY oracle that exists — and it is rate-limited into the
// shared invite budget. A "helpful" availability check through PostgREST here would be an
// unlimited oracle sitting beside a deliberately limited one, which is the whole defence undone by
// a convenience.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  inviteByUsername: vi.fn(),
}));

vi.mock('@/hooks/useFriendLink', () => ({
  useFriendLink: () => ({
    loading: false, error: null, refetch: vi.fn(),
    friends: [], pendingInvites: [], namesUnavailable: false,
    inviteByUsername: { mutate: mocks.inviteByUsername, isPending: false },
    accept: { mutate: vi.fn(), isPending: false },
    revoke: { mutate: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/components/settings/LeaderboardShareToggles', () => ({
  LeaderboardShareToggles: () => null,
}));
vi.mock('@/components/settings/FriendsLeaderboard', () => ({ FriendsLeaderboard: () => null }));
vi.mock('@/components/settings/UsernameClaim', () => ({ UsernameClaim: () => null }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => { throw new Error('FriendLink must not query the database directly'); },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MemoryRouter } from 'react-router';
import { FriendLink } from '../FriendLink';

const renderCard = () => render(<MemoryRouter><FriendLink /></MemoryRouter>);
const handleField = () => screen.getByLabelText("Friend's username");
const addButton = () => screen.getByText('Add by username');

beforeEach(() => {
  mocks.inviteByUsername = vi.fn();
});
afterEach(cleanup);

describe('adding a friend by username', () => {
  it('sends the handle the user typed', async () => {
    renderCard();
    fireEvent.change(handleField(), { target: { value: 'jordan' } });
    fireEvent.click(addButton());
    await waitFor(() => expect(mocks.inviteByUsername).toHaveBeenCalledWith('jordan'));
  });

  it('refuses to send an empty handle', () => {
    renderCard();
    fireEvent.click(addButton());
    expect(mocks.inviteByUsername).not.toHaveBeenCalled();
  });

  /*
   * ⚠️ A TEST WAS DELETED HERE ON 2026-09-15, deliberately, rather than left green.
   * It asserted that pressing "Add by username" did not call the EMAIL mutation. That mutation no
   * longer exists, and this file MOCKS the hook - so keeping it would have meant keeping an
   * `invite` key in the mock that the real hook does not return, and asserting a mock function
   * nothing could ever call. That is a test which is green about a shape that cannot exist, kept
   * alive only by the mock agreeing with it.
   * The durable guard lives in `useFriendLink.test.tsx`, against the REAL hook.
   */

  it('THE EMAIL PATH IS GONE — usernames only, with a positive control beside the absence', async () => {
    /**
     * ⚠️ THIS TEST USED TO ASSERT THE OPPOSITE. It was the control proving both buttons were not
     * wired to one mutation, and it named the email path "the only way to invite somebody who has
     * no account yet". Tre removed that path on 2026-09-15 ("usernames only"), and THAT CAPABILITY
     * IS GENUINELY GONE - a friend must now have an account and a claimed handle.
     *
     * The absence alone would also pass on a card that rendered nothing, so the username path is
     * exercised in the same test and must still fire.
     */
    renderCard();
    expect(screen.queryByPlaceholderText("Friend's email address")).toBeNull();
    expect(screen.queryByText('Send Invite')).toBeNull();

    fireEvent.change(handleField(), { target: { value: 'jordan' } });
    fireEvent.click(addButton());
    await waitFor(() => expect(mocks.inviteByUsername).toHaveBeenCalledWith('jordan'));
  });

  it('⚠️ NEVER QUERIES THE DATABASE ITSELF — the supabase mock throws if it tries', () => {
    // An availability check here would be an unlimited enumeration oracle beside the rate-limited
    // one. The mock turns that into a failure rather than a code-review note.
    expect(() => {
      renderCard();
      fireEvent.change(handleField(), { target: { value: 'jordan' } });
      fireEvent.click(addButton());
    }).not.toThrow();
  });
});
