// @vitest-environment jsdom
/**
 * Finish-later mode (fast setup, 2026-10-09). The account is already onboarding_completed via
 * 'wizard', so a fully ticked list must NOT write completion again: markOnboardingComplete(...,
 * 'checklist') would overwrite the attribution every funnel metric reads. The ordinary mode still
 * writes it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const markOnboardingComplete = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/onboarding-state', () => ({ markOnboardingComplete: (...a: unknown[]) => markOnboardingComplete(...(a as [])) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({ update: () => ({ eq: async () => ({}) }) }) } }));
vi.mock('@/components/shared/ReferenceAccountButton', () => ({ default: () => null }));

import OnboardingChecklist from '../OnboardingChecklist';

const card = { id: 'c1', account_type: 'credit_card' } as never;
const mount = (props: Partial<Parameters<typeof OnboardingChecklist>[0]>) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <OnboardingChecklist profile={{ gross_income: 4000 }} accounts={[card]} debts={[]} goals={[{ id: 'g' }]} plaidItems={[]} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => markOnboardingComplete.mockClear());

describe('OnboardingChecklist finish-later mode', () => {
  it('lists bills, counts a credit-card ACCOUNT as a debt, and titles itself "Finish setting up"', () => {
    mount({ finishLater: true, hasBills: false });
    expect(screen.getByText('Finish setting up')).toBeTruthy();
    expect(screen.getByText('Add your monthly bills')).toBeTruthy();
    expect(screen.getByText('4/5 done')).toBeTruthy(); // accounts, income, debt (the card), goals
  });

  it('all done: writes NO completion (the fast path already wrote it, as wizard)', async () => {
    mount({ finishLater: true, hasBills: true });
    expect(screen.getByText('5/5 done')).toBeTruthy();
    await new Promise(r => setTimeout(r, 30));
    expect(markOnboardingComplete).not.toHaveBeenCalled();
  });

  it('ordinary mode is unchanged: no bills item, and a full list still writes checklist completion', async () => {
    mount({});
    expect(screen.queryByText('Add your monthly bills')).toBeNull();
    expect(screen.getByText('4/4 done')).toBeTruthy();
    await waitFor(() => expect(markOnboardingComplete).toHaveBeenCalledWith('u1', 'checklist'));
  });
});
