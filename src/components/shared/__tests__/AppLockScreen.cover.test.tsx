// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import AppLockScreen from '../AppLockScreen';

/**
 * Ask e34975a1 (Tre, build 1112): "the biometric page should load fully before face id because it
 * seems like it just loads straight into the app without it sometime."
 *
 * 1. While the lock is still deciding (`ready` false), the app underneath must be COVERED. The
 *    routes render from the first frame, so returning null here showed a locked user's money.
 * 2. Face ID is asked for only once the lock screen is on screen, never while it is still deciding.
 * Paired with the unlocked case: a ready, unlocked app must show NO cover, or (1) passes against a
 * screen that covers everyone for ever.
 */

const unlockWithBiometric = vi.fn().mockResolvedValue(false);
const lock = {
  ready: false,
  isLocked: false,
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

beforeEach(() => {
  unlockWithBiometric.mockClear();
  lock.ready = false;
  lock.isLocked = false;
});

describe('app lock cover (e34975a1)', () => {
  it('covers the app while the lock is still deciding, and asks for no Face ID yet', async () => {
    draw();
    const cover = screen.getByTestId('app-lock-pending');
    expect(cover.className).toContain('fixed');
    expect(cover.className).toContain('inset-0');
    expect(cover.className).toContain('bg-background');
    await new Promise(r => setTimeout(r, 400));
    expect(unlockWithBiometric).not.toHaveBeenCalled();
  });

  it('shows NOTHING once ready and unlocked (the cover is not permanent)', () => {
    lock.ready = true;
    const { container } = draw();
    expect(screen.queryByTestId('app-lock-pending')).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('asks for Face ID only after the locked screen is drawn', async () => {
    lock.ready = true;
    lock.isLocked = true;
    draw();
    expect(screen.getByText("Verify it's you to continue")).toBeTruthy();
    expect(unlockWithBiometric).not.toHaveBeenCalled(); // not synchronously with the first render
    await waitFor(() => expect(unlockWithBiometric).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });
});
