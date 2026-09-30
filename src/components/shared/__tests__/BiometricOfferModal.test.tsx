// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BiometricOfferModal from '../BiometricOfferModal';

// Ask 2e42290d. Presses each control and asserts the CALL it makes; hidden when there is no offer.
const lock = {
  showBiometricOffer: true,
  acceptBiometricOffer: vi.fn(async () => true),
  dismissBiometricOffer: vi.fn(async () => {}),
};
vi.mock('@/hooks/useAppLock', () => ({ useAppLock: () => lock }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' } }));
const success = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (m: string) => success(m), error: vi.fn() } }));

beforeEach(() => {
  lock.showBiometricOffer = true;
  lock.acceptBiometricOffer.mockClear();
  lock.dismissBiometricOffer.mockClear();
  success.mockClear();
});

describe('BiometricOfferModal', () => {
  it('renders nothing when there is no offer', () => {
    lock.showBiometricOffer = false;
    const { container } = render(<BiometricOfferModal />);
    expect(container.innerHTML).toBe('');
  });

  it('"Use Face ID" accepts, once, and confirms', async () => {
    render(<BiometricOfferModal />);
    fireEvent.click(screen.getByRole('button', { name: /Use Face ID/ }));
    await waitFor(() => expect(success).toHaveBeenCalledWith('Face ID is on'));
    expect(lock.acceptBiometricOffer).toHaveBeenCalledTimes(1);
    expect(lock.dismissBiometricOffer).not.toHaveBeenCalled();
  });

  it('"Not now" and the close button both dismiss without accepting', () => {
    render(<BiometricOfferModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(lock.dismissBiometricOffer).toHaveBeenCalledTimes(2);
    expect(lock.acceptBiometricOffer).not.toHaveBeenCalled();
  });
});
