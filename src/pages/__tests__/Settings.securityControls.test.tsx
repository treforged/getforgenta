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

/**
 * ITEM 20 — SYMMETRY ACROSS THE SECTIONS OF THE SECURITY TAB.
 *
 * The header markup was already identical in all seven places, and that WAS the problem: identical
 * by copy, across five files, with nothing holding it that way. What had drifted was everything
 * around it — Change Email, Change Password and Two-Factor carried no description at all while the
 * others did, and Change Email's button was `px-3 py-2` against `px-2.5 py-1` everywhere else.
 *
 * These tests are about the SHAPE, not the wording. They assert that every section on the tab has a
 * heading and an explaining sentence under it, so the next section cannot ship without one.
 */
describe('the Security tab, one shape per section', () => {
  const SECTIONS = [
    'Change Email',
    'Linked Accounts',
    'Partner Link',
    'Friends',
    'Two-Factor Authentication',
    'Trusted Devices',
    'Change Password',
  ];

  it('every section has a heading AND a sentence explaining what it does', async () => {
    await renderSecurityTab();

    for (const title of SECTIONS) {
      const heading = screen.getByText(title);
      // The shared heading renders <div.flex><Icon/><span>title</span></div> then the blurb <p> as
      // the next sibling of that row. A section with no description has no such <p>.
      const row = heading.closest('div.flex.items-center.gap-2');
      expect(row, `${title} has no heading row`).toBeTruthy();
      const blurb = row!.nextElementSibling;
      expect(blurb?.tagName, `${title} has no description under its heading`).toBe('P');
      // A SENTENCE, not just any <p>. Change Email's next sibling used to be "Current: <address>",
      // which is a value and not an explanation — a looser assertion would have passed against the
      // exact gap this fixed. Eight words and a full stop is the cheapest test for "explains".
      const text = (blurb?.textContent ?? '').trim();
      expect(text.endsWith('.'), `${title}'s description is not a sentence: "${text}"`).toBe(true);
      expect(text.split(/\s+/).length, `${title}'s description is too short: "${text}"`).toBeGreaterThanOrEqual(8);
    }
  });

  it('states what each security control actually shares, since that is what a person is deciding', async () => {
    await renderSecurityTab();
    // Spot-checked on the two whose consequence is least guessable from two words.
    expect(screen.getByText(/read only/i)).toBeTruthy();
    expect(screen.getByText(/never see your budget/i)).toBeTruthy();
  });

  it('one button size across the tab — nothing left on the old px-3 py-2', () => {
    const src = readFileSync(path.resolve(here, '../Settings.tsx'), 'utf8');
    const securityPanel = src.slice(src.indexOf("panel === 'security'"), src.indexOf('Danger Zone'));
    expect(securityPanel).not.toMatch(/px-3 py-2 text-xs font-medium bg-secondary/);
  });

  /**
   * ITEM 6 — THE `btn` VOCABULARY, ON THIS SURFACE.
   *
   * 13e43d50 measured 456 `<button>` elements across 88 files carrying 380 DISTINCT class strings,
   * and only 18 of them declaring a tap target at all. Settings was the densest at 24. The point of
   * the rollout is the tap target: `btn` sets `min-height: 44px`, relaxed to 32px only under
   * `(pointer: fine)`, so a thumb gets a thumb-sized control and a cursor does not waste the space.
   *
   * ⚠️ THESE TESTS PRESS. The Auth migration before this one was verified in the stylesheet and
   * never pressed, because `/auth` redirects to `/dashboard` while signed in — so "migrated" meant
   * "the classes changed" and nothing more. The class assertion below is the cheap half; the tests
   * above, which click Unlink, Revoke, Remove and Add Authenticator App and assert the handler ran,
   * are what say the migration did not break them.
   */
  it('the migrated buttons carry the shared vocabulary and inherit its 44px tap target', async () => {
    await renderSecurityTab();
    for (const name of [/Send Verification/i, /Update Password/i]) {
      const el = screen.getByRole('button', { name });
      expect(el.className.split(/\s+/), `${name} was not migrated`).toContain('btn');
      expect(el.className).toMatch(/btn-(sm|md|lg|block)/);
    }
  });

  it('no migrated button re-declares what `btn` already gives it', () => {
    const src = readFileSync(path.resolve(here, '../Settings.tsx'), 'utf8');
    // `btn` already applies btn-press, transition-colors, disabled:opacity-50, the radius and the
    // flex centring. A migrated button repeating them is how 380 distinct strings happened.
    const migrated = src.match(/className="btn [^"]*"/g) ?? [];
    expect(migrated.length).toBeGreaterThan(10);
    for (const cls of migrated) {
      expect(cls, `redundant utility left on: ${cls}`).not.toMatch(/btn-press|transition-colors|disabled:opacity-50/);
    }
  });

  it('the heading has ONE implementation — no section hand-rolls its own again', () => {
    const files = [
      '../../components/settings/LinkedAccounts.tsx',
      '../../components/settings/TwoFactorAuth.tsx',
      '../../components/settings/PartnerLink.tsx',
      '../../components/settings/FriendLink.tsx',
    ].map(f => readFileSync(path.resolve(here, f), 'utf8'));
    for (const src of files) {
      expect(src).toMatch(/SettingsSection/);
    }
  });
});
