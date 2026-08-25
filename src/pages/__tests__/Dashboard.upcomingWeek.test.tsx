// @vitest-environment jsdom
//
// Dashboard, "Upcoming This Week", once a real payment answers a rule's occurrence.
//
// This widget had NO suppression of any kind: a bill already paid went on being listed as upcoming
// for as long as its DUE DATE was still in the seven-day window. Tre, 2026-08-24: "if a transaction
// matches a budget rule, the real transaction date and costs should auto override the transaction
// for that month. the real one should actually show."
//
// Three outcomes, all three asserted below, because the middle one is what makes this a
// substitution rather than a delete:
//   - paid, and the payment is still inside the week → the row shows the REAL date and the REAL
//     amount, marked "paid";
//   - paid early, so the payment is already behind us → the row leaves the week, which is what
//     "upcoming" means;
//   - unmatched → untouched, at the rule's own figures.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

const ACCOUNT = {
  id: 'acc-1', user_id: 'u1', name: 'Everyday Checking', account_type: 'checking',
  balance: 4200, active: true, created_at: '2026-01-01T00:00:00Z',
};

const rule = (over: Record<string, unknown>) => ({
  user_id: 'u1', rule_type: 'expense', frequency: 'monthly', due_month: null,
  deposit_account: null, start_date: null, end_date: null, notes: null, active: true,
  created_at: '2026-01-01T00:00:00Z', payment_source: 'acc-1', category: 'Bills', ...over,
});

// Due the 28th, settled on the 26th — still ahead of "today" (the 25th), so it stays in the week.
const RENT = rule({ id: 'rule-rent', name: 'Rent', amount: 1600, due_day: 28 });
const RENT_CHARGE = {
  id: 'stx-rent', account_id: 'acc-1', amount: 1608.42, date: '2026-08-26',
  pending: false, name: 'GREYSTAR RENT', merchant_name: 'Greystar',
};

// Due the 27th, settled on the 24th — already behind us, so it drops out of the week entirely.
const INTERNET = rule({ id: 'rule-net', name: 'Internet', amount: 80, due_day: 27 });
const INTERNET_CHARGE = {
  id: 'stx-net', account_id: 'acc-1', amount: 80, date: '2026-08-24',
  pending: false, name: 'XFINITY', merchant_name: 'Xfinity',
};

// Due the 29th, nothing answers it.
const PHONE = rule({ id: 'rule-phone', name: 'Phone', amount: 45, due_day: 29 });

vi.mock('@/hooks/useSupabaseData', () => ({
  useTransactions: () => ({ data: [], loading: false }),
  useAccounts: () => ({ data: [ACCOUNT], loading: false }),
  useProfile: () => ({ data: { onboarding_completed: true, founder_note_seen: true }, loading: false }),
  useNetWorthSnapshots: () => ({ data: [], loading: false }),
  useDebts: () => ({ data: [], loading: false }),
  useSavingsGoals: () => ({ data: [], loading: false }),
  useCarFunds: () => ({ data: [], loading: false }),
  useRecurringRules: () => ({ data: [RENT, INTERNET, PHONE], loading: false }),
  useAssets: () => ({ data: [], loading: false }),
  useLiabilities: () => ({ data: [], loading: false }),
  usePaymentPlans: () => ({ data: [] }),
  useSyncedTransactions: () => ({ data: [RENT_CHARGE, INTERNET_CHARGE] }),
  useSyncedTransactionReviewsQuery: () => ({ data: [] }),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: true }) }));
vi.mock('@/hooks/usePlaidItems', () => ({ usePlaidItems: () => ({ items: [] }) }));
vi.mock('@/hooks/useRetirementAutoUpdate', () => ({ useRetirementAutoUpdate: () => undefined }));
vi.mock('@/hooks/useNetWorthSnapshotRecorder', () => ({ useNetWorthSnapshotRecorder: () => undefined }));
vi.mock('@/hooks/useWidgetSync', () => ({ useWidgetSync: () => undefined }));
vi.mock('@/hooks/useMonth0DebtBreakdown', () => ({
  useMonth0DebtBreakdown: () => ({ recommendations: [], totalMinimumsDue: 0, totalRecommended: 0 }),
}));
vi.mock('@/contexts/CardProjectionContext', () => ({
  useCardProjectionContext: () => ({ cardProjection: null, pauseSavings: false, debtStrategy: 'avalanche' }),
}));
// Only the one widget, so this test is about the widget rather than about the whole page.
vi.mock('@/hooks/useDashboardLayout', () => ({
  useDashboardLayout: () => ({
    layout: [], setLayout: vi.fn(), visibleWidgets: ['upcoming_week'],
    isCustomizing: false, setCustomizing: vi.fn(), resetLayout: vi.fn(),
  }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { mfa: { listFactors: () => Promise.resolve({ data: null }) } } },
}));
// Fixed furniture above the widget list. None of it is about matching, and each owns queries or a
// chart library that jsdom has nothing useful to do with.
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

function renderOnTheTwentyFifth() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 25, 9, 0, 0));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><Dashboard /></MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The Upcoming This Week card. */
function widget(): HTMLElement {
  const heading = screen.getByText('Upcoming This Week');
  const card = heading.closest('.card-forged');
  if (!card) throw new Error('no Upcoming This Week card');
  return card as HTMLElement;
}

/** One bill row inside it, by name. */
function row(name: string): HTMLElement {
  const label = within(widget()).getByText(name);
  const el = label.closest('.flex.items-center.justify-between');
  if (!el) throw new Error(`no upcoming row for ${name}`);
  return el as HTMLElement;
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Dashboard, Upcoming This Week', () => {
  it('shows a settled bill at its REAL date and REAL amount, marked paid', () => {
    renderOnTheTwentyFifth();

    const rent = row('Rent');
    expect(within(rent).getByText('Aug 26')).toBeTruthy();   // settled, not the 28th it was due
    expect(within(rent).getByText('$1,608')).toBeTruthy();   // what left the account, not $1,600
    expect(within(rent).getByText('paid')).toBeTruthy();
  });

  it('stops listing a bill that was already paid before today', () => {
    renderOnTheTwentyFifth();

    // Due the 27th, so it was inside the window and listed as upcoming until this change.
    expect(within(widget()).queryByText('Internet')).toBeNull();
  });

  it('leaves an unmatched bill exactly as the rule predicted it', () => {
    renderOnTheTwentyFifth();

    const phone = row('Phone');
    expect(within(phone).getByText('Aug 29')).toBeTruthy();
    expect(within(phone).getByText('$45')).toBeTruthy();
    expect(within(phone).queryByText('paid')).toBeNull();
  });

  it('lists what is left in date order after a substitution has moved one', () => {
    renderOnTheTwentyFifth();

    const names = [...widget().querySelectorAll('.font-medium')].map(n => n.textContent);
    expect(names).toEqual(['Rent', 'Phone']);
  });
});
