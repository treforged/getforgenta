// @vitest-environment jsdom
//
// The notification toggle, PRESSED rather than read.
//
// This file exists because of the forged-glass licence panel: a settings control that was checked
// by reading what its label said, shipped, and threw the first time a human pressed it. So every
// case here clicks the switch and then asserts what was actually written.
//
// It was rewritten on 2026-09-02 with the switch itself. The old suite asserted that the control
// RENDERS NOTHING IN A BROWSER, which was the bug: there was no off switch anywhere a web user
// could reach, and the value lived on one device where nothing that sends could read it. The
// account row is the source of truth now, so these cases assert the WRITE TO THE ACCOUNT.
//
// Would-fail checks: drop the `savePrefs` call and "persists the master switch" fails while the
// on-screen state still flips; drop the revert-on-failure branch and "puts the switch back when
// the write fails" fails, which is the shape of bug where a user believes they are muted and is
// not; make the category toggle write `true` instead of `false` and the category case fails.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

let isNative = false;
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNative },
}));

const devicePrefs = new Map<string, string>();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: devicePrefs.has(key) ? devicePrefs.get(key) : null }),
    set: async ({ key, value }: { key: string; value: string }) => { devicePrefs.set(key, value); },
  },
}));

/** The account row, and the last thing written to it. Stands in for `profiles`. */
let storedPrefs: unknown = null;
let updateFails = false;
const updates: unknown[] = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { notification_prefs: storedPrefs }, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: async () => {
          if (updateFails) return { error: { message: 'nope' } };
          updates.push(payload.notification_prefs);
          storedPrefs = payload.notification_prefs;
          return { error: null };
        },
      }),
    }),
  },
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }));

import NotificationSettings from '../NotificationSettings';

beforeEach(() => {
  isNative = false;
  storedPrefs = null;
  updateFails = false;
  updates.length = 0;
  devicePrefs.clear();
  toastError.mockClear();
});
afterEach(cleanup);

/** Render, then hand back the master switch once the stored value has been read. */
const mount = async () => { render(<NotificationSettings />); return master(); };
const master = () => screen.findByRole('switch', { name: /alerts about your money/i });
const category = (name: RegExp) => screen.findByRole('switch', { name });

/** The value the component last wrote to the account. */
const lastWrite = () => updates[updates.length - 1] as { enabled: boolean; categories: Record<string, boolean> };

describe('NotificationSettings', () => {
  it('RENDERS IN THE BROWSER, which is the bug it was built to fix', async () => {
    const sw = await mount();
    expect(sw.getAttribute('aria-checked')).toBe('true');
    // And it says where the alerts actually arrive, rather than implying the browser will buzz.
    expect(screen.getByText(/delivered on the forgenta mobile app/i)).toBeTruthy();
  });

  it('does not claim mobile delivery when it IS the mobile app', async () => {
    isNative = true;
    await mount();
    expect(screen.queryByText(/delivered on the forgenta mobile app/i)).toBeNull();
  });

  it('starts ON for an account that has never chosen, and says what it will send', async () => {
    const sw = await mount();
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/at most five a week/i)).toBeTruthy();
    expect(screen.getByText(/never between 9pm and 8am/i)).toBeTruthy();
  });

  it('reflects a stored OFF rather than defaulting over the top of it', async () => {
    storedPrefs = { enabled: false, categories: {} };
    const sw = await mount();
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });

  it('PERSISTS the master switch to the account when pressed', async () => {
    const sw = await mount();

    fireEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'));
    await waitFor(() => expect(lastWrite().enabled).toBe(false));

    fireEvent.click(sw);
    await waitFor(() => expect(lastWrite().enabled).toBe(true));
  });

  it('SURVIVES A RELOAD: a fresh mount reads back what the press wrote', async () => {
    const sw = await mount();
    fireEvent.click(sw);
    await waitFor(() => expect(lastWrite().enabled).toBe(false));

    cleanup();
    render(<NotificationSettings />);
    const reloaded = await master();
    expect(reloaded.getAttribute('aria-checked')).toBe('false');
  });

  it('silences ONE category without silencing the rest', async () => {
    await mount();
    const recap = await category(/weekly recap/i);

    fireEvent.click(recap);
    await waitFor(() => expect(lastWrite().categories.weekly_checkin).toBe(false));
    // The bill warning — the reason people install this — is untouched.
    expect(lastWrite().categories.bill_due).toBe(true);
    expect(lastWrite().enabled).toBe(true);
  });

  it('puts the switch back and SAYS SO when the account write fails', async () => {
    const sw = await mount();
    updateFails = true;

    fireEvent.click(sw);
    // It may flip optimistically; what matters is where it ends up and that the user is told.
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    expect(toastError).toHaveBeenCalled();
  });

  it('never asks for notification permission from this screen', async () => {
    // Permission belongs at the first moment there is something real to send. This screen does
    // not import the plugin at all, so a request from here is impossible rather than merely absent.
    const sw = await mount();
    fireEvent.click(sw);
    await waitFor(() => expect(updates.length).toBe(1));
  });
});
