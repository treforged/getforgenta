// @vitest-environment jsdom
//
// THE SHOP WINDOW MUST NOT CONTRADICT ITSELF.
//
// Measured in Chrome on 2026-09-13, in demo on /dashboard: the "Jordan's Story" card said
// "$12,700 in CC debt ... a plan that clears the cards in a little over a year" and then, in the
// very next sentence, "Every number here is live-calculated from the data below." The tiles inches
// away read CC DEBT $6,482, and both /dashboard and /debt read "Not within 5 years".
//
// ⚠️ THIS IS THE SALES SURFACE, WHICH IS WHY IT IS WORSE THAN AN ORDINARY COPY BUG. The one
// sentence asking a stranger to trust the numbers carried two figures the app denied on the same
// screen. ($12,700 was the RETIREMENT tile's value — a hardcoded number that went stale when the
// demo data moved, with nothing to notice.)
//
// So the test is not "the copy says the right thing". It is: does the sentence agree with the data
// the page is rendering, whatever that data becomes? The last case changes the data to prove it.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const ACCOUNT = {
  id: 'acc-1', user_id: 'u1', name: 'Everyday Checking', account_type: 'checking',
  balance: 4200, active: true, created_at: '2026-01-01T00:00:00Z',
};

/** An open card carrying a balance — `accountSummary.ccDebt` sums exactly these. */
const CARD = {
  id: 'card-1', user_id: 'u1', name: 'Prime Visa', account_type: 'credit_card',
  balance: 6482, credit_limit: 10000, active: true, created_at: '2026-01-01T00:00:00Z',
};

vi.mock('@/hooks/useSupabaseData', () => ({
  useTransactions: () => ({ data: [], loading: false }),
  useAccounts: () => ({ data: [ACCOUNT, CARD], loading: false }),
  useProfile: () => ({ data: { onboarding_completed: true, founder_note_seen: true }, loading: false }),
  useNetWorthSnapshots: () => ({ data: [], loading: false }),
  useBudgetItems: () => ({ data: [], loading: false }),
  useDebts: () => ({ data: [], loading: false }),
  useSavingsGoals: () => ({ data: [], loading: false }),
  useCarFunds: () => ({ data: [], loading: false }),
  useRecurringRules: () => ({ data: [], loading: false }),
  useAssets: () => ({ data: [], loading: false }),
  useLiabilities: () => ({ data: [], loading: false }),
  usePaymentPlans: () => ({ data: [] }),
  useSyncedTransactions: () => ({ data: [] }),
  useSyncedTransactionReviewsQuery: () => ({ data: [] }),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
// The card only renders in demo — that is the whole point of it.
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: true }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: true }) }));
vi.mock('@/hooks/usePlaidItems', () => ({ usePlaidItems: () => ({ items: [] }) }));
vi.mock('@/hooks/useRetirementAutoUpdate', () => ({ useRetirementAutoUpdate: () => undefined }));
vi.mock('@/hooks/useNetWorthSnapshotRecorder', () => ({ useNetWorthSnapshotRecorder: () => undefined }));
vi.mock('@/hooks/useWidgetSync', () => ({ useWidgetSync: () => undefined }));
vi.mock('@/hooks/useLeaderboardPublisher', () => ({ useLeaderboardPublisher: () => undefined }));
vi.mock('@/hooks/useMonth0DebtBreakdown', () => ({
  useMonth0DebtBreakdown: () => ({ recommendations: [], totalMinimumsDue: 0, totalRecommended: 0 }),
}));
// No projection, so there is NO payoff month — exactly the live demo state that made the old
// "clears the cards in a little over a year" a contradiction.
vi.mock('@/contexts/CardProjectionContext', () => ({
  useCardProjectionContext: () => ({ cardProjection: null, pauseSavings: false, debtStrategy: 'avalanche' }),
}));
vi.mock('@/hooks/useDashboardLayout', () => ({
  useDashboardLayout: () => ({
    layout: [], setLayout: vi.fn(), visibleWidgets: [],
    isCustomizing: false, setCustomizing: vi.fn(), resetLayout: vi.fn(),
  }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { mfa: { listFactors: () => Promise.resolve({ data: null }) } } },
}));
vi.mock('@/components/shared/AppTour', () => ({ default: () => null }));
vi.mock('@/components/shared/AccountUpdateReminder', () => ({ default: () => null }));
vi.mock('@/components/dashboard/SubscriptionExpiryBanner', () => ({ default: () => null }));
vi.mock('@/components/dashboard/OnboardingChecklist', () => ({ default: () => null }));
vi.mock('@/components/dashboard/DashboardCustomizer', () => ({ default: () => null }));
vi.mock('@/components/dashboard/DashboardHero', () => ({ default: () => null }));
vi.mock('@/components/dashboard/DashboardOverviewStrip', () => ({ default: () => null }));
vi.mock('@/components/dashboard/MonthlyBudgetSnapshot', () => ({ default: () => null }));
vi.mock('@/components/dashboard/NetWorthTrendCard', () => ({ default: () => null }));
vi.mock('@/components/dashboard/DebtRecommendationsWidget', () => ({ default: () => null }));
vi.mock('@/components/shared/FounderNoteModal', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import Dashboard from '../Dashboard';

function renderDemo() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 15, 9, 0, 0));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><Dashboard /></MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

/** The story paragraph, found by the promise it makes rather than by a brittle selector. */
function story(): HTMLElement {
  const el = screen.getByText(/live-calculated from the data below/).closest('p');
  if (!el) throw new Error('Jordan story paragraph not rendered');
  return el as HTMLElement;
}

describe('Jordan story agrees with the numbers beside it', () => {
  it('states the CC debt the accounts actually total', () => {
    renderDemo();
    expect(story().textContent).toMatch(/\$6,482 in CC debt/);
  });

  it('⚠️ CARRIES NEITHER OF THE TWO STALE HARDCODED FIGURES', () => {
    renderDemo();
    const text = story().textContent ?? '';
    expect(text).not.toMatch(/12,700/);
    expect(text).not.toMatch(/little over a year/);
  });

  it('⚠️ MAKES NO PAYOFF CLAIM WHEN THERE IS NO PAYOFF — the contradiction itself', () => {
    // With no projection there is no payoff month, and both money screens read "Not within 5
    // years". A timeline here would be the app denying its own tiles.
    renderDemo();
    expect(story().textContent).not.toMatch(/clears the cards/);
  });

  it('follows the data when the data changes — which is what "derived" has to mean', () => {
    // The old copy was correct once, too. Only a figure that MOVES with the accounts is a fix.
    CARD.balance = 1234;
    renderDemo();
    expect(story().textContent).toMatch(/\$1,234 in CC debt/);
    CARD.balance = 6482;
  });
});
