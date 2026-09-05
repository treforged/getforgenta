// @vitest-environment jsdom
//
// Rule 9 from the reel Tre sent (`https://www.instagram.com/reel/DcmoHfNJDWO/`, @agenticmatt):
// "Tapping the currently selected bottom tab should return users to the top of that tab."
//
// The bar was plain `<Link>`s, so re-tapping the tab you were already on did NOTHING — someone
// four screens deep in Transactions had to scroll all of it back by hand.
//
// ⚠️ THE TRAP THIS PINS: the scroller is `#scroll-main`, not the window. `main` is the
// `overflow-y-auto` element in DashboardLayout, so `window.scrollTo` would scroll a document that
// never moved and do nothing at all — a fix that looks right, tests green against a `window` spy,
// and is inert in the app.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('@/hooks/useBankReviewQueue', () => ({ useBankReviewQueueCount: () => null }));

import MobileNav from '../MobileNav';

/** The real scrolling element, so a fix aimed at `window` cannot pass. */
function mountWithScroller(path: string) {
  const main = document.createElement('main');
  main.id = 'scroll-main';
  document.body.appendChild(main);
  const scrollTo = vi.fn();
  main.scrollTo = scrollTo as unknown as typeof main.scrollTo;
  const view = render(<MemoryRouter initialEntries={[path]}><MobileNav /></MemoryRouter>);
  return { scrollTo, main, view };
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(cleanup);

describe('MobileNav — tapping the tab you are already on', () => {
  it('scrolls the MAIN element to the top, not the window', () => {
    const { scrollTo } = mountWithScroller('/transactions');
    fireEvent.click(screen.getByText('Transactions'));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ top: 0 });
  });

  it('does NOTHING when the tab is a different destination — that is a navigation', () => {
    const { scrollTo } = mountWithScroller('/dashboard');
    fireEvent.click(screen.getByText('Transactions'));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('honours prefers-reduced-motion — an animated jump is the one thing they asked not to have', () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('reduce'), media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    try {
      const { scrollTo } = mountWithScroller('/debt');
      fireEvent.click(screen.getByText('Debt'));
      expect(scrollTo.mock.calls[0][0]).toMatchObject({ top: 0, behavior: 'auto' });
    } finally {
      window.matchMedia = original;
    }
  });

  it('does not throw when the scroller is absent — the tap must never break the app', () => {
    // A layout without `#scroll-main` (a test harness, a future shell) must degrade to a no-op.
    render(<MemoryRouter initialEntries={['/debt']}><MobileNav /></MemoryRouter>);
    expect(() => fireEvent.click(screen.getByText('Debt'))).not.toThrow();
  });
});
