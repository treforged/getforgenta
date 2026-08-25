// @vitest-environment jsdom
//
// Tre, 2026-08-24: *"adding phases doesnt show immediately. it requires the user to go to
// another page and back."*
//
// The cause was not the mutation and not the query. `Builds` renders
// `dragPhaseOrder ?? phases`, and `handleUpdatePhase` writes `dragPhaseOrder` on EVERY phase
// edit, not only on a drag, so after any rename the optimistic snapshot shadowed the query
// for the rest of the page's life. The insert landed, react-query refetched, `phases` grew,
// and the frozen list kept rendering. Leaving the page unmounted the component and dropped
// the snapshot, which is exactly why navigating away and back appeared to fix it.
//
// So the assertion that matters is not "an insert calls add". It is: WITH A PHASE EDIT
// ALREADY BEHIND US, does a refreshed `phases` reach the screen? That is the state the bug
// needed, and a test that skips the edit passes on the broken code too.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { CarBuild, CarBuildPhase } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  phases: [] as CarBuildPhase[],
  addPhase: vi.fn(),
  updatePhase: vi.fn(),
  removePhase: vi.fn(),
}));

const build: CarBuild = {
  id: 'b1', user_id: 'u1', name: 'Project Ledger', year: 2016, make: 'Subaru', model: 'WRX',
  notes: null, sort_order: 0, share_token: null, maintenance_public: false, pricing_public: true,
  photos: null, car_fund_id: null, created_at: '2026-01-01T00:00:00Z',
};

const phase = (id: string, title: string, sort_order: number): CarBuildPhase => ({
  id, build_id: 'b1', user_id: 'u1', title, sort_order, hidden: false,
  created_at: '2026-01-01T00:00:00Z',
});

vi.mock('@/hooks/useSupabaseData', () => ({
  useCarBuilds: () => ({
    data: [build], loading: false,
    add: { mutateAsync: vi.fn() }, update: { mutateAsync: vi.fn() }, remove: { mutateAsync: vi.fn() },
  }),
  // The list is read from the mock's mutable array, so a test can stand in for a refetch by
  // replacing it and re-rendering, exactly as react-query would after an invalidate.
  useCarBuildPhases: () => ({
    data: mocks.phases, loading: false,
    add: { mutateAsync: mocks.addPhase }, update: { mutateAsync: mocks.updatePhase },
    remove: { mutateAsync: mocks.removePhase }, reorder: { mutateAsync: vi.fn() },
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
// A mouse, so the desktop drag handles render and the arrow buttons do not. Either branch
// exercises the same state; this one matches how the bug was originally reported.
vi.mock('@/hooks/use-mobile', () => ({ useIsTouch: () => false }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn() } }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import Builds from '../Builds';

/**
 * `Builds` mounts an `ErrorBoundary`, which reads the query client and the router even though
 * every data hook here is mocked. One client per render so nothing leaks between tests.
 */
function Harness() {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><Builds /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.phases = [phase('p1', 'Suspension', 0)];
  mocks.addPhase.mockReset().mockResolvedValue(phase('p2', 'New Phase', 1));
  mocks.updatePhase.mockReset().mockResolvedValue(undefined);
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
});

afterEach(() => { cleanup(); });

/** Rename the first phase, which is what puts `dragPhaseOrder` in the way. */
async function renameFirstPhase(newTitle: string) {
  fireEvent.click(screen.getAllByTitle('Rename phase')[0]);
  const input = await screen.findByDisplayValue('Suspension');
  fireEvent.change(input, { target: { value: newTitle } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(mocks.updatePhase).toHaveBeenCalled());
}

describe('Builds - a refreshed phase list reaches the screen after a phase edit', () => {
  it('shows a phase added after a rename, with no remount', async () => {
    const { rerender } = render(<Harness />);
    expect(await screen.findByText('Suspension')).toBeTruthy();

    await renameFirstPhase('Suspension v2');
    expect(await screen.findByText('Suspension v2')).toBeTruthy();

    // The insert lands and the query refetches: a NEW array, one phase longer.
    mocks.phases = [phase('p1', 'Suspension v2', 0), phase('p2', 'Exhaust', 1)];
    rerender(<Harness />);

    // Before the fix this failed: `dragPhaseOrder` still held the one-phase snapshot taken
    // during the rename, so "Exhaust" never appeared until the page was left and re-entered.
    expect(await screen.findByText('Exhaust')).toBeTruthy();
    expect(screen.getByText('Suspension v2')).toBeTruthy();
  });

  it('shows a phase DELETED elsewhere disappear after a rename, the same way', async () => {
    mocks.phases = [phase('p1', 'Suspension', 0), phase('p2', 'Exhaust', 1)];
    const { rerender } = render(<Harness />);
    expect(await screen.findByText('Exhaust')).toBeTruthy();

    await renameFirstPhase('Suspension v2');

    mocks.phases = [phase('p1', 'Suspension v2', 0)];
    rerender(<Harness />);

    await waitFor(() => expect(screen.queryByText('Exhaust')).toBeNull());
  });

  it('still renders the query directly when no edit has happened', async () => {
    const { rerender } = render(<Harness />);
    expect(await screen.findByText('Suspension')).toBeTruthy();

    mocks.phases = [phase('p1', 'Suspension', 0), phase('p2', 'Exhaust', 1)];
    rerender(<Harness />);

    expect(await screen.findByText('Exhaust')).toBeTruthy();
  });
});
