// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import AppLockScreen from '../AppLockScreen';

/**
 * Ask 98cbf494 (Tre, 10-01): "after Face ID on resume ... the cover page lingers with no feedback".
 * The mark must SHIMMER while Face ID is running, and STOP when it fails - a shimmer that never
 * stops is a lie about loading. The pending cover shows the mark too, instead of a blank screen.
 */

let resolveBio: (ok: boolean) => void = () => {};
const unlockWithBiometric = vi.fn(() => new Promise<boolean>(r => { resolveBio = r; }));
const lock = {
  ready: true,
  isLocked: true,
  lockType: 'biometric' as 'pin' | 'biometric',
  failedAttempts: 0,
  unlockWithPin: vi.fn().mockResolvedValue(false),
  unlockWithBiometric,
};

vi.mock('@/hooks/useAppLock', () => ({ useAppLock: () => lock, MAX_FAILED_ATTEMPTS: 5 }));
vi.mock('@/lib/haptics', () => ({ tapFeedback: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const draw = () => render(<MemoryRouter><AppLockScreen /></MemoryRouter>);
const shimmering = () => screen.getByTestId('loading-mark').className.includes('logo-shimmer');

beforeEach(() => {
  unlockWithBiometric.mockClear();
  lock.ready = true;
  lock.isLocked = true;
});

describe('lock screen loading mark (98cbf494)', () => {
  it('shimmers while Face ID runs and stops when it fails', async () => {
    draw();
    // The auto-trigger fires after two frames + 250 ms; wait for it rather than pressing twice.
    await waitFor(() => expect(unlockWithBiometric).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await waitFor(() => expect(shimmering()).toBe(true));
    resolveBio(false);
    await waitFor(() => expect(shimmering()).toBe(false));
  });

  it('a press on the Face ID button starts the shimmer from rest', async () => {
    draw();
    await waitFor(() => expect(unlockWithBiometric).toHaveBeenCalledTimes(1), { timeout: 2000 });
    resolveBio(false);
    await waitFor(() => expect(shimmering()).toBe(false));
    fireEvent.click(screen.getByLabelText('Unlock with biometrics'));
    await waitFor(() => expect(shimmering()).toBe(true));
    expect(unlockWithBiometric).toHaveBeenCalledTimes(2);
    resolveBio(false);
  });

  it('the pending cover shows the mark, not a blank screen', () => {
    lock.ready = false;
    draw();
    const cover = screen.getByTestId('app-lock-pending');
    expect(cover.querySelector('[data-testid="loading-mark"]')).not.toBeNull();
    expect(cover.className).toContain('inset-0');
  });
});
