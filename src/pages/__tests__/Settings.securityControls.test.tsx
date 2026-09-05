// @vitest-environment jsdom
//
// The Security tab's three "remove a linked thing" controls, PRESSED rather than read.
//
// Symmetry pass (2026-09-05): Linked Accounts' Unlink, Trusted Devices' Revoke, and
// Two-Factor's factor-remove used three different visual treatments — a bordered pill, a
// bare underlined link, and an icon-only ghost button — so a user could not tell they did
// the same kind of thing. They were unified onto the majority bordered-pill shape. This
// file exists so that unification is proven to still DO what each one did before, not just
// look like the others now. A class-only diff that quietly dropped an onClick would pass
// every visual read and fail here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));

// ── Supabase: one shared mock, both auth and the `profiles` row ────────────────────────
// `vi.hoisted` because `vi.mock` factories are hoisted above every other statement in the
// file — a plain `const` above them is still "not yet initialized" when the factory runs.
const mocks = vi.hoisted(() => {
  const state = {
    identities: [
      { provider: 'email' },
      { provider: 'google', identity_data: { email: 'owner@gmail.com' } },
    ] as { provider: string; identity_data?: { email: string } }[],
    mfaFactors: {
      totp: [{ id: 'factor-1', friendly_name: 'Authenticator App', factor_type: 'totp', status: 'verified' }],
      phone: [] as never[],
    },
    profileUpdateCalls: [] as unknown[],
    // A STABLE reference. `useProfile`'s consumer effect keys off `[profile]` by identity —
    // a mock that returns a fresh object literal every render re-fires that effect every
    // render, which is an infinite loop, not a slow test. This object is only ever mutated
    // in place, never reassigned.
    profileData: {
      display_name: 'Owner', currency: 'USD', weekly_gross_income: 1875, budget_start_day: 1,
      show_cents: true, compact_mode: false, tax_rate: 22, cash_floor: 1000,
      paycheck_frequency: 'weekly', paycheck_day: 5, paycheck_start_date: '', default_deposit_account: '',
      auto_generate_recurring: true,
      trusted_devices: [{
        device_id: 'dev-1', name: 'Chrome on Windows',
        trusted_at: '2026-08-01T00:00:00Z', last_seen: '2026-08-02T00:00:00Z',
      }],
    },
  };
  return {
    state,
    linkIdentity: vi.fn(async () => ({ error: null })),
    unlinkIdentity: vi.fn(async () => ({ error: null })),
    mfaUnenroll: vi.fn(async ({ factorId }: { factorId: string }) => {
      state.mfaFactors = { totp: state.mfaFactors.totp.filter(f => f.id !== factorId), phone: [] };
      return { error: null };
    }),
    mfaEnroll: vi.fn(async () => ({
      data: { totp: { qr_code: 'data:image/png;base64,fake', secret: 'ABCDEFGHIJKLMNOP' }, id: 'factor-new' },
      error: null,
    })),
  };
});
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1', identities: mocks.state.identities } } })),
      linkIdentity: mocks.linkIdentity,
      unlinkIdentity: mocks.unlinkIdentity,
      mfa: {
        listFactors: vi.fn(async () => ({ data: mocks.state.mfaFactors, error: null })),
        enroll: mocks.mfaEnroll,
        challenge: vi.fn(async () => ({ data: { id: 'chal-1' }, error: null })),
        verify: vi.fn(async () => ({ error: null })),
        unenroll: mocks.mfaUnenroll,
      },
    },
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ count: 0, data: null, error: null }) }),
      update: (payload: unknown) => ({
        eq: () => {
          mocks.state.profileUpdateCalls.push(payload);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  },
}));

// Plain names for use inside the test bodies below (module eval has fully finished by then).
const { state, linkIdentity, unlinkIdentity, mfaUnenroll, mfaEnroll } = mocks;

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'owner@example.com' } }),
}));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));

vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({
    data: mocks.state.profileData,
    loading: false,
    update: { mutate: vi.fn(), isPending: false },
  }),
  useAccounts: () => ({ data: [] }),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    subscription: null, isPremium: false, hasStripeCustomer: false, isLoading: false, refetch: vi.fn(),
  }),
}));

