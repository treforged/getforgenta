// @vitest-environment jsdom
//
// PRESSING THE LEDGER-SIDE LINK, AND ASSERTING WHAT IT CHANGED.
//
// Tre, 2026-09-05 and again 2026-09-13: a row he types ahead of time "should merge when the real
// transaction shows". It does — but only from the Bank Activity queue, and only while that charge
// is still unanswered. Answer the charge and the offer was gone for good.
//
// ⚠️ THE ASSERTION IS THE WRITE, NOT THE ABSENCE OF AN ERROR. A button that throws nothing and does
// nothing passes every smoke test ever written, and this repo has shipped exactly that. So each
// test below reads what `update.mutateAsync` actually received — the bank's amount, the bank's
// date, and `origin: 'synced'` — rather than checking the press did not blow up.
//
// ⚠️ AND THE UNDO IS ASSERTED TOO, BECAUSE THIS WRITES TO A MONEY ROW. The typed figure is gone the
// instant the patch lands; if the reversal were not recorded with it, the amount would be
// unrecoverable. That is not hypothetical here — an earlier link in this codebase lost a $15 entry
// exactly that way, which is why `restoreTransaction` exists.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, within, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  isPartnerView: false,
  syncedTransactions: [] as unknown[],
  reviews: [] as unknown[],
  realTransactions: [] as unknown[],
  updateAsync: vi.fn(),
  recordApplied: vi.fn(),
}));

const ACCOUNT = {
  id: 'acc-1', user_id: 'u1', name: 'Everyday Checking', account_type: 'checking',
  balance: 4200, active: true, created_at: '2026-01-01T00:00:00Z',
};

/** Tre's real shape: a round figure typed on the day, against a charge that was a few cents less. */
const TYPED_SPOTIFY = {
  id: 'tx-spotify', user_id: 'u1', type: 'expense', amount: 8, category: 'Subscriptions',
  note: 'Spotify', date: '2026-08-17', payment_source: 'acc-1', origin: 'manual',
  created_at: '2026-08-17T00:00:00Z', updated_at: '2026-08-17T00:00:00Z',
};

const SPOTIFY_CHARGE = {
  id: 'stx-spotify', account_id: 'acc-1', amount: 7.93, date: '2026-08-17',
  pending: false, name: 'SPOTIFY USA', merchant_name: 'Spotify',
};

/** Answered by the user months ago, never linked — the state the queue can no longer reach. */
const ANSWERED = { synced_transaction_id: 'stx-spotify', transaction_id: null };

vi.mock('@/hooks/useSupabaseData', () => ({
  useTransactions: () => ({
    data: mocks.realTransactions, loading: false,
    add: { mutate: vi.fn() },
    update: { mutate: vi.fn(), mutateAsync: mocks.updateAsync },
    remove: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  }),
  useAccounts: () => ({ data: [ACCOUNT], loading: false }),
  useRecurringRules: () => ({ data: [], loading: false, add: { mutateAsync: vi.fn() }, update: { mutate: vi.fn() } }),
  useAccountReconciliations: () => ({ data: [] }),
  usePaymentPlans: () => ({
    data: [], loading: false,
    add: { mutate: vi.fn(), mutateAsync: vi.fn() }, update: { mutate: vi.fn() }, remove: { mutate: vi.fn() },
  }),
  useCarFunds: () => ({ data: [] }),
  useSavingsGoals: () => ({ data: [] }),
  useSyncedTransactions: () => ({ data: mocks.syncedTransactions }),
  useSyncedTransactionReviewsQuery: () => ({ data: mocks.reviews }),
}));

vi.mock('@/hooks/useAppliedActions', () => ({
  APPLIED_ACTIONS_KEY: 'applied_actions',
  useAppliedActions: () => ({ record: { mutateAsync: mocks.recordApplied } }),
}));

