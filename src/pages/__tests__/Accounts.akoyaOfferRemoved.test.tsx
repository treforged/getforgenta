// @vitest-environment jsdom
//
// THE AKOYA OFFER IS GONE FROM THE ACCOUNTS TAB, AND IT DID NOT LEAVE A BROKEN DISCLOSURE BEHIND.
//
// Tre, 2026-09-17: "remove Connect Fidelity via Akoya btw since i never bought it. i cant even do
// it sense its an expensive pay up front". Akoya is a paid-up-front data network this account has
// never purchased, so every Akoya offer was a control no user could complete.
//
// ⚠️ THIS FILE DELIBERATELY DOES NOT MOCK `AkoyaConnectButton` OR `AkoyaFallbackPrompt`, and that
// is the entire reason it exists as a separate file. Every other Accounts test mocks both to
// `() => null`. In those harnesses "no Akoya button is on screen" is true whatever the app does —
// the assertion would be green over a fully working offer, and green over a deleted one, with no
// way to tell them apart. Removing the mock is what makes the absence mean something.
//
// ⚠️ AND THE ABSENCE IS NOT THE WHOLE TEST. Emptying `AKOYA_INSTITUTIONS` makes the button map
// produce nothing, but the `<details>` disclosure WRAPPING that map is a separate element: with an
// empty list it still rendered, reading "Trouble connecting ?" — an empty institution name and no
// buttons under it. An empty map does not remove a disclosure, it leaves a broken one. So the
// summary text is asserted absent in its own right.
//
// WHAT THIS DOES NOT COVER: the Akoya PROVIDER, which is deliberately kept — the edge functions,
// the `/akoya-oauth` callback route and the response normalizers all still work and are still
// tested by `akoya-fallback.test.ts` and `akoya-normalize.test.ts`. He said he has not bought it,
// not that he never will. This file is about what a USER IS OFFERED, nothing else. It also says
// nothing about geometry; jsdom reports zero for every size in this repo.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AKOYA_INSTITUTIONS, findAkoyaInstitution, getAkoyaInstitutionByKey } from '@/config/akoya-institutions';

const account = (over: Record<string, unknown>) => ({
  user_id: 'u1', balance: 1000, active: true, created_at: '2026-01-01T00:00:00Z',
  payment_due_day: null, ...over,
});

// Names and figures are invented — this repo is public.
const ACCOUNTS = [
  account({ id: 'a1', name: 'Everyday Checking', account_type: 'checking', institution: 'Northwind Bank' }),
];

vi.mock('@/hooks/useSupabaseData', () => ({
  useAccounts: () => ({
    data: ACCOUNTS, loading: false,
    add: { mutate: vi.fn(), isPending: false, mutateAsync: () => Promise.resolve({ id: 'x' }) },
    update: { mutate: vi.fn(), isPending: false },
    remove: { mutate: vi.fn(), isPending: false },
    reorder: { mutate: vi.fn(), isPending: false },
  }),
  useDebts: () => ({
    data: [], loading: false,
    add: { mutate: vi.fn(), isPending: false },
    update: { mutate: vi.fn(), isPending: false },
  }),
  useAccountReconciliations: () => ({ data: [], add: { mutate: vi.fn(), isPending: false } }),
}));

