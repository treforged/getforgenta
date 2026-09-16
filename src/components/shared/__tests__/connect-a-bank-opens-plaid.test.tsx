// @vitest-environment jsdom
//
// "CONNECT A BANK" OPENS PLAID. IT DOES NOT MERELY NAVIGATE.
//
// Tre, 2026-09-16: "the connect a bank, first connection is free, should automatically open plaid
// instead of just taking the user to the page." Before this, the dashboard notice's CTA was a plain
// `<Link to="/accounts">` - it landed the user on a page and asked them to find a second button.
//
// THE CHAIN THIS GUARDS, and it spans three files, which is exactly why one test holds it:
//   FreeBankLinkNotice  -> `/accounts?tab=banks&connect=1`
//   Accounts.tsx        -> reads `connect=1` once, STRIPS it, passes `autoOpen`
//   PlaidLinkButton     -> fires its click handler once on mount
// Any one of the three silently breaking leaves a CTA that navigates and does nothing else - which
// looks completely normal, and is the defect being fixed.
//
// ⚠️ WHY IT ROUTES THROUGH PlaidLinkButton RATHER THAN OPENING PLAID FROM THE NOTICE. That
// component's `onSuccess` writes real financial accounts. A second copy of that path would be two
// writers that can disagree about the same money, so the notice arms the existing button instead of
// duplicating it - and every guard the button already sits behind (the bank-link ceiling, demo
// mode) keeps applying untouched.
//
// WHAT THIS DOES NOT CATCH: whether Plaid's own widget actually opens (that needs their SDK, a link
// token and a network), whether the token endpoint succeeds, and anything about the native hosted
// flow. It proves the INTENT is carried end to end through our own code.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const state = {
  isDemo: false,
  loading: false,
  accounts: [] as Array<{ plaid_account_id: string | null; active: boolean }>,
};

vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: state.isDemo }) }));
vi.mock('@/hooks/useSupabaseData', () => ({
  useAccounts: () => ({ data: state.accounts, loading: state.loading }),
}));

import FreeBankLinkNotice from '../FreeBankLinkNotice';

beforeEach(() => {
  state.isDemo = false;
  state.loading = false;
  state.accounts = [];
  try { localStorage.clear(); } catch { /* private window */ }
});

describe('the dashboard CTA carries the command, not just a destination', () => {
  it('links to the banks panel AND asks for Plaid to open', () => {
    render(<MemoryRouter><FreeBankLinkNotice /></MemoryRouter>);
    const cta = screen.getByRole('link', { name: /connect a bank/i });
    const href = cta.getAttribute('href') ?? '';

    // Asserted as PARSED PARAMS rather than a string match, so re-ordering them or adding a third
    // does not fail a test that should not care.
    const query = new URLSearchParams(href.split('?')[1] ?? '');
    expect(href.startsWith('/accounts'), `CTA points at ${href}`).toBe(true);
    expect(query.get('connect'), 'without connect=1 the CTA only navigates - the exact defect').toBe('1');
    expect(query.get('tab'), 'the bank button lives only on the banks panel').toBe('banks');
  });
});

/**
 * The button half, in isolation. `PlaidLinkButton` reaches for Capacitor, the Supabase client and
 * Plaid's CDN script the moment it is clicked, so those are stubbed - the assertion here is ONLY
 * "did it try to start a link session, and how many times".
 */
describe('PlaidLinkButton opens once on autoOpen, and not at all without it', () => {
  async function mountButton(props: { autoOpen?: boolean; disabled?: boolean }) {
    vi.resetModules();
    const createLinkToken = vi.fn(async () => {
      throw new Error('stop here - starting the session is the whole assertion');
    });

    vi.doMock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
    vi.doMock('@capacitor/browser', () => ({ Browser: { open: vi.fn(), close: vi.fn() } }));
    vi.doMock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) } }));
    vi.doMock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
    vi.doMock('@/integrations/supabase/client', () => ({
      supabase: {
        auth: {
          refreshSession: async () => ({ data: { session: { access_token: 't' } } }),
          getSession: async () => ({ data: { session: { access_token: 't' } } }),
        },
      },
    }));

    // ⚠️ PRE-SET `window.Plaid`, OR THE CHAIN NEVER REACHES THE NETWORK. `handleClick` awaits
    // `loadPlaidScript()` first, which appends a <script> and waits for its onload - in jsdom that
    // never fires, so the handler hangs forever and a fetch-based assertion reads as "never
    // opened". That was this test's FIRST result, and it was measuring the harness rather than the
    // component. `loadPlaidScript` returns immediately when `window.Plaid` already exists.
    vi.stubGlobal('Plaid', { create: () => ({ open: vi.fn(), exit: vi.fn() }) });

    // The click handler's first network act is creating a link token. Counting THAT is what
    // separates "it tried to open Plaid" from "it rendered a button".
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('plaid-create-link-token')) {
        createLinkToken();
      }
      return { ok: false, json: async () => ({ error: 'stubbed' }) } as unknown as Response;
    }));

    const { default: PlaidLinkButton } = await import('../PlaidLinkButton');
    render(<PlaidLinkButton onSuccess={vi.fn()} {...props} />);
    // Let the mount effect and its async handler run.
    await new Promise((r) => setTimeout(r, 10));
    return createLinkToken;
  }

  it('POSITIVE CONTROL: autoOpen starts a link session', async () => {
    const started = await mountButton({ autoOpen: true });
    expect(started, 'autoOpen did not start a session - the CTA would navigate and do nothing').toHaveBeenCalled();
  });

  it('starts it EXACTLY ONCE, not once per render', async () => {
    const started = await mountButton({ autoOpen: true });
    // Two Plaid sessions over one intent is a worse bug than not opening at all: the second
    // widget opens over the first and neither is the one the user is answering.
    expect(started).toHaveBeenCalledTimes(1);
  });

  it('NEGATIVE CONTROL: without autoOpen it stays shut', async () => {
    const started = await mountButton({});
    // Without this, a component that opened Plaid on EVERY mount would satisfy both tests above.
    expect(started, 'Plaid opened on a surface nobody asked to connect from').not.toHaveBeenCalled();
  });

  it('NEGATIVE CONTROL: disabled beats autoOpen', async () => {
    const started = await mountButton({ autoOpen: true, disabled: true });
    expect(started).not.toHaveBeenCalled();
  });
});
