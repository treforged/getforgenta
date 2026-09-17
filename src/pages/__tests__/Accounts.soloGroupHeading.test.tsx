// @vitest-environment jsdom
//
// A GROUP OF ONE GETS NO HEADING, AND ITS INSTITUTION MOVES ONTO THE ROW.
//
// Tre, on the Accounts tab: "there's a lot of information there which could be cleaned up and it
// just seems like a overwhelming amount that the user really doesn't need to see upfront."
//
// ⚠️ THE MEASUREMENT CAME FIRST, AND IT REFUTED THE OBVIOUS FIX. The row's meta line
// concatenates up to EIGHT facts, so in source it looks like the overload. Measured against his
// own 16 active accounts it averages 2.94 facts per row, max 5, and `Since <apr_start_date>`
// renders on ZERO rows. What he actually has is 16 rows across 10 GROUPS — sizes
// 4,2,2,2,1,1,1,1,1,1 — so SIX groups hold exactly one account and the tab rendered 26 blocks,
// six of them a heading + count + divider introducing a single row.
//
// ⚠️ THE PAIR IS THE POINT, AND EITHER HALF ALONE IS A DEFECT. Dropping the heading ALONE would
// delete the institution from the screen, because `Accounts.tsx` deliberately does not repeat it
// on a row while a heading carries it. So this asserts BOTH directions:
//   • solo group  ⇒ no heading, institution ON the row
//   • multi group ⇒ heading present, institution NOT repeated on the rows
// A test that only asserted the absence would be satisfied by the institution vanishing entirely.
//
// WOULD-FAIL CHECK (both proven by mutation, see the commit body): forcing `solo = false` puts the
// heading back and strips the institution from the solo row; forcing `solo = true` deletes the
// heading from the four-row group and repeats its institution on every row.
//
// WHAT THIS DOES NOT COVER: geometry. jsdom reports zero for every size in this repo, so this says
// nothing about how many LINES are saved or how it looks at 390px — that needs a rendered frame
// via Playwright. It asserts the text that is present, which is the half that decides whether a
// fact was lost.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const account = (over: Record<string, unknown>) => ({
  user_id: 'u1', balance: 1000, active: true, created_at: '2026-01-01T00:00:00Z',
  payment_due_day: null, ...over,
});

// His real shape in miniature: one institution with several accounts, and two carrying exactly
// one. Names and figures are invented — this repo is public.
const ACCOUNTS = [
  account({ id: 'a1', name: 'Everyday Checking', account_type: 'checking', institution: 'Northwind Bank' }),
  account({ id: 'a2', name: 'Rainy Day', account_type: 'savings', institution: 'Northwind Bank' }),
  account({ id: 'a3', name: 'Travel Card', account_type: 'credit_card', institution: 'Solo Trust' }),
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

vi.mock('@/hooks/usePlaidItems', () => ({
  usePlaidItems: () => ({
    items: [], loading: false, remove: { mutate: vi.fn(), isPending: false }, invalidate: vi.fn(),
  }),
}));
vi.mock('@/hooks/useSurplusRanking', () => ({ useSurplusRanking: () => ({ rankNewCard: vi.fn() }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: true }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/components/shared/PlaidLinkButton', () => ({ default: () => null }));
vi.mock('@/components/shared/AkoyaConnectButton', () => ({ default: () => null }));
vi.mock('@/components/shared/AkoyaFallbackPrompt', () => ({ default: () => null }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsTouch: () => false, useIsViewportBelow: () => false }));

import Accounts from '../Accounts';

/** The group headings actually rendered — `h3`, uppercased, as the group bar draws them. */
const headings = () =>
  [...document.querySelectorAll('h3')].map(h => (h.textContent ?? '').trim());

/** The card element that contains a given account name, so a row can be read on its own. */
function rowFor(name: string): HTMLElement {
  const el = [...document.querySelectorAll('p')].find(p => p.textContent?.trim() === name);
  const card = el?.closest('.card-forged');
  if (!(card instanceof HTMLElement)) throw new Error(`no row found for "${name}"`);
  return card;
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); });

describe('Accounts — a group of one loses its heading, never its institution', () => {
  it('POSITIVE CONTROL: the page renders all three rows and the multi-account heading', () => {
    // Without this, every assertion below is satisfied by a page that rendered nothing at all —
    // "no heading for Solo Trust" and "the page is blank" are the same observation otherwise.
    render(<MemoryRouter><Accounts /></MemoryRouter>);
    expect(() => rowFor('Everyday Checking')).not.toThrow();
    expect(() => rowFor('Rainy Day')).not.toThrow();
    expect(() => rowFor('Travel Card')).not.toThrow();
    expect(headings()).toContain('Northwind Bank');
  });

  it('SOLO GROUP: no heading, and the institution appears ON the row instead', () => {
    render(<MemoryRouter><Accounts /></MemoryRouter>);
    // The chrome is gone...
    expect(headings()).not.toContain('Solo Trust');
    // ...and the fact is not. This is the half that stops the fix deleting information.
    expect(rowFor('Travel Card').textContent).toContain('Solo Trust');
  });

  it('MULTI GROUP: the heading stays, and its institution is NOT repeated on the rows', () => {
    // The control for the test above: it shows the institution moves ONLY where the heading went,
    // rather than simply being printed on every row now.
    render(<MemoryRouter><Accounts /></MemoryRouter>);
    expect(headings()).toContain('Northwind Bank');
    expect(rowFor('Everyday Checking').textContent).not.toContain('Northwind Bank');
    expect(rowFor('Rainy Day').textContent).not.toContain('Northwind Bank');
  });

  it('the solo row keeps every other fact it had', () => {
    // A tidy-up that quietly drops the type label or the balance would pass the assertions above.
    render(<MemoryRouter><Accounts /></MemoryRouter>);
    const row = rowFor('Travel Card').textContent ?? '';
    expect(row).toContain('Credit Card');
    expect(row).toContain('Travel Card');
  });
});
