// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';

/**
 * Ask e34975a1 (Tre, build 1112: "it just loads straight into the app without it sometime").
 * The lock used to engage only on a process start, so a WARM reopen skipped it entirely. It now
 * locks on `pause` and a return within RESUME_GRACE_MS lifts that provisional lock with no prompt.
 * Each case is a pair: the lock must hold where it should AND lift where it should.
 */

const store = new Map<string, string>();
const handlers: Record<string, () => void> = {};

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }));
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
    remove: async ({ key }: { key: string }) => { store.delete(key); },
  },
}));
vi.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: { checkBiometry: async () => ({ isAvailable: false }), authenticate: async () => undefined },
}));
vi.mock('@/lib/debugLog', () => ({ debugLog: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

import { AppLockProvider, useAppLock, RESUME_GRACE_MS } from '../AppLockContext';

const PIN = '123456';
async function sha256(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}

function Probe() {
  const l = useAppLock();
  return (
    <div>
      <p data-testid="s">{`ready=${l.ready} locked=${l.isLocked}`}</p>
      <button onClick={() => void l.unlockWithPin(PIN)}>pin</button>
    </div>
  );
}
const state = () => screen.getByTestId('s').textContent ?? '';
let now = 1_800_000_000_000;

async function launch() {
  render(<AppLockProvider><Probe /></AppLockProvider>);
  await waitFor(() => expect(state()).toContain('ready=true locked=true'));
  await waitFor(() => expect(handlers.pause && handlers.resume).toBeTruthy());
}
async function unlock() {
  fireEvent.click(screen.getByText('pin'));
  await waitFor(() => expect(state()).toContain('locked=false'));
}
async function away(ms: number) {
  await act(async () => { handlers.pause(); });
  now += ms;
  await act(async () => { handlers.resume(); });
}

beforeEach(async () => {
  cleanup();
  store.clear();
  localStorage.clear();
  for (const k of Object.keys(handlers)) delete handlers[k];
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  store.set('forged:lock_enabled', '1');
  store.set('forged:lock_type', 'pin');
  store.set('forged:lock_pin_hash', await sha256(PIN));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('the lock engages on a warm reopen (e34975a1)', () => {
  it('locks the moment the app goes to the background, before it is shown again', async () => {
    await launch();
    await unlock();
    await act(async () => { handlers.pause(); });
    expect(state()).toContain('locked=true');
    await waitFor(() => expect(store.get('forged:lock_pending')).toBe('1'));
  });

  // a232812f: the case above flaked under full-suite load. The lock refs were synced in a PASSIVE
  // effect, so for a moment after an unlock the screen read unlocked while isLockedRef still read
  // locked - and a pause in that window returned early, leaving the app OPEN in the background.
  // A MutationObserver callback runs as a microtask right after the DOM commit, before passive effects
  // flush, so pausing there hits that window every time instead of only under load.
  it('locks on a pause that lands the instant the unlock commits (fail-closed, a232812f)', async () => {
    await launch();
    const p = screen.getByTestId('s');
    let paused = false;
    const mo = new MutationObserver(() => {
      if (!paused && (p.textContent ?? '').includes('locked=false')) { paused = true; handlers.pause(); }
    });
    mo.observe(p, { childList: true, characterData: true, subtree: true });
    fireEvent.click(screen.getByText('pin'));
    await waitFor(() => expect(paused).toBe(true));
    mo.disconnect();
    await waitFor(() => expect(state()).toContain('locked=true'));
  });

  it('keeps the lock after a return past the grace', async () => {
    await launch();
    await unlock();
    await away(RESUME_GRACE_MS + 1_000);
    expect(state()).toContain('locked=true');
  });

  it('lifts the lock with no prompt after a quick return inside the grace', async () => {
    await launch();
    await unlock();
    await away(10_000);
    expect(state()).toContain('locked=false');
    await waitFor(() => expect(store.has('forged:lock_pending')).toBe(false));
  });

  it('a quick return never unlocks an app that was ALREADY locked before it went away', async () => {
    await launch(); // cold start: locked, never unlocked
    await away(5_000);
    expect(state()).toContain('locked=true');
  });

  it('does nothing when the lock is switched off', async () => {
    store.delete('forged:lock_enabled');
    render(<AppLockProvider><Probe /></AppLockProvider>);
    await waitFor(() => expect(state()).toContain('ready=true locked=false'));
    await waitFor(() => expect(handlers.pause).toBeTruthy());
    await away(RESUME_GRACE_MS + 1_000);
    expect(state()).toContain('locked=false');
  });
});
