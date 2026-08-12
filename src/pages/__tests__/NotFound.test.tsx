// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import NotFound from '../NotFound';

// What this pins: a bad URL must look like a wrong address, not like a broken
// app — and the way out has to lead somewhere the visitor can actually reach.
// Sending a signed-out visitor to /dashboard just bounces them to /auth.

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
const demo = vi.hoisted(() => ({ isDemo: false }));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => demo }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotFound />
    </MemoryRouter>
  );
}

describe('NotFound', () => {
  beforeEach(() => {
    auth.user = null;
    demo.isDemo = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('says the address is wrong, and shows which address', () => {
    renderAt('/no-such-page');
    expect(screen.getByText('Page not found')).toBeTruthy();
    expect(screen.getByText('/no-such-page')).toBeTruthy();
  });

  it('sends a signed-out visitor to the homepage, not the dashboard', () => {
    renderAt('/nope');
    const link = screen.getByText('Go to homepage');
    expect(link.getAttribute('href')).toBe('/');
  });

  it('sends a signed-in user to the dashboard', () => {
    auth.user = { id: 'u1' };
    renderAt('/nope');
    expect(screen.getByText('Go to dashboard').getAttribute('href')).toBe('/dashboard');
  });

  it('treats a demo visitor as signed in', () => {
    demo.isDemo = true;
    renderAt('/nope');
    expect(screen.getByText('Go to dashboard').getAttribute('href')).toBe('/dashboard');
  });

  it('always offers a second way out', () => {
    renderAt('/nope');
    expect(screen.getByText('Go back')).toBeTruthy();
  });
});
