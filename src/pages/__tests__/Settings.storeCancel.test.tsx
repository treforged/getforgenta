// @vitest-environment jsdom
//
// 5874c945 - A STORE SUBSCRIBER CAN FIND CANCEL ON THE PLAN CARD, PRESSED ON THE REAL PAGE.
//
// Before this, an App Store or Google Play subscriber's Plan card showed a status and a renewal
// date and nothing else; the store's cancel steps were only inside Delete Account. The harness is
// Settings.securityControls.test.tsx's, with the subscription made switchable per case.
// Each case opens the Plan tab and reads the link the user would press. The Stripe case is the
// control: its own Cancel control stays, and no store link appears.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  // ClearMerchantMemory renders in the Danger Zone (Tre, 2026-09-13) and reads both of these.
  // Empty data means it renders nothing, which is what this suite wants — it is about the
  // security controls, and the clear has its own tests.
  useAllSyncedTransactions: () => ({ data: [] }),
  useSyncedTransactionReviews: () => ({ setCategory: { mutateAsync: vi.fn() } }),
}));

vi.mock('@/hooks/useMerchantMemory', () => ({
  useMerchantMemory: () => ({ rules: {}, reviewsByCharge: {}, suppressed: {}, setSuppressed: vi.fn(), isLoading: false }),
}));

vi.mock('@/hooks/useAppliedActions', () => ({
  useAppliedActions: () => ({
    actions: [], latest: null, isLoading: false,
    record: { mutateAsync: vi.fn() }, markUndone: { mutateAsync: vi.fn() },
    stepsOf: () => [], undoneChargeIds: new Set<string>(), undoneUnknown: false,
  }),
}));

const sub = vi.hoisted(() => ({ provider: null as null | string }));
vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    subscription: sub.provider === null ? null : {
      purchase_provider: sub.provider, subscription_status: 'active', plan: 'premium',
      current_period_end: '2026-12-01T00:00:00Z', cancel_at_period_end: false,
    },
    isPremium: sub.provider !== null, hasStripeCustomer: sub.provider === 'stripe', isLoading: false, refetch: vi.fn(),
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
    // Added 2026-09-13 with invite-by-username. A missing key here does not fail as "missing
    // mock" — it fails as `Cannot read properties of undefined (reading 'isPending')` across
    // EIGHT unrelated cases about 2FA and trusted devices, which is a long way from the cause.
    inviteByUsername: { mutate: vi.fn(), isPending: false },
    accept: { mutate: vi.fn(), isPending: false },
    revoke: { mutate: vi.fn(), isPending: false },
  }),
}));

// ⚠️ ADDED 2026-09-17. `Account.tsx` now calls `useFollows`, which calls `useQueryClient`, so
// rendering the real page without this throws "No QueryClient set" before a single assertion in
// this describe block can speak. Nine tests across two files went red on that one cause and NONE
// of them was disagreeing about the information architecture — worth writing down, because the
// handoff read them as IA failures and rewriting them that way would have deleted working guards.
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
import { APPLE_MANAGE_URL, GOOGLE_MANAGE_URL } from '@/components/settings/StoreSubscriptionManage';

const withQuery = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

async function openPlan() {
  render(withQuery(<MemoryRouter><SettingsPage /></MemoryRouter>));
  fireEvent.click(await screen.findByRole('tab', { name: /Plan/i }));
  await screen.findByText('Premium Active');
}

afterEach(() => { cleanup(); sub.provider = null; });

describe('5874c945 store subscribers can find cancel on the Plan card', () => {
  it("App Store: the link renders and points at Apple's subscription page", async () => {
    sub.provider = 'apple';
    await openPlan();
    const link = screen.getByRole('link', { name: /Manage or cancel in App Store/i });
    expect(link.getAttribute('href')).toBe(APPLE_MANAGE_URL);
    expect(APPLE_MANAGE_URL).toBe('https://apps.apple.com/account/subscriptions');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.queryByRole('link', { name: /Google Play/i })).toBeNull();
  });

  it("Google Play: the link renders and points at this app's Play subscriptions page", async () => {
    sub.provider = 'google';
    await openPlan();
    const link = screen.getByRole('link', { name: /Manage or cancel in Google Play/i });
    expect(link.getAttribute('href')).toBe(GOOGLE_MANAGE_URL);
    expect(GOOGLE_MANAGE_URL).toContain('play.google.com/store/account/subscriptions');
    expect(GOOGLE_MANAGE_URL).toContain('package=com.treforged.forged');
  });

  it('control - Stripe: its own Cancel control stays, and no store link appears', async () => {
    sub.provider = 'stripe';
    await openPlan();
    expect(screen.getByRole('button', { name: /Cancel subscription/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Manage or cancel/i })).toBeNull();
  });
});
