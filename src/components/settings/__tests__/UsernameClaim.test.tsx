// @vitest-environment jsdom
//
// CLAIMING A HANDLE — and the two things about it that are security, not UX.
//
// Tre, 2026-09-13: "maybe we should do usernames instead or make that an option to add people by
// usernames." The rules, the migration and the unique index shipped in `a787279c` with ZERO callers
// anywhere in `src/`; this component is the caller, and these are its tests.
//
// ⚠️ THE ASSERTIONS THAT MATTER ARE THE TWO THAT LOOK LIKE COPY CHECKS.
//   1. "Taken" and "reserved" must be INDISTINGUISHABLE. A username is the one field designed to be
//      guessable, so a form that answers "nobody has this" vs "somebody does" is a tool for mapping
//      the user base one guess at a time.
//   2. The field must START EMPTY. Seeding it from the email address hands people a public handle
//      derived from their private one, and most would accept the default without reading it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  profile: {} as Record<string, unknown>,
  loading: false,
  updateAsync: vi.fn(),
}));

vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({
    data: mocks.profile,
    loading: mocks.loading,
    update: { mutateAsync: mocks.updateAsync },
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { UsernameClaim } from '../UsernameClaim';
import { USERNAME_UNAVAILABLE_MESSAGE } from '@/lib/username';

const field = () => screen.getByLabelText('Choose a username') as HTMLInputElement;
const claim = () => screen.getByText('Claim');

function type(value: string) {
  fireEvent.change(field(), { target: { value } });
}

beforeEach(() => {
  mocks.profile = { username: null, email: 'tre@treforged.com' };
  mocks.loading = false;
  mocks.updateAsync = vi.fn().mockResolvedValue({});
});
afterEach(cleanup);

describe('the form itself', () => {
  it('⚠️ STARTS EMPTY — never seeded from the email address', () => {
    render(<UsernameClaim />);
    expect(field().value).toBe('');
  });

  it('shows the claimed handle instead of the form once one exists', () => {
    mocks.profile = { username: 'jordan' };
    render(<UsernameClaim />);
    expect(screen.getByText('@jordan')).toBeTruthy();
    expect(screen.queryByLabelText('Choose a username')).toBeNull();
  });
});

describe('local rules are enforced before any round trip', () => {
  it('refuses a short handle and says the rule, without asking the server', async () => {
    render(<UsernameClaim />);
    type('ab');
    fireEvent.click(claim());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mocks.updateAsync).not.toHaveBeenCalled();
  });

  it('refuses a handle that does not start with a letter', async () => {
    render(<UsernameClaim />);
    type('_admin');
    fireEvent.click(claim());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mocks.updateAsync).not.toHaveBeenCalled();
  });

  it('normalises before writing — the stored handle is the lowered one', async () => {
    render(<UsernameClaim />);
    type('  Jordan  ');
    fireEvent.click(claim());
    await waitFor(() => expect(mocks.updateAsync).toHaveBeenCalled());
    expect(mocks.updateAsync).toHaveBeenCalledWith({ username: 'jordan' });
  });
});

describe('⚠️ ENUMERATION — taken and reserved must give the SAME answer', () => {
  it('says "not available" for a RESERVED handle', async () => {
    render(<UsernameClaim />);
    type('admin');
    fireEvent.click(claim());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(USERNAME_UNAVAILABLE_MESSAGE);
  });

  it('says the SAME for one somebody else already holds', async () => {
    // The database is what decides this — the unique index on lower(username) — so the failure
    // arrives as a 23505 rather than from a pre-check.
    mocks.updateAsync = vi.fn().mockRejectedValue({ code: '23505', message: 'duplicate key value' });
    render(<UsernameClaim />);
    type('jordan');
    fireEvent.click(claim());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(USERNAME_UNAVAILABLE_MESSAGE);
  });

  it('⚠️ AND A DIFFERENT FAILURE DOES NOT MASQUERADE AS "TAKEN" — the control', () => {
    // Without this, answering "not available" to everything would pass both cases above while
    // telling a user their handle is gone when the network simply dropped.
    mocks.updateAsync = vi.fn().mockRejectedValue({ code: '08006', message: 'connection failure' });
    render(<UsernameClaim />);
    type('jordan');
    fireEvent.click(claim());
    return waitFor(async () => {
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).not.toBe(USERNAME_UNAVAILABLE_MESSAGE);
      expect(alert.textContent).toMatch(/Nothing changed/);
    });
  });
});
