// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';

/**
 * Ask 98cbf494: build 1201 measured Face ID OK -> page painted 7 ms, but iOS re-activated the app
 * 2,323 ms later and the native cover waited for that. The JS lock now tells AppCover the page has
 * painted. Pair: iOS calls it once AFTER a passed Face ID; a failed Face ID and Android never do.
 * Harness copied from AppLockContext.faceIdOrder.test.tsx.
 */

const store = new Map<string, string>();
// Holds Preferences.remove open, so a test can act while markUnlocked's writes are in flight.
const gate: { wait: Promise<void>; open: () => void } = { wait: Promise.resolve(), open: () => {} };
const handlers: Record<string, () => void> = {};

const platform = { name: 'ios' };
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => platform.name } }));
const unlocked = vi.fn(async () => {});
vi.mock('@/plugins/app-cover', () => ({ AppCover: { unlocked: () => unlocked() } }));
const bio = { fail: false };
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (event: string, cb: () => void) => {
      handlers[event] = cb;
      return { remove: () => { delete handlers[event]; } };
    },
  },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store.has(key) ? store.get(key)! : null }),
    set: async ({ key, value }: { key: string; value: string }) => { store.set(key, value); },
    remove: async ({ key }: { key: string }) => { await gate.wait; store.delete(key); },
  },
}));
vi.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: { checkBiometry: async () => ({ isAvailable: false }), authenticate: async () => { if (bio.fail) throw new Error('cancelled'); } },
}));
vi.mock('@/lib/debugLog', () => ({ debugLog: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

import { AppLockProvider, useAppLock } from '../AppLockContext';

function Probe() {
  const l = useAppLock();
  return (
    <div>
      <p data-testid="s">{`ready=${l.ready} locked=${l.isLocked}`}</p>
      <button onClick={() => void l.unlockWithBiometric()}>bio</button>
    </div>
  );
}
const state = () => screen.getByTestId('s').textContent ?? '';

async function launch() {
  render(<AppLockProvider><Probe /></AppLockProvider>);
  await waitFor(() => expect(state()).toContain('ready=true locked=true'));
}

beforeEach(() => {
  cleanup();
  store.clear();
  localStorage.clear();
  unlocked.mockClear();
  platform.name = 'ios';
  bio.fail = false;
  gate.wait = Promise.resolve();
  store.set('forged:lock_enabled', '1');
  store.set('forged:lock_type', 'biometric');
});
afterEach(() => { gate.open(); });

describe('Face ID lifts the native cover once painted (98cbf494)', () => {
  it('iOS: a passed Face ID calls AppCover.unlocked exactly once, after the unlock', async () => {
    await launch();
    expect(unlocked).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('bio'));
    await waitFor(() => expect(unlocked).toHaveBeenCalledTimes(1));
    expect(state()).toContain('locked=false');
  });

  it('iOS: a failed Face ID never lifts the cover', async () => {
    bio.fail = true;
    await launch();
    fireEvent.click(screen.getByText('bio'));
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });
    expect(state()).toContain('locked=true');
    expect(unlocked).not.toHaveBeenCalled();
  });

  it('Android: no AppCover call (there is no native cover there)', async () => {
    platform.name = 'android';
    await launch();
    fireEvent.click(screen.getByText('bio'));
    await waitFor(() => expect(state()).toContain('locked=false'));
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });
    expect(unlocked).not.toHaveBeenCalled();
  });
});