// `items: []` is the state the disclosure renders in — it is gated on being BELOW the bank-link
// ceiling, so an account already at the ceiling would hide it for an unrelated reason and the
// absence below would prove nothing.
vi.mock('@/hooks/usePlaidItems', () => ({
  usePlaidItems: () => ({
    items: [], loading: false, remove: { mutate: vi.fn(), isPending: false }, invalidate: vi.fn(),
  }),
}));
vi.mock('@/hooks/useSurplusRanking', () => ({ useSurplusRanking: () => ({ rankNewCard: vi.fn() }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: true }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/components/shared/PlaidLinkButton', () => ({ default: () => null }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsTouch: () => false, useIsViewportBelow: () => false }));

import Accounts from '../Accounts';

const bodyText = () => document.body.textContent ?? '';

/**
 * Mount the page and switch to the BANKS panel, which is where the Akoya disclosure lives.
 *
 * ⚠️ THIS PRESS IS NOT CEREMONY — IT IS THE DIFFERENCE BETWEEN A TEST AND A BLANK. The whole
 * block is gated on `effectiveTab === 'banks'` and the page opens on Balances, so an earlier
 * version of this file asserted four absences against a panel that was never mounted. It passed
 * with the Akoya offer fully present and working; only restoring the real pre-fix institution
 * list exposed it, because the expected red never came. Green against unreachable.
 */
function renderBanksPanel() {
  render(<MemoryRouter><Accounts /></MemoryRouter>);
  const banksTab = [...document.querySelectorAll('button')]
    .find(b => (b.textContent ?? '').trim().startsWith('Banks'));
  if (!banksTab) throw new Error('no Banks tab button found — the page shape changed');
  fireEvent.click(banksTab);
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); });

describe('the Akoya offer is withdrawn at its single source', () => {
  it('has an empty institution list, and both lookups agree', () => {
    expect(AKOYA_INSTITUTIONS).toHaveLength(0);
    // The names that USED to match. These are the strings Plaid reports, and they are what the
    // matcher was written for — so a list that quietly regained an entry fails here first.
    expect(findAkoyaInstitution('Fidelity')).toBeNull();
    expect(findAkoyaInstitution('Fidelity Investments')).toBeNull();
    expect(getAkoyaInstitutionByKey('fidelity')).toBeNull();
  });

  it('CONTROL: the lookups are the real functions and still refuse an unknown name', () => {
    // Guards the vacuous reading of the case above: an import that resolved to undefined would
    // throw here rather than quietly satisfying `toBeNull()` everywhere.
    expect(typeof findAkoyaInstitution).toBe('function');
    expect(typeof getAkoyaInstitutionByKey).toBe('function');
    expect(findAkoyaInstitution('Northwind Bank')).toBeNull();
    expect(findAkoyaInstitution(null)).toBeNull();
  });
});

describe('the Accounts tab offers no Akoya route', () => {
  it('POSITIVE CONTROL: the BANKS PANEL itself is mounted, not merely the page', () => {
    // Every assertion below is an ABSENCE, and an unmounted panel satisfies all of them
    // perfectly. "No linked banks yet" is rendered INSIDE the banks panel, a few lines under the
    // disclosure being asserted absent, so it cannot be true unless the disclosure's own
    // container is on screen. A page-level string would not have discriminated — and did not:
    // the first version of this control read "Linked Banks", which is the TAB LABEL and is
    // present while the panel is closed.
    // ⚠️ ASSERT EACH HALF WHERE IT ACTUALLY EXISTS. Switching to Banks UNMOUNTS the Balances
    // rows, so reading the account name after the click fails while the app is perfectly
    // healthy — a control that goes red on a good day is worse than none, because an
    // instrument fault is the one diagnosis nobody chases. The row is read BEFORE the press.
    render(<MemoryRouter><Accounts /></MemoryRouter>);
    expect(screen.getByText('Everyday Checking')).toBeTruthy();

    const banksTab = [...document.querySelectorAll('button')]
      .find(b => (b.textContent ?? '').trim().startsWith('Banks'));
    expect(banksTab).toBeTruthy();
    fireEvent.click(banksTab!);
    expect(bodyText()).toContain('No linked banks yet');
  });

  it('renders no "Connect … via Akoya" button', () => {
    renderBanksPanel();
    expect(bodyText()).not.toContain('via Akoya');
    expect(bodyText()).not.toContain('Fidelity');
  });

  it('renders no "Trouble connecting" disclosure — an empty map leaves a broken one', () => {
    // ⚠️ SCOPED TO THE AKOYA DISCLOSURE, NOT TO `details` AS A CLASS. The first version asserted
    // ZERO `<details>` on the panel and was wrong: the "We never see your bank login" connections
    // notice is also a `<details>`, it is a disclosure the product OWES, and this repo does not
    // take information away to make a page tidier. Asserting the element type would have demanded
    // its deletion. What must be gone is the summary that offers the route.
    renderBanksPanel();
    expect(bodyText()).not.toContain('Trouble connecting');

    const summaries = [...document.querySelectorAll('details > summary')]
      .map(s => (s.textContent ?? '').trim());
    expect(summaries.some(t => t.includes('Trouble connecting'))).toBe(false);
    // POSITIVE CONTROL on the same reader: the connections disclosure MUST still be here, so a
    // selector that silently matched nothing cannot satisfy the line above.
    expect(summaries.some(t => t.includes('We never see your bank login'))).toBe(true);
  });

  it('mentions Akoya nowhere on the page at all', () => {
    renderBanksPanel();
    expect(bodyText()).not.toContain('Akoya');
  });
});