// Not this slice's controls — mocked so the render doesn't depend on their own network/edge
// function plumbing. Their own suites (useFriendLink.test.tsx, usePartnerLink.test.tsx) cover them.
vi.mock('@/hooks/usePartnerLink', () => ({
  usePartnerLink: () => ({
    loading: false, error: null, refetch: vi.fn(),
    activeLink: null, pendingInvite: null, partnerUserId: null, partnerLabel: null,
    invite: { mutate: vi.fn(), isPending: false },
    accept: { mutate: vi.fn(), isPending: false },
    revoke: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/hooks/useFriendLink', () => ({
  useFriendLink: () => ({
    loading: false, error: null, refetch: vi.fn(),
    friends: [], pendingInvites: [], namesUnavailable: false,
    invite: { mutate: vi.fn(), isPending: false },
    accept: { mutate: vi.fn(), isPending: false },
    revoke: { mutate: vi.fn(), isPending: false },
  }),
}));

vi.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve(null) }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => children,
  PaymentElement: () => null,
  useStripe: () => null,
  useElements: () => null,
}));

const toastFns = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastFns }));

import SettingsPage from '../Settings';

async function renderSecurityTab() {
  render(<MemoryRouter><SettingsPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: /Security/i }));
  // Section headers only exist once the panel has actually switched.
  await screen.findByText('Linked Accounts');
}

beforeEach(() => {
  state.identities = [{ provider: 'email' }, { provider: 'google', identity_data: { email: 'owner@gmail.com' } }];
  state.mfaFactors = { totp: [{ id: 'factor-1', friendly_name: 'Authenticator App', factor_type: 'totp', status: 'verified' }], phone: [] };
  state.profileUpdateCalls.length = 0;
  linkIdentity.mockClear();
  unlinkIdentity.mockClear();
  mfaUnenroll.mockClear();
  mfaEnroll.mockClear();
  toastFns.success.mockClear();
});
afterEach(cleanup);

describe('the Security tab, one card, three remove controls', () => {
  it('Linked Accounts: Unlink still calls unlinkIdentity, Link still calls linkIdentity', async () => {
    await renderSecurityTab();

    // Google is already linked (per the mock) — its control is "Unlink".
    fireEvent.click(screen.getByRole('button', { name: /Unlink/i }));
    await waitFor(() => expect(unlinkIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google' }),
    ));

    // Apple is not linked — its control is "Link".
    fireEvent.click(screen.getByRole('button', { name: /^Link$/i }));
    await waitFor(() => expect(linkIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'apple' }),
    ));
  });

  it('Trusted Devices: Revoke still writes the device out of the profile and the row disappears', async () => {
    await renderSecurityTab();

    expect(screen.getByText('Chrome on Windows')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Revoke/i }));

    await waitFor(() => expect(state.profileUpdateCalls.length).toBe(1));
    expect(state.profileUpdateCalls[0]).toEqual({ trusted_devices: [] });
    await waitFor(() => expect(screen.getByText('No trusted devices yet.')).toBeTruthy());
    expect(screen.queryByText('Chrome on Windows')).toBeNull();
  });

  it('Two-Factor: Remove still calls mfa.unenroll and the factor disappears', async () => {
    await renderSecurityTab();

    expect(screen.getByText('Authenticator App')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));

    await waitFor(() => expect(mfaUnenroll).toHaveBeenCalledWith({ factorId: 'factor-1' }));
    await waitFor(() => expect(screen.getByText('Add Authenticator App')).toBeTruthy());
  });

  it('Two-Factor: Add Authenticator App still opens the QR enrollment view', async () => {
    state.mfaFactors = { totp: [], phone: [] };
    await renderSecurityTab();

    fireEvent.click(await screen.findByRole('button', { name: /Add Authenticator App/i }));
    await waitFor(() => expect(mfaEnroll).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Scan with your authenticator app')).toBeTruthy();
  });

  it('none of the three controls dropped below the text-xs floor', () => {
    // A regression guard for the hard constraint itself: nothing in these four files may
    // reintroduce an arbitrary sub-xs text class. Source-string check rather than a computed
    // style read, because jsdom does not apply Tailwind's generated CSS at all.
    const src = [
      readFileSync(path.resolve(here, '../../components/settings/LinkedAccounts.tsx'), 'utf8'),
      readFileSync(path.resolve(here, '../../components/settings/TwoFactorAuth.tsx'), 'utf8'),
      readFileSync(path.resolve(here, '../../components/settings/PartnerLink.tsx'), 'utf8'),
      readFileSync(path.resolve(here, '../../components/settings/FriendLink.tsx'), 'utf8'),
    ].join('\n');
    expect(src).not.toMatch(/text-\[(9|10|11)px\]/);
  });
});
