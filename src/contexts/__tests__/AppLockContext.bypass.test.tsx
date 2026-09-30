// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * Ask e34975a1 (Tre, build 1112): "it just loads straight into the app without [the lock] sometime".
 *
 * The bypass this pins: AppDelegate reloads the WebView with `forged:bg_reload = '1'` - after a
 * background, AND when the native cover's deadline fires on a cold launch. That flag skips the
 * fresh-launch lock check. If the reload lands while the lock screen is still up, the app came back
 * UNLOCKED. The fix is a `forged:lock_pending` marker that survives the reload.
 *
 * DISCRIMINATING PAIR: a bg reload with a pending lock must stay LOCKED, and a bg reload with no
 * pending lock must stay UNLOCKED (the background/foreground case the flag exists for). Either half
 * alone passes against a broken context: always-locked satisfies the first, never-locked the second.
 */

const store = new Map<string, string>();
let session: unknown = { user: { id: 'u1' } };

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store.has(key) ? store.get(key)! : null }),
    set: async ({ key, value }: { key: string; value: string }) => { store.set(key, value); },
    remove: async ({ key }: { key: string }) => { store.delete(key); },
  },
}));
vi.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: { checkBiometry: async () => ({ isAvailable: true }), authenticate: async () => undefined },
}));
vi.mock('@/lib/debugLog', () => ({ debugLog: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

import { AppLockProvider, useAppLock, hasSessionForLock, LOCK_PENDING } from '../AppLockContext';

function Probe() {
  const { ready, isLocked, lockEnabled, lockType } = useAppLock();
  return <p data-testid="probe">{`ready=${ready} locked=${isLocked} enabled=${lockEnabled} type=${lockType}`}</p>;
}

const launch = async () => {
  render(<AppLockProvider><Probe /></AppLockProvider>);
  await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('ready=true'));
  return screen.getByTestId('probe').textContent;
};

beforeEach(() => {
  store.clear();
  localStorage.clear();
  session = { user: { id: 'u1' } };
  store.set('forged:lock_enabled', '1');
  store.set('forged:lock_type', 'biometric');
  store.set('forged:lock_pin_hash', 'x');
});

describe('app lock across a bg_reload (e34975a1)', () => {
  it('a cold launch locks AND records the pending marker', async () => {
    expect(await launch()).toBe('ready=true locked=true enabled=true type=biometric');
    expect(store.get(LOCK_PENDING)).toBe('1');
  });

  it('a bg_reload that interrupts a pending lock comes back LOCKED', async () => {
    store.set(LOCK_PENDING, '1');
    store.set('forged:bg_reload', '1');
    expect(await launch()).toBe('ready=true locked=true enabled=true type=biometric');
    expect(store.has('forged:bg_reload')).toBe(false);
  });

  it('a bg_reload with no pending lock stays unlocked, but still knows the lock is ON', async () => {
    store.set('forged:bg_reload', '1');
    // enabled=true is the second fix: this path used to leave lockEnabled false.
    expect(await launch()).toBe('ready=true locked=false enabled=true type=biometric');
  });

  it('a pending marker with the lock turned off does not lock, and is cleared', async () => {
    store.delete('forged:lock_enabled');
    store.set(LOCK_PENDING, '1');
    store.set('forged:bg_reload', '1');
    expect(await launch()).toContain('locked=false enabled=false');
    expect(store.has(LOCK_PENDING)).toBe(false);
  });
});

describe('hasSessionForLock fails CLOSED', () => {
  it('a session is true, no session is false', async () => {
    expect(await hasSessionForLock(async () => ({ data: { session: {} } }))).toBe(true);
    expect(await hasSessionForLock(async () => ({ data: { session: null } }))).toBe(false);
  });

  it('a read that throws or never answers counts as a session, so the lock shows', async () => {
    expect(await hasSessionForLock(() => Promise.reject(new Error('offline')))).toBe(true);
    expect(await hasSessionForLock(() => new Promise(() => {}), 20)).toBe(true);
  });
});
