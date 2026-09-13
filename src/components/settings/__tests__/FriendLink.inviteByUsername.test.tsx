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
  invite: vi.fn(),
}));

vi.mock('@/hooks/useFriendLink', () => ({
  useFriendLink: () => ({
    loading: false, error: null, refetch: vi.fn(),
    friends: [], pendingInvites: [], namesUnavailable: false,
    invite: { mutate: mocks.invite, isPending: false },
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
  mocks.invite = vi.fn();
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

  it('⚠️ DOES NOT SEND IT DOWN THE EMAIL PATH — two different actions, two different servers rules', () => {
    renderCard();
    fireEvent.change(handleField(), { target: { value: 'jordan' } });
    fireEvent.click(addButton());
    expect(mocks.invite).not.toHaveBeenCalled();
  });

  it('leaves the email path working and separate', async () => {
    // The control. Without it, wiring both buttons to the username mutation would pass everything
    // above while breaking the only way to invite somebody who has no account yet.
    renderCard();
    fireEvent.change(screen.getByPlaceholderText("Friend's email address"), {
      target: { value: 'someone@example.com' },
    });
    fireEvent.click(screen.getByText('Send Invite'));
    await waitFor(() => expect(mocks.invite).toHaveBeenCalledWith('someone@example.com'));
    expect(mocks.inviteByUsername).not.toHaveBeenCalled();
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
