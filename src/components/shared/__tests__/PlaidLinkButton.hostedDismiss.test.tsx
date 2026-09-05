// @vitest-environment jsdom
//
// THE BLANK PAGE THAT NEVER CLOSED — pressed, on the native hosted-link path.
//
// Live on 2026-09-05, on Tre's iPhone. He went through Plaid's hosted flow, pressed Allow
// for Robinhood, and the in-app sheet showed a blank white page and never closed. The link
// had SUCCEEDED — his accounts were already adopted server-side — so he was looking at what
// appeared to be a failure while it had worked. That is the worst failure shape there is,
// because a person who believes it broke will link again, and re-linking is what creates the
// duplicate connections this codebase has spent weeks cleaning up.
//
// The first test below IS that scenario: the sheet opens, the redirect NEVER fires, the user
// never dismisses it, and only the server knows the session completed. Before the fix nothing
// closed the sheet and the exchange never ran. Revert the while-open poll and this test hangs
// on its own assertions rather than passing quietly.
//
// These press the flow rather than reading it: Browser.open, Browser.close and the exchange
// call are all observed, and the assertions are about what was CALLED, not about a label.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  isNative: true,
  browserOpened: [] as string[],
  browserClosed: 0,
  /** Listeners the component registered, so a test can fire them — or deliberately not. */
  appUrlListeners: [] as ((e: { url: string }) => void)[],
  browserFinishedListeners: [] as (() => void)[],
  /** What `plaid-hosted-link-result` answers, in order. The last entry repeats. */
  resultStatuses: [] as { status: string; public_token?: string; institution_id?: string; institution_name?: string }[],
  calls: [] as string[],
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.isNative },
}));

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: async ({ url }: { url: string }) => { h.browserOpened.push(url); },
    close: async () => { h.browserClosed += 1; },
    addListener: async (_ev: string, cb: () => void) => {
      h.browserFinishedListeners.push(cb);
      return { remove: () => {} };
    },
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_ev: string, cb: (e: { url: string }) => void) => {
      h.appUrlListeners.push(cb);
      return { remove: () => {} };
    },
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      refreshSession: async () => ({ data: { session: { access_token: 'tok' } } }),
      getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
    },
  },
}));

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }));

import PlaidLinkButton from '@/components/shared/PlaidLinkButton';

/** One canned response per endpoint, recording every call so the test can assert the flow. */
function installFetch() {
  let resultIndex = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = String(url).split('/functions/v1/')[1] ?? String(url);
    h.calls.push(path);
    if (path === 'plaid-create-link-token') {
      return { ok: true, json: async () => ({ link_token: 'lt-1', hosted_link_url: 'https://secure.plaid.com/x' }) };
    }
    if (path === 'plaid-hosted-link-result') {
      const next = h.resultStatuses[Math.min(resultIndex, h.resultStatuses.length - 1)];
      resultIndex += 1;
      return { ok: true, json: async () => next };
    }
    if (path === 'plaid-exchange-token') {
      return { ok: true, json: async () => ({ institution_name: 'Robinhood' }) };
    }
    if (path === 'plaid-sync') {
      return { ok: true, json: async () => ({ accounts: [{ name: 'Robinhood individual', balance: 1, type: 'investment' }] }) };
    }
    return { ok: true, json: async () => ({}) };
  }));
}

describe('native hosted link — the sheet must close on the SERVER signal, not only on a redirect', () => {
  beforeEach(() => {
    h.isNative = true;
    h.browserOpened = []; h.browserClosed = 0;
    h.appUrlListeners = []; h.browserFinishedListeners = [];
    h.calls = [];
    h.resultStatuses = [];
    installFetch();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('closes the sheet and finishes the link when Plaid never redirects back', async () => {
    // Plaid answers "pending" once, then "completed". No appUrlOpen is ever fired and the
    // user never dismisses the sheet — exactly the blank-page case.
    h.resultStatuses = [
      { status: 'pending' },
      { status: 'completed', public_token: 'pub-1', institution_id: 'ins_54', institution_name: 'Robinhood' },
    ];
    const onSuccess = vi.fn();
    render(<PlaidLinkButton onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(h.browserOpened).toHaveLength(1), { timeout: 4000 });
    // Nothing has told the app the flow finished. Before the fix, this is where it stopped.
    expect(h.browserClosed).toBe(0);

    // The while-open poll finds the completed session and closes the sheet ITSELF.
    await waitFor(() => expect(h.browserClosed).toBeGreaterThan(0), { timeout: 10000 });
    await waitFor(() => expect(h.calls).toContain('plaid-exchange-token'), { timeout: 10000 });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled(), { timeout: 10000 });
  }, 20000);

  it('still finishes immediately on the redirect, without waiting for a poll', async () => {
    h.resultStatuses = [
      { status: 'completed', public_token: 'pub-2', institution_id: 'ins_54', institution_name: 'Robinhood' },
    ];
    const onSuccess = vi.fn();
    render(<PlaidLinkButton onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(h.appUrlListeners.length).toBeGreaterThan(0), { timeout: 4000 });
    h.appUrlListeners.forEach(cb => cb({ url: 'com.treforged.forged://plaid-complete?x=1' }));

    await waitFor(() => expect(h.browserClosed).toBeGreaterThan(0), { timeout: 4000 });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled(), { timeout: 10000 });
  }, 20000);

  it('does not exchange anything when the user dismisses the sheet without linking', async () => {
    h.resultStatuses = [{ status: 'exited' }];
    const onSuccess = vi.fn();
    render(<PlaidLinkButton onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(h.browserFinishedListeners.length).toBeGreaterThan(0), { timeout: 4000 });
    h.browserFinishedListeners.forEach(cb => cb());

    await waitFor(() => expect(h.calls).toContain('plaid-hosted-link-result'), { timeout: 6000 });
    expect(h.calls).not.toContain('plaid-exchange-token');
    expect(onSuccess).not.toHaveBeenCalled();
  }, 20000);
});
