// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import AppLockScreen from '../AppLockScreen';

/**
 * ⚠️ WHAT THIS TEST ASSERTS, AND WHY IT IS SHAPED THIS WAY.
 *
 * Tre, 2026-09-12: the PIN pad "should have some sort of effect when each number is pressed."
 * Every key ALREADY carried `btn-press` — `active:scale-[0.98]`, a 2% shrink that lasts only
 * while the finger is down. So a check that asserted "the key has a press class" would have
 * been GREEN over the exact complaint. The house rule applies in full here: pressing the
 * button is not the assertion, the CHANGE is.
 *
 * So these assert an observable state TRANSITION on the pressed key — absent, then present,
 * then absent again after the flash window — and that a press lights ONLY the key pressed.
 * `data-pressed` is the handle; the visible colour/scale classes ride along with it.
 *
 * WHAT THEY DO NOT CLAIM: nothing here proves a real taptic engine fires. `tapFeedback` is
 * mocked, so what is proven is that a press CALLS it exactly once per key and that the
 * component survives it rejecting. Real haptics are native and belong to the device walk.
 */

const tapFeedback = vi.fn().mockResolvedValue(undefined);

const lock = {
  ready: true,
  isLocked: true,
  lockType: 'pin' as 'pin' | 'biometric',
  failedAttempts: 0,
  unlockWithPin: vi.fn().mockResolvedValue(false),
  unlockWithBiometric: vi.fn().mockResolvedValue(false),
};

vi.mock('@/hooks/useAppLock', () => ({
  useAppLock: () => lock,
  MAX_FAILED_ATTEMPTS: 5,
}));
vi.mock('@/lib/haptics', () => ({ tapFeedback: () => tapFeedback() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderScreen = () =>
  render(
    <MemoryRouter>
      <AppLockScreen />
    </MemoryRouter>,
  );

const key = (label: string) =>
  screen.getAllByRole('button').find(b => b.textContent === label)!;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  tapFeedback.mockClear();
  lock.failedAttempts = 0;
  lock.unlockWithPin.mockResolvedValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AppLockScreen — per-key press feedback', () => {
  it('lights the pressed key, then clears it after the flash window', () => {
    renderScreen();
    const seven = key('7');

    // BEFORE: no press state. This is the half that makes the next assertion mean something.
    expect(seven.getAttribute('data-pressed')).toBeNull();

    fireEvent.click(seven);
    expect(key('7').getAttribute('data-pressed')).toBe('true');

    act(() => { vi.advanceTimersByTime(200); });
    expect(key('7').getAttribute('data-pressed')).toBeNull();
  });

  it('lights ONLY the key pressed', () => {
    renderScreen();
    fireEvent.click(key('4'));

    expect(key('4').getAttribute('data-pressed')).toBe('true');
    for (const other of ['1', '2', '3', '5', '6', '7', '8', '9', '0']) {
      expect(key(other).getAttribute('data-pressed')).toBeNull();
    }
  });

  it('applies a visible colour change, not only the data attribute', () => {
    renderScreen();
    const before = key('2').className;
    fireEvent.click(key('2'));
    const after = key('2').className;

    expect(after).not.toBe(before);
    expect(after).toContain('border-primary');
    expect(after).toContain('scale-95');
  });

  it('fires one haptic per key press', () => {
    renderScreen();
    fireEvent.click(key('1'));
    expect(tapFeedback).toHaveBeenCalledTimes(1);

    fireEvent.click(key('2'));
    expect(tapFeedback).toHaveBeenCalledTimes(2);
  });

  it('lights the key for a PHYSICAL KEYBOARD press, where :active never fires', () => {
    renderScreen();
    fireEvent.keyDown(window, { key: '9' });
    expect(key('9').getAttribute('data-pressed')).toBe('true');
    expect(tapFeedback).toHaveBeenCalledTimes(1);
  });

  it('still registers the digit — feedback must not replace the input', () => {
    renderScreen();
    fireEvent.click(key('5'));
    // Six filled dots would submit; one press fills exactly one.
    const filled = document.querySelectorAll('.bg-primary.border-primary');
    expect(filled.length).toBe(1);
  });

  it('survives haptics rejecting, and still lights the key', () => {
    tapFeedback.mockRejectedValueOnce(new Error('no taptic engine'));
    renderScreen();

    expect(() => fireEvent.click(key('3'))).not.toThrow();
    expect(key('3').getAttribute('data-pressed')).toBe('true');
  });
});
