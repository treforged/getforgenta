// @vitest-environment jsdom
//
// CHANGING A HANDLE, AND BEING TOLD WHEN YOU CAN CHANGE IT AGAIN.
//
// Tre, 2026-09-15 (ask `23c07655`): "allowing users to edit their username twice every seven days."
//
// ⚠️ THE FIRST FINDING WAS THAT THERE WAS NO WAY TO CHANGE ONE AT ALL. Once `profile.username`
// existed this component returned a read-only line, so the limit he asked for would have been a
// gate in front of a wall. The edit affordance is half the ask, and the first case below is the
// one that would have caught its absence.
//
// ⚠️ THE LIMIT ITSELF IS NOT TESTED HERE, AND SAYING SO MATTERS. It lives in a Postgres trigger,
// because `20260913_profile_usernames.sql` grants `update (username)` to every authenticated user
// and a handle can be PATCHed straight to PostgREST without this screen running. What these cases
// assert is that the UI RECOGNISES the refusal and surfaces its unlock time rather than replacing
// it with "could not save that right now". The trigger's own behaviour - the third change inside
// the window, clear-and-reclaim, the free first claim - was proven against the live database.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const state = {
  username: 'takenhandle' as string | null,
  reject: null as { message?: string; details?: string; code?: string } | null,
};
const updated: Array<Record<string, unknown>> = [];

vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({
    data: { username: state.username },
    loading: false,
    update: {
      mutateAsync: async (patch: Record<string, unknown>) => {
        if (state.reject) throw state.reject;
        updated.push(patch);
        return patch;
      },
    },
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { UsernameClaim } from '../UsernameClaim';

beforeEach(() => {
  state.username = 'takenhandle';
  state.reject = null;
  updated.length = 0;
});
afterEach(cleanup);

describe('changing a username', () => {
  it('offers a way to change one you already have', () => {
    render(<UsernameClaim />);
    expect(screen.getByText('@takenhandle')).toBeTruthy();
    // The assertion that would have failed before 2026-09-15: the handle rendered, and nothing
    // on the screen could alter it.
    expect(screen.getByRole('button', { name: /change/i })).toBeTruthy();
  });

  it('sends the new handle, seeded from the current one rather than from an email', () => {
    render(<UsernameClaim />);
    fireEvent.click(screen.getByRole('button', { name: /change/i }));
    const field = screen.getByLabelText('Choose a username') as HTMLInputElement;
    expect(field.value).toBe('takenhandle');
    fireEvent.change(field, { target: { value: 'newhandle' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    return waitFor(() => expect(updated).toEqual([{ username: 'newhandle' }]));
  });

  it('names the unlock time when the database refuses the third change', async () => {
    state.reject = { message: 'USERNAME_CHANGE_LIMIT', details: '2026-09-22T15:09:22Z' };
    render(<UsernameClaim />);
    fireEvent.click(screen.getByRole('button', { name: /change/i }));
    fireEvent.change(screen.getByLabelText('Choose a username'), { target: { value: 'newhandle' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/twice every seven days/i);
    // The half that makes it a wait rather than a wall.
    expect(alert.textContent).toMatch(/unlocks/i);
    expect(alert.textContent).not.toMatch(/could not save/i);
  });

  it("degrades to the rule rather than printing an unparseable date", async () => {
    // ⚠️ THIS CASE IS NOT HYPOTHETICAL - IT CAUGHT A REAL ONE. The trigger first emitted
    // `to_char(..., 'OF')`, which renders `+00`; ECMA-262 accepts `Z` or `+HH:MM` and nothing
    // else, so every refusal arrived as an Invalid Date and fell through to this branch, losing
    // the unlock time the whole feature was asked for. The database now emits a `Z` instant. The
    // degrade stays, because a wrong date is worse than no date.
    // A wrong date is worse than no date: "Invalid Date" tells somebody to retry at a moment that
    // does not exist.
    state.reject = { message: 'USERNAME_CHANGE_LIMIT', details: 'not-a-timestamp' };
    render(<UsernameClaim />);
    fireEvent.click(screen.getByRole('button', { name: /change/i }));
    fireEvent.change(screen.getByLabelText('Choose a username'), { target: { value: 'newhandle' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/twice every seven days/i);
    expect(alert.textContent).not.toMatch(/invalid date/i);
  });

  it('POSITIVE CONTROL: an unrelated failure still reads as a generic failure', async () => {
    // Without this, a component that showed the limit message for EVERY error would pass every
    // assertion above.
    state.reject = { message: 'network unreachable' };
    render(<UsernameClaim />);
    fireEvent.click(screen.getByRole('button', { name: /change/i }));
    fireEvent.change(screen.getByLabelText('Choose a username'), { target: { value: 'newhandle' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not save/i);
    expect(alert.textContent).not.toMatch(/seven days/i);
  });
});
