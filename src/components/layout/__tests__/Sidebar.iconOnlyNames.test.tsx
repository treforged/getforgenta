// @vitest-environment jsdom
//
// EVERY RAIL ROW HAS AN ACCESSIBLE NAME, because icon-only is now the DEFAULT on any mouse.
//
// Tre, 2026-09-12: on desktop the sidebar "should be auto retracted... only show the symbols and
// not the text", expanding on hover like Instagram's.
//
// ⚠️ THIS FIXES A DEFECT THAT PREDATES THE HOVER WORK. The label `<span>` is not rendered at all
// when the rail is collapsed — so a collapsed row's accessible name was EMPTY and a screen reader
// announced an unnamed link. That was already true of the manual collapse; making icon-only the
// default on every mouse turns a latent defect into the normal case for most users.
//
// ⚠️ AND THIS IS THE PART JSDOM CAN ACTUALLY SEE. The geometry — 64px footprint, 208px on hover,
// content NOT moving because the panel is out of flow — is not testable here: jsdom reports every
// box as 0 and applies no Tailwind. Those rules were instead verified in the BUILT CSS (absolute,
// z-40, both widths, hover and focus-within all present inside the
// `@media (hover:hover) and (pointer:fine)` block). Stated rather than implied, so nobody reads a
// green here as proof the rail expands.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Sidebar from '../Sidebar';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false, leaveDemo: vi.fn() }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: false }) }));
// Renders without a QueryClientProvider, so every react-query-backed hook is mocked -- the
// established pattern in this repo's component suites.
vi.mock('@/hooks/useBankReviewQueue', () => ({ useBankReviewQueueCount: () => 3 }));
vi.mock('@/hooks/usePersistedState', () => ({
  // Collapsed: the state the hover rail makes the default on every mouse.
  usePersistedState: () => [true, vi.fn()],
}));

const renderRail = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Sidebar /></MemoryRouter>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe('the desktop rail, collapsed to icons', () => {
  it('names EVERY navigation row, even with no label text on screen', () => {
    renderRail();

    for (const name of ['Dashboard', 'Transactions', 'Debt Payoff', 'Garage', 'Settings']) {
      const link = screen.getByRole('link', { name });
      expect(link, `${name} has no accessible name`).toBeTruthy();
      expect(link.getAttribute('href')).toBeTruthy();
    }
  });

  it('leaves no unnamed link in the rail — the assertion that would catch a NEW icon-only row', () => {
    // A per-row check passes for the rows someone remembered. This one fails for the next row
    // added without a label, which is the failure mode worth guarding.
    const { container } = renderRail();
    const unnamed = [...container.querySelectorAll('a')].filter(a => {
      const name = (a.getAttribute('aria-label') ?? a.textContent ?? '').trim();
      return name.length === 0;
    });
    expect(unnamed.map(a => a.getAttribute('href'))).toEqual([]);
  });

  it('does NOT render Forecast — it moved into Transactions', () => {
    renderRail();
    expect(screen.queryByRole('link', { name: 'Forecast' })).toBeNull();
  });
});
