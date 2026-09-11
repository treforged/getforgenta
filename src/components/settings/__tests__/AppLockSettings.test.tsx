// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppLockSettings } from '../AppLockSettings';

/**
 * ⚠️ WHAT THESE TESTS ARE FOR, and what they deliberately do NOT claim.
 *
 * The app lock was mounted on 2026-09-06 and was still effectively unreachable: the
 * only route to enabling it was a one-shot prompt whose dismissal wrote
 * `forged:lock_setup_prompted` forever. So the assertion that matters is not "the
 * button renders" — it is that the ENABLE control is wired to `openSetupModal` and
 * the DISABLE control is wired to `disableLock`, i.e. that the two controls do
 * DIFFERENT things. Forged-glass shipped a tab whose two handlers both set the same
 * view; it threw nothing, so every press-the-button check ever run on it passed.
 *
 * These are component-level tests over a mocked context, so they prove the WIRING.
 * They do not and cannot prove that `forged:lock_enabled` flips on a real phone —
 * that is native Capacitor Preferences and belongs to the walk. Stated here rather
 * than left for a reader to assume from a green run.
 */

const lock = {
  ready: true,
  lockEnabled: false,
  lockType: 'pin' as 'pin' | 'biometric',
  biometricAvailable: false,
  openSetupModal: vi.fn(),
  disableLock: vi.fn().mockResolvedValue(undefined),
};

let isNative = true;

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNative },
}));
vi.mock('@/hooks/useAppLock', () => ({ useAppLock: () => lock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  isNative = true;
  lock.ready = true;
  lock.lockEnabled = false;
  lock.lockType = 'pin';
  lock.biometricAvailable = false;
  lock.openSetupModal.mockClear();
  lock.disableLock.mockClear();
});

describe('AppLockSettings', () => {
  it('offers a way to set a PIN when the lock is off', () => {
    render(<AppLockSettings />);
    expect(screen.getByRole('button', { name: /set a pin/i })).toBeTruthy();
  });

  it('THE LOAD-BEARING ONE: pressing enable calls openSetupModal, not dismiss', () => {
    render(<AppLockSettings />);
    fireEvent.click(screen.getByRole('button', { name: /set a pin/i }));

    // Assert the CHANGE, not the absence of a throw. A handler wired to nothing
    // raises no error and would pass any smoke test ever written.
    expect(lock.openSetupModal).toHaveBeenCalledTimes(1);
    expect(lock.disableLock).not.toHaveBeenCalled();
  });

  it('the two controls do DIFFERENT things — disable does not open setup', async () => {
    lock.lockEnabled = true;
    render(<AppLockSettings />);
    fireEvent.click(screen.getByRole('button', { name: /turn off app lock/i }));

    expect(lock.disableLock).toHaveBeenCalledTimes(1);
    expect(lock.openSetupModal).not.toHaveBeenCalled();
  });

  it('names biometrics only when the device actually offers them', () => {
    lock.biometricAvailable = true;
    render(<AppLockSettings />);
    expect(screen.getByRole('button', { name: /biometrics/i })).toBeTruthy();
  });

  it('renders NOTHING on web — the lock is mounted for native only', () => {
    isNative = false;
    const { container } = render(<AppLockSettings />);
    // A control that cannot do anything is worse than an absent one: it invites a
    // press and then reports nothing.
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing until the native provider is ready', () => {
    // Showing the "off" wording during restore would tell a user who HAS a PIN that
    // they have none — a confident wrong answer, not a harmless flicker.
    lock.ready = false;
    const { container } = render(<AppLockSettings />);
    expect(container.innerHTML).toBe('');
  });
});