vi.mock('@/contexts/CardProjectionContext', () => ({
  useCardProjectionContext: () => ({
    cardProjection: null, forecastFundingAccountId: null, projections: { data: [] },
  }),
}));
vi.mock('@/contexts/ViewedProfileContext', () => ({
  useViewedProfile: () => ({ viewedUserId: null, isPartnerView: mocks.isPartnerView }),
}));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: true }) }));
vi.mock('@/hooks/useBankReviewQueue', () => ({
  useBankReviewQueueCount: () => null,
  reviewBadgeCount: () => null,
  useBankReviewQueue: () => ({
    queue: { needsDecision: [], suggestions: {}, suggestedCount: 0 }, reviewsByCharge: {}, isLoading: false,
  }),
}));
vi.mock('@/components/transactions/BankActivity', () => ({ default: () => <div data-testid="bank-activity" /> }));
vi.mock('@/hooks/useFormDraft', () => ({ useFormDraft: () => ({ restored: false, discard: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import Transactions from '../Transactions';

function renderInAugust() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 25, 9, 0, 0));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><Transactions /></MemoryRouter>
    </QueryClientProvider>,
  );
}

function ledger(): HTMLElement {
  const rows = document.querySelectorAll('.card-forged.divide-y');
  const el = rows[rows.length - 1];
  if (!el) throw new Error('no ledger list rendered');
  return el as HTMLElement;
}

function spotifyRow(): HTMLElement {
  const el = within(ledger()).getByText('Spotify').closest('.flex.items-center.justify-between');
  if (!el) throw new Error('no ledger row for Spotify');
  return el as HTMLElement;
}

beforeEach(() => {
  localStorage.clear();
  mocks.syncedTransactions = [];
  mocks.reviews = [];
  mocks.realTransactions = [];
  mocks.isPartnerView = false;
  mocks.updateAsync = vi.fn().mockResolvedValue({});
  mocks.recordApplied = vi.fn().mockResolvedValue({});
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the offer appears on the ledger row the queue can no longer reach', () => {
  it('names the bank figure ON the button, before the press', () => {
    // A control that says only "matches" and then changes an amount has done more than it said.
    mocks.realTransactions = [TYPED_SPOTIFY];
    mocks.syncedTransactions = [SPOTIFY_CHARGE];
    mocks.reviews = [ANSWERED];
    renderInAugust();
    expect(within(spotifyRow()).getByText(/Bank says \$7\.93/)).toBeTruthy();
  });

  it('⚠️ OFFERS NOTHING while the charge is still unanswered — Bank Activity owns that one', () => {
    mocks.realTransactions = [TYPED_SPOTIFY];
    mocks.syncedTransactions = [SPOTIFY_CHARGE];
    mocks.reviews = [];
    renderInAugust();
    expect(within(spotifyRow()).queryByText(/Bank says/)).toBeNull();
  });

  it('⚠️ OFFERS NOTHING IN PARTNER VIEW — the write would match zero rows and toast success', () => {
    // Partner view READS the other person's ledger while `update` writes scoped to `user.id`. A
    // button there is a silent no-op reported as a win, and it would record an undo for it too.
    mocks.realTransactions = [TYPED_SPOTIFY];
    mocks.syncedTransactions = [SPOTIFY_CHARGE];
    mocks.reviews = [ANSWERED];
    mocks.isPartnerView = true;
    renderInAugust();
    expect(within(spotifyRow()).queryByText(/Bank says/)).toBeNull();
  });
});

describe('the press writes the bank figures onto the typed row', () => {
  it("takes the bank's amount, date and origin — asserting the CHANGE, not the absence of a throw", async () => {
    mocks.realTransactions = [TYPED_SPOTIFY];
    mocks.syncedTransactions = [SPOTIFY_CHARGE];
    mocks.reviews = [ANSWERED];
    renderInAugust();
    // The date is only needed while the page RENDERS; `waitFor` needs real ones to poll on.
    vi.useRealTimers();
    fireEvent.click(within(spotifyRow()).getByText(/Bank says \$7\.93/));
    await waitFor(() => expect(mocks.updateAsync).toHaveBeenCalled());
    expect(mocks.updateAsync.mock.calls[0][0]).toEqual({
      id: 'tx-spotify', amount: 7.93, date: '2026-08-17', origin: 'synced',
    });
  });

  it('⚠️ RECORDS THE REVERSAL, carrying the figure the press is about to destroy', async () => {
    mocks.realTransactions = [TYPED_SPOTIFY];
    mocks.syncedTransactions = [SPOTIFY_CHARGE];
    mocks.reviews = [ANSWERED];
    renderInAugust();
    // The date is only needed while the page RENDERS; `waitFor` needs real ones to poll on.
    vi.useRealTimers();
    fireEvent.click(within(spotifyRow()).getByText(/Bank says \$7\.93/));
    await waitFor(() => expect(mocks.recordApplied).toHaveBeenCalled());
    const action = mocks.recordApplied.mock.calls[0][0];
    expect(action.kind).toBe('ledger_reconcile');
    expect(action.steps).toEqual([{
      write: 'restoreTransaction',
      chargeId: 'stx-spotify',
      transactionId: 'tx-spotify',
      amount: 8,          // THE TYPED FIGURE — gone from the row the moment the patch lands.
      date: '2026-08-17',
      origin: 'manual',
    }]);
  });

  it('⚠️ RECORDS NO UNDO WHEN THE WRITE FAILED — a reversal for a write that never happened is a lie', async () => {
    mocks.realTransactions = [TYPED_SPOTIFY];
    mocks.syncedTransactions = [SPOTIFY_CHARGE];
    mocks.reviews = [ANSWERED];
    mocks.updateAsync = vi.fn().mockRejectedValue(new Error('network'));
    renderInAugust();
    // The date is only needed while the page RENDERS; `waitFor` needs real ones to poll on.
    vi.useRealTimers();
    fireEvent.click(within(spotifyRow()).getByText(/Bank says \$7\.93/));
    await waitFor(() => expect(mocks.updateAsync).toHaveBeenCalled());
    expect(mocks.recordApplied).not.toHaveBeenCalled();
  });
});
