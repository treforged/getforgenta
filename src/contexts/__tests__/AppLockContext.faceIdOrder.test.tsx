// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';

/**
 * Ask 98cbf494 (Tre: "the cover page lingers after Face ID"): a Face ID unlock lifts the lock
 * BEFORE its Preferences writes, and a pause during those writes must still leave the lock
 * pending on disk. Harness copied from AppLockContext.resume.test.tsx.
 *
 * Ask e34975a1 (Tre, build 1112: "it just loads straight into the app without it sometime").
 * The lock used to engage only on a process start, so a WARM reopen skipped it entirely. It now
 * locks on `pause` and a return within RESUME_GRACE_MS lifts that provisional lock with no prompt.
 * Each case is a pair: the lock must hold where it should AND lift where it should.
 */

const store = new Map<string, string>();
// Holds Preferences.remove open, so a test can act while markUnlocked's writes are in flight.
const gate: { wait: Promise<void>; open: () => void } = { wait: Promise.resolve(), open: () => {} };
function closeGate() { gate.wait = new Promise<void>(r => { gate.open = r; }); }
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
    remove: async ({ key }: { key: string }) => { await gate.wait; store.delete(key); },
  },
}));
vi.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: { checkBiometry: async () => ({ isAvailable: false }), authenticate: async () => undefined },
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
  await waitFor(() => expect(handlers.pause && handlers.resume).toBeTruthy());
}

beforeEach(() => {
  cleanup();
  store.clear();
  localStorage.clear();
  for (const k of Object.keys(handlers)) delete handlers[k];
  gate.wait = Promise.resolve();
  store.set('forged:lock_enabled', '1');
  store.set('forged:lock_type', 'biometric');
});
afterEach(() => { gate.open(); vi.restoreAllMocks(); });

describe('Face ID unlock order (98cbf494)', () => {
  it('lifts the lock while the unlock writes are still in flight', async () => {
    await launch();
    expect(store.get('forged:lock_pending')).toBe('1');
    closeGate();
    fireEvent.click(screen.getByText('bio'));
    await waitFor(() => expect(state()).toContain('locked=false'));
    // The writes have not landed: the screen did not wait for them.
    expect(store.get('forged:lock_pending')).toBe('1');
    gate.open();
    await waitFor(() => expect(store.has('forged:lock_pending')).toBe(false));
  });

  it('a pause DURING those writes stays locked on disk, not just in memory', async () => {
    await launch();
    closeGate();
    fireEvent.click(screen.getByText('bio'));
    await waitFor(() => expect(state()).toContain('locked=false'));
    await act(async () => { handlers.pause(); });
    expect(state()).toContain('locked=true');
    gate.open();
    await new Promise(r => setTimeout(r, 50));
    expect(store.get('forged:lock_pending')).toBe('1');
  });
});
