// @vitest-environment jsdom
//
// THE TWO CONTROLS THAT DECIDE WHAT STRANGERS SEE ARE SWITCHES NOW, AND THIS PRESSES THEM.
//
// Tre, 2026-09-13: "they are weird to understand as is. they dont look like normal buttons."
// These two read "✓ Public" / "Private" and "✓ Shown" / "Hidden" — a single word that could equally
// be the current state or what a press would do. They govern a PUBLIC share link, so guessing wrong
// publishes his service history or his prices.
//
// ⚠️ THE DEFAULT IS THE PART MOST LIKELY TO BE GOT WRONG, AND IT IS TESTED FIRST.
// `pricing_public` is shown unless it is explicitly `false`, so the check is `!== false` and NOT a
// truthy test. A plain `!!activeBuild.pricing_public` would read `undefined` as OFF and silently
// hide prices on every build that has never touched the setting — a privacy control failing in the
// direction nobody notices, because hiding something looks like caution rather than a bug.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { CarBuild } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  build: null as unknown as CarBuild,
  updateBuild: vi.fn(),
}));

const baseBuild = (over: Partial<CarBuild> = {}): CarBuild => ({
  id: 'b1', user_id: 'u1', name: 'Project Ledger', year: 2016, make: 'Subaru', model: 'WRX',
  notes: null, sort_order: 0, share_token: 'tok-1', maintenance_public: false, pricing_public: true,
  photos: null, car_fund_id: null, created_at: '2026-01-01T00:00:00Z', ...over,
});

vi.mock('@/hooks/useSupabaseData', () => ({
  useCarBuilds: () => ({
    data: [mocks.build], loading: false,
    add: { mutateAsync: vi.fn() }, update: { mutateAsync: mocks.updateBuild }, remove: { mutateAsync: vi.fn() },
  }),
  useCarBuildPhases: () => ({
    data: [], loading: false,
    add: { mutateAsync: vi.fn() }, update: { mutateAsync: vi.fn() },
    remove: { mutateAsync: vi.fn() }, reorder: { mutateAsync: vi.fn() },
  }),
  useCarBuildItems: () => ({
    data: [], loading: false,
    add: { mutateAsync: vi.fn() }, update: { mutateAsync: vi.fn() },
    remove: { mutateAsync: vi.fn() }, reorder: { mutateAsync: vi.fn() },
  }),
  useCarMaintenanceLogs: () => ({
    data: [], loading: false,
    add: { mutateAsync: vi.fn() }, update: { mutateAsync: vi.fn() }, remove: { mutateAsync: vi.fn() },
  }),
  usePaymentPlans: () => ({ data: [], add: { mutateAsync: vi.fn() } }),
  useTransactions: () => ({ data: [], update: { mutateAsync: vi.fn() }, add: { mutateAsync: vi.fn() } }),
  useAccounts: () => ({ data: [] }),
  useCarFunds: () => ({ data: [] }),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: true }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsTouch: () => false }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn() } }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import Builds from '../Builds';

function Harness() {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><Builds /></MemoryRouter>
    </QueryClientProvider>
  );
}

/** The share panel is collapsed until the Share build button is pressed — open it first. */
async function openSharePanel() {
  fireEvent.click(await screen.findByTitle('Share build'));
}

const MAINTENANCE = 'Show the maintenance log on the public share link';
const PRICES = 'Show prices on the public share link';

beforeEach(() => {
  mocks.build = baseBuild();
  mocks.updateBuild.mockReset().mockResolvedValue(undefined);
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
});
afterEach(cleanup);

describe('the share controls are switches, and their state is unambiguous', () => {
  it('renders both as switches rather than as pressed buttons', async () => {
    render(<Harness />);
    await openSharePanel();
    expect(await screen.findByLabelText(MAINTENANCE)).toBeTruthy();
    expect(screen.getByLabelText(PRICES)).toBeTruthy();
    // The old controls said "✓ Public" / "✓ Shown", which is the ambiguity being removed.
    expect(screen.queryByText('✓ Public')).toBeNull();
    expect(screen.queryByText('✓ Shown')).toBeNull();
  });

  it('a PRIVATE maintenance log reads as off', async () => {
    render(<Harness />);
    await openSharePanel();
    const sw = await screen.findByLabelText(MAINTENANCE);
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });

  it('⚠️ AN UNSET `pricing_public` READS AS ON — the default that a truthy test would invert', async () => {
    mocks.build = baseBuild({ pricing_public: undefined as unknown as boolean });
    render(<Harness />);
    await openSharePanel();
    const sw = await screen.findByLabelText(PRICES);
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });

  it('an explicit `false` on pricing reads as off — the only value that hides it', async () => {
    mocks.build = baseBuild({ pricing_public: false });
    render(<Harness />);
    await openSharePanel();
    const sw = await screen.findByLabelText(PRICES);
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });
});

describe('pressing them actually writes, and writes the right direction', () => {
  it('turning the maintenance log ON asks for public = true', async () => {
    render(<Harness />);
    await openSharePanel();
    fireEvent.click(await screen.findByLabelText(MAINTENANCE));
    await waitFor(() => expect(mocks.updateBuild).toHaveBeenCalled());
    expect(mocks.updateBuild.mock.calls[0][0]).toMatchObject({ id: 'b1', maintenance_public: true });
  });

  it('⚠️ TURNING PRICES OFF ASKS FOR false — the direction that must never be wrong', async () => {
    // Publishing something the user asked to hide is the failure this pair of tests exists for.
    render(<Harness />);
    await openSharePanel();
    fireEvent.click(await screen.findByLabelText(PRICES));
    await waitFor(() => expect(mocks.updateBuild).toHaveBeenCalled());
    expect(mocks.updateBuild.mock.calls[0][0]).toMatchObject({ id: 'b1', pricing_public: false });
  });
});
