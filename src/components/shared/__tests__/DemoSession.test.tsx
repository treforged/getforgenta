// @vitest-environment jsdom
//
// The demo has two audiences and, since 2026-08-18, two doors. A signed-out visitor is being sold
// to: "Sign Up Free". A user who already signed up and opened the reference account mid-setup is
// not — they need the way BACK, and it must never be a sign-out, because their own session is
// still underneath the fixture data.
//
// These render the real banner and the real entry button over a mocked pair of contexts, so the
// assertions are about what a person sees and what the click actually does.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DemoBanner from '../DemoBanner';
import ReferenceAccountButton from '../ReferenceAccountButton';

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  isDemo: false,
  setIsDemo: vi.fn(),
  navigate: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user, signOut: mocks.signOut }),
}));

vi.mock('@/contexts/DemoContext', () => ({
  useDemo: () => ({ isDemo: mocks.isDemo, setIsDemo: mocks.setIsDemo }),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mocks.navigate };
});

beforeEach(() => {
  mocks.user = null;
  mocks.isDemo = false;
  mocks.setIsDemo.mockReset();
  mocks.navigate.mockReset();
  mocks.signOut.mockReset();
});

afterEach(cleanup);

const renderBanner = () => render(<MemoryRouter><DemoBanner /></MemoryRouter>);

describe('DemoBanner — the way out depends on who is looking', () => {
  it('sells to a signed-out visitor', () => {
    mocks.isDemo = true;
    renderBanner();
    expect(screen.getByText('Sign Up Free →')).toBeTruthy();
    expect(screen.queryByText(/Back to my account/)).toBeNull();
  });

  it('offers a signed-in user the way back to their own account, not a sign-up', () => {
    mocks.isDemo = true;
    mocks.user = { id: 'user-1' };
    renderBanner();
    expect(screen.queryByText('Sign Up Free →')).toBeNull();
    expect(screen.getByText(/Back to my account/)).toBeTruthy();
  });

  it('leaving is the flag dropping — never a sign-out', () => {
    mocks.isDemo = true;
    mocks.user = { id: 'user-1' };
    renderBanner();
    fireEvent.click(screen.getByText(/Back to my account/));
    expect(mocks.setIsDemo).toHaveBeenCalledWith(false);
    expect(mocks.signOut).not.toHaveBeenCalled();
    // Back to a known page: a user still mid-setup is sent on to /onboarding by the route gate.
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('renders nothing at all when the app is not in demo', () => {
    mocks.user = { id: 'user-1' };
    const { container } = renderBanner();
    expect(container.textContent).toBe('');
  });
});

describe('ReferenceAccountButton — the demo\'s only door', () => {
  it('turns the reference account on and lands on the Dashboard', () => {
    mocks.user = { id: 'user-1' };
    render(<MemoryRouter><ReferenceAccountButton /></MemoryRouter>);
    fireEvent.click(screen.getByText(/See a reference account/));
    expect(mocks.setIsDemo).toHaveBeenCalledWith(true);
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('says the same thing in both variants — one promise, two shapes', () => {
    render(<MemoryRouter><ReferenceAccountButton variant="inline" /></MemoryRouter>);
    expect(screen.getByText(/See a reference account/)).toBeTruthy();
  });
});
