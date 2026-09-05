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

/** What `registerForPush` was called with, so the ORDER and the OPTIONS can both be asserted. */
const pushCalls: Array<{ prompt?: boolean }> = [];
/** What `registerForPush` should answer. Every value here is a real path — see its own tests. */
let pushOutcome: string = 'registered';
vi.mock('@/lib/push-registration', () => ({
  registerForPush: async (_store: unknown, options: { prompt?: boolean } = {}) => {
    pushCalls.push(options);
    if (pushOutcome === 'throws') throw new Error('plugin missing');
    return { outcome: pushOutcome, token: pushOutcome === 'registered' ? 'apns-token-abc' : null };
  },
}));
vi.mock('@/lib/push-store', () => ({
  supabasePushStore: { saveToken: async () => true, revokeToken: async () => {}, recordOutcome: async () => {} },
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
  pushCalls.length = 0;
  pushOutcome = 'registered';
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

describe('NotificationSettings — the switch must not claim what it did not do', () => {
  /**
   * ⚠️ THE BUG THESE PIN WAS LIVE AND UNIVERSAL ON iOS. `registerForPush` was called with
   * `.catch(() => {})` and its result thrown away, so the switch went to ON whether a token had
   * been minted or not. `App.entitlements` had no `aps-environment` key, so EVERY iOS
   * registration failed — and every iOS user who turned this on was told it worked, while
   * `device_tokens` held zero iOS rows.
   */
  const note = () => screen.queryByTestId('push-registration-note');

  it('says nothing when registration actually worked', async () => {
    isNative = true;
    storedPrefs = { enabled: false, categories: {} };   // so the click is a turn-ON
    fireEvent.click(await mount());
    await waitFor(() => expect(pushCalls).toHaveLength(1));
    await waitFor(() => expect(lastWrite().enabled).toBe(true));
    expect(note()).toBeNull();
  });

  it('⚠️ says the build cannot receive notifications when the OS refuses to register', async () => {
    isNative = true;
    storedPrefs = { enabled: false, categories: {} };   // so the click is a turn-ON
    pushOutcome = 'registration_error';
    fireEvent.click(await mount());
    await waitFor(() => expect(note()).not.toBeNull());
    // Whose problem it is, without blaming the reader or sending them to a setting that is fine.
    expect(note()!.textContent).toMatch(/cannot receive notifications yet/i);
    expect(note()!.textContent).toMatch(/nothing is wrong with your settings/i);
  });

  it('sends somebody who declined at the OS level to the right place', async () => {
    isNative = true;
    storedPrefs = { enabled: false, categories: {} };   // so the click is a turn-ON
    pushOutcome = 'denied';
    fireEvent.click(await mount());
    await waitFor(() => expect(note()).not.toBeNull());
    expect(note()!.textContent).toMatch(/device settings/i);
  });

  it('still explains itself when the registration call throws outright', async () => {
    isNative = true;
    storedPrefs = { enabled: false, categories: {} };   // so the click is a turn-ON
    pushOutcome = 'throws';
    fireEvent.click(await mount());
    await waitFor(() => expect(note()).not.toBeNull());
  });

  it('clears a previous warning when the switch is pressed again', async () => {
    isNative = true;
    storedPrefs = { enabled: false, categories: {} };   // so the click is a turn-ON
    pushOutcome = 'registration_error';
    const sw = await mount();
    fireEvent.click(sw);
    await waitFor(() => expect(note()).not.toBeNull());

    pushOutcome = 'registered';
    fireEvent.click(sw);            // off
    await waitFor(() => expect(note()).toBeNull());
  });

  it('shows nothing on the web, where there is no OS to have refused', async () => {
    isNative = false;
    storedPrefs = { enabled: false, categories: {} };   // so the click is a turn-ON
    fireEvent.click(await mount());
    await waitFor(() => expect(lastWrite().enabled).toBe(true));
    expect(pushCalls).toHaveLength(0);
    expect(note()).toBeNull();
  });
});

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

  /**
   * ⚠️ THIS SCREEN IS NOW THE ONLY PLACE THE PUSH PROMPT IS ASKED FOR, and that reverses what
   * this file used to assert. It previously said "never asks for notification permission from
   * this screen", which was right about LOCAL notifications (still asked at the first real send,
   * in notification-service.ts) and became wrong about PUSH.
   *
   * `registerForPush` used to fire from `AuthContext` ON SIGN-IN. On iOS the system prompt is a
   * ONE-SHOT resource — declined, the app can never present it again — so it was being spent
   * seconds after somebody first got into the app, before a single notification-worthy thing had
   * happened. Every new user who tapped "Don't Allow" there was permanently unreachable.
   *
   * Turning the switch ON is the user stating the intent in their own words, seconds before the
   * prompt appears. That is the strongest rationale the app will ever have for asking.
   */
  it('⚠️ ASKS for push permission when the switch is turned ON, on a device', async () => {
    isNative = true;
    storedPrefs = { enabled: false, categories: {} };   // so the click is a turn-ON
    const sw = await mount();
    fireEvent.click(sw);
    await waitFor(() => expect(pushCalls).toHaveLength(1));
    // `prompt: true` is the whole difference between asking and not.
    expect(pushCalls[0]).toEqual({ prompt: true });
  });

  it('SAVES THE PREFERENCE FIRST, then asks — so a declined prompt leaves nothing to redo', async () => {
    isNative = true;
    storedPrefs = { enabled: false, categories: {} };
    const sw = await mount();
    fireEvent.click(sw);
    await waitFor(() => expect(pushCalls).toHaveLength(1));
    // The account write happened, and it happened before the prompt. Someone who says no to the
    // OS still has notifications ON in the app, so granting later needs no second visit here.
    expect(updates.length).toBe(1);
  });

  it('does NOT ask when the switch is turned OFF — that is the opposite of intent', async () => {
    isNative = true;
    storedPrefs = { enabled: false, categories: {} };
    const sw = await mount();
    fireEvent.click(sw);                        // on  -> asks
    await waitFor(() => expect(pushCalls).toHaveLength(1));
    fireEvent.click(await master());            // off -> must not
    await waitFor(() => expect(updates.length).toBe(2));
    expect(pushCalls).toHaveLength(1);
  });

  it('does not reach for the plugin at all in a browser', async () => {
    isNative = false;
    storedPrefs = { enabled: false, categories: {} };
    const sw = await mount();
    fireEvent.click(sw);
    await waitFor(() => expect(updates.length).toBe(1));
    expect(pushCalls).toHaveLength(0);
  });
});
