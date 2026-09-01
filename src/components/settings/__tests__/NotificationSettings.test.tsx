// @vitest-environment jsdom
//
// The notification toggle, PRESSED rather than read.
//
// This file exists because of the forged-glass licence panel: a settings control that was checked
// by reading what its label said, shipped, and threw the first time a human pressed it. So every
// case here clicks the switch and then asserts what was actually written to storage.
//
// Would-fail check: drop the `Capacitor.isNativePlatform()` guard and "renders nothing in the
// browser" fails; drop the `void setEnabled(next)` call and "persists the new value" fails while
// the on-screen state still flips, which is exactly the shape of bug that looks fine in a demo.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

const prefs = new Map<string, string>();
let isNative = true;

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNative },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefs.has(key) ? prefs.get(key) : null }),
    set: async ({ key, value }: { key: string; value: string }) => { prefs.set(key, value); },
  },
}));

import NotificationSettings from '../NotificationSettings';
import { ENABLED_KEY } from '@/lib/notification-service';

beforeEach(() => {
  prefs.clear();
  isNative = true;
});
afterEach(cleanup);

const findSwitch = () => screen.findByRole('switch', { name: /alerts about your money/i });

describe('NotificationSettings', () => {
  it('renders nothing in the browser, where the feature does not exist', async () => {
    isNative = false;
    const { container } = render(<NotificationSettings />);
    // Plain assertions on purpose: this suite does not register the jest-dom matchers.
    await waitFor(() => expect(container.innerHTML).toBe(''));
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('starts ON for a user who has never chosen, and says what it will send', async () => {
    render(<NotificationSettings />);
    const sw = await findSwitch();
    expect(sw.getAttribute('aria-checked')).toBe('true');
    // The description has to be specific, or the control is asking for trust it has not earned.
    expect(screen.getByText(/at most three a week/i)).toBeTruthy();
    expect(screen.getByText(/never between 9pm and 8am/i)).toBeTruthy();
  });

  it('reflects a stored OFF rather than defaulting over the top of it', async () => {
    prefs.set(ENABLED_KEY, 'false');
    render(<NotificationSettings />);
    const sw = await findSwitch();
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });

  it('PERSISTS the new value when pressed, not just the on-screen state', async () => {
    render(<NotificationSettings />);
    const sw = await findSwitch();

    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await waitFor(() => expect(prefs.get(ENABLED_KEY)).toBe('false'));

    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(prefs.get(ENABLED_KEY)).toBe('true'));
  });

  it('never asks for notification permission from this screen', async () => {
    // Permission belongs at the first moment there is something real to send. If this screen ever
    // starts importing the plugin, this test is the thing that should stop it.
    render(<NotificationSettings />);
    const sw = await findSwitch();
    fireEvent.click(sw);
    // The local-notifications plugin is not mocked here at all: if the component reached for it,
    // the import would fail and the click would throw rather than pass silently.
    await waitFor(() => expect(prefs.get(ENABLED_KEY)).toBe('false'));
  });
});
