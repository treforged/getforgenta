// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

/**
 * Ask 2e42290d (Tre, build 1112): "people who have pin enabled already need to be prompted for face id."
 *
 * The offer appears ONCE, right after a PIN unlock, and only when it can help: a PIN user on a
 * device with biometrics. Pairs: it must appear for that user AND must not appear for a Face ID
 * user or on a device without biometrics, and after either answer it must not appear again.
 */

const store = new Map<string, string>();
let bioAvailable = true;
const authenticate = vi.fn(async () => undefined);

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store.has(key) ? store.get(key)! : null }),
    set: async ({ key, value }: { key: string; value: string }) => { store.set(key, value); },
    remove: async ({ key }: { key: string }) => { store.delete(key); },
  },
}));
vi.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: { checkBiometry: async () => ({ isAvailable: bioAvailable }), authenticate: () => authenticate() },
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

import { AppLockProvider, useAppLock } from '../AppLockContext';

const PIN = '123456';
async function sha256(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}

function Probe() {
  const l = useAppLock();
  return (
    <div>
      <p data-testid="s">{`ready=${l.ready} locked=${l.isLocked} offer=${l.showBiometricOffer} type=${l.lockType}`}</p>
      <button onClick={() => void l.unlockWithPin(PIN)}>pin</button>
      <button onClick={() => void l.acceptBiometricOffer()}>accept</button>
      <button onClick={() => void l.dismissBiometricOffer()}>dismiss</button>
    </div>
  );
}
const state = () => screen.getByTestId('s').textContent ?? '';

async function launchAndUnlock() {
  cleanup();
  // A relaunch within 3 s of an unlock is deliberately NOT locked (INIT_GRACE_MS); a real
  // relaunch is later than that, so drop the stamp to model one.
  localStorage.removeItem('forged:lock_unlocked_at');
  render(<AppLockProvider><Probe /></AppLockProvider>);
  await waitFor(() => expect(state()).toContain('ready=true locked=true'));
  fireEvent.click(screen.getByText('pin'));
  await waitFor(() => expect(state()).toContain('locked=false'));
  // let the post-unlock offer read settle
  await new Promise(r => setTimeout(r, 20));
}

beforeEach(async () => {
  store.clear();
  localStorage.clear();
  bioAvailable = true;
  authenticate.mockClear();
  store.set('forged:lock_enabled', '1');
  store.set('forged:lock_type', 'pin');
  store.set('forged:lock_pin_hash', await sha256(PIN));
});

describe('one-time Face ID offer for PIN users (2e42290d)', () => {
  it('appears after a PIN unlock for a PIN user with biometrics', async () => {
    await launchAndUnlock();
    expect(state()).toContain('offer=true');
  });

  it('accepting runs Face ID, switches the lock to biometric, and records the offer', async () => {
    await launchAndUnlock();
    fireEvent.click(screen.getByText('accept'));
    await waitFor(() => expect(state()).toContain('offer=false type=biometric'));
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(store.get('forged:lock_type')).toBe('biometric');
    expect(store.get('forged:lock_bio_offered')).toBe('1');
  });

  it('"Not now" is remembered: the next launch and unlock does not offer again', async () => {
    await launchAndUnlock();
    fireEvent.click(screen.getByText('dismiss'));
    await waitFor(() => expect(state()).toContain('offer=false'));
    expect(store.get('forged:lock_type')).toBe('pin');
    await launchAndUnlock();
    expect(state()).toContain('offer=false');
  });

  it('never appears for a Face ID user or on a device without biometrics', async () => {
    store.set('forged:lock_type', 'biometric');
    await launchAndUnlock();
    expect(state()).toContain('offer=false');
    store.set('forged:lock_type', 'pin');
    bioAvailable = false;
    await launchAndUnlock();
    expect(state()).toContain('offer=false');
  });
});
